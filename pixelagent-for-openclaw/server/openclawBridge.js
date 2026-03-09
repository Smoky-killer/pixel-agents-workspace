'use strict';

/**
 * OpenClaw Bridge
 *
 * Two-pronged agent tracking:
 *  1. WebSocket client to OpenClaw gateway (ws://127.0.0.1:18789) — primary
 *  2. File-watcher on ~/.openclaw/agents/<name>/sessions/ JSONL files — fallback
 *
 * Broadcasts pixel-agents protocol messages to all connected browser clients.
 *
 * OpenClaw JSONL format (v3):
 *   {"type":"session", "id":"<uuid>", ...}               — session start
 *   {"type":"message", "message":{"role":"assistant",
 *     "content":[{"type":"toolCall","id":"...","name":"...","arguments":{}}]}}
 *                                                          — tool invocation
 *   {"type":"message", "message":{"role":"toolResult",
 *     "toolCallId":"...", "toolName":"..."}}               — tool completion
 *   {"type":"message", "message":{"role":"assistant",
 *     "content":[{"type":"text",...}]}}                   — text-only (idle soon)
 *   {"type":"custom"|"model_change"|"thinking_level_change", ...} — metadata, ignored
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const { AgentRegistry } = require('./agentRegistry.js');

// ── Constants (matches pixel-agents src/constants.ts) ────────
const TOOL_DONE_DELAY_MS = 300;
const PERMISSION_TIMER_DELAY_MS = 7000;
const TEXT_IDLE_DELAY_MS = 5000;
const FILE_POLL_INTERVAL_MS = 1000;
const PROJECT_SCAN_INTERVAL_MS = 1000;
const BASH_COMMAND_MAX = 30;
const TASK_DESC_MAX = 40;

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

// ── Tool status formatter — handles both Claude Code and OpenClaw tool names ──
function formatToolStatus(toolName, args) {
  const base = (p) => (typeof p === 'string' ? path.basename(p) : '');
  // Normalise to lowercase for OpenClaw snake_case names
  const lc = toolName.toLowerCase();
  switch (lc) {
    // OpenClaw native tools
    case 'read':        return `Reading ${base(args.path || args.file_path || args.file || '')}`;
    case 'write':       return `Writing ${base(args.path || args.file_path || args.file || '')}`;
    case 'edit':        return `Editing ${base(args.path || args.file_path || args.file || '')}`;
    case 'exec':
    case 'bash':
    case 'shell':
    case 'run_command': {
      const cmd = args.command || args.cmd || '';
      return `Running: ${cmd.length > BASH_COMMAND_MAX ? cmd.slice(0, BASH_COMMAND_MAX) + '…' : cmd}`;
    }
    case 'glob':
    case 'find_files':  return 'Searching files';
    case 'grep':
    case 'search':
    case 'search_code': return 'Searching code';
    case 'fetch':
    case 'web_fetch':
    case 'webfetch':    return 'Fetching web content';
    case 'web_search':
    case 'websearch':   return 'Searching the web';
    case 'sessions_spawn':
    case 'task': {
      const target = args.agentId || args.agent_id || args.description || '';
      const label = target.length > TASK_DESC_MAX ? target.slice(0, TASK_DESC_MAX) + '…' : target;
      return label ? `Spawning: ${label}` : 'Spawning agent';
    }
    case 'ask_user':
    case 'askuserquestion': return 'Waiting for your answer';
    case 'enterplanmode':   return 'Planning';
    case 'notebookedit':    return 'Editing notebook';
    default:            return `Using ${toolName}`;
  }
}

class OpenClawBridge {
  /**
   * @param {object} opts
   * @param {string} opts.gatewayUrl   — OpenClaw gateway WebSocket URL
   * @param {function} opts.broadcast  — broadcast(msg) to all browser clients
   */
  constructor({ gatewayUrl, broadcast }) {
    this.gatewayUrl = gatewayUrl;
    this.broadcast = broadcast;
    this.registry = new AgentRegistry();
    this.gatewayWs = null;
    this.gatewayConnected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;

    // File watching state
    this.knownJsonlFiles = new Set();
    this.fileWatchers = new Map();   // agentId → FSWatcher
    this.pollingTimers = new Map();  // agentId → setInterval
    this.waitingTimers = new Map();  // agentId → setTimeout
    this.permissionTimers = new Map(); // agentId → setTimeout
    this.projectScanTimer = null;

    // ~/.openclaw/agents/<name>/sessions/ — OpenClaw session directory
    this.openclawAgentsDir = path.join(os.homedir(), '.openclaw', 'agents');
  }

  start() {
    this._connectGateway();
    this._startProjectScan();
  }

  stop() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.projectScanTimer) { clearInterval(this.projectScanTimer); this.projectScanTimer = null; }
    for (const t of this.pollingTimers.values()) clearInterval(t);
    for (const t of this.waitingTimers.values()) clearTimeout(t);
    for (const t of this.permissionTimers.values()) clearTimeout(t);
    for (const w of this.fileWatchers.values()) { try { w.close(); } catch {} }
    if (this.gatewayWs) { try { this.gatewayWs.close(); } catch {} }
  }

  // ── Gateway WebSocket client ──────────────────────────────

  _connectGateway() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    console.log(`[Bridge] Connecting to OpenClaw gateway at ${this.gatewayUrl}`);
    try {
      const ws = new WebSocket(this.gatewayUrl, { handshakeTimeout: 5000 });
      this.gatewayWs = ws;

      ws.on('open', () => {
        console.log('[Bridge] Connected to OpenClaw gateway');
        this.gatewayConnected = true;
        this.reconnectDelay = 1000;
        this.broadcast({ type: 'gatewayStatus', connected: true });
      });

      ws.on('message', (data) => {
        this._handleGatewayMessage(data.toString());
      });

      ws.on('close', () => {
        if (this.gatewayConnected) {
          console.log('[Bridge] Gateway disconnected');
          this.gatewayConnected = false;
          this.broadcast({ type: 'gatewayStatus', connected: false });
        }
        this._scheduleReconnect();
      });

      ws.on('error', (err) => {
        // Connection refused is normal when gateway is offline
        if (!this.gatewayConnected) {
          // Only log on first attempt or periodically
        } else {
          console.log('[Bridge] Gateway error:', err.message);
        }
      });
    } catch (err) {
      console.log('[Bridge] Gateway connect error:', err.message);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connectGateway();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  _handleGatewayMessage(rawData) {
    try {
      const msg = JSON.parse(rawData);
      // Attempt to map OpenClaw gateway events to pixel-agents protocol
      // The exact protocol is unknown — we do best-effort translation
      const type = msg.type || msg.event || msg.kind || '';

      if (type.includes('session') && type.includes('start')) {
        const sessionId = msg.sessionId || msg.id || msg.agentId;
        if (sessionId && !this.registry.hasSession(String(sessionId))) {
          const agent = this.registry.create(String(sessionId), null, msg.name || msg.label);
          this.broadcast({ type: 'agentCreated', id: agent.id });
        }
      } else if (type.includes('session') && (type.includes('end') || type.includes('close'))) {
        const sessionId = msg.sessionId || msg.id || msg.agentId;
        if (sessionId) {
          const agent = this.registry.getBySession(String(sessionId));
          if (agent) this._removeAgent(agent.id);
        }
      } else if (type.includes('tool') && type.includes('start')) {
        this._handleGatewayToolStart(msg);
      } else if (type.includes('tool') && type.includes('done')) {
        this._handleGatewayToolDone(msg);
      } else if (type === 'agentCreated' || type === 'agentClosed' || type === 'agentStatus' ||
                 type === 'agentToolStart' || type === 'agentToolDone' || type === 'agentToolsClear' ||
                 type === 'existingAgents' || type === 'layoutLoaded') {
        // Gateway already speaks pixel-agents protocol — pass through directly
        this.broadcast(msg);
        // Track agents from existingAgents
        if (type === 'existingAgents' && Array.isArray(msg.agents)) {
          for (const id of msg.agents) {
            if (!this.registry.has(id)) {
              const agent = this.registry.create(String(id), null, `Agent ${id}`);
              agent.id = id; // Use the ID from the gateway
            }
          }
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  _handleGatewayToolStart(msg) {
    const sessionId = msg.sessionId || msg.agentId;
    if (!sessionId) return;
    const agent = this.registry.getBySession(String(sessionId));
    if (!agent) return;
    const toolName = msg.tool || msg.toolName || msg.name || '';
    const toolId = msg.toolId || msg.id || String(Date.now());
    const status = formatToolStatus(toolName, msg.input || {});
    this.broadcast({ type: 'agentToolStart', id: agent.id, toolId, status });
  }

  _handleGatewayToolDone(msg) {
    const sessionId = msg.sessionId || msg.agentId;
    if (!sessionId) return;
    const agent = this.registry.getBySession(String(sessionId));
    if (!agent) return;
    const toolId = msg.toolId || msg.id;
    if (toolId) {
      setTimeout(() => {
        this.broadcast({ type: 'agentToolDone', id: agent.id, toolId });
      }, TOOL_DONE_DELAY_MS);
    }
  }

  // ── OpenClaw JSONL fallback watcher ───────────────────────
  //
  // Directory layout:
  //   ~/.openclaw/agents/<agentName>/sessions/<uuid>.jsonl
  //
  // One pixel-agents character per <agentName>.  We track whichever session
  // file for that agent was modified most recently and watch it for activity.

  _startProjectScan() {
    if (!fs.existsSync(this.openclawAgentsDir)) {
      console.warn('[Bridge] ~/.openclaw/agents not found — file-watcher fallback disabled (gateway events only)');
      // Retry every 30 s in case OpenClaw is installed later
      setTimeout(() => this._startProjectScan(), 30000);
      return;
    }

    console.log(`[Bridge] Watching ${this.openclawAgentsDir} for session activity`);
    this.projectScanTimer = setInterval(() => {
      this._scanForNewJsonlFiles();
    }, PROJECT_SCAN_INTERVAL_MS);

    this._scanForNewJsonlFiles();
  }

  /**
   * Walk ~/.openclaw/agents/<agentName>/sessions/ and, for each named agent,
   * adopt the most recently modified live .jsonl file if it is fresh enough.
   * "Live" means the filename does NOT contain ".deleted.".
   */
  _scanForNewJsonlFiles() {
    try {
      if (!fs.existsSync(this.openclawAgentsDir)) return;
      const agentNames = fs.readdirSync(this.openclawAgentsDir);

      for (const agentName of agentNames) {
        const sessionsDir = path.join(this.openclawAgentsDir, agentName, 'sessions');
        try {
          if (!fs.existsSync(sessionsDir)) continue;

          // Find the newest live .jsonl file for this agent
          const files = fs.readdirSync(sessionsDir);
          let newestFile = null;
          let newestMtime = 0;

          for (const file of files) {
            // Skip deleted sessions (name contains ".deleted.")
            if (file.includes('.deleted.')) continue;
            if (!file.endsWith('.jsonl')) continue;

            const fullPath = path.join(sessionsDir, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs > newestMtime) {
                newestMtime = stat.mtimeMs;
                newestFile = fullPath;
              }
            } catch {}
          }

          if (!newestFile) continue;

          // Only track sessions active within the last 30 minutes
          const ageMins = (Date.now() - newestMtime) / 60000;
          if (ageMins > 30) continue;

          const existingAgent = this.registry.getBySession(agentName);

          if (!existingAgent) {
            // New named agent — create a character for it
            this._adoptOpenClawAgent(agentName, newestFile);
          } else if (existingAgent.jsonlFile !== newestFile) {
            // Same agent but a newer session file appeared — switch to it
            console.log(`[Bridge] Agent "${agentName}" switched to newer session`);
            existingAgent.jsonlFile = newestFile;
            existingAgent.fileOffset = 0;
            existingAgent.lineBuffer = '';
            // Restart the fs.watch watcher on the new file
            const oldWatcher = this.fileWatchers.get(existingAgent.id);
            if (oldWatcher) { try { oldWatcher.close(); } catch {} }
            this._attachFsWatch(existingAgent.id);
          }
        } catch {}
      }
    } catch {}
  }

  /** Create a registry entry and start watching for a newly discovered OpenClaw agent. */
  _adoptOpenClawAgent(agentName, jsonlFile) {
    const agent = this.registry.create(agentName, jsonlFile, agentName);
    console.log(`[Bridge] Adopted OpenClaw agent "${agentName}" (${path.basename(jsonlFile)}) → char ${agent.id}`);
    this.broadcast({ type: 'agentCreated', id: agent.id });
    this._startFileWatching(agent.id);
  }

  _startFileWatching(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.jsonlFile) return;

    this._attachFsWatch(agentId);

    // Polling backup (also handles the initial read)
    const interval = setInterval(() => {
      if (!this.registry.has(agentId)) {
        clearInterval(interval);
        return;
      }
      this._readNewLines(agentId);
    }, FILE_POLL_INTERVAL_MS);
    this.pollingTimers.set(agentId, interval);
  }

  _attachFsWatch(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.jsonlFile) return;
    try {
      const watcher = fs.watch(agent.jsonlFile, () => this._readNewLines(agentId));
      watcher.on('error', () => {});
      this.fileWatchers.set(agentId, watcher);
    } catch {}
  }

  _readNewLines(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.jsonlFile) return;
    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      const hasData = lines.some(l => l.trim());
      if (hasData) {
        this._cancelWaitingTimer(agentId);
      }

      for (const line of lines) {
        if (line.trim()) this._processLine(agentId, line);
      }
    } catch {}
  }

  /**
   * Parse one line of an OpenClaw v3 JSONL file.
   *
   * Relevant record shapes:
   *
   *   Assistant turn with tool calls:
   *     { type:"message", message:{ role:"assistant",
   *         content:[{ type:"toolCall", id:"...", name:"...", arguments:{} }, ...] } }
   *
   *   Tool result (completion):
   *     { type:"message", message:{ role:"toolResult",
   *         toolCallId:"...", toolName:"..." } }
   *
   *   User message (new prompt → reset activity):
   *     { type:"message", message:{ role:"user", content:[...] } }
   *
   *   Session start (new session file picked up mid-run):
   *     { type:"session", id:"<uuid>", ... }
   *
   *   Ignored: type:"custom", "model_change", "thinking_level_change"
   */
  _processLine(agentId, line) {
    const agent = this.registry.get(agentId);
    if (!agent) return;
    try {
      const record = JSON.parse(line);
      if (record.type !== 'message') return; // ignore metadata records

      const msg = record.message;
      if (!msg) return;
      const role = msg.role;

      if (role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content : [];
        const toolCalls = content.filter(b => b && b.type === 'toolCall');

        if (toolCalls.length > 0) {
          // Agent is using tools — mark active and emit toolStart for each
          this._cancelWaitingTimer(agentId);
          agent.isWaiting = false;
          agent.hadToolsInTurn = true;
          this.broadcast({ type: 'agentStatus', id: agentId, status: 'active' });

          let hasNonExempt = false;
          for (const block of toolCalls) {
            const toolName = block.name || '';
            const toolId = block.id || `${toolName}-${Date.now()}`;
            const status = formatToolStatus(toolName, block.arguments || {});
            agent.activeToolIds.add(toolId);
            agent.activeToolStatuses.set(toolId, status);
            agent.activeToolNames.set(toolId, toolName);
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExempt = true;
            this.broadcast({ type: 'agentToolStart', id: agentId, toolId, status });
          }
          if (hasNonExempt) this._startPermissionTimer(agentId);

        } else if (content.some(b => b && (b.type === 'text' || b.type === 'thinking')) && !agent.hadToolsInTurn) {
          // Text-only assistant turn — agent will be waiting for user soon
          this._startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS);
        }

      } else if (role === 'toolResult') {
        // A tool has finished — emit toolDone for that call ID
        const toolId = msg.toolCallId;
        if (toolId) {
          agent.activeToolIds.delete(toolId);
          agent.activeToolStatuses.delete(toolId);
          agent.activeToolNames.delete(toolId);
          const tid = toolId;
          setTimeout(() => {
            this.broadcast({ type: 'agentToolDone', id: agentId, toolId: tid });
          }, TOOL_DONE_DELAY_MS);
        }

        // If no tools remain pending, the turn is complete — agent is waiting
        if (agent.activeToolIds.size === 0 && agent.hadToolsInTurn) {
          agent.hadToolsInTurn = false;
          this._cancelPermissionTimer(agentId);
          this._startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS);
        }

      } else if (role === 'user') {
        // New user prompt — new turn starting, reset all activity
        this._cancelWaitingTimer(agentId);
        this._clearAgentActivity(agentId);
        agent.hadToolsInTurn = false;
      }
    } catch {
      // Ignore malformed lines
    }
  }

  // ── Timer helpers ─────────────────────────────────────────

  _startWaitingTimer(agentId, delay) {
    this._cancelWaitingTimer(agentId);
    this.waitingTimers.set(agentId, setTimeout(() => {
      this.waitingTimers.delete(agentId);
      const agent = this.registry.get(agentId);
      if (!agent) return;
      agent.isWaiting = true;
      this.broadcast({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }, delay));
  }

  _cancelWaitingTimer(agentId) {
    const t = this.waitingTimers.get(agentId);
    if (t) { clearTimeout(t); this.waitingTimers.delete(agentId); }
  }

  _startPermissionTimer(agentId) {
    this._cancelPermissionTimer(agentId);
    this.permissionTimers.set(agentId, setTimeout(() => {
      this.permissionTimers.delete(agentId);
      const agent = this.registry.get(agentId);
      if (!agent) return;

      // Check if any non-exempt tool is still active
      let hasNonExempt = false;
      for (const toolName of agent.activeToolNames.values()) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) { hasNonExempt = true; break; }
      }
      for (const [, subNames] of agent.activeSubagentToolNames) {
        for (const [, toolName] of subNames) {
          if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) { hasNonExempt = true; break; }
        }
        if (hasNonExempt) break;
      }
      if (!hasNonExempt) return;

      if (!agent.permissionSent) {
        agent.permissionSent = true;
        this.broadcast({ type: 'agentToolPermission', id: agentId });
      }
    }, PERMISSION_TIMER_DELAY_MS));
  }

  _cancelPermissionTimer(agentId) {
    const t = this.permissionTimers.get(agentId);
    if (t) { clearTimeout(t); this.permissionTimers.delete(agentId); }
  }

  _clearAgentActivity(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent) return;
    this._cancelPermissionTimer(agentId);

    if (agent.activeToolIds.size > 0) {
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      this.broadcast({ type: 'agentToolsClear', id: agentId });
    }
    agent.permissionSent = false;
    agent.isWaiting = false;
    this.broadcast({ type: 'agentStatus', id: agentId, status: 'active' });
  }

  _removeAgent(agentId) {
    this._cancelWaitingTimer(agentId);
    this._cancelPermissionTimer(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) { clearInterval(pt); this.pollingTimers.delete(agentId); }
    const fw = this.fileWatchers.get(agentId);
    if (fw) { try { fw.close(); } catch {} this.fileWatchers.delete(agentId); }
    this.registry.remove(agentId);
    this.broadcast({ type: 'agentClosed', id: agentId });
  }

  // ── Public API ────────────────────────────────────────────

  getRegistry() {
    return this.registry;
  }

  isGatewayConnected() {
    return this.gatewayConnected;
  }

  /** Handle a message from a browser client (e.g. "openClaude") */
  handleBrowserMessage(msg) {
    if (msg.type === 'saveLayout') {
      // Handled by index.js directly
    } else if (msg.type === 'focusAgent' || msg.type === 'closeAgent') {
      // No-op for standalone app (no terminal to focus/close)
      if (msg.type === 'closeAgent') {
        this._removeAgent(msg.id);
      }
    } else if (msg.type === 'openClaude') {
      this._startNewSession(msg.folderPath);
    }
  }

  _startNewSession(folderPath) {
    const { execFile } = require('child_process');
    const cwd = folderPath || os.homedir();
    const sessionId = require('crypto').randomUUID();

    console.log(`[Bridge] Starting new OpenClaw session ${sessionId} in ${cwd}`);

    // Try `openclaw agent` first, then fall back to plain `claude`
    const tryOpenClaw = () => {
      execFile('openclaw', ['agent', '--session-id', sessionId, '--non-interactive'], { cwd },
        (err) => {
          if (err) {
            console.log('[Bridge] openclaw agent failed, trying claude CLI:', err.message);
            tryClaudeCli();
          }
        }
      );
    };

    const tryClaudeCli = () => {
      execFile('claude', ['--session-id', sessionId], { cwd }, (err) => {
        if (err) console.log('[Bridge] claude CLI also failed:', err.message);
      });
    };

    tryOpenClaw();
  }
}

module.exports = { OpenClawBridge };
