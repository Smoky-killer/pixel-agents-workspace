/**
 * zoneLayoutGenerator — generates furnished OfficeLayouts from zone config.
 *
 * Reads sources.config.json zone settings (agents, hasConferenceTable, etc.)
 * and produces a proper OfficeLayout with walls, floors, desks, chairs, PCs,
 * and decorative furniture.
 */

import type { FloorColor, OfficeLayout, PlacedFurniture, TileType as TileTypeVal } from '../office/types.js';
import { FurnitureType, TileType } from '../office/types.js';
import type { ZoneConfig } from './ZoneManager.js';

// ── Room style floor colors ─────────────────────────────────────
const ROOM_STYLES: Record<string, FloorColor> = {
  modern:  { h: 210, s: 20, b: 10, c: 0 },
  classic: { h: 35, s: 30, b: 15, c: 0 },
  lab:     { h: 180, s: 15, b: 5, c: 5 },
  minimal: { h: 0, s: 0, b: 5, c: 0 },
};

// ── Furniture footprints [width, height] ────────────────────────
const FOOTPRINTS: Record<string, [number, number]> = {
  [FurnitureType.DESK]:       [2, 2],
  [FurnitureType.BOOKSHELF]:  [1, 2],
  [FurnitureType.PLANT]:      [1, 1],
  [FurnitureType.COOLER]:     [1, 1],
  [FurnitureType.WHITEBOARD]: [2, 1],
  [FurnitureType.CHAIR]:      [1, 1],
  [FurnitureType.PC]:         [1, 1],
  [FurnitureType.LAMP]:       [1, 1],
};

// Items that sit on top of desks (skip collision checks)
const SURFACE_ITEMS: Set<string> = new Set([FurnitureType.PC, FurnitureType.LAMP]);

// Items that go on wall tiles
const WALL_ITEMS: Set<string> = new Set([FurnitureType.WHITEBOARD]);

/**
 * Try to place a furniture item, checking for overlaps.
 * Surface items (PC, lamp) skip collision since they sit on desks.
 * Wall items skip wall-tile collision.
 */
function tryPlace(
  furniture: PlacedFurniture[],
  occupied: Set<string>,
  item: PlacedFurniture,
  cols: number,
  rows: number,
): boolean {
  const fp = FOOTPRINTS[item.type] || [1, 1];
  const [w, h] = fp;

  // Bounds check
  if (item.col < 0 || item.col + w > cols || item.row < 0 || item.row + h > rows) return false;

  const isSurface = SURFACE_ITEMS.has(item.type);
  const isWall = WALL_ITEMS.has(item.type);

  if (!isSurface) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const key = `${item.col + c},${item.row + r}`;
        if (occupied.has(key)) {
          // Wall items can overlap wall tiles
          if (isWall && isWallTile(item.col + c, item.row + r, cols, rows)) continue;
          return false;
        }
      }
    }
    // Mark tiles as occupied
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        occupied.add(`${item.col + c},${item.row + r}`);
      }
    }
  }

  furniture.push(item);
  return true;
}

function isWallTile(c: number, r: number, cols: number, rows: number): boolean {
  return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
}

/**
 * Generate a furnished OfficeLayout for a zone based on its config.
 */
