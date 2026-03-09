'use strict';

/**
 * Asset loader — ported from pixel-agents src/assetLoader.ts without VS Code APIs.
 * Loads PNGs and converts to string[][] (hex color arrays) for sending to the browser.
 */

const fs = require('fs');
const path = require('path');

// Constants (matches src/constants.ts)
const PNG_ALPHA_THRESHOLD = 128;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;
const WALL_GRID_COLS = 4;
const WALL_BITMASK_COUNT = 16;
const FLOOR_PATTERN_COUNT = 7;
const FLOOR_TILE_SIZE = 16;
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'];
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHAR_COUNT = 6;

let PNG;
try {
  PNG = require('pngjs').PNG;
} catch {
  console.warn('[AssetLoader] pngjs not available — assets will use fallback sprites');
  PNG = null;
}

function pngToSpriteData(pngBuffer, width, height) {
  if (!PNG) return null;
  try {
    const png = PNG.sync.read(pngBuffer);
    const sprite = [];
    const data = png.data;
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * png.width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        if (a < PNG_ALPHA_THRESHOLD) {
          row.push('');
        } else {
          row.push(
            `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
          );
        }
      }
      sprite.push(row);
    }
    return sprite;
  } catch (err) {
    console.warn('[AssetLoader] PNG parse error:', err.message);
    return null;
  }
}

function loadCharacterSprites(assetsRoot) {
  if (!PNG) return null;
  try {
    const charDir = path.join(assetsRoot, 'characters');
    const characters = [];
    for (let ci = 0; ci < CHAR_COUNT; ci++) {
      const filePath = path.join(charDir, `char_${ci}.png`);
      if (!fs.existsSync(filePath)) {
        console.log(`[AssetLoader] No char sprite at ${filePath}`);
        return null;
      }
      const pngBuffer = fs.readFileSync(filePath);
      const png = PNG.sync.read(pngBuffer);
      const charData = { down: [], up: [], right: [] };
      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx];
        const rowOffsetY = dirIdx * CHAR_FRAME_H;
        const frames = [];
        for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
          const sprite = [];
          const frameOffsetX = f * CHAR_FRAME_W;
          for (let y = 0; y < CHAR_FRAME_H; y++) {
            const row = [];
            for (let x = 0; x < CHAR_FRAME_W; x++) {
              const idx = ((rowOffsetY + y) * png.width + (frameOffsetX + x)) * 4;
              const r = png.data[idx];
              const g = png.data[idx + 1];
              const b = png.data[idx + 2];
              const a = png.data[idx + 3];
              if (a < PNG_ALPHA_THRESHOLD) {
                row.push('');
              } else {
                row.push(
                  `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
                );
              }
            }
            sprite.push(row);
          }
          frames.push(sprite);
        }
        charData[dir] = frames;
      }
      characters.push(charData);
    }
    console.log(`[AssetLoader] Loaded ${characters.length} character sprites`);
    return { characters };
  } catch (err) {
    console.error('[AssetLoader] Error loading character sprites:', err.message);
    return null;
  }
}

function loadWallTiles(assetsRoot) {
  if (!PNG) return null;
  try {
    const wallPath = path.join(assetsRoot, 'walls.png');
    if (!fs.existsSync(wallPath)) return null;
    const pngBuffer = fs.readFileSync(wallPath);
    const png = PNG.sync.read(pngBuffer);
    const sprites = [];
    for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
      const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
      const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
      const sprite = [];
      for (let r = 0; r < WALL_PIECE_HEIGHT; r++) {
        const row = [];
        for (let c = 0; c < WALL_PIECE_WIDTH; c++) {
          const idx = ((oy + r) * png.width + (ox + c)) * 4;
          const rv = png.data[idx];
          const gv = png.data[idx + 1];
          const bv = png.data[idx + 2];
          const av = png.data[idx + 3];
          if (av < PNG_ALPHA_THRESHOLD) {
            row.push('');
          } else {
            row.push(
              `#${rv.toString(16).padStart(2, '0')}${gv.toString(16).padStart(2, '0')}${bv.toString(16).padStart(2, '0')}`.toUpperCase()
            );
          }
        }
        sprite.push(row);
      }
      sprites.push(sprite);
    }
    console.log(`[AssetLoader] Loaded ${sprites.length} wall tile pieces`);
    return { sprites };
  } catch (err) {
    console.error('[AssetLoader] Error loading wall tiles:', err.message);
    return null;
  }
}

function loadFloorTiles(assetsRoot) {
  if (!PNG) return null;
  try {
    const floorPath = path.join(assetsRoot, 'floors.png');
    if (!fs.existsSync(floorPath)) return null;
    const pngBuffer = fs.readFileSync(floorPath);
    const png = PNG.sync.read(pngBuffer);
    const sprites = [];
    for (let t = 0; t < FLOOR_PATTERN_COUNT; t++) {
      const sprite = [];
      for (let y = 0; y < FLOOR_TILE_SIZE; y++) {
        const row = [];
        for (let x = 0; x < FLOOR_TILE_SIZE; x++) {
          const px = t * FLOOR_TILE_SIZE + x;
          const idx = (y * png.width + px) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          const a = png.data[idx + 3];
          if (a < PNG_ALPHA_THRESHOLD) {
            row.push('');
          } else {
            row.push(
              `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
            );
          }
        }
        sprite.push(row);
      }
      sprites.push(sprite);
    }
    console.log(`[AssetLoader] Loaded ${sprites.length} floor tile patterns`);
    return { sprites };
  } catch (err) {
    console.error('[AssetLoader] Error loading floor tiles:', err.message);
    return null;
  }
}

function loadFurnitureAssets(assetsRoot) {
  if (!PNG) return null;
  try {
    const catalogPath = path.join(assetsRoot, 'furniture', 'furniture-catalog.json');
    if (!fs.existsSync(catalogPath)) return null;
    const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const catalog = catalogData.assets || [];
    const sprites = {};
    for (const asset of catalog) {
      try {
        let filePath = asset.file;
        if (!filePath.startsWith('assets/')) filePath = `assets/${filePath}`;
        const assetPath = path.join(assetsRoot, '..', filePath);
        if (!fs.existsSync(assetPath)) continue;
        const pngBuffer = fs.readFileSync(assetPath);
        const sprite = pngToSpriteData(pngBuffer, asset.width, asset.height);
        if (sprite) sprites[asset.id] = sprite;
      } catch {}
    }
    console.log(`[AssetLoader] Loaded ${Object.keys(sprites).length}/${catalog.length} furniture sprites`);
    return { catalog, sprites };
  } catch (err) {
    console.error('[AssetLoader] Error loading furniture assets:', err.message);
    return null;
  }
}

function loadDefaultLayout(assetsRoot) {
  try {
    const layoutPath = path.join(assetsRoot, 'default-layout.json');
    if (!fs.existsSync(layoutPath)) return null;
    const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8'));
    return layout.version === 1 && Array.isArray(layout.tiles) ? layout : null;
  } catch {
    return null;
  }
}

module.exports = {
  loadCharacterSprites,
  loadWallTiles,
  loadFloorTiles,
  loadFurnitureAssets,
  loadDefaultLayout,
};
