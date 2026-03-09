import { useCallback, useState } from 'react';

import type { ActionHistoryEntry } from '../hooks/useExtensionMessages.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { ToolActivity } from '../office/types.js';
import { Direction } from '../office/types.js';
import { SpriteCanvas } from './SpriteCanvas.js';
import { zoneManager } from '../zones/ZoneManager.js';

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

/** Map role strings to short badge labels */
function roleBadge(role: string): string {
  const r = role.toLowerCase();
  if (r === 'commander' || r === 'cmd') return 'CMD';
  if (r === 'dispatcher' || r === 'dsp') return 'DSP';
  if (r === 'researcher' || r === 'rsr') return 'RSR';
  // Default to worker for any other role
  return 'WRK';
}

/** Badge background color by role */
function roleBadgeColor(role: string): string {
  const badge = roleBadge(role);
  switch (badge) {
    case 'CMD': return 'rgba(249, 199, 79, 0.25)';
    case 'DSP': return 'rgba(116, 176, 249, 0.25)';
    case 'RSR': return 'rgba(186, 116, 249, 0.25)';
    default: return 'rgba(255, 255, 255, 0.1)';
  }
}

/** Badge text color by role */
function roleBadgeTextColor(role: string): string {
  const badge = roleBadge(role);
  switch (badge) {
    case 'CMD': return '#f9c74f';
    case 'DSP': return '#74b0f9';
    case 'RSR': return '#ba74f9';
    default: return 'rgba(255, 255, 255, 0.6)';
  }
}

interface AgentRowProps {
  id: number;
  name: string;
  role: string;
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
  role,
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

  // Determine status: dot color + activity text
  let statusDotColor = '#888'; // gray = idle
  let activityText = 'Idle';

  const activeTool = tools.find((t) => !t.done);

  if (status === 'waiting') {
    statusDotColor = '#f9c74f'; // yellow
    activityText = 'Waiting for input';
  } else if (status === 'talk') {
    statusDotColor = '#a6e3a1'; // green
    activityText = 'Delegating...';
  } else if (activeTool) {
    statusDotColor = '#a6e3a1'; // green = active
    activityText = activeTool.status;
  } else if (tools.length > 0 && tools.every((t) => t.done)) {
    statusDotColor = '#888';
    activityText = 'Wandering';
  }

  const now = Date.now();
  const badge = roleBadge(role);

  return (
    <div
      style={{
        padding: '6px 10px',
        cursor: 'pointer',
        background: isExpanded ? 'rgba(255,255,255,0.04)' : 'transparent',
        transition: 'background 0.15s',
      }}
      onClick={() => (isExpanded ? onCollapse() : onExpand(id))}
    >
      {/* Main row: sprite | dot + name + badge | activity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Sprite preview */}
        <div
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `${color}18`,
            border: `1px solid ${color}33`,
            borderRadius: 2,
          }}
        >
          {sprite ? (
            <SpriteCanvas sprite={sprite} scale={2} />
          ) : (
            <div style={{ width: 28, height: 28, background: color, borderRadius: 2 }} />
          )}
        </div>

        {/* Name + badge column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Status dot */}
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: statusDotColor,
                boxShadow: statusDotColor === '#a6e3a1' ? '0 0 4px #a6e3a1' : 'none',
                flexShrink: 0,
              }}
            />
            {/* Agent name */}
            <div
              style={{
                color: 'var(--sidebar-text)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {name}
            </div>
            {/* Role badge */}
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.8,
                padding: '1px 5px',
                borderRadius: 2,
                background: roleBadgeColor(role),
                color: roleBadgeTextColor(role),
                flexShrink: 0,
              }}
            >
              {badge}
            </div>
          </div>

          {/* Activity text */}
          <div
            style={{
              color: statusDotColor === '#a6e3a1'
                ? 'rgba(166, 227, 161, 0.85)'
                : statusDotColor === '#f9c74f'
                  ? 'rgba(249, 199, 79, 0.85)'
                  : 'rgba(255, 255, 255, 0.4)',
              fontSize: 10,
              marginTop: 2,
              marginLeft: 13, // align under name, past the dot
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activityText}
          </div>
        </div>
      </div>

      {/* Last action (collapsed only, below main row) */}
      {!isExpanded && lastAction && (
        <div
          style={{
            color: 'var(--sidebar-text-dim)',
            fontSize: 9,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 3,
            marginLeft: 36, // align with name text
          }}
        >
          {lastAction}
        </div>
      )}

      {/* Expanded: full history timeline */}
      {isExpanded && (
        <div
          style={{
            marginTop: 6,
            padding: '6px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 2,
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
              marginBottom: 4,
            }}
          >
            History — {name} ({taskCount} tasks)
          </div>
          {taskStartTime && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginBottom: 3 }}>
              Current task: {formatDuration(now - taskStartTime)}
            </div>
          )}
          {lastFile && (
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginBottom: 5 }}>
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
                  marginBottom: 2,
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

  // Build zone-grouped agent structure
  const zones = zoneManager.config?.zones ?? [];
  const agentSet = new Set(agents);

  // Collect agents that belong to a zone
  const assignedAgentIds = new Set<number>();
  const zoneGroups: Array<{
    zoneName: string;
    accentColor: string;
    zoneAgents: Array<{ agentId: number; role: string }>;
  }> = [];

  for (const zone of zones) {
    const zoneAgents: Array<{ agentId: number; role: string }> = [];
    for (const agentCfg of zone.agents) {
      if (agentSet.has(agentCfg.agentId)) {
        zoneAgents.push({ agentId: agentCfg.agentId, role: agentCfg.role });
        assignedAgentIds.add(agentCfg.agentId);
      }
    }
    if (zoneAgents.length > 0) {
      zoneGroups.push({
        zoneName: zone.name,
        accentColor: zone.accentColor,
        zoneAgents,
      });
    }
  }

  // Collect unassigned agents (active but not in any zone config)
  const unassignedAgents = agents.filter((id) => !assignedAgentIds.has(id));

  return (
    <div
      style={{
        width: 300,
        minWidth: 300,
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

      {/* Agent list grouped by zone */}
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
          <>
            {zoneGroups.map((group) => (
              <div key={group.zoneName}>
                {/* Zone section header */}
                <div
                  style={{
                    padding: '6px 12px 4px',
                    borderBottom: `2px solid ${group.accentColor}`,
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 4,
                      height: 12,
                      borderRadius: 1,
                      background: group.accentColor,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: group.accentColor,
                    }}
                  >
                    {group.zoneName}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'rgba(255,255,255,0.35)',
                      marginLeft: 'auto',
                    }}
                  >
                    {group.zoneAgents.length}
                  </span>
                </div>

                {/* Agents in this zone */}
                {group.zoneAgents.map((za, idx) => {
                  const id = za.agentId;
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
                        role={za.role}
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
                })}
              </div>
            ))}

            {/* Unassigned agents (not in any zone) */}
            {unassignedAgents.length > 0 && (
              <div>
                <div
                  style={{
                    padding: '6px 12px 4px',
                    borderBottom: '2px solid rgba(255,255,255,0.2)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 4,
                      height: 12,
                      borderRadius: 1,
                      background: 'rgba(255,255,255,0.3)',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      textTransform: 'uppercase',
                      color: 'rgba(255,255,255,0.5)',
                    }}
                  >
                    Unassigned
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'rgba(255,255,255,0.35)',
                      marginLeft: 'auto',
                    }}
                  >
                    {unassignedAgents.length}
                  </span>
                </div>

                {unassignedAgents.map((id, idx) => {
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
                        role="worker"
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
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