export function generateZoneLayout(
  config: ZoneConfig,
  cols: number,
  rows: number,
): OfficeLayout {
  const tiles: TileTypeVal[] = [];
  const tileColors: Array<FloorColor | null> = [];
  const floorColor = ROOM_STYLES[config.roomStyle || 'modern'] || ROOM_STYLES.modern;

  // ── Build tile grid: walls on perimeter, floor inside ─────────
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWallTile(c, r, cols, rows)) {
        tiles.push(TileType.WALL);
        tileColors.push(null);
      } else {
        tiles.push(TileType.FLOOR_1);
        tileColors.push(floorColor);
      }
    }
  }

  const furniture: PlacedFurniture[] = [];
  const occupied = new Set<string>();
  const zid = config.id;

  // Mark wall tiles as occupied
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWallTile(c, r, cols, rows)) {
        occupied.add(`${c},${r}`);
      }
    }
  }

  // ── Agent workstations ────────────────────────────────────────
  // Each agent gets: desk (2×2) + chair (1×1 below) + PC (1×1 on desk)
  const agents = config.agents || [];
  const innerW = cols - 2;

  // How many workstations fit per row (each needs ~5 cols: 2 desk + 3 gap)
  const stationsPerRow = Math.max(1, Math.floor(innerW / 5));

  // Calculate horizontal starting positions for each column of stations
  const colStarts: number[] = [];
  const spacing = Math.floor(innerW / stationsPerRow);
  for (let i = 0; i < stationsPerRow; i++) {
    colStarts.push(2 + i * spacing);
  }

  for (let i = 0; i < agents.length; i++) {
    const rowGroup = Math.floor(i / stationsPerRow);
    const colGroup = i % stationsPerRow;

    const dCol = colStarts[colGroup];
    const dRow = 2 + rowGroup * 4; // 4 rows per workstation block

    // Skip if workstation would be out of bounds
    if (dCol + 2 > cols - 1 || dRow + 3 > rows - 1) continue;

    // Desk (2×2)
    tryPlace(furniture, occupied, {
      uid: `${zid}-desk-${i}`,
      type: FurnitureType.DESK,
      col: dCol,
      row: dRow,
    }, cols, rows);

    // Chair (below desk, faces UP toward desk)
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-${i}`,
      type: FurnitureType.CHAIR,
      col: dCol,
      row: dRow + 2,
    }, cols, rows);

    // PC on desk surface
    tryPlace(furniture, occupied, {
      uid: `${zid}-pc-${i}`,
      type: FurnitureType.PC,
      col: dCol + 1,
      row: dRow,
    }, cols, rows);
  }

  // ── Bookshelf (left wall area) ────────────────────────────────
  if (rows >= 8) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-bookshelf`,
      type: FurnitureType.BOOKSHELF,
      col: 1,
      row: Math.min(5, rows - 4),
    }, cols, rows);
  }

  // ── Whiteboard (top wall, center-right) ───────────────────────
  if (cols >= 10) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-whiteboard`,
      type: FurnitureType.WHITEBOARD,
      col: Math.floor(cols * 0.6),
      row: 0,
    }, cols, rows);
  }

  // ── Plants (corners) ─────────────────────────────────────────
  if (config.hasPlants) {
    // Top-left
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-tl`,
      type: FurnitureType.PLANT,
      col: 1,
      row: 1,
    }, cols, rows);

    // Bottom-right
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-br`,
      type: FurnitureType.PLANT,
      col: cols - 2,
      row: rows - 2,
    }, cols, rows);

    // Top-right (if enough space)
    if (cols >= 12) {
      tryPlace(furniture, occupied, {
        uid: `${zid}-plant-tr`,
        type: FurnitureType.PLANT,
        col: cols - 2,
        row: 1,
      }, cols, rows);
    }
  }

  // ── Cooler / coffee machine ───────────────────────────────────
  if (config.hasCoffeeMachine) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-cooler`,
      type: FurnitureType.COOLER,
      col: cols - 3,
      row: rows - 3,
    }, cols, rows);
  }

  // ── Conference table (right-center area) ──────────────────────
  if (config.hasConferenceTable && cols >= 12 && rows >= 10) {
    const confCol = Math.max(Math.floor(cols * 0.6), 8);
    const confRow = Math.max(Math.floor(rows * 0.45), 4);

    if (tryPlace(furniture, occupied, {
      uid: `${zid}-conf-table`,
      type: FurnitureType.DESK,
      col: confCol,
      row: confRow,
    }, cols, rows)) {
      // Chair above conference table
      tryPlace(furniture, occupied, {
        uid: `${zid}-conf-chair-t`,
        type: FurnitureType.CHAIR,
        col: confCol,
        row: confRow - 1,
      }, cols, rows);

      // Chair below conference table
      tryPlace(furniture, occupied, {
        uid: `${zid}-conf-chair-b`,
        type: FurnitureType.CHAIR,
        col: confCol + 1,
        row: confRow + 2,
      }, cols, rows);
    }
  }

  // ── Discord desk (top-right area) ─────────────────────────────
  if (config.hasDiscordDesk && cols >= 14) {
    const ddCol = cols - 5;
    const ddRow = 2;

    if (tryPlace(furniture, occupied, {
      uid: `${zid}-discord-desk`,
      type: FurnitureType.DESK,
      col: ddCol,
      row: ddRow,
    }, cols, rows)) {
      // Chair below discord desk
      tryPlace(furniture, occupied, {
        uid: `${zid}-discord-chair`,
        type: FurnitureType.CHAIR,
        col: ddCol,
        row: ddRow + 2,
      }, cols, rows);

      // Lamp on discord desk
      tryPlace(furniture, occupied, {
        uid: `${zid}-discord-lamp`,
        type: FurnitureType.LAMP,
        col: ddCol + 1,
        row: ddRow,
      }, cols, rows);
    }
  }

  // ── Extra lamp near bookshelf ─────────────────────────────────
  if (rows >= 10) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-lamp-1`,
      type: FurnitureType.LAMP,
      col: 1,
      row: rows - 3,
    }, cols, rows);
  }

  return { version: 1, cols, rows, tiles, tileColors, furniture };
}
