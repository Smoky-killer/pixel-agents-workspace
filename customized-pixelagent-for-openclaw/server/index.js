'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('../config.json');
const { readLayout, writeLayout, readAgentSeats, writeAgentSeats, watchLayout } = require('./layoutStore.js');
const { OpenClawBridge } = require('./openclawBridge.js');
const {
  loadCharacterSprites,
  loadWallTiles,
  loadFloorTiles,
  loadFurnitureAssets,
  loadDefaultLayout,
} = require('./assetLoader.js');

const PORT = config.serverPort || 3000;
const WS_PORT = config.wsPort || 3001;

// ── Resolve assets directory ──────────────────────────────
// Dev: webview-ui/public/assets/
// Prod: public/assets/ (after build)
const PROJECT_ROOT = path.join(__dirname, '..');
const DEV_ASSETS = path.join(PROJECT_ROOT, 'webview-ui', 'public', 'assets');
const PROD_ASSETS = path.join(PROJECT_ROOT, 'public', 'assets');
const ASSETS_DIR = fs.existsSync(DEV_ASSETS) ? DEV_ASSETS : PROD_ASSETS;

console.log(`[Server] Assets directory: ${ASSETS_DIR}`);

// ── Pre-load assets once at startup ──────────────────────
let cachedCharSprites = null;
let cachedWallTiles = null;
let cachedFloorTiles = null;
let cachedFurnitureAssets = null;
let cachedDefaultLayout = null;

function loadAssets() {
  console.log('[Server] Loading assets...');
  cachedCharSprites = loadCharacterSprites(ASSETS_DIR);
  cachedWallTiles = loadWallTiles(ASSETS_DIR);
  cachedFloorTiles = loadFloorTiles(ASSETS_DIR);
  cachedFurnitureAssets = loadFurnitureAssets(ASSETS_DIR);
  cachedDefaultLayout = loadDefaultLayout(ASSETS_DIR);
  console.log('[Server] Assets loaded.');
}

loadAssets();

// ── Express app (HTTP, serves frontend) ──────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve built frontend from public/
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
app.use(express.static(PUBLIC_DIR));

// Dev mode: if public/index.html doesn't exist, serve a redirect to Vite dev server
app.get('/', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Dev mode — tell user to run `npm run build` or use `npm run dev`
    res.send(`
      <!DOCTYPE html><html><body style="font-family:monospace;background:#1e1e2e;color:#cdd6f4;padding:2rem">
      <h2>pixelagent-for-openclaw</h2>
      <p>Frontend not built yet. Run: <code>npm run build</code></p>
      <p>Or for development: <code>npm run dev</code> (starts both server and Vite dev server)</p>
      <p>Then open: <a href="http://localhost:5173" style="color:#89b4fa">http://localhost:5173</a></p>
      </body></html>
    `);
  }
});

// API routes
app.get('/api/agents', (req, res) => {
  const agents = bridge.getRegistry().all().map(a => ({
    id: a.id,
    name: a.name,
    sessionId: a.sessionId,
    isWaiting: a.isWaiting,
  }));
  res.json({ agents });
});

app.get('/api/layout', (req, res) => {
  const layout = readLayout() || cachedDefaultLayout;
  res.json(layout || {});
});

app.post('/api/layout', (req, res) => {
  const layout = req.body;
  if (!layout || layout.version !== 1 || !Array.isArray(layout.tiles)) {
    return res.status(400).json({ error: 'Invalid layout' });
  }
  layoutWatcher.markOwnWrite();
  writeLayout(layout);
  // Broadcast to all browser clients
  broadcastAll({ type: 'layoutLoaded', layout });
  res.json({ ok: true });
});

app.post('/api/agents/start', (req, res) => {
  bridge.handleBrowserMessage({ type: 'openClaude', folderPath: req.body?.folderPath });
  res.json({ ok: true });
});

// HTTP server (serves Express)
const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`[Server] HTTP server running at http://localhost:${PORT}`);
});

// ── WebSocket server (browser-facing, port 3001) ─────────
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[Server] WebSocket server running at ws://localhost:${WS_PORT}`);
});

