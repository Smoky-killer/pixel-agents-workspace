'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LAYOUT_DIR = path.join(os.homedir(), '.pixelagent-openclaw');
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json');
const AGENTS_FILE = path.join(LAYOUT_DIR, 'agents.json');

function ensureDir() {
  if (!fs.existsSync(LAYOUT_DIR)) {
    fs.mkdirSync(LAYOUT_DIR, { recursive: true });
  }
}

function readLayout() {
  try {
    ensureDir();
    if (!fs.existsSync(LAYOUT_FILE)) return null;
    const raw = fs.readFileSync(LAYOUT_FILE, 'utf-8');
    const layout = JSON.parse(raw);
    if (layout.version !== 1 || !Array.isArray(layout.tiles)) return null;
    return layout;
  } catch {
    return null;
  }
}

function writeLayout(layout) {
  try {
    ensureDir();
    const tmp = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(layout, null, 2), 'utf-8');
    fs.renameSync(tmp, LAYOUT_FILE);
    return true;
  } catch (err) {
    console.error('[LayoutStore] Error writing layout:', err.message);
    return false;
  }
}

function readAgentSeats() {
  try {
    ensureDir();
    if (!fs.existsSync(AGENTS_FILE)) return {};
    const raw = fs.readFileSync(AGENTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAgentSeats(seats) {
  try {
    ensureDir();
    fs.writeFileSync(AGENTS_FILE, JSON.stringify(seats, null, 2), 'utf-8');
  } catch (err) {
    console.error('[LayoutStore] Error writing agent seats:', err.message);
  }
}

/**
 * Watch the layout file for external changes (cross-process sync).
 * Calls onChange(layout) when an external write is detected.
 * Returns a dispose function.
 */
function watchLayout(onChange) {
  let ownWritePending = false;
  let lastMtime = 0;
  let fsWatcher = null;

  function markOwnWrite() {
    ownWritePending = true;
    setTimeout(() => { ownWritePending = false; }, 500);
  }

  function checkFile() {
    if (ownWritePending) return;
    try {
      if (!fs.existsSync(LAYOUT_FILE)) return;
      const stat = fs.statSync(LAYOUT_FILE);
      const mtime = stat.mtimeMs;
      if (mtime === lastMtime) return;
      lastMtime = mtime;
      const layout = readLayout();
      if (layout) onChange(layout);
    } catch {
      // ignore
    }
  }

  // Try fs.watch first
  try {
    fsWatcher = fs.watch(LAYOUT_FILE, checkFile);
  } catch {
    // File might not exist yet — polling will handle it
  }

  // Polling backup
  const pollTimer = setInterval(checkFile, 2000);

  return {
    markOwnWrite,
    dispose() {
      clearInterval(pollTimer);
      if (fsWatcher) {
        try { fsWatcher.close(); } catch {}
        fsWatcher = null;
      }
    },
  };
}

module.exports = { readLayout, writeLayout, readAgentSeats, writeAgentSeats, watchLayout, LAYOUT_FILE, LAYOUT_DIR };
