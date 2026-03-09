/**
 * ZoneOverlay — React component that renders zone labels, borders, and HUD
 * as HTML overlays on top of the canvas.
 *
 * This is lighter-weight than canvas rendering and supports CSS animations.
 */

import { useMemo } from 'react';
import type { ZoneManager } from './ZoneManager.js';
import type { HudMessage } from './ZoneRenderer.js';

interface ZoneOverlayProps {
  zoneManager: ZoneManager;
  zoom: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
  activeZones: Set<string>;
  agentCounts: Record<string, { active: number; total: number }>;
  hudMessages: HudMessage[];
  maxHudMessages: number;
  onZoneClick?: (zoneId: string) => void;
}

export function ZoneOverlay({
  zoneManager,
  zoom,
  panX,
  panY,
  canvasWidth,
  canvasHeight,
  activeZones,
  agentCounts,
  hudMessages,
  maxHudMessages,
  onZoneClick,
}: ZoneOverlayProps) {
  const zones = useMemo(() => zoneManager.getAllZones(), [zoneManager]);

  // Convert world coords to screen coords
  const mapW = zoneManager.totalWidth * zoom;
  const mapH = zoneManager.totalHeight * zoom;
  const baseOffsetX = (canvasWidth - mapW) / 2 + panX;
  const baseOffsetY = (canvasHeight - mapH) / 2 + panY;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 45 }}>
      {/* Zone labels and borders */}
      {zones.map((zone) => {
        const x = baseOffsetX + zone.worldX * zoom;
        const y = baseOffsetY + zone.worldY * zoom;
        const w = zone.widthPx * zoom;
        const h = zone.heightPx * zoom;
        const isActive = activeZones.has(zone.config.id);
        const counts = agentCounts[zone.config.id] || { active: 0, total: 0 };

        return (
          <div
            key={zone.config.id}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              pointerEvents: 'none',
            }}
          >
            {/* Border */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: `2px solid ${zone.config.accentColor}`,
                opacity: isActive ? 1 : 0.3,
                boxShadow: isActive ? `0 0 12px ${zone.config.accentColor}60, inset 0 0 8px ${zone.config.accentColor}20` : 'none',
                transition: 'opacity 0.5s, box-shadow 0.5s',
              }}
            />

            {/* Zone label */}
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'auto',
                cursor: 'pointer',
              }}
              onClick={() => onZoneClick?.(zone.config.id)}
            >
              {/* Accent bar */}
              <div
                style={{
                  width: 3,
                  height: 20,
                  background: zone.config.accentColor,
                  opacity: isActive ? 1 : 0.5,
                }}
              />
              <div
                style={{
                  background: 'rgba(10,10,20,0.85)',
                  padding: '3px 8px',
                  fontSize: Math.max(10, 11 * (zoom / 2)),
                  fontFamily: '"FSPixelSansUnicode", monospace',
                  fontWeight: 'bold',
                  color: zone.config.accentColor,
                  opacity: isActive ? 1 : 0.6,
                  letterSpacing: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {zone.config.name}
              </div>

              {/* Active agent count badge */}
              {counts.total > 0 && (
                <div
                  style={{
                    background: counts.active > 0 ? '#00FF8840' : '#FF333340',
                    border: `1px solid ${counts.active > 0 ? '#00FF88' : '#FF3333'}`,
                    borderRadius: 2,
                    padding: '1px 5px',
                    fontSize: Math.max(8, 9 * (zoom / 2)),
                    color: counts.active > 0 ? '#00FF88' : '#FF3333',
                    fontFamily: 'monospace',
                  }}
                >
                  {counts.active}/{counts.total}
                </div>
              )}
            </div>

            {/* Status lights (top-right) */}
            <div
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              {(zone.config.agents || []).map((agent) => {
                // We'll determine if this specific agent is active based on
                // whether any tracked agent in this zone matches
                return (
                  <div
                    key={agent.agentId}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        width: Math.max(4, 5 * (zoom / 2)),
                        height: Math.max(4, 5 * (zoom / 2)),
                        borderRadius: '50%',
                        background: '#FF3333', // default idle
                        boxShadow: '0 0 3px #FF333380',
                      }}
                    />
                    <span
                      style={{
                        fontSize: Math.max(5, 6 * (zoom / 2)),
                        color: 'rgba(255,255,255,0.4)',
                        fontFamily: 'monospace',
                        lineHeight: 1,
                      }}
                    >
                      {agent.name.slice(0, 4)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Source indicator */}
            <div
              style={{
                position: 'absolute',
                bottom: 4,
                right: 6,
                fontSize: Math.max(7, 8 * (zoom / 2)),
                color: 'rgba(255,255,255,0.2)',
                fontFamily: 'monospace',
              }}
            >
              {zone.config.source === 'claude' ? 'Claude Code' : 'OpenClaw'}
            </div>
          </div>
        );
      })}

      {/* HUD Bar (top of screen) */}
      {hudMessages.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 28,
            background: 'rgba(10,10,20,0.92)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 8,
            overflow: 'hidden',
            zIndex: 50,
          }}
        >
          {hudMessages.slice(0, maxHudMessages).map((msg, i) => (
            <div key={msg.id} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <span
                style={{
                  color: msg.zoneColor,
                  fontSize: 11,
                  fontFamily: '"FSPixelSansUnicode", monospace',
                  fontWeight: 'bold',
                }}
              >
                [{msg.zoneName}]
              </span>
              <span
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 11,
                  fontFamily: '"FSPixelSansUnicode", monospace',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {msg.text}
              </span>
              {i < Math.min(hudMessages.length, maxHudMessages) - 1 && (
                <span style={{ color: 'rgba(255,255,255,0.15)', margin: '0 4px' }}> · </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
