'use strict';

/**
 * Multi-Zone Bridge
 *
 * Watches multiple JSONL directories (one per zone) simultaneously.
 * Each zone can be an OpenClaw instance (gateway + JSONL) or a Claude Code instance (JSONL only).
 *
 * Broadcasts pixel-agents protocol messages with zone metadata to all connected browser clients.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const { AgentRegistry } = require('./agentRegistry.js');

// ── Constants ────────────────────────────────────────────
const TOOL_DONE_DELAY_MS = 300;
const PERMISSION_TIMER_DELAY_MS = 7000;
const TEXT_IDLE_DELAY_MS = 5000;
const FILE_POLL_INTERVAL_MS = 1000;
const PROJECT_SCAN_INTERVAL_MS = 1000;
const BASH_COMMAND_MAX = 30;
const TASK_DESC_MAX = 40;

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

// ── Tool status formatter ────────────────────────────────
function formatToolStatus(toolName, args) {
  const base = (p) => (typeof p === 'string' ? path.basename(p) : '');
  const lc = toolName.toLowerCase();
  switch (lc) {
    case 'read':        return `Reading ${base(args.path || args.file_path || args.file || '')}`;
    case 'write':       return `Writing ${base(args.path || args.file_path || args.file || '')}`;
    case 'edit':        return `Editing ${base(args.path || args.file_path || args.file || '')}`;
    case 'exec':
    case 'bash':
    case 'shell':
    case 'run_command': {
      const cmd = args.command || args.cmd || '';
      return `Running: ${cmd.length > BASH_COMMAND_MAX ? cmd.slice(0, BASH_COMMAND_MAX) + '...' : cmd}`;
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
      const label = target.length > TASK_DESC_MAX ? target.slice(0, TASK_DESC_MAX) + '...' : target;
      return label ? `Spawning: ${label}` : 'Spawning agent';
    }
    case 'ask_user':
    case 'askuserquestion': return 'Waiting for your answer';
    case 'enterplanmode':   return 'Planning';
    case 'notebookedit':    return 'Editing notebook';
    default:            return `Using ${toolName}`;
  }
}

/**
 * Per-zone watcher state.
 */
class ZoneWatcher {
  constructor(zoneConfig, registry, broadcast) {
    this.zone = zoneConfig;
    this.registry = registry;
    this.broadcast = broadcast;

    this.gatewayWs = null;
    this.gatewayConnected = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;

    // File watching state
    this.fileWatchers = new Map();    // agentId -> FSWatcher
    this.pollingTimers = new Map();   // agentId -> setInterval
    this.waitingTimers = new Map();   // agentId -> setTimeout
    this.permissionTimers = new Map();// agentId -> setTimeout
    this.projectScanTimer = null;

    this.jsonlDir = this._resolveDir(zoneConfig.jsonlDir);
    this.gatewayUrl = zoneConfig.gatewayPort
      ? `ws://127.0.0.1:${zoneConfig.gatewayPort}`
      : null;
    this.gatewayToken = zoneConfig.gatewayToken || null;
    this.gatewayAuthenticated = false;

    // Map from agentName (from JSONL dir) to the configured agent entry
    this.configuredAgents = new Map();
    for (const a of (zoneConfig.agents || [])) {
      this.configuredAgents.set(a.name.toUpperCase(), a);
    }
  }

  _resolveDir(dir) {
    if (!dir) return null;
    if (dir.startsWith('~')) return path.join(os.homedir(), dir.slice(1));
    return dir;
  }

