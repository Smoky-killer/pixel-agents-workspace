/**
 * useZoneState — React hook that manages multi-zone state.
 *
 * Listens for sourcesConfig and zone-prefixed messages from the server.
 * Tracks which zones are active, agent-to-zone mapping, and HUD messages.
 * Creates per-zone OfficeStates with generated furniture layouts.
 * Routes agent delegation messages (commander→dispatcher→worker) to walkToAgent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { OfficeState } from '../office/engine/officeState.js';
import { CharacterState } from '../office/types.js';
import { zoneManager } from './ZoneManager.js';
import type { SourcesConfig, ZoneConfig } from './ZoneManager.js';
import { generateZoneLayout } from './zoneLayoutGenerator.js';
import type { HudMessage } from './ZoneRenderer.js';

export interface ZoneState {
  configLoaded: boolean;
  activeZones: Set<string>;
  agentCounts: Record<string, { active: number; total: number }>;
  agentZoneMap: Record<number, string>;
  /** Per-zone set of active agent IDs (for status lights) */
  activeAgentIds: Record<string, Set<number>>;
  /** Per-zone set of created/known agent IDs (agents with real sessions) */
  knownAgentIds: Record<string, Set<number>>;
  hudMessages: HudMessage[];
  maxHudMessages: number;
  panToZone: (zoneId: string) => { x: number; y: number } | null;
  tick: number;
}

/** Find config agent by role within a zone */
function findAgentByRole(zoneConfig: ZoneConfig, role: string): number | null {
  const agent = zoneConfig.agents?.find(a => a.role === role);
  return agent ? agent.agentId : null;
}

