import {
  NOTIFICATION_NOTE_1_HZ,
  NOTIFICATION_NOTE_1_START_SEC,
  NOTIFICATION_NOTE_2_HZ,
  NOTIFICATION_NOTE_2_START_SEC,
  NOTIFICATION_NOTE_DURATION_SEC,
  NOTIFICATION_VOLUME,
} from './constants.js';

let soundEnabled = true;
let audioCtx: AudioContext | null = null;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function playNote(ctx: AudioContext, freq: number, startOffset: number): void {
  const t = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);

  gain.gain.setValueAtTime(NOTIFICATION_VOLUME, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + NOTIFICATION_NOTE_DURATION_SEC);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t);
  osc.stop(t + NOTIFICATION_NOTE_DURATION_SEC);
}

export async function playDoneSound(): Promise<void> {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    // Resume suspended context (webviews suspend until user gesture)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    // Ascending two-note chime: E5 → B5
    playNote(audioCtx, NOTIFICATION_NOTE_1_HZ, NOTIFICATION_NOTE_1_START_SEC);
    playNote(audioCtx, NOTIFICATION_NOTE_2_HZ, NOTIFICATION_NOTE_2_START_SEC);
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch {
    // ignore
  }
}

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
  } catch {
    return null;
  }
}

/** Soft rhythmic typing click — call on each tick while agent is typing */
export function playTypingClick(pitchVariance = 0): void {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx || ctx.state === 'suspended') return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800 + pitchVariance * 200, t);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  } catch { /* ignore */ }
}

/** Agent arrives — soft pop/whoosh */
export async function playAgentArriveSound(): Promise<void> {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.linearRampToValueAtTime(600, t + 0.12);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  } catch { /* ignore */ }
}

/** Agent leaves — soft fade-out tone */
export async function playAgentLeaveSound(): Promise<void> {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, t);
    osc.frequency.linearRampToValueAtTime(200, t + 0.3);
    gain.gain.setValueAtTime(0.1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  } catch { /* ignore */ }
}

/** Task complete — brief ascending two-note tone */
export async function playTaskCompleteSound(): Promise<void> {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
    const t = ctx.currentTime;
    // First note
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(440, t);
    g1.gain.setValueAtTime(0.1, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o1.connect(g1);
    g1.connect(ctx.destination);
    o1.start(t);
    o1.stop(t + 0.15);
    // Second note (higher)
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(660, t + 0.12);
    g2.gain.setValueAtTime(0.1, t + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o2.connect(g2);
    g2.connect(ctx.destination);
    o2.start(t + 0.12);
    o2.stop(t + 0.3);
  } catch { /* ignore */ }
}
