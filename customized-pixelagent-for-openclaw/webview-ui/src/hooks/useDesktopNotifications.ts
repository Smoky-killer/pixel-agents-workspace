import { useCallback, useEffect, useRef } from 'react';

const STORAGE_KEY_DENIED = 'pixelagent-notif-denied';
const STORAGE_KEY_ENABLED = 'pixelagent-notif-enabled';
const AGENT_DEBOUNCE_MS = 30_000;
const GATEWAY_OFFLINE_DELAY_MS = 10_000;

function notificationsAllowed(): boolean {
  try {
    if (localStorage.getItem(STORAGE_KEY_DENIED) === '1') return false;
    if (localStorage.getItem(STORAGE_KEY_ENABLED) === '0') return false;
    return Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function isTabHidden(): boolean {
  return document.hidden;
}

export function useDesktopNotifications(enabled: boolean) {
  const permissionRequested = useRef(false);
  const agentLastNotif = useRef<Map<number, number>>(new Map());
  const gatewayOfflineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Request permission on first load
  useEffect(() => {
    if (permissionRequested.current) return;
    permissionRequested.current = true;
    try {
      if (localStorage.getItem(STORAGE_KEY_DENIED) === '1') return;
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          if (perm === 'denied') {
            try { localStorage.setItem(STORAGE_KEY_DENIED, '1'); } catch {}
          }
        });
      }
    } catch { /* ignore */ }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    if (!enabledRef.current) return;
    if (!notificationsAllowed()) return;
    try {
      const n = new Notification(title, { body, icon: undefined });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* ignore */ }
  }, []);

  const onAgentWaiting = useCallback((id: number, name: string) => {
    if (!isTabHidden()) return;
    const last = agentLastNotif.current.get(id) ?? 0;
    if (Date.now() - last < AGENT_DEBOUNCE_MS) return;
    agentLastNotif.current.set(id, Date.now());
    notify(`${name} is waiting for your input`, 'Click to focus');
  }, [notify]);

  const onAgentTaskComplete = useCallback((id: number, name: string) => {
    const last = agentLastNotif.current.get(id) ?? 0;
    if (Date.now() - last < AGENT_DEBOUNCE_MS) return;
    agentLastNotif.current.set(id, Date.now());
    notify(`${name} completed a task`);
  }, [notify]);

  const onAgentConnected = useCallback((_id: number, name: string) => {
    notify(`New OpenClaw agent connected: ${name}`);
  }, [notify]);

  const onGatewayConnected = useCallback(() => {
    if (gatewayOfflineTimer.current) {
      clearTimeout(gatewayOfflineTimer.current);
      gatewayOfflineTimer.current = null;
    }
  }, []);

  const onGatewayDisconnected = useCallback(() => {
    if (gatewayOfflineTimer.current) return;
    gatewayOfflineTimer.current = setTimeout(() => {
      gatewayOfflineTimer.current = null;
      notify('OpenClaw gateway disconnected', 'Check your OpenClaw gateway');
    }, GATEWAY_OFFLINE_DELAY_MS);
  }, [notify]);

  return {
    onAgentWaiting,
    onAgentTaskComplete,
    onAgentConnected,
    onGatewayConnected,
    onGatewayDisconnected,
  };
}