export function useZoneState(): ZoneState {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [activeZones, setActiveZones] = useState<Set<string>>(new Set());
  const [agentCounts, setAgentCounts] = useState<Record<string, { active: number; total: number }>>({});
  const [agentZoneMap, setAgentZoneMap] = useState<Record<number, string>>({});
  const [activeAgentIds, setActiveAgentIds] = useState<Record<string, Set<number>>>({});
  const [knownAgentIds, setKnownAgentIds] = useState<Record<string, Set<number>>>({});
  const [hudMessages, setHudMessages] = useState<HudMessage[]>([]);
  const [maxHudMessages, setMaxHudMessages] = useState(6);
  const [tick, setTick] = useState(0);

  const configRef = useRef<SourcesConfig | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'sourcesConfig') {
        const config = msg.config as SourcesConfig;
        configRef.current = config;
        zoneManager.loadConfig(config);

        // Initialize per-zone OfficeStates with generated layouts
        zoneManager.initOfficeStates(OfficeState, generateZoneLayout);

        // Initialize empty per-zone tracking (agents spawn only on agentCreated)
        const initActiveIds: Record<string, Set<number>> = {};
        const initKnownIds: Record<string, Set<number>> = {};
        for (const zoneConfig of config.zones) {
          initActiveIds[zoneConfig.id] = new Set();
          initKnownIds[zoneConfig.id] = new Set();
        }

        setMaxHudMessages(config.global?.hudMaxMessages || 6);
        setActiveAgentIds(initActiveIds);
        setKnownAgentIds(initKnownIds);

        const counts: Record<string, { active: number; total: number }> = {};
        for (const zone of config.zones) {
          counts[zone.id] = { active: 0, total: zone.agents?.length || 0 };
        }
        setAgentCounts(counts);
        setConfigLoaded(true);
        setTick(t => t + 1);
      }

      // ── Agent created ─────────────────────────────────────
      if (msg.type === 'agentCreated' && msg.zoneId) {
        const agentId = msg.id as number;
        const zoneId = msg.zoneId as string;

        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state && !state.characters.has(agentId)) {
          const zoneConfig = configRef.current?.zones.find(z => z.id === zoneId);
          const agentConfig = zoneConfig?.agents?.find(a => a.agentId === agentId);
          state.addAgent(agentId, agentConfig?.palette, agentConfig?.hueShift, undefined, false);
        }
        if (state) {
          state.setAgentActive(agentId, true);
        }

        setAgentZoneMap(prev => ({ ...prev, [agentId]: zoneId }));
        setActiveZones(prev => { const n = new Set(prev); n.add(zoneId); return n; });
        setAgentCounts(prev => {
          const z = prev[zoneId] || { active: 0, total: 0 };
          return { ...prev, [zoneId]: { active: z.active + 1, total: z.total } };
        });
        setActiveAgentIds(prev => {
          const s = new Set(prev[zoneId] || []);
          s.add(agentId);
          return { ...prev, [zoneId]: s };
        });
        setKnownAgentIds(prev => {
          const s = new Set(prev[zoneId] || []);
          s.add(agentId);
          return { ...prev, [zoneId]: s };
        });
        setTick(t => t + 1);
      }

      // ── Agent closed ──────────────────────────────────────
      if (msg.type === 'agentClosed' && msg.zoneId) {
        const agentId = msg.id as number;
        const zoneId = msg.zoneId as string;

        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state) state.setAgentActive(agentId, false);

        setAgentZoneMap(prev => { const n = { ...prev }; delete n[agentId]; return n; });
        setAgentCounts(prev => {
          const z = prev[zoneId] || { active: 0, total: 0 };
          return { ...prev, [zoneId]: { active: Math.max(0, z.active - 1), total: z.total } };
        });
        setActiveAgentIds(prev => {
          const s = new Set(prev[zoneId] || []);
          s.delete(agentId);
          return { ...prev, [zoneId]: s };
        });
        setKnownAgentIds(prev => {
          const s = new Set(prev[zoneId] || []);
          s.delete(agentId);
          return { ...prev, [zoneId]: s };
        });
        setTick(t => t + 1);
      }

      // ── Agent status ──────────────────────────────────────
      if (msg.type === 'agentStatus' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const agentId = msg.id as number;
        const status = msg.status as string;
        const isActive = status === 'active';

        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state && typeof agentId === 'number') {
          state.setAgentActive(agentId, isActive);
        }

        setActiveZones(prev => { const n = new Set(prev); if (isActive) n.add(zoneId); return n; });
        setActiveAgentIds(prev => {
          const s = new Set(prev[zoneId] || []);
          if (isActive) s.add(agentId); else s.delete(agentId);
          return { ...prev, [zoneId]: s };
        });
      }

      // ── Tool activity ─────────────────────────────────────
      if (msg.type === 'agentToolStart' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const agentId = msg.id as number;
        const toolStatus = msg.status as string;
        const config = configRef.current;
        const zoneConfig = config?.zones.find(z => z.id === zoneId);

        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state && typeof agentId === 'number') {
          state.setAgentTool(agentId, toolStatus || null);

          // Map tool names to character states
          const toolLower = (toolStatus || '').toLowerCase();
          if (toolLower.includes('websearch') || toolLower.includes('webfetch') || toolLower.includes('grep') || toolLower.includes('read')) {
            state.setAgentState(agentId, CharacterState.SEARCH);
          } else if (toolLower.includes('plan') || toolLower.includes('think')) {
            state.setAgentState(agentId, CharacterState.THINK);
          }
        }

        // HUD feed
        const agentConfig = zoneConfig?.agents?.find(a => a.agentId === agentId);
        const agentName = agentConfig?.name || `Agent ${agentId}`;
        const hudMsg: HudMessage = {
          id: `${Date.now()}-${Math.random()}`,
          zoneId,
          zoneName: zoneConfig?.name || zoneId,
          zoneColor: zoneConfig?.accentColor || '#888',
          text: `${agentName}: ${toolStatus}`,
          timestamp: Date.now(),
        };
        setHudMessages(prev => [hudMsg, ...prev].slice(0, 20));
      }

      // ── Agent message (delegation chain) ──────────────────
      if (msg.type === 'agentMessage' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const fromId = msg.fromId as number;
        const toId = msg.toId as number | null;
        const fromName = msg.fromName as string;
        const toName = msg.toName as string | null;
        const text = msg.text as string;
        const config = configRef.current;
        const zoneConfig = config?.zones.find(z => z.id === zoneId);

        const state = zoneManager.getZoneOfficeState(zoneId);

        // Trigger walk-to-agent delegation animation
        if (state && typeof fromId === 'number') {
          // If toId is known, walk from sender to receiver
          if (typeof toId === 'number' && state.characters.has(toId)) {
            state.walkToAgent(fromId, toId, text);
          } else if (zoneConfig) {
            // Infer delegation target: commander→dispatcher, dispatcher→first worker
            const fromAgent = zoneConfig.agents?.find(a => a.agentId === fromId);
            if (fromAgent?.role === 'commander') {
              const dispatcherId = findAgentByRole(zoneConfig, 'dispatcher');
              if (dispatcherId !== null) {
                state.walkToAgent(fromId, dispatcherId, text);
              }
            } else if (fromAgent?.role === 'dispatcher') {
              // Find first available worker
              const worker = zoneConfig.agents?.find(a =>
                a.role === 'worker' || a.role === 'researcher',
              );
              if (worker) {
                state.walkToAgent(fromId, worker.agentId, text);
              }
            }
          }
        }

        // HUD feed with delegation format
        const hudMsg: HudMessage = {
          id: `${Date.now()}-${Math.random()}`,
          zoneId,
          zoneName: zoneConfig?.name || zoneId,
          zoneColor: zoneConfig?.accentColor || '#888',
          text: toName
            ? `${fromName} → ${toName}: "${text}"`
            : `${fromName}: "${text}"`,
          timestamp: Date.now(),
        };
        setHudMessages(prev => [hudMsg, ...prev].slice(0, 20));
      }

      // ── Existing agents ───────────────────────────────────
      if (msg.type === 'existingAgents' && msg.agentZones) {
        const zones = msg.agentZones as Record<number, string | null>;
        const map: Record<number, string> = {};
        const activeSet = new Set<string>();
        for (const [idStr, zoneId] of Object.entries(zones)) {
          if (zoneId) {
            const agentId = Number(idStr);
            map[agentId] = zoneId;
            activeSet.add(zoneId);

            const state = zoneManager.getZoneOfficeState(zoneId);
            if (state && !state.characters.has(agentId)) {
              const zoneConfig = configRef.current?.zones.find(z => z.id === zoneId);
              const agentConfig = zoneConfig?.agents?.find(a => a.agentId === agentId);
              state.addAgent(agentId, agentConfig?.palette, agentConfig?.hueShift, undefined, true);
              state.setAgentActive(agentId, true);
            }
          }
        }
        setAgentZoneMap(prev => ({ ...prev, ...map }));
        setActiveZones(prev => { const n = new Set(prev); for (const z of activeSet) n.add(z); return n; });
        setKnownAgentIds(prev => {
          const next = { ...prev };
          for (const [idStr, zId] of Object.entries(zones)) {
            if (zId) {
              const aid = Number(idStr);
              next[zId] = new Set(next[zId] || []);
              next[zId].add(aid);
            }
          }
          return next;
        });
        setTick(t => t + 1);
      }

      // Handle agent appearance changes (from character selector)
      if (msg.type === 'agentAppearanceChanged') {
        const { agentId, zoneId, palette, hueShift } = msg as {
          agentId: number; zoneId: string; palette: number; hueShift: number;
        };
        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state) {
          const ch = state.characters.get(agentId);
          if (ch) {
            ch.palette = palette;
            ch.hueShift = hueShift;
          }
        }
        setTick(t => t + 1);
      }

      // Handle telegram messages (commander speech bubble)
      if (msg.type === 'telegramMessage') {
        const zoneId = msg.zoneId as string;
        const text = msg.text as string;
        const from = msg.from as string;
        const state = zoneManager.getZoneOfficeState(zoneId);
        const zoneConfig = configRef.current?.zones.find((z: { id: string }) => z.id === zoneId);
        if (state && zoneConfig) {
          const commander = (zoneConfig.agents ?? []).find((a: { role: string }) => a.role === 'commander');
          if (commander) {
            const preview = text.length > 30 ? text.slice(0, 29) + '...' : text;
            state.setAgentSpeech(commander.agentId, `TG ${from}: ${preview}`);
          }
        }
      }

      // ── Nova error flash ─────────────────────────────────
      if (msg.type === 'novaError') {
        const zoneId = msg.zoneId as string;
        const agentId = msg.agentId as number;
        const state = zoneManager.getZoneOfficeState(zoneId);
        if (state) {
          state.triggerErrorFlash(agentId);
        }
      }

      // ── Nova repair task ─────────────────────────────────
      if (msg.type === 'novaRepairTask') {
        const zoneId = msg.zoneId as string;
        const targetRole = msg.targetRole as string;
        const description = msg.description as string;
        const config = configRef.current;
        const zoneConfig = config?.zones.find((z: { id: string }) => z.id === zoneId);
        const state = zoneManager.getZoneOfficeState(zoneId);

        if (state && zoneConfig) {
          // Find commander and target repair/builder agent
          const commander = (zoneConfig.agents ?? []).find((a: { role: string }) => a.role === 'commander');
          const targetAgent = (zoneConfig.agents ?? []).find((a: { role: string }) => a.role === targetRole);

          if (commander && targetAgent) {
            // Commander walks to repair/builder agent with task description
            state.walkToAgent(commander.agentId, targetAgent.agentId, description);

            // After a delay, set target to THINK state
            setTimeout(() => {
              const s = zoneManager.getZoneOfficeState(zoneId);
              if (s) {
                s.setAgentState(targetAgent.agentId, CharacterState.THINK);
                s.setAgentSpeech(targetAgent.agentId, description.slice(0, 30));
              }
            }, 3000);
          }

          // HUD message
          const agentName = targetAgent
            ? (targetAgent as { name?: string }).name || `Agent`
            : 'Agent';
          const hudMsg: HudMessage = {
            id: `${Date.now()}-${Math.random()}`,
            zoneId,
            zoneName: zoneConfig?.name || zoneId,
            zoneColor: '#ff4444',
            text: `Auto-repair: ${agentName} → ${description.slice(0, 40)}`,
            timestamp: Date.now(),
          };
          setHudMessages(prev => [hudMsg, ...prev].slice(0, 20));
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const panToZone = useCallback((zoneId: string): { x: number; y: number } | null => {
    const zone = zoneManager.getZone(zoneId);
    if (!zone) return null;
    const centerX = zone.worldX + zone.widthPx / 2;
    const centerY = zone.worldY + zone.heightPx / 2;
    const totalCenterX = zoneManager.totalWidth / 2;
    const totalCenterY = zoneManager.totalHeight / 2;
    return {
      x: (totalCenterX - centerX) * 2,
      y: (totalCenterY - centerY) * 2,
    };
  }, []);

  return {
    configLoaded,
    activeZones,
    agentCounts,
    agentZoneMap,
    activeAgentIds,
    knownAgentIds,
    hudMessages,
    maxHudMessages,
    panToZone,
    tick,
  };
}
