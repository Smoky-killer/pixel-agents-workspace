/**
 * ZoneRenderer — draws zone borders, labels, status lights, and HUD on the canvas.
 */

import type { ZoneManager, ZoneRect } from './ZoneManager.js';

const LABEL_FONT_SIZE = 10;
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 3;
const BORDER_WIDTH = 2;
const STATUS_LIGHT_RADIUS = 4;
const STATUS_LIGHT_SPACING = 14;

export interface ZoneAgentStatus {
  name: string;
  isActive: boolean;
  zoneId: string;
}

/**
 * Render all zone borders and labels on the canvas.
 */
export function renderZoneBorders(
  ctx: CanvasRenderingContext2D,
  zoneManager: ZoneManager,
  offsetX: number,
  offsetY: number,
  zoom: number,
  activeZones: Set<string>,
  agentCounts?: Record<string, { active: number; total: number }>,
): void {
  for (const zone of zoneManager.getAllZones()) {
    const x = offsetX + zone.worldX * zoom;
    const y = offsetY + zone.worldY * zoom;
    const w = zone.widthPx * zoom;
    const h = zone.heightPx * zoom;

    const isActive = activeZones.has(zone.config.id);
    const color = zone.config.accentColor;

    // Zone border
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = BORDER_WIDTH * zoom;
    ctx.globalAlpha = isActive ? 1.0 : 0.4;
    ctx.strokeRect(x, y, w, h);

    // Glow effect for active zones
    if (isActive) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * zoom;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Zone label + count badge (top-left corner)
    const counts = agentCounts?.[zone.config.id];
    renderZoneLabel(ctx, zone, x, y, zoom, isActive, counts);

    // Source indicator (bottom-right corner)
    const srcFontSize = Math.max(5, 7 * zoom);
    ctx.save();
    ctx.font = `${srcFontSize}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      zone.config.source === 'claude' ? 'Claude Code' : 'OpenClaw',
      x + w - 6 * zoom,
      y + h - 4 * zoom,
    );
    ctx.restore();
  }
}

function renderZoneLabel(
  ctx: CanvasRenderingContext2D,
  zone: ZoneRect,
  x: number,
  y: number,
  zoom: number,
  isActive: boolean,
  counts?: { active: number; total: number },
): void {
  const fontSize = Math.max(8, LABEL_FONT_SIZE * zoom);
  ctx.save();
  ctx.font = `bold ${fontSize}px "FSPixelSansUnicode", monospace`;

  const text = zone.config.name;
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const padX = LABEL_PAD_X * zoom;
  const padY = LABEL_PAD_Y * zoom;
  const bgW = textW + padX * 2;
  const bgH = fontSize + padY * 2;

  // Label sits inside top-left of zone
  const labelX = x + 2 * zoom;
  const labelY = y + 2 * zoom;

  // Background
  ctx.fillStyle = 'rgba(10, 10, 20, 0.85)';
  ctx.fillRect(labelX, labelY, bgW, bgH);

  // Accent bar on left
  ctx.fillStyle = zone.config.accentColor;
  ctx.globalAlpha = isActive ? 1.0 : 0.5;
  ctx.fillRect(labelX, labelY, 3 * zoom, bgH);

  // Text
  ctx.globalAlpha = isActive ? 1.0 : 0.6;
  ctx.fillStyle = zone.config.accentColor;
  ctx.textBaseline = 'top';
  ctx.fillText(text, labelX + padX + 2 * zoom, labelY + padY);

  // Agent count badge (to the right of the label)
  if (counts && counts.total > 0) {
    const badgeText = `${counts.active}/${counts.total}`;
    const badgeFontSize = Math.max(7, 8 * zoom);
    ctx.font = `${badgeFontSize}px monospace`;
    const badgeW = ctx.measureText(badgeText).width + 8 * zoom;
    const badgeH = badgeFontSize + 4 * zoom;
    const badgeX = labelX + bgW + 4 * zoom;
    const badgeY = labelY + (bgH - badgeH) / 2;

    const badgeColor = counts.active > 0 ? '#00FF88' : '#FF3333';

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = counts.active > 0 ? 'rgba(0,255,136,0.15)' : 'rgba(255,51,51,0.15)';
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);

    ctx.fillStyle = badgeColor;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 2 * zoom);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}

/**
 * Render status lights (green/red dots) for each agent in a zone.
 */
export function renderStatusLights(
  ctx: CanvasRenderingContext2D,
  zoneManager: ZoneManager,
  offsetX: number,
  offsetY: number,
  zoom: number,
  agentStatuses: ZoneAgentStatus[],
  activeColor: string,
  idleColor: string,
): void {
  // Group agents by zone
  const byZone = new Map<string, ZoneAgentStatus[]>();
  for (const a of agentStatuses) {
    if (!byZone.has(a.zoneId)) byZone.set(a.zoneId, []);
    byZone.get(a.zoneId)!.push(a);
  }

  for (const [zoneId, agents] of byZone) {
    const zone = zoneManager.getZone(zoneId);
    if (!zone) continue;

    const zx = offsetX + zone.worldX * zoom;
    const zy = offsetY + zone.worldY * zoom;
    const zw = zone.widthPx * zoom;

    // Position lights in top-right area of zone
    const startX = zx + zw - (agents.length * STATUS_LIGHT_SPACING * zoom) - 8 * zoom;
    const lightY = zy + 10 * zoom;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const cx = startX + i * STATUS_LIGHT_SPACING * zoom;
      const r = STATUS_LIGHT_RADIUS * zoom;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, lightY, r, 0, Math.PI * 2);
      ctx.fillStyle = agent.isActive ? activeColor : idleColor;
      ctx.fill();

      // Glow for active
      if (agent.isActive) {
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 4 * zoom;
        ctx.beginPath();
        ctx.arc(cx, lightY, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Agent name label below light
      const nameFontSize = Math.max(5, 6 * zoom);
      ctx.save();
      ctx.font = `${nameFontSize}px monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(agent.name.slice(0, 5), cx, lightY + r + 2 * zoom);
      ctx.restore();
    }
  }
}