/** Broadcast a message to all connected browser clients */
function broadcastAll(msg) {
  const json = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

// ── OpenClaw Bridge ────────────────────────────────────────
const bridge = new OpenClawBridge({
  gatewayUrl: config.openclawGatewayUrl,
  broadcast: broadcastAll,
});

// ── Layout watcher ─────────────────────────────────────────
const layoutWatcher = watchLayout((layout) => {
  console.log('[Server] External layout change — broadcasting to browsers');
  broadcastAll({ type: 'layoutLoaded', layout });
});

// ── Browser WebSocket connection handler ──────────────────
wss.on('connection', (ws, req) => {
  console.log('[Server] Browser client connected');

  // Send gateway status immediately
  ws.send(JSON.stringify({ type: 'gatewayStatus', connected: bridge.isGatewayConnected() }));

  // Send a one-shot "init" sequence to this new client
  sendInitSequence(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleBrowserMessage(ws, msg);
    } catch {}
  });

  ws.on('close', () => {
    console.log('[Server] Browser client disconnected');
  });

  ws.on('error', () => {});
});

/**
 * Send assets + layout + existingAgents to a newly-connected browser client.
 * Matches the load order from PixelAgentsViewProvider:
 *   characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded → furnitureAssetsLoaded → layoutLoaded → existingAgents
 */
function sendInitSequence(ws) {
  function send(msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // 1. Character sprites
  if (cachedCharSprites) {
    send({ type: 'characterSpritesLoaded', characters: cachedCharSprites.characters });
  }

  // 2. Floor tiles
  if (cachedFloorTiles) {
    send({ type: 'floorTilesLoaded', sprites: cachedFloorTiles.sprites });
  }

  // 3. Wall tiles
  if (cachedWallTiles) {
    send({ type: 'wallTilesLoaded', sprites: cachedWallTiles.sprites });
  }

  // 4. Furniture assets
  if (cachedFurnitureAssets) {
    send({ type: 'furnitureAssetsLoaded', catalog: cachedFurnitureAssets.catalog, sprites: cachedFurnitureAssets.sprites });
  }

  // 5. Layout (saved or default)
  const savedLayout = readLayout();
  const layout = savedLayout || cachedDefaultLayout || null;
  send({ type: 'layoutLoaded', layout });

  // 6. Sound settings (enabled by default)
  send({ type: 'settingsLoaded', soundEnabled: true });

  // 7. Existing agents
  const seatData = readAgentSeats();
  const existingMsg = bridge.getRegistry().toExistingAgentsMessage(seatData);
  send(existingMsg);
}

/** Handle messages FROM the browser client */
function handleBrowserMessage(ws, msg) {
  switch (msg.type) {
    case 'webviewReady':
      // Re-send init sequence (webview is ready to receive)
      sendInitSequence(ws);
      break;

    case 'saveLayout': {
      const layout = msg.layout;
      if (layout && layout.version === 1 && Array.isArray(layout.tiles)) {
        layoutWatcher.markOwnWrite();
        writeLayout(layout);
      }
      break;
    }

    case 'saveAgentSeats':
      writeAgentSeats(msg.seats || {});
      break;

    case 'setSoundEnabled':
      // Store in memory only (no VS Code globalState in standalone mode)
      break;

    case 'openClaude':
      bridge.handleBrowserMessage(msg);
      break;

    case 'closeAgent':
      bridge.handleBrowserMessage(msg);
      break;

    case 'focusAgent':
      // No-op in standalone mode (no terminal to focus)
      break;

    case 'openSessionsFolder':
      // No-op in standalone mode
      break;

    case 'exportLayout': {
      // Browser handles download natively via vscodeApi.ts intercept — this is a fallback
      const layout = readLayout() || cachedDefaultLayout;
      if (layout) {
        ws.send(JSON.stringify({ type: 'exportLayoutData', json: JSON.stringify(layout, null, 2) }));
      }
      break;
    }

    case 'importLayout': {
      // Browser handles file picker natively — no server-side handling needed
      break;
    }

    default:
      break;
  }
}

// ── Start the bridge ───────────────────────────────────────
bridge.start();

console.log('[Server] pixelagent-for-openclaw started');
console.log(`[Server]  → Open http://localhost:${PORT} in your browser`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  bridge.stop();
  layoutWatcher.dispose();
  httpServer.close();
  wss.close();
  process.exit(0);
});