  start() {
    if (this.gatewayUrl) this._connectGateway();
    if (this.jsonlDir) this._startProjectScan();
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

  // ── Gateway WebSocket client ──────────────────────────
  _connectGateway() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try {
      const ws = new WebSocket(this.gatewayUrl, { handshakeTimeout: 5000 });
      this.gatewayWs = ws;

      ws.on('open', () => {
        console.log(`[Zone:${this.zone.id}] Connected to gateway at ${this.gatewayUrl}`);
        this.gatewayAuthenticated = false;
      });

      ws.on('message', (data) => this._handleGatewayMessage(data.toString()));

      ws.on('close', () => {
        if (this.gatewayConnected || this.gatewayAuthenticated) {
          console.log(`[Zone:${this.zone.id}] Gateway disconnected`);
          this.gatewayConnected = false;
          this.gatewayAuthenticated = false;
          this.broadcast({ type: 'zoneGatewayStatus', zoneId: this.zone.id, connected: false });
        }
        this._scheduleReconnect();
      });

      ws.on('error', () => {});
    } catch {
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

      // Handle OpenClaw challenge-response auth
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        const nonce = msg.payload?.nonce;
        if (!nonce || !this.gatewayToken) {
          console.warn(`[Zone:${this.zone.id}] Gateway challenge received but no token configured`);
          return;
        }
        const frame = {
          type: 'req',
          id: crypto.randomUUID(),
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: 'gateway-client', displayName: 'Nova HQ', version: '1.0.0', platform: process.platform, mode: 'backend' },
            caps: [],
            auth: { token: this.gatewayToken },
            role: 'operator',
            scopes: ['operator.read'],
          },
        };
        try { this.gatewayWs.send(JSON.stringify(frame)); } catch {}
        return;
      }

      // Handle auth response (hello-ok)
      if (msg.type === 'res' && !this.gatewayAuthenticated) {
        if (msg.ok) {
          this.gatewayAuthenticated = true;
          this.gatewayConnected = true;
          this.reconnectDelay = 1000;
          console.log(`[Zone:${this.zone.id}] Gateway authenticated`);
          this.broadcast({ type: 'zoneGatewayStatus', zoneId: this.zone.id, connected: true });
        } else {
          console.error(`[Zone:${this.zone.id}] Gateway auth failed: ${msg.error?.message || 'unknown'}`);
        }
        return;
      }

      // Handle gateway events (agent lifecycle, health, etc.)
      if (msg.type === 'event') {
        this._handleGatewayEvent(msg);
        return;
      }

      // Legacy format fallback
      const type = msg.type || msg.event || msg.kind || '';
      if (type.includes('session') && type.includes('start')) {
        const sessionId = msg.sessionId || msg.id || msg.agentId;
        if (sessionId && !this.registry.hasSession(String(sessionId))) {
          const agent = this.registry.create(String(sessionId), null, msg.name || msg.label);
          agent.zoneId = this.zone.id;
          this.broadcast({ type: 'agentCreated', id: agent.id, name: agent.name, zoneId: this.zone.id });
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
      }
    } catch {}
  }

  _handleGatewayEvent(msg) {
    const event = msg.event || '';
    const data = msg.data || msg.payload || {};
    const sessionKey = msg.sessionKey || '';

    // Extract agent name from sessionKey (format: "agent:<name>:<session>")
    const agentName = sessionKey.startsWith('agent:') ? sessionKey.split(':')[1] : null;

    if (event === 'agent' && data.phase === 'start') {
      // Agent started
      if (agentName) {
        const key = `gw-${this.zone.id}-${agentName}`;
        if (!this.registry.hasSession(key)) {
          this._adoptAgent(key, null, agentName);
        }
        const agent = this.registry.getBySession(key);
        if (agent) {
          agent.isWaiting = false;
          this.broadcast({ type: 'agentStatus', id: agent.id, status: 'active', zoneId: this.zone.id });
        }
      }
    } else if (event === 'agent' && (data.phase === 'done' || data.phase === 'error' || data.phase === 'end')) {
      // Agent finished
      if (agentName) {
        const key = `gw-${this.zone.id}-${agentName}`;
        const agent = this.registry.getBySession(key);
        if (agent) {
          agent.isWaiting = true;
          this.broadcast({ type: 'agentStatus', id: agent.id, status: 'waiting', zoneId: this.zone.id });
        }
      }
    } else if (event === 'chat') {
      // Chat state change
      if (agentName && data.state === 'running') {
        const key = `gw-${this.zone.id}-${agentName}`;
        const agent = this.registry.getBySession(key);
        if (agent) {
          this.broadcast({ type: 'agentStatus', id: agent.id, status: 'active', zoneId: this.zone.id });
        }
      }
    }
    // Ignore health, tick, and other non-agent events
  }

  _handleGatewayToolStart(msg) {
    const sessionId = msg.sessionId || msg.agentId;
    if (!sessionId) return;
    const agent = this.registry.getBySession(String(sessionId));
    if (!agent) return;
    const toolName = msg.tool || msg.toolName || msg.name || '';
    const toolId = msg.toolId || msg.id || String(Date.now());
    const status = formatToolStatus(toolName, msg.input || {});
    this.broadcast({ type: 'agentToolStart', id: agent.id, toolId, status, zoneId: this.zone.id });
  }

  _handleGatewayToolDone(msg) {
    const sessionId = msg.sessionId || msg.agentId;
    if (!sessionId) return;
    const agent = this.registry.getBySession(String(sessionId));
    if (!agent) return;
    const toolId = msg.toolId || msg.id;
    if (toolId) {
      setTimeout(() => {
        this.broadcast({ type: 'agentToolDone', id: agent.id, toolId, zoneId: this.zone.id });
      }, TOOL_DONE_DELAY_MS);
    }
  }

  // ── JSONL fallback watcher ─────────────────────────────
  _startProjectScan() {
    if (!this.jsonlDir || !fs.existsSync(this.jsonlDir)) {
      console.warn(`[Zone:${this.zone.id}] JSONL dir not found: ${this.jsonlDir} — will retry`);
      setTimeout(() => this._startProjectScan(), 30000);
      return;
    }

    console.log(`[Zone:${this.zone.id}] Watching ${this.jsonlDir} for session activity`);
    this.projectScanTimer = setInterval(() => this._scanForNewJsonlFiles(), PROJECT_SCAN_INTERVAL_MS);
    this._scanForNewJsonlFiles();
  }

  _scanForNewJsonlFiles() {
    try {
      if (!this.jsonlDir || !fs.existsSync(this.jsonlDir)) return;

      // For OpenClaw: scan agents/<name>/sessions/
      // For Claude: scan the projects dir for JSONL files
      if (this.zone.source === 'openclaw') {
        this._scanOpenClawJsonl();
      } else {
        this._scanClaudeJsonl();
      }
    } catch {}
  }

  _scanOpenClawJsonl() {
    const agentNames = fs.readdirSync(this.jsonlDir);

    for (const agentName of agentNames) {
      // Skip the gateway's own "main" session directory
      if (agentName === 'main') continue;

      const sessionsDir = path.join(this.jsonlDir, agentName, 'sessions');
      try {
        if (!fs.existsSync(sessionsDir)) continue;

        const files = fs.readdirSync(sessionsDir);
        let newestFile = null;
        let newestMtime = 0;

        for (const file of files) {
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
        const ageMins = (Date.now() - newestMtime) / 60000;
        if (ageMins > 30) continue;

        const existingAgent = this.registry.getBySession(agentName);

        if (!existingAgent) {
          this._adoptAgent(agentName, newestFile);
        } else if (existingAgent.jsonlFile !== newestFile) {
          existingAgent.jsonlFile = newestFile;
          existingAgent.fileOffset = 0;
          existingAgent.lineBuffer = '';
          const oldWatcher = this.fileWatchers.get(existingAgent.id);
          if (oldWatcher) { try { oldWatcher.close(); } catch {} }
          this._attachFsWatch(existingAgent.id);
        }
      } catch {}
    }
  }

  _scanClaudeJsonl() {
    // Claude Code stores JSONL in ~/.claude/projects/<hash>/<sessionId>.jsonl
    try {
      if (!fs.existsSync(this.jsonlDir)) return;
      const hashDirs = fs.readdirSync(this.jsonlDir);

      for (const hashDir of hashDirs) {
        const projectDir = path.join(this.jsonlDir, hashDir);
        try {
          const stat = fs.statSync(projectDir);
          if (!stat.isDirectory()) continue;

          const files = fs.readdirSync(projectDir);
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;
            const fullPath = path.join(projectDir, file);
            try {
              const fstat = fs.statSync(fullPath);
              const ageMins = (Date.now() - fstat.mtimeMs) / 60000;
              if (ageMins > 30) continue;

              const sessionKey = `claude-${hashDir}-${file}`;
              const existingAgent = this.registry.getBySession(sessionKey);

              if (!existingAgent) {
                this._adoptAgent(sessionKey, fullPath, 'Claude');
              } else if (existingAgent.jsonlFile !== fullPath) {
                existingAgent.jsonlFile = fullPath;
                existingAgent.fileOffset = 0;
                existingAgent.lineBuffer = '';
                const oldWatcher = this.fileWatchers.get(existingAgent.id);
                if (oldWatcher) { try { oldWatcher.close(); } catch {} }
                this._attachFsWatch(existingAgent.id);
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  _adoptAgent(sessionId, jsonlFile, displayName) {
    const name = displayName || sessionId;
    const agent = this.registry.create(sessionId, jsonlFile, name);
    agent.zoneId = this.zone.id;

    // Look up configured agent info
    const configAgent = this.configuredAgents.get(name.toUpperCase());
    if (configAgent) {
      agent.configuredPalette = configAgent.palette;
      agent.configuredHueShift = configAgent.hueShift || 0;
      agent.configuredBadge = configAgent.badge || 'none';
      agent.configuredRole = configAgent.role || 'worker';
      agent.configuredDeskType = configAgent.deskType || 'standard';
    }

    console.log(`[Zone:${this.zone.id}] Adopted agent "${name}" (${path.basename(jsonlFile)}) -> char ${agent.id}`);
    this.broadcast({
      type: 'agentCreated',
      id: agent.id,
      name: agent.name,
      zoneId: this.zone.id,
      palette: agent.configuredPalette,
      hueShift: agent.configuredHueShift,
      badge: agent.configuredBadge,
      role: agent.configuredRole,
    });
    this._startFileWatching(agent.id);
  }

  _startFileWatching(agentId) {
    const agent = this.registry.get(agentId);
    if (!agent || !agent.jsonlFile) return;

    this._attachFsWatch(agentId);

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
      if (hasData) this._cancelWaitingTimer(agentId);

      for (const line of lines) {
        if (line.trim()) this._processLine(agentId, line);
      }
    } catch {}
  }

  _processLine(agentId, line) {
    const agent = this.registry.get(agentId);
    if (!agent) return;
    const zoneId = this.zone.id;

    try {
      const record = JSON.parse(line);
      if (record.type !== 'message') return;

      const msg = record.message;
      if (!msg) return;
      const role = msg.role;

      if (role === 'assistant') {
        const content = Array.isArray(msg.content) ? msg.content : [];
        const toolCalls = content.filter(b => b && (b.type === 'toolCall' || b.type === 'tool_use'));

        if (toolCalls.length > 0) {
          this._cancelWaitingTimer(agentId);
          agent.isWaiting = false;
          agent.hadToolsInTurn = true;
          this.broadcast({ type: 'agentStatus', id: agentId, status: 'active', zoneId });

          let hasNonExempt = false;
          for (const block of toolCalls) {
            const toolName = block.name || '';
            const toolId = block.id || `${toolName}-${Date.now()}`;
            const args = block.arguments || block.input || {};
            const status = formatToolStatus(toolName, args);
            agent.activeToolIds.add(toolId);
            agent.activeToolStatuses.set(toolId, status);
            agent.activeToolNames.set(toolId, toolName);
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExempt = true;
            this.broadcast({ type: 'agentToolStart', id: agentId, toolId, status, zoneId });

            // Emit agentMessage for Task tool
            if (toolName === 'Task' || toolName === 'task' || toolName === 'sessions_spawn') {
              const targetName = args.agentId || args.agent_id || args.agent || '';
              const msgText = args.description || args.message || args.prompt || targetName || 'Subtask';
              const toAgent = targetName ? this.registry.getBySession(targetName) : null;
              this.broadcast({
                type: 'agentMessage',
                fromId: agentId,
                fromName: agent.name,
                toId: toAgent ? toAgent.id : null,
                toName: targetName || null,
                text: msgText.length > 60 ? msgText.slice(0, 59) + '...' : msgText,
                msgType: 'instruction',
                zoneId,
              });
            }
          }
          if (hasNonExempt) this._startPermissionTimer(agentId);

        } else if (content.some(b => b && (b.type === 'text' || b.type === 'thinking')) && !agent.hadToolsInTurn) {
          this._startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS);
        }

      } else if (role === 'toolResult' || role === 'tool_result') {
        const toolId = msg.toolCallId || msg.tool_use_id;
        if (toolId) {
          agent.activeToolIds.delete(toolId);
          agent.activeToolStatuses.delete(toolId);
          agent.activeToolNames.delete(toolId);
          const tid = toolId;
          setTimeout(() => {
            this.broadcast({ type: 'agentToolDone', id: agentId, toolId: tid, zoneId });
          }, TOOL_DONE_DELAY_MS);
        }

        if (agent.activeToolIds.size === 0 && agent.hadToolsInTurn) {
          agent.hadToolsInTurn = false;
          this._cancelPermissionTimer(agentId);
          this._startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS);
        }

      } else if (role === 'user') {
        this._cancelWaitingTimer(agentId);
        this._clearAgentActivity(agentId);
        agent.hadToolsInTurn = false;
      }
    } catch {}
  }

  // ── Timer helpers ──────────────────────────────────────
  _startWaitingTimer(agentId, delay) {
    this._cancelWaitingTimer(agentId);
    this.waitingTimers.set(agentId, setTimeout(() => {
      this.waitingTimers.delete(agentId);
      const agent = this.registry.get(agentId);
      if (!agent) return;
      agent.isWaiting = true;
      this.broadcast({ type: 'agentStatus', id: agentId, status: 'waiting', zoneId: this.zone.id });
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

      let hasNonExempt = false;
      for (const toolName of agent.activeToolNames.values()) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) { hasNonExempt = true; break; }
      }
      if (!hasNonExempt) return;

      if (!agent.permissionSent) {
        agent.permissionSent = true;
        this.broadcast({ type: 'agentToolPermission', id: agentId, zoneId: this.zone.id });
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
      this.broadcast({ type: 'agentToolsClear', id: agentId, zoneId: this.zone.id });
    }
    agent.permissionSent = false;
    agent.isWaiting = false;
    this.broadcast({ type: 'agentStatus', id: agentId, status: 'active', zoneId: this.zone.id });
  }

  _removeAgent(agentId) {
    this._cancelWaitingTimer(agentId);
    this._cancelPermissionTimer(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) { clearInterval(pt); this.pollingTimers.delete(agentId); }
    const fw = this.fileWatchers.get(agentId);
    if (fw) { try { fw.close(); } catch {} this.fileWatchers.delete(agentId); }
    this.registry.remove(agentId);
    this.broadcast({ type: 'agentClosed', id: agentId, zoneId: this.zone.id });
  }

  isGatewayConnected() {
    return this.gatewayConnected;
  }
}

/**
 * MultiZoneBridge — orchestrates all zone watchers.
 */
class MultiZoneBridge {
  constructor({ sourcesConfig, broadcast }) {
    this.sourcesConfig = sourcesConfig;
    this.broadcast = broadcast;
    this.registry = new AgentRegistry();
    this.zoneWatchers = new Map(); // zoneId -> ZoneWatcher
    this.zones = sourcesConfig.zones || [];

    for (const zone of this.zones) {
      const watcher = new ZoneWatcher(zone, this.registry, broadcast);
      this.zoneWatchers.set(zone.id, watcher);
      console.log(`[Zone:${zone.id}] JSONL path: ${watcher.jsonlDir || '(none)'}`);
      console.log(`[Zone:${zone.id}] Gateway: ${watcher.gatewayUrl || '(none)'}`);
    }
  }

  start() {
    for (const watcher of this.zoneWatchers.values()) {
      watcher.start();
    }
  }

  stop() {
    for (const watcher of this.zoneWatchers.values()) {
      watcher.stop();
    }
  }

  getRegistry() {
    return this.registry;
  }

  getZones() {
    return this.zones;
  }

  getZoneGatewayStatus() {
    const status = {};
    for (const [zoneId, watcher] of this.zoneWatchers) {
      status[zoneId] = watcher.isGatewayConnected();
    }
    return status;
  }

  /** Get all agents grouped by zone */
  getAgentsByZone() {
    const grouped = {};
    for (const zone of this.zones) {
      grouped[zone.id] = [];
    }
    for (const agent of this.registry.all()) {
      const zoneId = agent.zoneId || 'unknown';
      if (!grouped[zoneId]) grouped[zoneId] = [];
      grouped[zoneId].push(agent);
    }
    return grouped;
  }

  handleBrowserMessage(msg) {
    if (msg.type === 'closeAgent') {
      const agent = this.registry.get(msg.id);
      if (agent) {
        const watcher = this.zoneWatchers.get(agent.zoneId);
        if (watcher) watcher._removeAgent(msg.id);
      }
    }
  }
}

module.exports = { MultiZoneBridge, formatToolStatus };
