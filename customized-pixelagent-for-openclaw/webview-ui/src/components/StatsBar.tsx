import { useEffect, useState } from 'react';

import type { GlobalStats } from '../hooks/useExtensionMessages.js';

interface StatsBarProps {
  stats: GlobalStats;
}

function formatUptime(startMs: number): string {
  const diff = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function StatsBar({ stats }: StatsBarProps) {
  // Tick every minute to update uptime display
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        height: 24,
        background: 'rgba(0,0,0,0.75)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 14px',
        fontSize: 10,
        color: 'rgba(255,255,255,0.5)',
        letterSpacing: 0.5,
        flexShrink: 0,
        userSelect: 'none',
        zIndex: 45,
      }}
    >
      <span>Tasks today: <b style={{ color: 'rgba(255,255,255,0.75)' }}>{stats.tasksToday}</b></span>
      <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
      <span>Files modified: <b style={{ color: 'rgba(255,255,255,0.75)' }}>{stats.filesModified}</b></span>
      <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
      <span>Commands run: <b style={{ color: 'rgba(255,255,255,0.75)' }}>{stats.commandsRun}</b></span>
      <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
      <span>Uptime: <b style={{ color: 'rgba(255,255,255,0.75)' }}>{formatUptime(stats.sessionStart)}</b></span>
    </div>
  );
}
