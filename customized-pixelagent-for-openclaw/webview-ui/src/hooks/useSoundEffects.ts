import { useCallback, useRef } from 'react';

import {
  isSoundEnabled,
  playAgentArriveSound,
  playAgentLeaveSound,
  playDoneSound,
  playTaskCompleteSound,
  playTypingClick,
} from '../notificationSound.js';

export interface SoundEffectsAPI {
  onAgentArrived: (id: number) => void;
  onAgentLeft: (id: number) => void;
  onAgentWaiting: () => void;
  onAgentTaskComplete: (id: number) => void;
  onTypingTick: (id: number) => void;
}

/**
 * Manages all sound effects.
 * Returns callbacks that should be called on relevant events.
 */
export function useSoundEffects(): SoundEffectsAPI {
  // Per-agent typing click state: { lastClick: number, pitchVariance: number }
  const typingState = useRef<Map<number, { lastClick: number; pitchVariance: number }>>(new Map());

  const onAgentArrived = useCallback((id: number) => {
    if (!isSoundEnabled()) return;
    void playAgentArriveSound();
    // Assign a stable pitch variance to this agent for typing sounds
    if (!typingState.current.has(id)) {
      typingState.current.set(id, { lastClick: 0, pitchVariance: Math.random() });
    }
  }, []);

  const onAgentLeft = useCallback((id: number) => {
    if (!isSoundEnabled()) return;
    void playAgentLeaveSound();
    typingState.current.delete(id);
  }, []);

  const onAgentWaiting = useCallback(() => {
    if (!isSoundEnabled()) return;
    void playDoneSound();
  }, []);

  const onAgentTaskComplete = useCallback((_id: number) => {
    if (!isSoundEnabled()) return;
    void playTaskCompleteSound();
  }, []);

  const onTypingTick = useCallback((id: number) => {
    if (!isSoundEnabled()) return;
    const state = typingState.current.get(id);
    if (!state) return;
    const now = performance.now();
    if (now - state.lastClick >= 300) {
      state.lastClick = now;
      playTypingClick(state.pitchVariance);
    }
  }, []);

  return { onAgentArrived, onAgentLeft, onAgentWaiting, onAgentTaskComplete, onTypingTick };
}
