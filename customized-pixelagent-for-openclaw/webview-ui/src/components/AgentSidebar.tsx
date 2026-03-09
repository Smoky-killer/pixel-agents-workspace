import { useCallback, useState } from 'react';

import type { ActionHistoryEntry } from '../hooks/useExtensionMessages.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { ToolActivity } from '../office/types.js';
import { Direction } from '../office/types.js';
import { SpriteCanvas } from './SpriteCanvas.js';

/** 6 base palette hues (matches spriteData palette order) */
const PALETTE_HUES = [210, 120, 0, 270, 30, 180];

function getAgentColor(palette: number, hueShift: number): string {
  const base = PALETTE_HUES[palette % PALETTE_HUES.length];
  const hue = (base + hueShift) % 360;
  return `hsl(${hue}, 60%, 65%)`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface AgentRowProps {
  id: number;
  name: string;
  palette: number;
  hueShift: number;
  status: string | undefined;
  lastAction: string | undefined;
  history: ActionHistoryEntry[];
  tools: ToolActivity[];
  taskStartTime: number | undefined;
  taskCount: number;
  lastFile: string | undefined;
  isExpanded: boolean;
  onExpand: (id: number) => void;
  onCollapse: () => void;
}

function AgentRow({
  id,
  name,
  palette,
  hueShift,
  status,
  lastAction,
  history,
  tools,
  taskStartTime,
  taskCount,
  lastFile,
  isExpanded,
  onExpand,
  onCollapse,
}: AgentRowProps) {
  const color = getAgentColor(palette, hueShift);

  // Get sprite for display
  let sprite: string[][] | null = null;
  try {
    const sprites = getCharacterSprites(palette, hueShift);
    sprite = sprites.typing[Direction.DOWN][0];
  } catch {
    sprite = null;
  }

  // Determine status display
  let statusLabel = '💤 Idle';
  let statusColor = 'rgba(255,255,255,0.4)';
  if (status === 'waiting') {
    statusLabel = '💬 Waiting for input';
    statusColor = '#f9c74f';
  } else if (tools.length > 0 && !tools.every((t) => t.done)) {
    const activeTool = tools.find((t) => !t.done);
    if (activeTool) {
      const s = activeTool.status.toLowerCase();
      if (s.startsWith('reading') || s.startsWith('searching') || s.startsWith('fetching')) {
        statusLabel = `🔍 ${activeTool.status}`;
        statusColor = '#74b0f9';
      } else if (s.startsWith('writing') || s.startsWith('editing')) {
        statusLabel = `✍ ${activeTool.status}`;
        statusColor = '#74f9a0';
      } else {
        statusLabel = `⚙ ${activeTool.status}`;
        statusColor = '#f9a074';
      }
    }
  } else if (tools.length > 0) {
    statusLabel = '🚶 Walking';
    statusColor = 'rgba(255,255,255,0.8)';
  }

  const now = Date.now();

  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        padding: '8px 10px',
        cursor: 'pointer',
        background: isExpanded ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.2s',
      }}
      onClick={() => (isExpanded ? onCollapse() : onExpand(id))}
    >
      {/* Header row: sprite + name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `${color}22`,
            border: `1px solid ${color}44`,
            borderRadius: 2,
          }}
        >
          {sprite ? (
            <SpriteCanvas sprite={sprite} scale={2} />
          ) : (
            <div style={{ width: 32, height: 32, background: color, borderRadius: 2 }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: 'var(--sidebar-text)',
              fontSize: 13,
              fontWeight: 'bold',
              letterSpacing: 1,
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
          <div style={{ color: statusColor, fontSize: 11, marginTop: 1 }}>{statusLabel}</div>
        </div>
      </div>

      {/* Last action */}
      {lastAction && (
        <div
          style={{
            color: 'var(--sidebar-text-dim)',
            fontSize: 10,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 4,
          }}
        >
          {lastAction}
        </div>
      )}

      {/* Micro-log: last 5 entries */}
      {history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {history.slice(0, 5).map((entry, i) => (
            <div
              key={i}
              style={{
                color: 'rgba(255,255,255,0.28)',
                fontSize: 9,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {formatTime(entry.timestamp)} — {entry.status}
            </div>
          ))}
        </div>
      )}

      {/* Expanded: agent history timeline */}
      {isExpanded && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 6px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            maxHeight: 200,
            overflowY: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              fontSize: 10,
              color: color,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            History — {name} ({taskCount} tasks)
          </div>
          {taskStartTime && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginBottom: 4 }}>
              Current task: {formatDuration(now - taskStartTime)}
            </div>
          )}
          {lastFile && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginBottom: 6 }}>
              Last file: {lastFile}
            </div>
          )}
          {history.map((entry, i) => {
            const s = entry.status.toLowerCase();
            let entryColor = 'rgba(255,255,255,0.45)';
            if (s.startsWith('writing') || s.startsWith('editing')) entryColor = '#74f9a0';
            else if (s.startsWith('reading') || s.startsWith('searching')) entryColor = '#74b0f9';
            else if (s.startsWith('running')) entryColor = '#f9c74f';
            else if (s.startsWith('waiting')) entryColor = '#f9c74f';
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                  marginBottom: 3,
                  borderLeft: `2px solid ${entryColor}`,
                  paddingLeft: 5,
                }}
              >
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, flexShrink: 0, minWidth: 36 }}>
                  {formatTime(entry.timestamp)}
                </div>
                <div style={{ color: entryColor, fontSize: 9, flex: 1 }}>{entry.status}</div>
              </div>
            );
          })}
          {history.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>No actions yet</div>
          )}
        </div>
      )}
    </div>
  );
}

