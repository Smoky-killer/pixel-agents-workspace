import { useEffect, useRef, useState } from 'react';

import { playDoneSound, setSoundEnabled } from '../notificationSound.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import { setCharacterTemplates } from '../office/sprites/spriteData.js';
import { extractToolName } from '../office/toolUtils.js';
import { CharacterState } from '../office/types.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { vscode } from '../vscodeApi.js';

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

export interface AgentMessage {
  id: string;
  fromId: number;
  fromName: string;
  toId: number | null;
  toName: string | null;
  text: string;
  timestamp: number;
  msgType: 'instruction' | 'status' | 'result';
}

export interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  partOfGroup?: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface ActionHistoryEntry {
  timestamp: number;
  status: string;
}

export interface GlobalStats {
  tasksToday: number;
  filesModified: number;
  commandsRun: number;
  sessionStart: number;
}

export interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  layoutReady: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  agentNames: Record<number, string>;
  agentActionHistory: Record<number, ActionHistoryEntry[]>;
  agentLastAction: Record<number, string>;
  agentLastFile: Record<number, string>;
  agentTaskStartTime: Record<number, number>;
  agentTaskCount: Record<number, number>;
  globalStats: GlobalStats;
  conversationLog: AgentMessage[];
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) continue;
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats });
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
  onAgentArrived?: (id: number) => void,
  onAgentLeft?: (id: number) => void,
  onAgentWaitingNotif?: (id: number, name: string) => void,
  onAgentTaskCompleteNotif?: (id: number, name: string) => void,
  onAgentConnectedNotif?: (id: number, name: string) => void,
  onTypingTick?: (id: number) => void,
  onAgentTaskCompleteSound?: (id: number) => void,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [agentNames, setAgentNames] = useState<Record<number, string>>({});
  const [agentActionHistory, setAgentActionHistory] = useState<Record<number, ActionHistoryEntry[]>>({});
  const [agentLastAction, setAgentLastAction] = useState<Record<number, string>>({});
  const [agentLastFile, setAgentLastFile] = useState<Record<number, string>>({});
  const [agentTaskStartTime, setAgentTaskStartTime] = useState<Record<number, number>>({});
  const [agentTaskCount, setAgentTaskCount] = useState<Record<number, number>>({});
  const [globalStats, setGlobalStats] = useState<GlobalStats>({
    tasksToday: 0,
    filesModified: 0,
    commandsRun: 0,
    sessionStart: Date.now(),
  });
  const [conversationLog, setConversationLog] = useState<AgentMessage[]>([]);

  // Refs for callbacks (to avoid stale closures without effect deps)
  const onAgentArrivedRef = useRef(onAgentArrived);
  onAgentArrivedRef.current = onAgentArrived;
  const onAgentLeftRef = useRef(onAgentLeft);
  onAgentLeftRef.current = onAgentLeft;
  const onAgentWaitingNotifRef = useRef(onAgentWaitingNotif);
  onAgentWaitingNotifRef.current = onAgentWaitingNotif;
  const onAgentTaskCompleteNotifRef = useRef(onAgentTaskCompleteNotif);
  onAgentTaskCompleteNotifRef.current = onAgentTaskCompleteNotif;
  const onAgentConnectedNotifRef = useRef(onAgentConnectedNotif);
  onAgentConnectedNotifRef.current = onAgentConnectedNotif;
  const onTypingTickRef = useRef(onTypingTick);
  onTypingTickRef.current = onTypingTick;
  const onAgentTaskCompleteSoundRef = useRef(onAgentTaskCompleteSound);
  onAgentTaskCompleteSoundRef.current = onAgentTaskCompleteSound;

  // Typing ticker: fires typing sounds for active typing agents
  const typingTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeTypingAgentsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    typingTickerRef.current = setInterval(() => {
      for (const id of activeTypingAgentsRef.current) {
        onTypingTickRef.current?.(id);
      }
    }, 300);
    return () => {
      if (typingTickerRef.current) clearInterval(typingTickerRef.current);
    };
  }, []);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: Array<{
      id: number;
      palette?: number;
      hueShift?: number;
      seatId?: string;
      folderName?: string;
    }> = [];

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      const os = getOfficeState();

      if (msg.type === 'layoutLoaded') {
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
        }
        pendingAgents = [];
        layoutReadyRef.current = true;
        setLayoutReady(true);
        if (os.characters.size > 0) {
          saveAgentSeats(os);
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number;
        const zoneId = msg.zoneId as string | undefined;
        const folderName = msg.folderName as string | undefined;
        const agentName = (msg.name as string | undefined) || `Agent ${id}`;
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setSelectedAgent(id);
        setAgentNames((prev) => ({ ...prev, [id]: agentName }));
        // Only add to primary officeState if NOT a zone agent (zone agents handled by useZoneState)
        if (!zoneId) {
          os.addAgent(id, undefined, undefined, undefined, undefined, folderName);
          saveAgentSeats(os);
        }
        onAgentArrivedRef.current?.(id);
        onAgentConnectedNotifRef.current?.(id, agentName);
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        const zoneId = msg.zoneId as string | undefined;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        activeTypingAgentsRef.current.delete(id);
        // Only remove from primary officeState if NOT a zone agent
        if (!zoneId) {
          os.removeAllSubagents(id);
          setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
          os.removeAgent(id);
        }
        onAgentLeftRef.current?.(id);
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<
          number,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        const names = (msg.agentNames || {}) as Record<number, string>;
        // Capture names for all existing agents
        if (Object.keys(names).length > 0) {
          setAgentNames((prev) => ({ ...prev, ...names }));
        }
        // Buffer non-zone agents — they'll be added in layoutLoaded after seats are built
        const agentZones = (msg.agentZones || {}) as Record<number, string | null>;
        for (const id of incoming) {
          if (agentZones[id]) continue; // zone agent, handled by useZoneState
          const m = meta[id];
          pendingAgents.push({
            id,
            palette: m?.palette,
            hueShift: m?.hueShift,
            seatId: m?.seatId,
            folderName: folderNames[id],
          });
        }
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return { ...prev, [id]: [...list, { toolId, status, done: false }] };
        });
        const toolName = extractToolName(status);
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        os.clearPermissionBubble(id);
        // Set distinct character state for visual tools
        if (toolName === 'WebSearch') {
          os.setAgentState(id, CharacterState.SEARCH);
        } else if (toolName === 'EnterPlanMode') {
          os.setAgentState(id, CharacterState.THINK);
        }
        // Track last action, history, task start time, stats
        const displayStatus = status.length > 40 ? status.slice(0, 40) + '…' : status;
        setAgentLastAction((prev) => ({ ...prev, [id]: displayStatus }));
        setAgentTaskStartTime((prev) => ({ ...prev, [id]: Date.now() }));
        setAgentActionHistory((prev) => {
          const hist = prev[id] || [];
          const entry: ActionHistoryEntry = { timestamp: Date.now(), status: displayStatus };
          return { ...prev, [id]: [entry, ...hist].slice(0, 50) };
        });
        // Track last file if status contains a path
        const fileMatch = status.match(/[^\s]+\.[a-zA-Z0-9]+$/);
        if (fileMatch) {
          setAgentLastFile((prev) => ({ ...prev, [id]: fileMatch[0] }));
        }
        // Update global stats
        const lc = status.toLowerCase();
        const isWrite = lc.startsWith('writing') || lc.startsWith('editing');
        const isCmd = lc.startsWith('running');
        if (isWrite) {
          setGlobalStats((prev) => ({ ...prev, filesModified: prev.filesModified + 1, tasksToday: prev.tasksToday + 1 }));
        } else if (isCmd) {
          setGlobalStats((prev) => ({ ...prev, commandsRun: prev.commandsRun + 1, tasksToday: prev.tasksToday + 1 }));
        } else {
          setGlobalStats((prev) => ({ ...prev, tasksToday: prev.tasksToday + 1 }));
        }
        // Track typing agents for sound
        if (!toolName || !['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'].includes(toolName)) {
          activeTypingAgentsRef.current.add(id);
        }
        // Create sub-agent character for Task tool subtasks
        if (status.startsWith('Subtask:')) {
          const label = status.slice('Subtask:'.length).trim();
          const subId = os.addSubagent(id, toolId);
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev;
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        activeTypingAgentsRef.current.delete(id);
        // Task complete: fire sound + notification
        setAgentTaskCount((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
        onAgentTaskCompleteSoundRef.current?.(id);
        // Remove all sub-agent characters belonging to this agent
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
        // Reset any special visual state back to TYPE
        os.setAgentState(id, CharacterState.TYPE);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os.showWaitingBubble(id);
          playDoneSound();
          activeTypingAgentsRef.current.delete(id);
          // Notifications
          setAgentNames((prev) => {
            const name = prev[id] || `Agent ${id}`;
            onAgentWaitingNotifRef.current?.(id, name);
            return prev;
          });
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        os.showPermissionBubble(id);
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        // Show permission bubble on the sub-agent character
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        os.clearPermissionBubble(id);
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        // Update sub-agent character's tool and active state
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          const subToolName = extractToolName(status);
          os.setAgentTool(subId, subToolName);
          os.setAgentActive(subId, true);
        }
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) =>
          prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
        );
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} wall tile sprites`);
        setWallSprites(sprites);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      } else if (msg.type === 'agentMessage') {
        const fromId = msg.fromId as number;
        const toId = msg.toId as number | null;
        // Resolve names at receive time (agentNames state snapshot may lag; use msg names if provided)
        const fromName = (msg.fromName as string | undefined) || `Agent ${fromId}`;
        const toName = (msg.toName as string | undefined) || (toId != null ? `Agent ${toId}` : null);
        const text = msg.text as string;
        const msgType = (msg.msgType as 'instruction' | 'status' | 'result') || 'instruction';

        const entry: AgentMessage = {
          id: `${Date.now()}-${Math.random()}`,
          fromId,
          fromName,
          toId,
          toName,
          text,
          timestamp: Date.now(),
          msgType,
        };
        setConversationLog((prev) => [entry, ...prev].slice(0, 20));

        // Trigger walk-to-agent animation if both agents are present
        const osRef = getOfficeState();
        if (toId != null) {
          osRef.walkToAgent(fromId, toId, text);
        } else {
          osRef.setAgentSpeech(fromId, text);
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'webviewReady' });
    return () => window.removeEventListener('message', handler);
  }, [getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    layoutReady,
    loadedAssets,
    workspaceFolders,
    agentNames,
    agentActionHistory,
    agentLastAction,
    agentLastFile,
    agentTaskStartTime,
    agentTaskCount,
    globalStats,
    conversationLog,
  };
}