/**
 * HUD message for the multi-zone feed.
 */
export interface HudMessage {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  text: string;
  timestamp: number;
}

/**
 * Render the top HUD bar with zone-prefixed messages.
 */
export function renderHud(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  messages: HudMessage[],
  maxMessages: number,
): void {
  if (messages.length === 0) return;

  const barHeight = 28;
  const fontSize = 11;
  const padX = 10;

  // Semi-transparent background bar
  ctx.save();
  ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
  ctx.fillRect(0, 0, canvasWidth, barHeight);

  // Bottom border
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, barHeight - 1, canvasWidth, 1);

  ctx.font = `${fontSize}px "FSPixelSansUnicode", monospace`;
  ctx.textBaseline = 'middle';

  const visible = messages.slice(0, maxMessages);
  let x = padX;
  const y = barHeight / 2;

  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i];

    // Zone prefix [ZONE_NAME]
    const prefix = `[${msg.zoneName}]`;
    ctx.fillStyle = msg.zoneColor;
    ctx.fillText(prefix, x, y);
    x += ctx.measureText(prefix).width + 4;

    // Message text
    const maxTextW = Math.max(80, (canvasWidth - 40) / maxMessages - 60);
    let text = msg.text;
    while (ctx.measureText(text).width > maxTextW && text.length > 10) {
      text = text.slice(0, -4) + '...';
    }
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(text, x, y);
    x += ctx.measureText(text).width;

    // Separator dot
    if (i < visible.length - 1) {
      x += 8;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillText(' · ', x, y);
      x += ctx.measureText(' · ').width + 8;
    }
  }

  ctx.restore();
}
