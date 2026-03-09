'use strict';

/**
 * AgentRegistry — tracks active OpenClaw / Claude Code agents.
 *
 * Each agent has:
 *   id         — numeric ID sent to the browser (positive integers)
 *   sessionId  — UUID string from the JSONL filename
 *   jsonlFile  — absolute path to the JSONL transcript
 *   name       — display name (folder name or "Agent N")
 *   palette    — character palette 0-5
 *   hueShift   — hue shift degrees
 *   seatId     — persisted seat assignment (nullable)
 *   fileOffset — bytes already parsed
 *   lineBuffer — partial line from last read
 *   activeToolIds     — Set<string>
 *   activeToolStatuses — Map<string, string>
 *   activeToolNames   — Map<string, string>
 *   activeSubagentToolIds   — Map<string, Set<string>>
 *   activeSubagentToolNames — Map<string, Map<string, string>>
 *   isWaiting  — bool
 *   permissionSent — bool
 *   hadToolsInTurn — bool
 */

class AgentRegistry {
  constructor() {
    /** @type {Map<number, object>} id → agent state */
    this.agents = new Map();
    /** @type {Map<string, number>} sessionId → id */
    this.sessionToId = new Map();
    this._nextId = 1;
  }

  nextId() {
    return this._nextId++;
  }

  create(sessionId, jsonlFile, name) {
    const id = this.nextId();
    const agent = {
      id,
      sessionId,
      jsonlFile,
      name: name || `Agent ${id}`,
      palette: undefined,
      hueShift: undefined,
      seatId: undefined,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
    };
    this.agents.set(id, agent);
    this.sessionToId.set(sessionId, id);
    return agent;
  }

  get(id) {
    return this.agents.get(id);
  }

  getBySession(sessionId) {
    const id = this.sessionToId.get(sessionId);
    return id !== undefined ? this.agents.get(id) : undefined;
  }

  has(id) {
    return this.agents.has(id);
  }

  hasSession(sessionId) {
    return this.sessionToId.has(sessionId);
  }

  remove(id) {
    const agent = this.agents.get(id);
    if (agent) {
      this.sessionToId.delete(agent.sessionId);
      this.agents.delete(id);
    }
  }

  all() {
    return Array.from(this.agents.values());
  }

  /** Serialise active agents for existingAgents message */
  toExistingAgentsMessage(seatData) {
    const agentIds = [];
    const agentMeta = {};
    const agentNames = {};
    for (const agent of this.agents.values()) {
      agentIds.push(agent.id);
      const saved = seatData[agent.id] || {};
      agentMeta[agent.id] = {
        palette: agent.palette ?? saved.palette,
        hueShift: agent.hueShift ?? saved.hueShift ?? 0,
        seatId: agent.seatId ?? saved.seatId ?? null,
      };
      agentNames[agent.id] = agent.name;
    }
    return { type: 'existingAgents', agents: agentIds, agentMeta, agentNames };
  }
}

module.exports = { AgentRegistry };
