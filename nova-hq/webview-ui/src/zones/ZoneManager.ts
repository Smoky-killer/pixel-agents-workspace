/**
 * ZoneManager — handles multi-zone layout positioning on a single canvas.
 *
 * Layout: "1-top-2x2-bottom"
 *   ┌─────────────────────────────────────┐
 *   │         CLAUDE HQ (full width)       │
 *   ├──────────────────┬──────────────────┤
 *   │    STUDIO         │    MARKETER       │
 *   ├──────────────────┼──────────────────┤
 *   │    ORACLE         │    RESERVE        │
 *   └──────────────────┴──────────────────┘
 *
 * Each zone has its own OfficeState, tile map, furniture, and characters.
 * ZoneManager computes world-pixel offsets so all zones render on one canvas.
 */

export interface ZoneConfig {
  id: string;
  name: string;
  position: string;
  accentColor: string;
  source: 'claude' | 'openclaw';
  agents: AgentConfig[];
  roomStyle?: string;
  hasConferenceTable?: boolean;
  hasDiscordDesk?: boolean;
  hasCoffeeMachine?: boolean;
  hasPlants?: boolean;
  hasTelegramDesk?: boolean;
  gatewayPort?: number | null;
  jsonlDir?: string | null;
}

export interface AgentConfig {
  agentId: number;
  name: string;
  role: string;
  palette: number;
  hueShift: number;
  badge: string;
  deskType: string;
}

export interface GlobalConfig {
  canvasTitle: string;
  gridLayout: string;
  tileSize: number;
  defaultZoom: number;
  hudMaxMessages: number;
  agentWalkSpeed: number;
  speechBubbleDuration: number;
  statusLightColors: { active: string; idle: string };
}

export interface SourcesConfig {
  global: GlobalConfig;
  zones: ZoneConfig[];
  discord?: { enabled: boolean; token: string; channels: unknown[] };
  telegram?: { enabled: boolean; bots: unknown[] };
}

// Zone dimensions in tiles
const ZONE_COLS = 20;
const ZONE_ROWS = 15;
const ZONE_BORDER_PX = 2; // border between zones in world pixels
const TILE_SIZE = 16;

// Claude zone is wider (spans full top row)
const CLAUDE_ZONE_COLS = 42;
const CLAUDE_ZONE_ROWS = 15;

export interface ZoneRect {
  /** Zone config */
  config: ZoneConfig;
  /** Top-left X in world pixels */
  worldX: number;
  /** Top-left Y in world pixels */
  worldY: number;
  /** Width in tiles */
  cols: number;
  /** Height in tiles */
  rows: number;
  /** Width in world pixels */
  widthPx: number;
  /** Height in world pixels */
  heightPx: number;
}

export class ZoneManager {
  zones: Map<string, ZoneRect> = new Map();
  totalWidth = 0;
  totalHeight = 0;
  config: SourcesConfig | null = null;
  /** Per-zone OfficeState instances, keyed by zone ID */
  zoneOfficeStates: Map<string, import('../office/engine/officeState.js').OfficeState> = new Map();

  loadConfig(config: SourcesConfig): void {
    this.config = config;
    this.zones.clear();

    const zones = config.zones || [];
    const layout = config.global?.gridLayout || '1-top-2x2-bottom';

    if (layout === '1-top-2x2-bottom') {
      this._layout1Top2x2Bottom(zones);
    } else {
      // Fallback: stack vertically
      this._layoutVertical(zones);
    }
  }

