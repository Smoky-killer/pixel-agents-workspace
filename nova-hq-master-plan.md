# Nova HQ — Master Architecture Plan
## One canvas. 6 companies. Real agents. Live.

---

## 🗺️ The Grid Layout

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│               CLAUDE BLOCK  (full width)            │
│            (your personal Claude Code zone)         │
│                                                     │
├─────────────────────────┬───────────────────────────┤
│                         │                           │
│     OPENCLAW BLOCK 1    │     OPENCLAW BLOCK 2      │
│   [JARVIS, NOVA, etc.]  │  [ATLAS, SCRIBE, etc.]    │
│                         │                           │
├─────────────────────────┼───────────────────────────┤
│                         │                           │
│     OPENCLAW BLOCK 3    │     OPENCLAW BLOCK 4      │
│  [PIXEL, VIBE, etc.]    │  [TRENDY, CLIP, etc.]     │
│                         │                           │
└─────────────────────────┴───────────────────────────┘
```

5 zones total. Claude block spans the full top row (wider, premium feel — it's your personal command center). The 4 OpenClaw blocks sit in a 2×2 grid below it.

Each block = its own named "company zone" with:
- Company name label (e.g. "NOVA HQ", "VISION CO", "ATLAS OPS")
- Individual desks, named agent characters, status lights
- Green light = active/working, Red light = idle
- Agents walk between desks WITHIN their zone
- Zone border glows when that OpenClaw is busy

---

## 🏗️ Architecture: 3 Layers

### Layer 1 — Multi-Zone Canvas (pixel-agents fork)
The biggest change. pixel-agents currently supports ONE flat office. We need a **zoned canvas**.

```
OfficeState (current)
  └── characters[]
  └── furniture[]
  └── tileMap[][]

ZonedOfficeState (new)
  └── zones: Map<zoneId, Zone>
        └── Zone {
              id: string         // "openclaw-1", "claude-1" etc.
              name: string       // "NOVA HQ"
              offsetCol: number  // where this zone starts on the grid
              offsetRow: number
              tileMap[][]
              furniture[]
              characters[]
              source: 'openclaw' | 'claude'
              color: ZoneColor   // border/accent color per zone
            }
```

Zone sizes:
- Each zone = ~20×15 tiles (matches screenshot aesthetic)
- 2px wall border between zones
- Zone label drawn above top-left corner
- Total canvas = ~42×48 tiles (fits 2x3 grid with borders)

---

### Layer 2 — Multi-Source JSONL Bridge

Each OpenClaw instance runs in its own VNC session on the same PC. They each have their own `~/.claude/projects/<hash>/` directory.

```
nova-hq-bridge/
  ├── bridge.js              # Main process, watches all JSONL paths
  ├── sources.config.json    # Maps zone IDs to JSONL paths
  └── discord-connector.js   # Discord webhook listener
```

**sources.config.json:**
```json
{
  "zones": [
    {
      "id": "openclaw-1",
      "name": "NOVA HQ",
      "color": "#FFD700",
      "jsonlDir": "/home/user/.claude/projects/openclaw-1/",
      "agents": [
        { "agentId": 0, "name": "NOVA",    "role": "commander",  "palette": 0 },
        { "agentId": 1, "name": "JARVIS",  "role": "dispatcher", "palette": 1 },
        { "agentId": 2, "name": "SCRIBE",  "role": "worker",     "palette": 2 },
        { "agentId": 3, "name": "ATLAS",   "role": "worker",     "palette": 3 }
      ]
    },
    {
      "id": "openclaw-2",
      "name": "VISION CO",
      "color": "#44AAFF",
      "jsonlDir": "/home/user/.claude/projects/openclaw-2/",
      "agents": [...]
    },
    {
      "id": "openclaw-3",
      "name": "PIXEL OPS",
      "color": "#AA55CC",
      "jsonlDir": "/home/user/.claude/projects/openclaw-3/",
      "agents": [...]
    },
    {
      "id": "openclaw-4",
      "name": "CLOSE SQUAD",
      "color": "#FF8844",
      "jsonlDir": "/home/user/.claude/projects/openclaw-4/",
      "agents": [...]
    },
    {
      "id": "claude-1",
      "name": "CLAUDE LAB",
      "color": "#44CC88",
      "jsonlDir": "/home/user/.claude/projects/claude-1/",
      "layout": "wide",
      "agents": [...]
    }
  ]
}
```

The bridge watches ALL directories simultaneously, deduplicates events by zone, and emits unified WebSocket messages to the pixel-agents webview.

---

### Layer 3 — Discord Connector

When a Discord message arrives at a monitored channel:

```
Discord message received
  → Parse which zone/agent it's addressed to
  → Emit { type: 'discordMessage', zone, agentName, text, from }
  → That agent's character walks to the "Discord desk"
     (a special desk in each zone with a Discord logo above it)
  → Speech bubble shows: "📨 [username]: [message preview]"
  → Top HUD shows: "🟣 Discord → NOVA: '[text]'"
  → Agent sits at Discord desk and enters TALK state
  → If it's a command, the normal Nova→Dispatcher→Worker chain fires
