/**
 * Badge system — small 8x8 pixel icons rendered above agent heads.
 *
 * Badges are drawn procedurally (no external sprites needed).
 * Each badge is a simple pixel-art icon.
 */

export type BadgeType = 'crown' | 'wrench' | 'magnifier' | 'lightning' | 'star' | 'none';

// Pre-computed 8x8 badge pixel patterns (1 = filled, 0 = transparent)
// Each is rendered in the badge color at the agent's head position

const BADGE_CROWN = [
  [0,0,0,0,0,0,0,0],
  [0,1,0,1,0,1,0,0],
  [0,1,0,1,0,1,0,0],
  [0,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
];

const BADGE_WRENCH = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,1,1,0,0],
  [0,0,0,1,0,1,0,0],
  [0,0,1,0,0,0,0,0],
  [0,1,0,0,0,0,0,0],
  [1,0,1,0,0,0,0,0],
  [1,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
];

const BADGE_MAGNIFIER = [
  [0,0,0,0,0,0,0,0],
  [0,0,1,1,1,0,0,0],
  [0,1,0,0,0,1,0,0],
  [0,1,0,0,0,1,0,0],
  [0,0,1,1,1,0,0,0],
  [0,0,0,0,0,1,0,0],
  [0,0,0,0,0,0,1,0],
  [0,0,0,0,0,0,0,0],
];

const BADGE_LIGHTNING = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,1,1,0,0,0],
  [0,0,1,1,0,0,0,0],
  [0,1,1,1,1,0,0,0],
  [0,0,0,1,1,0,0,0],
  [0,0,1,1,0,0,0,0],
  [0,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
];

const BADGE_STAR = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,1,0,0,0,0],
  [0,0,0,1,0,0,0,0],
  [0,1,1,1,1,1,0,0],
  [0,0,1,1,1,0,0,0],
  [0,1,0,1,0,1,0,0],
  [0,1,0,0,0,1,0,0],
  [0,0,0,0,0,0,0,0],
];

const BADGE_PATTERNS: Record<string, number[][]> = {
  crown: BADGE_CROWN,
  wrench: BADGE_WRENCH,
  magnifier: BADGE_MAGNIFIER,
  lightning: BADGE_LIGHTNING,
  star: BADGE_STAR,
};

const BADGE_COLORS: Record<string, string> = {
  crown: '#FFD700',      // gold
  wrench: '#88AACC',     // steel blue
  magnifier: '#88FF88',  // green
  lightning: '#FFFF44',  // yellow
  star: '#FF88FF',       // pink
};

// Cache rendered badge canvases at different zoom levels
const badgeCache = new Map<string, OffscreenCanvas>();

/**
 * Get a rendered badge canvas at the given zoom level.
 */
export function getBadgeSprite(badge: BadgeType, zoom: number): OffscreenCanvas | null {
  if (badge === 'none' || !BADGE_PATTERNS[badge]) return null;

  const key = `${badge}-${zoom}`;
  if (badgeCache.has(key)) return badgeCache.get(key)!;

  const pattern = BADGE_PATTERNS[badge];
  const color = BADGE_COLORS[badge];
  const size = 8;
  const canvas = new OffscreenCanvas(size * zoom, size * zoom);
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pattern[y][x]) {
        ctx.fillStyle = color;
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
  }

  badgeCache.set(key, canvas);
  return canvas;
}

/**
 * Render a badge above a character's head position.
 */
export function renderBadge(
  ctx: CanvasRenderingContext2D,
  badge: BadgeType,
  characterX: number,
  characterY: number,
  zoom: number,
  sittingOffset: number,
): void {
  const sprite = getBadgeSprite(badge, zoom);
  if (!sprite) return;

  // Position above the character's head
  const badgeX = Math.round(characterX - sprite.width / 2);
  const badgeY = Math.round(characterY + sittingOffset - 32 * zoom - sprite.height - 1 * zoom);

  ctx.drawImage(sprite, badgeX, badgeY);
}
