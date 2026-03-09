'use strict';

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const config = require('../config.json');
const sourcesConfig = require('../sources.config.json');
const { readLayout, writeLayout, readAgentSeats, writeAgentSeats, watchLayout } = require('./layoutStore.js');
const { MultiZoneBridge } = require('./multiZoneBridge.js');
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

// ── Express app ──────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));

const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <!DOCTYPE html><html><body style="font-family:monospace;background:#1e1e2e;color:#cdd6f4;padding:2rem">
      <h2>Nova HQ</h2>
      <p>Frontend not built yet. Run: <code>npm run build</code></p>
      <p>Or for development: <code>npm run dev</code> (starts both server and Vite dev server)</p>
      <p>Then open: <a href="http://localhost:5173" style="color:#89b4fa">http://localhost:5173</a></p>
      </body></html>
    `);
  }
});

// API: get sources config (zones, agents)
app.get('/api/config', (req, res) => {
  res.json(sourcesConfig);
});

app.get('/api/agents', (req, res) => {
  const agents = bridge.getRegistry().all().map(a => ({
    id: a.id,
    name: a.name,
    sessionId: a.sessionId,
    isWaiting: a.isWaiting,
    zoneId: a.zoneId,
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
  broadcastAll({ type: 'layoutLoaded', layout });
  res.json({ ok: true });
});

const httpServer = http.createServer(app);
httpServer.listen(PORT, () => {
  console.log(`[Server] HTTP server running at http://localhost:${PORT}`);
});

// ── WebSocket server ─────────────────────────────────────
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[Server] WebSocket server running at ws://localhost:${WS_PORT}`);
});

function broadcastAll(msg) {
  const json = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

// ── Multi-Zone Bridge ────────────────────────────────────
const bridge = new MultiZoneBridge({
  sourcesConfig,
  broadcast: broadcastAll,
});

// ── Layout watcher ───────────────────────────────────────
const layoutWatcher = watchLayout((layout) => {
  console.log('[Server] External layout change - broadcasting');
  broadcastAll({ type: 'layoutLoaded', layout });
});

// ── Browser WebSocket connection handler ─────────────────
wss.on('connection', (ws) => {
  console.log('[Server] Browser client connected');

  // Send zone gateway statuses
  const gatewayStatus = bridge.getZoneGatewayStatus();
  ws.send(JSON.stringify({ type: 'zoneGatewayStatuses', statuses: gatewayStatus }));

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

function sendInitSequence(ws) {
  function send(msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // 0. Sources config (zones, agents, global settings)
  send({ type: 'sourcesConfig', config: sourcesConfig });

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

  // 5. Layout
  const savedLayout = readLayout();
  const layout = savedLayout || cachedDefaultLayout || null;
  send({ type: 'layoutLoaded', layout });

  // 6. Sound settings
  send({ type: 'settingsLoaded', soundEnabled: true });

  // 7. Existing agents (grouped by zone)
  const seatData = readAgentSeats();
  const existingMsg = bridge.getRegistry().toExistingAgentsMessage(seatData);
  // Add zone information to existing agents
  const agentZones = {};
  for (const agent of bridge.getRegistry().all()) {
    agentZones[agent.id] = agent.zoneId || null;
  }
  existingMsg.agentZones = agentZones;
  send(existingMsg);
}

function handleBrowserMessage(ws, msg) {
  switch (msg.type) {
    case 'webviewReady':
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
      break;

    case 'closeAgent':
      bridge.handleBrowserMessage(msg);
      break;

    case 'focusAgent':
      break;

    case 'openSessionsFolder':
      break;

    case 'exportLayout': {
      const layout = readLayout() || cachedDefaultLayout;
      if (layout) {
        ws.send(JSON.stringify({ type: 'exportLayoutData', json: JSON.stringify(layout, null, 2) }));
      }
      break;
    }

    case 'importLayout':
      break;

    default:
      break;
  }
}

// ── Start the bridge ─────────────────────────────────────
bridge.start();

console.log('[Server] Nova HQ started');
console.log(`[Server]  -> Open http://localhost:${PORT} in your browser`);
console.log(`[Server]  -> Watching ${bridge.getZones().length} zones`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  bridge.stop();
  layoutWatcher.dispose();
  httpServer.close();
  wss.close();
  process.exit(0);
});
