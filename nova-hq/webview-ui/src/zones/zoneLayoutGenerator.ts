/**
 * zoneLayoutGenerator — generates zone-specific furnished OfficeLayouts.
 *
 * Each zone ID dispatches to a dedicated layout builder that places
 * furniture appropriate to that zone's purpose (command, studio,
 * marketing, research, or wide claude-main).
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

// ── Helpers ──────────────────────────────────────────────────────

/** Build the tile + tileColors grid (walls on perimeter, floor inside). */
function buildTileGrid(
  cols: number,
  rows: number,
  floorColor: FloorColor,
): { tiles: TileTypeVal[]; tileColors: Array<FloorColor | null> } {
  const tiles: TileTypeVal[] = [];
  const tileColors: Array<FloorColor | null> = [];
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
  return { tiles, tileColors };
}

/** Mark wall tiles as occupied in the collision set. */
function markWalls(occupied: Set<string>, cols: number, rows: number): void {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWallTile(c, r, cols, rows)) {
        occupied.add(`${c},${r}`);
      }
    }
  }
}

/** Place a standard workstation: desk (2x2) + chair below + PC on desk. */
function placeWorkstation(
  zid: string,
  suffix: string,
  col: number,
  row: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
  cols: number,
  rows: number,
): boolean {
  const placed = tryPlace(furniture, occupied, {
    uid: `${zid}-desk-${suffix}`,
    type: FurnitureType.DESK,
    col,
    row,
  }, cols, rows);
  if (placed) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-${suffix}`,
      type: FurnitureType.CHAIR,
      col,
      row: row + 2,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-pc-${suffix}`,
      type: FurnitureType.PC,
      col: col + 1,
      row,
    }, cols, rows);
  }
  return placed;
}

/** Place a desk with chair and lamp (no PC). */
function placeDeskWithLamp(
  zid: string,
  suffix: string,
  col: number,
  row: number,
  chairRow: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
  cols: number,
  rows: number,
): boolean {
  const placed = tryPlace(furniture, occupied, {
    uid: `${zid}-desk-${suffix}`,
    type: FurnitureType.DESK,
    col,
    row,
  }, cols, rows);
  if (placed) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-${suffix}`,
      type: FurnitureType.CHAIR,
      col,
      row: chairRow,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-lamp-${suffix}`,
      type: FurnitureType.LAMP,
      col: col + 1,
      row,
    }, cols, rows);
  }
  return placed;
}

/**
 * Place overflow agents that did not get a named station.
 * Fills available space row by row from the given starting position.
 */
function placeOverflowAgents(
  zid: string,
  startIdx: number,
  agents: ZoneConfig['agents'],
  startCol: number,
  startRow: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
  cols: number,
  rows: number,
): void {
  let c = startCol;
  let r = startRow;
  for (let i = startIdx; i < agents.length; i++) {
    // Try to place, advancing rightward then downward
    let placed = false;
    while (r + 3 <= rows - 1 && !placed) {
      while (c + 2 <= cols - 1 && !placed) {
        placed = placeWorkstation(zid, `overflow-${i}`, c, r, furniture, occupied, cols, rows);
        if (!placed) c += 3;
      }
      if (!placed) {
        c = startCol;
        r += 4;
      }
    }
  }
}

// ── Zone-specific layout builders ────────────────────────────────

/**
 * NOVA zone — commander/orchestrator office (20x15).
 *
 * Layout:
 *   Top-center:  commander desk + chair + PC
 *   Top-left:    Telegram station (desk + chair + lamp)
 *   Top-right:   Discord station if enabled
 *   Center-right: strategy table desk + 2 chairs
 *   Bottom-left: builder workbench + chair + PC
 *   Bottom-right: repair station + chair + lamp
 *   Middle-left: remaining agent workstations
 *   Left wall:   bookshelves
 *   Corners:     plants, cooler bottom-right
 */