```

**Discord desk** = a special furniture piece in each zone, top-right corner, with a purple/blurple indicator light. Always glows when a message is waiting.

---

## 🎨 Character System — Custom Per Agent

### Existing Palette System
pixel-agents uses 6 palettes (hair/skin/shirt/pants/shoes color sets). We extend this to:

**Per-Agent Character Config** (in sources.config.json):
```json
{
  "name": "NOVA",
  "palette": 0,
  "hueShift": 0,
  "badge": "crown",      // crown | wrench | magnifier | lightning | star | none
  "deskType": "executive" // executive | standard | lab | monitor-wall
}
```

**New badge icons** (rendered above character head):
- 👑 `crown` — Commander (Nova, Jarvis)
- ⚙️ `wrench` — Builder/Coder agents  
- 🔍 `magnifier` — Researcher agents
- ⚡ `lightning` — Fast/executor agents
- ★ `star` — Special/featured agents

Badges are small 8x8 pixel sprites rendered at character head level, persistent (not a bubble).

### Character Selector UI
New panel in settings: grid of all available characters (palette 0-5 × hueShift variations), click to assign to an agent. Changes saved to sources.config.json. Live update in canvas — no restart needed.

---

## 🗂️ Zone Office Layout — Per Zone Interior

Each zone's interior (20×15 tiles) follows a template:

```
┌──────────────────────────────┐  ← Zone name label
│  [Discord desk] [Conf table] │  ← Top area: comms + meeting
│                              │
│  [Desk][Desk]  [Desk][Desk]  │  ← Agent rows
│  NAME   NAME    NAME   NAME  │
│   🔴     🟢      🟢     🔴   │  ← Status lights
│                              │
│  [Plant] [Printer] [Coffee]  │  ← Decorations
└──────────────────────────────┘
```

Zones are separated by a 1-tile dark border ("wall"). Zone accent color glows on the border.

---

## 📺 Top HUD — Multi-Zone Feed

The top bar now shows zone-prefixed messages:

```
[NOVA HQ ★] NOVA→JARVIS: "Build the API"  ·  [VISION CO] SCRIBE searching files  ·  🟣 Discord→ATLAS: "Ship it"
```

Color coded by zone accent color. Scrolls automatically. Click a message to camera-pan to that zone.

---

## 📋 Build Order

| Phase | What | Complexity |
|-------|------|-----------|
| 1 | `sources.config.json` schema + loader | Low |
| 2 | Multi-zone tileMap renderer (offset zones on one canvas) | High |
| 3 | Multi-source JSONL bridge (watch N directories) | Medium |
| 4 | Per-agent character selector UI | Medium |
| 5 | Badge sprites (crown, wrench, etc.) | Low |
| 6 | Discord connector + Discord desk furniture | Medium |
| 7 | Zone border glow + status lights | Low |
| 8 | HUD multi-zone labels + click-to-pan | Medium |

Estimated: Phases 1-3 = core system working. Phases 4-8 = full polish.

---

---

## ⚙️ FULL CUSTOMIZATION REFERENCE
### Everything is in `sources.config.json` — no code edits needed after setup

```jsonc
{
  // ─── GLOBAL SETTINGS ────────────────────────────────────────
  "global": {
    "canvasTitle": "Nova HQ",            // Title shown at top of the panel
    "gridLayout": "1-top-2x2-bottom",    // "1-top-2x2-bottom" | "2x3" | "1x5-vertical"
    "tileSize": 16,                       // Sprite tile size in px (don't change unless you rebuild sprites)
    "defaultZoom": 2,                     // Starting zoom level (1-4)
    "hudMaxMessages": 6,                  // Messages shown in top bar before scroll
    "agentWalkSpeed": 64,                 // Pixels/sec walk speed
    "speechBubbleDuration": 4,           // Seconds speech bubbles stay visible
    "statusLightColors": {
      "active": "#00FF88",               // Hex color for working/active light
      "idle":   "#FF3333"                // Hex color for idle light
    }
  },

  // ─── ZONES ──────────────────────────────────────────────────
  "zones": [
    {
      "id": "claude-main",               // Internal ID (used in logs, never shown)
      "name": "CLAUDE HQ",               // Display name shown above zone
      "position": "top",                 // "top" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
      "accentColor": "#44CC88",          // Zone border glow + HUD label color
      "source": "claude",                // "claude" | "openclaw"

      // ── File paths ─────────────────────────────────────────
      "jsonlDir": "~/.claude/projects/claude-main/",  // Where to watch JSONL files
      // If running under a different Linux user (VNC session):
      // "jsonlDir": "/home/otheruser/.claude/projects/hash123/",

      // ── Layout ─────────────────────────────────────────────
      "roomStyle": "modern",             // "modern" | "classic" | "lab" | "minimal"
      "hasConferenceTable": true,        // Add a conference table to the zone
      "hasDiscordDesk": true,            // Add Discord desk (top-right of zone)
      "hasCoffeeMachine": true,          // Add coffee machine decoration
      "hasPlants": true,                 // Add plant decorations
      "hasPingPongTable": false,         // Add ping pong table (gym area)

      // ── Agents ─────────────────────────────────────────────
      "agents": [
        {
          "agentId": 0,
          "name": "CLAUDE",
          "role": "commander",           // "commander" | "dispatcher" | "worker" | "researcher" | "builder"
          "palette": 0,                  // 0-5 (base color palette)
          "hueShift": 0,                 // -180 to 180 (color hue rotation on top of palette)
          "badge": "crown",             // "crown" | "wrench" | "magnifier" | "lightning" | "star" | "none"
          "deskType": "executive",       // "executive" | "standard" | "lab" | "monitor-wall" | "standing"
          "deskPosition": { "col": 3, "row": 5 }  // Optional manual placement (auto if omitted)
        }
      ]
    },

    {
      "id": "openclaw-1",
      "name": "NOVA HQ",
      "position": "middle-left",
      "accentColor": "#FFD700",
      "source": "openclaw",
      "jsonlDir": "~/.claude/projects/openclaw-1/",
      "roomStyle": "classic",
      "hasConferenceTable": true,
      "hasDiscordDesk": true,
      "hasCoffeeMachine": false,
      "hasPlants": true,
      "agents": [
        { "agentId": 0, "name": "NOVA",   "role": "commander",  "palette": 1, "badge": "crown",      "deskType": "executive" },
        { "agentId": 1, "name": "JARVIS", "role": "dispatcher", "palette": 2, "badge": "lightning",  "deskType": "standard" },
        { "agentId": 2, "name": "SCRIBE", "role": "worker",     "palette": 3, "badge": "magnifier",  "deskType": "standard" },
        { "agentId": 3, "name": "ATLAS",  "role": "researcher", "palette": 4, "badge": "none",       "deskType": "lab" }
      ]
    },

    {
      "id": "openclaw-2",
      "name": "VISION CO",
      "position": "middle-right",
      "accentColor": "#44AAFF",
      "source": "openclaw",
      "jsonlDir": "~/.claude/projects/openclaw-2/",
      "roomStyle": "lab",
      "agents": [
        { "agentId": 0, "name": "PIXEL",  "role": "commander",  "palette": 0, "badge": "crown",   "deskType": "executive" },
        { "agentId": 1, "name": "VIBE",   "role": "dispatcher", "palette": 5, "badge": "star",    "deskType": "standard" },
        { "agentId": 2, "name": "SAGE",   "role": "researcher", "palette": 2, "badge": "magnifier","deskType": "lab" }
      ]
    },

    {
      "id": "openclaw-3",
      "name": "PIXEL OPS",
      "position": "bottom-left",
      "accentColor": "#AA55CC",
      "source": "openclaw",
      "jsonlDir": "~/.claude/projects/openclaw-3/",
      "roomStyle": "modern",
      "agents": [
        { "agentId": 0, "name": "TRENDY", "role": "commander",  "palette": 3, "badge": "crown",   "deskType": "executive" },
        { "agentId": 1, "name": "CLIP",   "role": "worker",     "palette": 1, "badge": "wrench",  "deskType": "standard" },
        { "agentId": 2, "name": "CLOSER", "role": "worker",     "palette": 4, "badge": "lightning","deskType": "standard" }
      ]
    },

    {
      "id": "openclaw-4",
      "name": "ORACLE OPS",
      "position": "bottom-right",
      "accentColor": "#FF8844",
      "source": "openclaw",
      "jsonlDir": "~/.claude/projects/openclaw-4/",
      "roomStyle": "minimal",
      "agents": [
        { "agentId": 0, "name": "ORACLE",    "role": "commander",  "palette": 5, "badge": "crown",     "deskType": "executive" },
        { "agentId": 1, "name": "SENTINEL",  "role": "dispatcher", "palette": 0, "badge": "lightning", "deskType": "standard" }
      ]
    }
  ],

  // ─── DISCORD INTEGRATION ────────────────────────────────────
  "discord": {
    "enabled": true,
    "token": "YOUR_BOT_TOKEN_HERE",     // Bot token from Discord Developer Portal
    "channels": [
      {
        "channelId": "123456789",        // Discord channel ID (right-click → Copy ID)
        "targetZone": "openclaw-1",      // Which zone receives this channel's messages
        "targetAgent": "NOVA"            // Which agent walks to Discord desk (optional, defaults to commander)
      },
      {
        "channelId": "987654321",
        "targetZone": "claude-main",
        "targetAgent": "CLAUDE"
      }
    ]
  }
}
```

### What You Can Change Without Touching Code
| Setting | Where | Effect |
|---------|-------|--------|
| Zone names | `zones[].name` | Updates display label on canvas |
| JSONL path | `zones[].jsonlDir` | Points bridge to different OpenClaw instance |
| Agent names | `agents[].name` | Updates nameplate above desk |
| Agent color | `agents[].palette` + `hueShift` | Changes character appearance live |
| Agent badge | `agents[].badge` | Changes icon above head |
| Desk type | `agents[].deskType` | Changes furniture at their spot |
| Zone color | `zones[].accentColor` | Changes border glow + HUD color |
| Room style | `zones[].roomStyle` | Changes floor/wall theme |
| Walk speed | `global.agentWalkSpeed` | Faster or slower character movement |
| Bubble time | `global.speechBubbleDuration` | How long messages stay visible |
| Discord | `discord.channels[]` | Add/remove channel routing |

---

## ❓ Remaining Questions Before Phase 1

1. **JSONL paths** — do all 4 OpenClaws share one Linux user home (`~/.claude/`) or do they each run as different Linux users in their VNC sessions? This determines the actual paths in `jsonlDir`.
2. **Zone names** — what do you want to call each of the 4 OpenClaw zones? Fill in the names and I'll pre-populate the config.
3. **Agent roster per zone** — which agents are in each OpenClaw? (copy-paste from your configs is fine)
4. **Discord** — bot token or webhook URL? Which server/channels should route to which zone?
