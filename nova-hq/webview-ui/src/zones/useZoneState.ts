/**
 * useZoneState — React hook that manages multi-zone state.
 *
 * Listens for sourcesConfig and zone-prefixed messages from the server.
 * Tracks which zones are active, agent-to-zone mapping, and HUD messages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { zoneManager } from './ZoneManager.js';
import type { SourcesConfig } from './ZoneManager.js';
import type { HudMessage } from './ZoneRenderer.js';

export interface ZoneState {
  /** Whether the sources config has been loaded */
  configLoaded: boolean;
  /** Set of zone IDs that have at least one active agent */
  activeZones: Set<string>;
  /** Agent counts per zone */
  agentCounts: Record<string, { active: number; total: number }>;
  /** Agent-to-zone mapping */
  agentZoneMap: Record<number, string>;
  /** HUD messages (newest first) */
  hudMessages: HudMessage[];
  /** Max HUD messages to show */
  maxHudMessages: number;
  /** Pan to a zone */
  panToZone: (zoneId: string) => { x: number; y: number } | null;
}

export function useZoneState(): ZoneState {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [activeZones, setActiveZones] = useState<Set<string>>(new Set());
  const [agentCounts, setAgentCounts] = useState<Record<string, { active: number; total: number }>>({});
  const [agentZoneMap, setAgentZoneMap] = useState<Record<number, string>>({});
  const [hudMessages, setHudMessages] = useState<HudMessage[]>([]);
  const [maxHudMessages, setMaxHudMessages] = useState(6);

  const configRef = useRef<SourcesConfig | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'sourcesConfig') {
        const config = msg.config as SourcesConfig;
        configRef.current = config;
        zoneManager.loadConfig(config);
        setMaxHudMessages(config.global?.hudMaxMessages || 6);

        // Initialize agent counts from config
        const counts: Record<string, { active: number; total: number }> = {};
        for (const zone of config.zones) {
          counts[zone.id] = { active: 0, total: zone.agents?.length || 0 };
        }
        setAgentCounts(counts);
        setConfigLoaded(true);
      }

      // Track agent creation with zone info
      if (msg.type === 'agentCreated' && msg.zoneId) {
        const agentId = msg.id as number;
        const zoneId = msg.zoneId as string;

        setAgentZoneMap(prev => ({ ...prev, [agentId]: zoneId }));
        setActiveZones(prev => {
          const next = new Set(prev);
          next.add(zoneId);
          return next;
        });
        setAgentCounts(prev => {
          const zone = prev[zoneId] || { active: 0, total: 0 };
          return { ...prev, [zoneId]: { active: zone.active + 1, total: zone.total } };
        });
      }

      if (msg.type === 'agentClosed' && msg.zoneId) {
        const agentId = msg.id as number;
        const zoneId = msg.zoneId as string;

        setAgentZoneMap(prev => {
          const next = { ...prev };
          delete next[agentId];
          return next;
        });
        setAgentCounts(prev => {
          const zone = prev[zoneId] || { active: 0, total: 0 };
          return { ...prev, [zoneId]: { active: Math.max(0, zone.active - 1), total: zone.total } };
        });
      }

      // Track active/waiting status
      if (msg.type === 'agentStatus' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const status = msg.status as string;
        setActiveZones(prev => {
          const next = new Set(prev);
          if (status === 'active') next.add(zoneId);
          return next;
        });
      }

      // HUD messages from agentMessage and tool activity
      if (msg.type === 'agentMessage' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const config = configRef.current;
        const zoneConfig = config?.zones.find(z => z.id === zoneId);

        const hudMsg: HudMessage = {
          id: `${Date.now()}-${Math.random()}`,
          zoneId,
          zoneName: zoneConfig?.name || zoneId,
          zoneColor: zoneConfig?.accentColor || '#888',
          text: `${msg.fromName || '?'}: "${msg.text || ''}"`,
          timestamp: Date.now(),
        };
        setHudMessages(prev => [hudMsg, ...prev].slice(0, 20));
      }

      if (msg.type === 'agentToolStart' && msg.zoneId) {
        const zoneId = msg.zoneId as string;
        const config = configRef.current;
        const zoneConfig = config?.zones.find(z => z.id === zoneId);
        const status = msg.status as string;

        const hudMsg: HudMessage = {
          id: `${Date.now()}-${Math.random()}`,
          zoneId,
          zoneName: zoneConfig?.name || zoneId,
          zoneColor: zoneConfig?.accentColor || '#888',
          text: status,
          timestamp: Date.now(),
        };
        setHudMessages(prev => [hudMsg, ...prev].slice(0, 20));
      }

      // Existing agents with zone info
      if (msg.type === 'existingAgents' && msg.agentZones) {
        const zones = msg.agentZones as Record<number, string | null>;
        const map: Record<number, string> = {};
        const activeSet = new Set<string>();
        for (const [idStr, zoneId] of Object.entries(zones)) {
          if (zoneId) {
            map[Number(idStr)] = zoneId;
            activeSet.add(zoneId);
          }
        }
        setAgentZoneMap(prev => ({ ...prev, ...map }));
        setActiveZones(prev => {
          const next = new Set(prev);
          for (const z of activeSet) next.add(z);
          return next;
        });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const panToZone = useCallback((zoneId: string): { x: number; y: number } | null => {
    const zone = zoneManager.getZone(zoneId);
    if (!zone) return null;
    // Center the zone on screen
    const centerX = zone.worldX + zone.widthPx / 2;
    const centerY = zone.worldY + zone.heightPx / 2;
    const totalCenterX = zoneManager.totalWidth / 2;
    const totalCenterY = zoneManager.totalHeight / 2;
    return {
      x: (totalCenterX - centerX) * 2, // multiplied by default zoom
      y: (totalCenterY - centerY) * 2,
    };
  }, []);

  return {
    configLoaded,
    activeZones,
    agentCounts,
    agentZoneMap,
    hudMessages,
    maxHudMessages,
    panToZone,
  };
}
