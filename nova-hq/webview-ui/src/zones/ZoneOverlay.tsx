/**
 * ZoneOverlay — HUD bar rendered as HTML overlay at top of screen.
 * Zone borders, labels, and status lights are now drawn on the canvas
 * (see ZoneRenderer.ts) so they stay in sync with pan/zoom.
 */

import type { HudMessage } from './ZoneRenderer.js';

interface ZoneOverlayProps {
  hudMessages: HudMessage[];
  maxHudMessages: number;
}

export function ZoneOverlay({
  hudMessages,
  maxHudMessages,
}: ZoneOverlayProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 45 }}>
      {/* HUD Bar (top of screen) — live scrolling feed */}
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
                  maxWidth: 300,
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
