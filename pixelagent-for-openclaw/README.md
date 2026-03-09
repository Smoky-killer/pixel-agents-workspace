# pixelagent-for-openclaw

A standalone localhost web app that visualizes OpenClaw/Claude Code agents as pixel art characters in a virtual office.

## Requirements

- Node.js 18+
- OpenClaw (optional — app still works via Claude JSONL file watching)

## Quick Start

```bash
cd pixelagent-for-openclaw
npm install
cd webview-ui && npm install && cd ..
npm run build     # build the frontend once
npm start         # start the server
```

Then open **http://localhost:3000** in your browser.

## Development Mode

```bash
npm run dev
```

Runs Express server (port 3000) + Vite dev server (port 5173) in parallel.  
Open **http://localhost:5173** for hot-reload development.

## Architecture

```
Browser (http://localhost:3000)
  ↕  WebSocket  ws://localhost:3001
Node.js Server (Express + ws)
  ↕  WebSocket client  ws://127.0.0.1:18789
OpenClaw Gateway (optional)
  +
  ↕  File watching
~/.claude/projects/**/*.jsonl  (Claude Code session transcripts)
```

## Config

Edit `config.json` to change ports or gateway URL:

```json
{
  "openclawGatewayUrl": "ws://127.0.0.1:18789",
  "serverPort": 3000,
  "wsPort": 3001
}
```

## Layout Persistence

Office layout is saved to `~/.pixelagent-openclaw/layout.json`.  
Agent seat assignments are saved to `~/.pixelagent-openclaw/agents.json`.

Use **Settings → Export Layout** to download the layout JSON, and **Import Layout** to load one.
