import { useCallback, useMemo, useState } from 'react';

import type { ZoneManager } from '../zones/ZoneManager.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { SpriteCanvas } from './SpriteCanvas.js';

interface CharacterSelectorProps {
  zoneManager: ZoneManager;
  onClose: () => void;
}

interface AgentEntry {
  agentId: number;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  name: string;
  role: string;
  palette: number;
  hueShift: number;
  badge: string;
}

const PALETTE_OPTIONS = [0, 1, 2, 3, 4, 5];
const HUE_OPTIONS = [0, 45, 90];

export function CharacterSelector({ zoneManager, onClose }: CharacterSelectorProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentEntry | null>(null);

  const allAgents = useMemo(() => {
    const list: AgentEntry[] = [];
    const config = zoneManager.config;
    if (!config) return list;
    for (const zone of config.zones) {
      for (const agent of zone.agents ?? []) {
        list.push({
          agentId: agent.agentId,
          zoneId: zone.id,
          zoneName: zone.name,
          zoneColor: zone.accentColor,
          name: agent.name,
          role: agent.role,
          palette: agent.palette,
          hueShift: agent.hueShift,
          badge: agent.badge,
        });
      }
    }
    return list;
  }, [zoneManager]);

  const handleSelect = useCallback(
    async (agent: AgentEntry, palette: number, hueShift: number) => {
      try {
        await fetch('/api/agent-appearance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: agent.agentId,
            zoneId: agent.zoneId,
            palette,
            hueShift,
          }),
        });
        // Update local state to reflect change
        agent.palette = palette;
        agent.hueShift = hueShift;
        setSelectedAgent({ ...agent });
      } catch (err) {
        console.error('[CharacterSelector] Save failed:', err);
      }
    },
    [],
  );

  const roleIcon = (role: string) => {
    switch (role) {
      case 'commander': return '\u2655'; // crown
      case 'dispatcher': return '\u26A1'; // lightning
      case 'researcher': return '\uD83D\uDD0D'; // magnifier
      default: return '\uD83D\uDD27'; // wrench
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#1a1a2e',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: 20,
          maxWidth: 700,
          maxHeight: '80vh',
          overflow: 'auto',
          minWidth: 400,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#fff', fontFamily: '"FSPixelSansUnicode", monospace', fontSize: 16 }}>
            Agent Characters
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              cursor: 'pointer',
              padding: '2px 8px',
              fontFamily: 'monospace',
            }}
          >
            X
          </button>
        </div>

        {/* Agent list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {allAgents.map((agent) => {
            const sprites = getCharacterSprites(agent.palette, agent.hueShift);
            const idleSprite = sprites.walk[0][1]; // down-facing idle
            const isSelected = selectedAgent?.agentId === agent.agentId && selectedAgent?.zoneId === agent.zoneId;

            return (
              <div key={`${agent.zoneId}-${agent.agentId}`}>
                <div
                  onClick={() => setSelectedAgent(isSelected ? null : agent)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 10px',
                    background: isSelected ? 'rgba(68,170,255,0.15)' : 'rgba(255,255,255,0.03)',
                    border: isSelected ? '1px solid #44AAFF' : '1px solid transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  {idleSprite && <SpriteCanvas sprite={idleSprite} scale={2} />}
                  <span style={{ color: agent.zoneColor, fontSize: 10, fontFamily: 'monospace', minWidth: 60 }}>
                    {agent.zoneName}
                  </span>
                  <span style={{ color: '#fff', fontSize: 12, fontFamily: '"FSPixelSansUnicode", monospace', flex: 1 }}>
                    {agent.name}
                  </span>
                  <span style={{ fontSize: 12 }}>{roleIcon(agent.role)}</span>
                </div>

                {/* Palette picker (expanded when selected) */}
                {isSelected && (
                  <div style={{ padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: '0 0 4px 4px' }}>
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, fontFamily: 'monospace', marginBottom: 6 }}>
                      Choose appearance:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {PALETTE_OPTIONS.map((p) =>
                        HUE_OPTIONS.map((h) => {
                          const s = getCharacterSprites(p, h);
                          const sp = s.walk[0][1];
                          const isCurrent = agent.palette === p && agent.hueShift === h;
                          return (
                            <div
                              key={`${p}-${h}`}
                              onClick={() => handleSelect(agent, p, h)}
                              style={{
                                border: isCurrent ? '2px solid #00FF88' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 3,
                                padding: 2,
                                cursor: 'pointer',
                                background: isCurrent ? 'rgba(0,255,136,0.1)' : 'transparent',
                              }}
                            >
                              {sp && <SpriteCanvas sprite={sp} scale={2} />}
                            </div>
                          );
                        }),
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
