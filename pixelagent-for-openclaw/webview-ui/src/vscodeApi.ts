/**
 * vscodeApi.ts — WebSocket replacement for the VS Code extension API.
 *
 * Strategy:
 *  - Incoming WS messages are dispatched as window `message` events so that
 *    useExtensionMessages.ts works without any changes.
 *  - vscode.postMessage() sends JSON over the WebSocket.
 *  - exportLayout / importLayout are handled natively in the browser.
 */

const WS_URL = 'ws://localhost:3001';

// Queue messages that arrive before the socket is open
const _queue: unknown[] = [];

const _ws = new WebSocket(WS_URL);

_ws.onopen = () => {
  for (const msg of _queue) {
    _ws.send(JSON.stringify(msg));
  }
  _queue.length = 0;
};

// Dispatch incoming WS messages as window `message` events
// (exactly what the VS Code webview host does)
_ws.onmessage = (event: MessageEvent) => {
  try {
    const data = JSON.parse(event.data as string);
    window.dispatchEvent(new MessageEvent('message', { data }));
  } catch {
    // ignore malformed messages
  }
};

_ws.onerror = () => {
  // Connection errors are expected when server is starting
};

_ws.onclose = () => {
  // Server disconnected
};

function _send(msg: unknown): void {
  if (_ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(msg));
  } else {
    _queue.push(msg);
  }
}

/** Fetch layout JSON and trigger a browser download */
async function _exportLayout(): Promise<void> {
  try {
    const resp = await fetch('/api/layout');
    const layout = await resp.json();
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixelagent-layout.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('[vscodeApi] Export layout failed:', err);
  }
}

/** Open a file picker and import a layout JSON */
function _importLayout(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const layout = JSON.parse(text) as Record<string, unknown>;
      if (layout.version !== 1 || !Array.isArray(layout.tiles)) {
        alert('Invalid layout file (must have version: 1 and a tiles array)');
        return;
      }
      // Save to server
      _send({ type: 'saveLayout', layout });
      // Update the UI immediately
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'layoutLoaded', layout } }));
    } catch {
      alert('Failed to read or parse layout file.');
    }
  };
  input.click();
}

export const vscode = {
  postMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'exportLayout':
        void _exportLayout();
        break;
      case 'importLayout':
        _importLayout();
        break;
      case 'openSessionsFolder':
        // No-op in standalone mode
        break;
      default:
        _send(msg);
        break;
    }
  },
};

/** Expose the raw WebSocket for any hook that needs its own onmessage handler */
export const wsClient = _ws;