function layoutNova(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];
  let assigned = 0;

  // Commander desk — top center
  const cmdCol = Math.floor(cols / 2) - 1;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'cmd', cmdCol, 2, furniture, occupied, cols, rows);
    assigned++;
  }

  // Telegram station — top-left area
  if (agents.length > assigned) {
    placeDeskWithLamp(zid, 'telegram', 2, 2, 4, furniture, occupied, cols, rows);
    assigned++;
  }

  // Discord station — top-right area (only if config says so)
  if (config.hasDiscordDesk && agents.length > assigned) {
    placeDeskWithLamp(zid, 'discord', cols - 5, 2, 4, furniture, occupied, cols, rows);
    assigned++;
  }

  // Strategy table — center-right with 2 chairs (above and below)
  if (agents.length > assigned) {
    const stCol = cols - 6;
    const stRow = Math.floor(rows / 2) - 1;
    if (tryPlace(furniture, occupied, {
      uid: `${zid}-desk-strategy`,
      type: FurnitureType.DESK,
      col: stCol,
      row: stRow,
    }, cols, rows)) {
      tryPlace(furniture, occupied, {
        uid: `${zid}-chair-strategy-t`,
        type: FurnitureType.CHAIR,
        col: stCol,
        row: stRow - 1,
      }, cols, rows);
      tryPlace(furniture, occupied, {
        uid: `${zid}-chair-strategy-b`,
        type: FurnitureType.CHAIR,
        col: stCol + 1,
        row: stRow + 2,
      }, cols, rows);
      tryPlace(furniture, occupied, {
        uid: `${zid}-pc-strategy`,
        type: FurnitureType.PC,
        col: stCol + 1,
        row: stRow,
      }, cols, rows);
      assigned++;
    }
  }

  // Builder workbench — bottom-left
  if (agents.length > assigned) {
    placeWorkstation(zid, 'builder', 2, rows - 5, furniture, occupied, cols, rows);
    assigned++;
  }

  // Repair station — bottom-right
  if (agents.length > assigned) {
    placeDeskWithLamp(zid, 'repair', cols - 5, rows - 5, rows - 3, furniture, occupied, cols, rows);
    assigned++;
  }

  // Remaining worker desks in middle-left area
  if (agents.length > assigned) {
    placeOverflowAgents(zid, assigned, agents, 2, 6, furniture, occupied, cols, rows);
  }

  // Bookshelves along left wall
  for (let br = 2; br + 2 <= rows - 2; br += 3) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-bookshelf-${br}`,
      type: FurnitureType.BOOKSHELF,
      col: 1,
      row: br,
    }, cols, rows);
  }

  // Cooler — bottom-right corner
  tryPlace(furniture, occupied, {
    uid: `${zid}-cooler`,
    type: FurnitureType.COOLER,
    col: cols - 2,
    row: rows - 2,
  }, cols, rows);

  // Plants in corners
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-tl`,
    type: FurnitureType.PLANT,
    col: 1,
    row: 1,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-tr`,
    type: FurnitureType.PLANT,
    col: cols - 2,
    row: 1,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-bl`,
    type: FurnitureType.PLANT,
    col: 1,
    row: rows - 2,
  }, cols, rows);
}

/**
 * STUDIO zone — content/video production (20x15).
 *
 * Layout:
 *   Top-center:   commander desk
 *   Middle:       two side-by-side video editing desks
 *   Right-center: conference table + 2 chairs
 *   Bottom-right: publishing station desk + lamp
 *   Bottom-left:  Telegram desk if configured
 *   Top wall:     whiteboard, bookshelves, plants
 */
function layoutStudio(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];
  let assigned = 0;

  // Commander desk — top center
  const cmdCol = Math.floor(cols / 2) - 1;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'cmd', cmdCol, 2, furniture, occupied, cols, rows);
    assigned++;
  }

  // Video editing desks — two side-by-side in middle area
  const editRow = 6;
  const editCol1 = 3;
  const editCol2 = editCol1 + 4;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'edit1', editCol1, editRow, furniture, occupied, cols, rows);
    assigned++;
  }
  if (agents.length > assigned) {
    placeWorkstation(zid, 'edit2', editCol2, editRow, furniture, occupied, cols, rows);
    assigned++;
  }

  // Conference table — right-center with 2 chairs
  const confCol = cols - 5;
  const confRow = Math.floor(rows / 2) - 1;
  if (tryPlace(furniture, occupied, {
    uid: `${zid}-desk-conf`,
    type: FurnitureType.DESK,
    col: confCol,
    row: confRow,
  }, cols, rows)) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-conf-t`,
      type: FurnitureType.CHAIR,
      col: confCol,
      row: confRow - 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-conf-b`,
      type: FurnitureType.CHAIR,
      col: confCol + 1,
      row: confRow + 2,
    }, cols, rows);
  }

  // Publishing station — bottom-right with lamp
  if (agents.length > assigned) {
    placeDeskWithLamp(zid, 'publish', cols - 5, rows - 5, rows - 3, furniture, occupied, cols, rows);
    assigned++;
  }

  // Telegram desk — bottom-left if configured
  if (config.hasTelegramDesk && agents.length > assigned) {
    placeDeskWithLamp(zid, 'telegram', 2, rows - 5, rows - 3, furniture, occupied, cols, rows);
    assigned++;
  }

  // Overflow agents
  if (agents.length > assigned) {
    placeOverflowAgents(zid, assigned, agents, 2, 10, furniture, occupied, cols, rows);
  }

  // Whiteboard on top wall
  tryPlace(furniture, occupied, {
    uid: `${zid}-whiteboard`,
    type: FurnitureType.WHITEBOARD,
    col: Math.floor(cols * 0.6),
    row: 0,
  }, cols, rows);

  // Bookshelves near top-left
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-1`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 2,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-2`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 5,
  }, cols, rows);

  // Plants
  if (config.hasPlants) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-tl`,
      type: FurnitureType.PLANT,
      col: 1,
      row: 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-br`,
      type: FurnitureType.PLANT,
      col: cols - 2,
      row: rows - 2,
    }, cols, rows);
  }
}

