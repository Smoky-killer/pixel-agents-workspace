'use strict';

/**
 * RepairOrchestrator — classifies detected errors and dispatches repair tasks.
 *
 * Receives `novaError` events from multiZoneBridge, applies cooldown logic,
 * and broadcasts `novaRepairTask` to the appropriate agent (BUILDER or REPAIR).
 */

// Error type → target agent role
const REPAIR_ROUTING = {
  'missing-file':   'builder',
  'missing-dep':    'builder',
  'code-error':     'repair',
  'permission':     'repair',
  'resource':       'repair',
  'rate-limit':     null, // self-resolving, ignore
};

const COOLDOWN_MS = 60_000; // 60s cooldown per error type

class RepairOrchestrator {
  constructor({ broadcast, novaZoneId }) {
    this.broadcast = broadcast;
    this.novaZoneId = novaZoneId || 'openclaw-nova';
    this.cooldowns = new Map(); // errorType → lastTriggeredTimestamp
  }

  /**
   * Handle a detected error from the NOVA zone.
   * @param {{ errorType: string, severity: string, snippet: string, agentId: number }} error
   */
  handleError(error) {
    const { errorType, severity, snippet, agentId } = error;

    // Skip rate-limit errors (self-resolving)
    const targetRole = REPAIR_ROUTING[errorType];
    if (targetRole === null || targetRole === undefined) return;

    // Cooldown check
    const now = Date.now();
    const lastTriggered = this.cooldowns.get(errorType) || 0;
    if (now - lastTriggered < COOLDOWN_MS) return;
    this.cooldowns.set(errorType, now);

    // Build repair description
    const description = this._buildDescription(errorType, snippet);

    console.log(`[RepairOrchestrator] Dispatching ${errorType} repair to ${targetRole}: ${description}`);

    this.broadcast({
      type: 'novaRepairTask',
      zoneId: this.novaZoneId,
      errorType,
      severity,
      targetRole,
      description,
      sourceAgentId: agentId,
    });
  }

  _buildDescription(errorType, snippet) {
    const shortSnippet = snippet.length > 80 ? snippet.slice(0, 77) + '...' : snippet;
    switch (errorType) {
      case 'missing-file':
        return `Fix missing file: ${shortSnippet}`;
      case 'missing-dep':
        return `Install missing dependency: ${shortSnippet}`;
      case 'code-error':
        return `Fix code error: ${shortSnippet}`;
      case 'permission':
        return `Fix permission issue: ${shortSnippet}`;
      case 'resource':
        return `Fix resource issue: ${shortSnippet}`;
      default:
        return `Auto-repair: ${shortSnippet}`;
    }
  }
}

module.exports = { RepairOrchestrator };