  private _layout1Top2x2Bottom(zones: ZoneConfig[]): void {
    const topZone = zones.find(z => z.position === 'top');
    const middleLeft = zones.find(z => z.position === 'middle-left');
    const middleRight = zones.find(z => z.position === 'middle-right');
    const bottomLeft = zones.find(z => z.position === 'bottom-left');
    const bottomRight = zones.find(z => z.position === 'bottom-right');

    const border = ZONE_BORDER_PX;
    const smallW = ZONE_COLS * TILE_SIZE;
    const smallH = ZONE_ROWS * TILE_SIZE;
    const bigW = smallW * 2 + border;
    const bigH = CLAUDE_ZONE_ROWS * TILE_SIZE;

    let y = 0;

    // Top zone (Claude HQ — full width)
    if (topZone) {
      this.zones.set(topZone.id, {
        config: topZone,
        worldX: 0,
        worldY: y,
        cols: CLAUDE_ZONE_COLS,
        rows: CLAUDE_ZONE_ROWS,
        widthPx: bigW,
        heightPx: bigH,
      });
      y += bigH + border;
    }

    // Middle row
    if (middleLeft) {
      this.zones.set(middleLeft.id, {
        config: middleLeft,
        worldX: 0,
        worldY: y,
        cols: ZONE_COLS,
        rows: ZONE_ROWS,
        widthPx: smallW,
        heightPx: smallH,
      });
    }
    if (middleRight) {
      this.zones.set(middleRight.id, {
        config: middleRight,
        worldX: smallW + border,
        worldY: y,
        cols: ZONE_COLS,
        rows: ZONE_ROWS,
        widthPx: smallW,
        heightPx: smallH,
      });
    }
    if (middleLeft || middleRight) {
      y += smallH + border;
    }

    // Bottom row
    if (bottomLeft) {
      this.zones.set(bottomLeft.id, {
        config: bottomLeft,
        worldX: 0,
        worldY: y,
        cols: ZONE_COLS,
        rows: ZONE_ROWS,
        widthPx: smallW,
        heightPx: smallH,
      });
    }
    if (bottomRight) {
      this.zones.set(bottomRight.id, {
        config: bottomRight,
        worldX: smallW + border,
        worldY: y,
        cols: ZONE_COLS,
        rows: ZONE_ROWS,
        widthPx: smallW,
        heightPx: smallH,
      });
    }
    if (bottomLeft || bottomRight) {
      y += smallH;
    }

    this.totalWidth = bigW;
    this.totalHeight = y;
  }

  private _layoutVertical(zones: ZoneConfig[]): void {
    let y = 0;
    for (const z of zones) {
      const cols = z.position === 'top' ? CLAUDE_ZONE_COLS : ZONE_COLS;
      const rows = z.position === 'top' ? CLAUDE_ZONE_ROWS : ZONE_ROWS;
      const w = cols * TILE_SIZE;
      const h = rows * TILE_SIZE;
      this.zones.set(z.id, {
        config: z,
        worldX: 0,
        worldY: y,
        cols,
        rows,
        widthPx: w,
        heightPx: h,
      });
      y += h + ZONE_BORDER_PX;
    }
    this.totalWidth = CLAUDE_ZONE_COLS * TILE_SIZE;
    this.totalHeight = y;
  }

  /** Create an OfficeState per zone using generated layouts */
  initOfficeStates(
    OfficeStateCtor: new (layout: import('../office/types.js').OfficeLayout) => import('../office/engine/officeState.js').OfficeState,
    generateLayout: (config: ZoneConfig, cols: number, rows: number) => import('../office/types.js').OfficeLayout,
  ): void {
    this.zoneOfficeStates.clear();
    for (const [id, zone] of this.zones) {
      const layout = generateLayout(zone.config, zone.cols, zone.rows);
      const state = new OfficeStateCtor(layout);
      this.zoneOfficeStates.set(id, state);
    }
  }

  /** Get a zone's OfficeState */
  getZoneOfficeState(zoneId: string): import('../office/engine/officeState.js').OfficeState | undefined {
    return this.zoneOfficeStates.get(zoneId);
  }

  getZone(zoneId: string): ZoneRect | undefined {
    return this.zones.get(zoneId);
  }

  getAllZones(): ZoneRect[] {
    return Array.from(this.zones.values());
  }

  /** Get the zone that contains a world-pixel point */
  getZoneAtPoint(worldX: number, worldY: number): ZoneRect | null {
    for (const zone of this.zones.values()) {
      if (
        worldX >= zone.worldX &&
        worldX < zone.worldX + zone.widthPx &&
        worldY >= zone.worldY &&
        worldY < zone.worldY + zone.heightPx
      ) {
        return zone;
      }
    }
    return null;
  }
}

export const zoneManager = new ZoneManager();