/**
 * MARKETER zone — marketing/outreach (20x15).
 *
 * Layout:
 *   Top-center:   commander desk
 *   Top wall:     campaign whiteboard
 *   Middle row:   3-4 prospecting/calling desks in a row
 *   Right area:   ad review table (conference desk) + chairs
 *   Bottom-left:  Telegram desk if configured
 *   Decor:        cooler, bookshelves
 */
function layoutMarketer(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];
  let assigned = 0;

  // Commander desk — top center
  const cmdCol = Math.floor(cols / 2) - 1;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'cmd', cmdCol, 2, furniture, occupied, cols, rows);
    assigned++;
  }

  // Campaign whiteboard on top wall
  tryPlace(furniture, occupied, {
    uid: `${zid}-whiteboard`,
    type: FurnitureType.WHITEBOARD,
    col: 3,
    row: 0,
  }, cols, rows);

  // Row of prospecting/calling desks across middle (up to 4)
  const deskRow = 6;
  const deskCount = Math.min(agents.length - assigned, 4);
  const spacing = 4;
  const startCol = 2;
  for (let d = 0; d < deskCount; d++) {
    const dc = startCol + d * spacing;
    if (dc + 2 <= cols - 1) {
      placeWorkstation(zid, `prospect-${d}`, dc, deskRow, furniture, occupied, cols, rows);
      assigned++;
    }
  }

  // Ad review table — right area with chairs
  const adCol = cols - 5;
  const adRow = rows - 6;
  if (tryPlace(furniture, occupied, {
    uid: `${zid}-desk-adreview`,
    type: FurnitureType.DESK,
    col: adCol,
    row: adRow,
  }, cols, rows)) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-adreview-t`,
      type: FurnitureType.CHAIR,
      col: adCol,
      row: adRow - 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-adreview-b`,
      type: FurnitureType.CHAIR,
      col: adCol + 1,
      row: adRow + 2,
    }, cols, rows);
  }

  // Telegram desk — bottom-left if configured
  if (config.hasTelegramDesk && agents.length > assigned) {
    placeDeskWithLamp(zid, 'telegram', 2, rows - 5, rows - 3, furniture, occupied, cols, rows);
    assigned++;
  }

  // Overflow agents
  if (agents.length > assigned) {
    placeOverflowAgents(zid, assigned, agents, 2, 10, furniture, occupied, cols, rows);
  }

  // Cooler
  tryPlace(furniture, occupied, {
    uid: `${zid}-cooler`,
    type: FurnitureType.COOLER,
    col: cols - 2,
    row: rows - 2,
  }, cols, rows);

  // Bookshelves along left wall
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-1`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 2,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-2`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 5,
  }, cols, rows);
}

/**
 * ORACLE zone — research/analysis (20x15).
 *
 * Layout:
 *   Top-center:   commander desk
 *   Left wall:    research bookshelves stacked along entire wall
 *   Center-right: analysis table (large desk) + multiple chairs
 *   Bottom:       news monitoring station desk
 *   Right wall bottom: archive shelves (more bookshelves)
 *   Decor:        plants, cooler
 */