interface AgentSidebarProps {
  agents: number[];
  agentNames: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  agentActionHistory: Record<number, ActionHistoryEntry[]>;
  agentLastAction: Record<number, string>;
  agentLastFile: Record<number, string>;
  agentTaskStartTime: Record<number, number>;
  agentTaskCount: Record<number, number>;
  gatewayConnected: boolean | null;
  characters: Map<number, { palette: number; hueShift: number }>;
  isVisible: boolean;
}

export function AgentSidebar({
  agents,
  agentNames,
  agentTools,
  agentStatuses,
  agentActionHistory,
  agentLastAction,
  agentLastFile,
  agentTaskStartTime,
  agentTaskCount,
  gatewayConnected,
  characters,
  isVisible,
}: AgentSidebarProps) {
  const [expandedAgent, setExpandedAgent] = useState<number | null>(null);

  const handleExpand = useCallback((id: number) => setExpandedAgent(id), []);
  const handleCollapse = useCallback(() => setExpandedAgent(null), []);

  if (!isVisible) return null;

  const activeCount = agents.length;

  return (
    <div
      style={{
        width: 'var(--sidebar-width)',
        height: '100%',
        flexShrink: 0,
        background: 'var(--sidebar-bg)',
        borderLeft: '1px solid var(--sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        zIndex: 45,
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid var(--sidebar-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: 'var(--sidebar-text)',
              fontWeight: 'bold',
            }}
          >
            Agents
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--sidebar-text-dim)',
              background: 'rgba(255,255,255,0.08)',
              padding: '1px 5px',
              borderRadius: 2,
            }}
          >
            {activeCount} active
          </span>
        </div>
        {/* Gateway status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: gatewayConnected === null ? '#888' : gatewayConnected ? '#a6e3a1' : '#f38ba8',
              boxShadow: gatewayConnected ? '0 0 4px #a6e3a1' : gatewayConnected === false ? '0 0 4px #f38ba8' : 'none',
            }}
          />
          <span style={{ fontSize: 9, color: 'var(--sidebar-text-dim)', letterSpacing: 0.5 }}>
            OpenClaw
          </span>
        </div>
      </div>

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {agents.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--sidebar-text-dim)',
              fontSize: 11,
            }}
          >
            No active agents
          </div>
        ) : (
          agents.map((id, idx) => {
            const ch = characters.get(id);
            const palette = ch?.palette ?? (id % 6);
            const hueShift = ch?.hueShift ?? 0;
            return (
              <div key={id}>
                {idx > 0 && (
                  <div style={{ height: 1, background: 'var(--sidebar-divider)' }} />
                )}
                <AgentRow
                  id={id}
                  name={agentNames[id] || `Agent ${id}`}
                  palette={palette}
                  hueShift={hueShift}
                  status={agentStatuses[id]}
                  lastAction={agentLastAction[id]}
                  history={agentActionHistory[id] || []}
                  tools={agentTools[id] || []}
                  taskStartTime={agentTaskStartTime[id]}
                  taskCount={agentTaskCount[id] || 0}
                  lastFile={agentLastFile[id]}
                  isExpanded={expandedAgent === id}
                  onExpand={handleExpand}
                  onCollapse={handleCollapse}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
