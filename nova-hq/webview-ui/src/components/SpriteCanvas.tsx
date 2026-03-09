import { useEffect, useRef } from 'react';

import type { SpriteData } from '../office/types.js';

interface SpriteCanvasProps {
  sprite: SpriteData;
  scale?: number;
  style?: React.CSSProperties;
}

/**
 * Renders a pixel-art SpriteData (string[][]) onto a canvas at the given scale.
 */
export function SpriteCanvas({ sprite, scale = 2, style }: SpriteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rows = sprite.length;
    const cols = sprite[0]?.length ?? 0;
    if (rows === 0 || cols === 0) return;

    canvas.width = cols * scale;
    canvas.height = rows * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = sprite[r][c];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(c * scale, r * scale, scale, scale);
      }
    }
  }, [sprite, scale]);

  return (
    <canvas
      ref={canvasRef}
      style={{ imageRendering: 'pixelated', display: 'block', ...style }}
    />
  );
}