function layoutOracle(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];
  let assigned = 0;

  // Commander desk — top center
  const cmdCol = Math.floor(cols / 2) - 1;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'cmd', cmdCol, 2, furniture, occupied, cols, rows);
    assigned++;
  }

  // Research bookshelves along ENTIRE left wall
  for (let br = 1; br + 2 <= rows - 1; br += 2) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-bookshelf-l-${br}`,
      type: FurnitureType.BOOKSHELF,
      col: 1,
      row: br,
    }, cols, rows);
  }

  // Analysis table — center-right with multiple chairs
  const atCol = cols - 7;
  const atRow = 5;
  if (agents.length > assigned) {
    if (tryPlace(furniture, occupied, {
      uid: `${zid}-desk-analysis`,
      type: FurnitureType.DESK,
      col: atCol,
      row: atRow,
    }, cols, rows)) {
      tryPlace(furniture, occupied, {
        uid: `${zid}-chair-analysis-t`,
        type: FurnitureType.CHAIR,
        col: atCol,
        row: atRow - 1,
      }, cols, rows);
      tryPlace(furniture, occupied, {
        uid: `${zid}-chair-analysis-b`,
        type: FurnitureType.CHAIR,
        col: atCol + 1,
        row: atRow + 2,
      }, cols, rows);
      tryPlace(furniture, occupied, {
        uid: `${zid}-chair-analysis-r`,
        type: FurnitureType.CHAIR,
        col: atCol + 2,
        row: atRow,
      }, cols, rows);
      tryPlace(furniture, occupied, {
        uid: `${zid}-pc-analysis`,
        type: FurnitureType.PC,
        col: atCol,
        row: atRow,
      }, cols, rows);
      assigned++;
    }
  }

  // Research workstations for more agents — middle area
  const researchRow = 5;
  const researchCol = 3;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'research1', researchCol, researchRow, furniture, occupied, cols, rows);
    assigned++;
  }
  if (agents.length > assigned) {
    placeWorkstation(zid, 'research2', researchCol + 4, researchRow, furniture, occupied, cols, rows);
    assigned++;
  }

  // News monitoring station — bottom area
  if (agents.length > assigned) {
    placeWorkstation(zid, 'news', Math.floor(cols / 2) - 1, rows - 5, furniture, occupied, cols, rows);
    assigned++;
  }

  // Archive shelves along right wall bottom
  for (let ar = rows - 5; ar + 2 <= rows - 1; ar += 2) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-bookshelf-r-${ar}`,
      type: FurnitureType.BOOKSHELF,
      col: cols - 2,
      row: ar,
    }, cols, rows);
  }

  // Overflow agents
  if (agents.length > assigned) {
    placeOverflowAgents(zid, assigned, agents, 3, 9, furniture, occupied, cols, rows);
  }

  // Plants
  if (config.hasPlants) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-tl`,
      type: FurnitureType.PLANT,
      col: 1,
      row: 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-br`,
      type: FurnitureType.PLANT,
      col: cols - 2,
      row: rows - 2,
    }, cols, rows);
  }

  // Cooler
  tryPlace(furniture, occupied, {
    uid: `${zid}-cooler`,
    type: FurnitureType.COOLER,
    col: cols - 3,
    row: rows - 2,
  }, cols, rows);
}

/**
 * CLAUDE zone — wide 42-column layout.
 *
 * Layout:
 *   Center:       commander desk
 *   Right-center: conference table + chairs
 *   All 4 corners: plants
 *   Spread out:   bookshelves, whiteboard, cooler
 */
function layoutClaude(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];
  let assigned = 0;

  // Commander desk — centered in the wide room
  const cmdCol = Math.floor(cols / 2) - 1;
  if (agents.length > assigned) {
    placeWorkstation(zid, 'cmd', cmdCol, 4, furniture, occupied, cols, rows);
    assigned++;
  }

  // Conference table — right of center
  const confCol = Math.floor(cols * 0.65);
  const confRow = 5;
  if (tryPlace(furniture, occupied, {
    uid: `${zid}-desk-conf`,
    type: FurnitureType.DESK,
    col: confCol,
    row: confRow,
  }, cols, rows)) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-conf-t`,
      type: FurnitureType.CHAIR,
      col: confCol,
      row: confRow - 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-chair-conf-b`,
      type: FurnitureType.CHAIR,
      col: confCol + 1,
      row: confRow + 2,
    }, cols, rows);
  }

  // Plants in all 4 corners
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-tl`,
    type: FurnitureType.PLANT,
    col: 1,
    row: 1,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-tr`,
    type: FurnitureType.PLANT,
    col: cols - 2,
    row: 1,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-bl`,
    type: FurnitureType.PLANT,
    col: 1,
    row: rows - 2,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-plant-br`,
    type: FurnitureType.PLANT,
    col: cols - 2,
    row: rows - 2,
  }, cols, rows);

  // Bookshelves — spread along left side
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-1`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 3,
  }, cols, rows);
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-2`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: 6,
  }, cols, rows);

  // Bookshelves — right side
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf-3`,
    type: FurnitureType.BOOKSHELF,
    col: cols - 2,
    row: 4,
  }, cols, rows);

  // Whiteboard on top wall — left-center
  tryPlace(furniture, occupied, {
    uid: `${zid}-whiteboard`,
    type: FurnitureType.WHITEBOARD,
    col: Math.floor(cols * 0.3),
    row: 0,
  }, cols, rows);

  // Cooler — right side, lower area
  tryPlace(furniture, occupied, {
    uid: `${zid}-cooler`,
    type: FurnitureType.COOLER,
    col: cols - 4,
    row: rows - 3,
  }, cols, rows);

  // Overflow agents — spread across the wide room
  if (agents.length > assigned) {
    placeOverflowAgents(zid, assigned, agents, 5, 7, furniture, occupied, cols, rows);
  }
}

// ── Main entry point ─────────────────────────────────────────────

/**
 * Generate a furnished OfficeLayout for a zone based on its config.
 */
export function generateZoneLayout(
  config: ZoneConfig,
  cols: number,
  rows: number,
): OfficeLayout {
  const floorColor = ROOM_STYLES[config.roomStyle || 'modern'] || ROOM_STYLES.modern;
  const { tiles, tileColors } = buildTileGrid(cols, rows, floorColor);

  const furniture: PlacedFurniture[] = [];
  const occupied = new Set<string>();
  markWalls(occupied, cols, rows);

  // Dispatch to zone-specific layout
  switch (config.id) {
    case 'openclaw-nova':
      layoutNova(config, cols, rows, furniture, occupied);
      break;
    case 'openclaw-studio':
      layoutStudio(config, cols, rows, furniture, occupied);
      break;
    case 'openclaw-marketer':
      layoutMarketer(config, cols, rows, furniture, occupied);
      break;
    case 'openclaw-oracle':
      layoutOracle(config, cols, rows, furniture, occupied);
      break;
    case 'claude-main':
      layoutClaude(config, cols, rows, furniture, occupied);
      break;
    default:
      // Fallback: generic workstation grid for unknown zones
      layoutGenericFallback(config, cols, rows, furniture, occupied);
      break;
  }

  return { version: 1, cols, rows, tiles, tileColors, furniture };
}

/**
 * Generic fallback layout for unrecognized zone IDs.
 * Places agent workstations in a grid, with basic decorations.
 */
function layoutGenericFallback(
  config: ZoneConfig,
  cols: number,
  rows: number,
  furniture: PlacedFurniture[],
  occupied: Set<string>,
): void {
  const zid = config.id;
  const agents = config.agents || [];

  // Place all agents as workstations in a grid
  placeOverflowAgents(zid, 0, agents, 2, 2, furniture, occupied, cols, rows);

  // Bookshelf
  tryPlace(furniture, occupied, {
    uid: `${zid}-bookshelf`,
    type: FurnitureType.BOOKSHELF,
    col: 1,
    row: Math.min(5, rows - 4),
  }, cols, rows);

  // Whiteboard
  if (cols >= 10) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-whiteboard`,
      type: FurnitureType.WHITEBOARD,
      col: Math.floor(cols * 0.6),
      row: 0,
    }, cols, rows);
  }

  // Plants
  if (config.hasPlants) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-tl`,
      type: FurnitureType.PLANT,
      col: 1,
      row: 1,
    }, cols, rows);
    tryPlace(furniture, occupied, {
      uid: `${zid}-plant-br`,
      type: FurnitureType.PLANT,
      col: cols - 2,
      row: rows - 2,
    }, cols, rows);
  }

  // Cooler
  if (config.hasCoffeeMachine) {
    tryPlace(furniture, occupied, {
      uid: `${zid}-cooler`,
      type: FurnitureType.COOLER,
      col: cols - 3,
      row: rows - 3,
    }, cols, rows);
  }
}
