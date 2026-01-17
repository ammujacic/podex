'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * Global visibility store for tracking tab/window focus state.
 * This allows multiple components to react to visibility changes without
 * each needing their own event listeners.
 */
interface VisibilityState {
  /** Whether the document is currently visible (not hidden) */
  isVisible: boolean;
  /** Whether the window/tab is currently focused */
  isFocused: boolean;
  /** Timestamp of when focus was last gained */
  lastFocusedAt: number | null;
  /** Timestamp of when focus was last lost */
  lastBlurredAt: number | null;
  /** Time spent unfocused (in ms) since last blur, 0 if currently focused */
  unfocusedDuration: number;

  // Internal actions
  _setVisible: (visible: boolean) => void;
  _setFocused: (focused: boolean) => void;
}

export const useVisibilityStore = create<VisibilityState>((set, get) => ({
  isVisible: typeof document !== 'undefined' ? !document.hidden : true,
  isFocused: typeof document !== 'undefined' ? document.hasFocus() : true,
  lastFocusedAt: null,
  lastBlurredAt: null,
  unfocusedDuration: 0,

  _setVisible: (visible) => set({ isVisible: visible }),
  _setFocused: (focused) => {
    const now = Date.now();
    if (focused) {
      const state = get();
      const unfocusedDuration = state.lastBlurredAt ? now - state.lastBlurredAt : 0;
      set({
        isFocused: true,
        lastFocusedAt: now,
        unfocusedDuration,
      });
    } else {
      set({
        isFocused: false,
        lastBlurredAt: now,
        unfocusedDuration: 0,
      });
    }
  },
}));

// Initialize global event listeners (runs once on import)
if (typeof window !== 'undefined') {
  // Visibility change (tab switching, minimizing)
  document.addEventListener('visibilitychange', () => {
    useVisibilityStore.getState()._setVisible(!document.hidden);
    // Also update focus based on visibility
    if (document.hidden) {
      useVisibilityStore.getState()._setFocused(false);
    }
  });

  // Window focus/blur (clicking into/out of window)
  window.addEventListener('focus', () => {
    useVisibilityStore.getState()._setFocused(true);
  });

  window.addEventListener('blur', () => {
    useVisibilityStore.getState()._setFocused(false);
  });
}

/**
 * Hook to track document visibility and window focus state.
 *
 * @example
 * const { isVisible, isFocused, wasRecentlyUnfocused } = useVisibilityTracking();
 *
 * // Auto-mark as read when user returns to tab
 * useEffect(() => {
 *   if (isFocused && wasRecentlyUnfocused) {
 *     markNotificationsAsRead();
 *   }
 * }, [isFocused]);
 */
export function useVisibilityTracking() {
  const isVisible = useVisibilityStore((state) => state.isVisible);
  const isFocused = useVisibilityStore((state) => state.isFocused);
  const lastFocusedAt = useVisibilityStore((state) => state.lastFocusedAt);
  const lastBlurredAt = useVisibilityStore((state) => state.lastBlurredAt);
  const unfocusedDuration = useVisibilityStore((state) => state.unfocusedDuration);

  // Was the tab unfocused for more than a brief moment (e.g., 1 second)?
  // This helps distinguish intentional tab switches from accidental focus loss
  const wasRecentlyUnfocused = unfocusedDuration > 1000;

  return {
    isVisible,
    isFocused,
    lastFocusedAt,
    lastBlurredAt,
    unfocusedDuration,
    wasRecentlyUnfocused,
  };
}

/**
 * Hook that fires a callback when the tab regains focus.
 *
 * @param callback - Function to call when focus is regained
 * @param options - Configuration options
 *
 * @example
 * useOnFocusReturn(() => {
 *   markAllNotificationsAsRead();
 * }, { minUnfocusedTime: 2000 });
 */
export function useOnFocusReturn(
  callback: (unfocusedDuration: number) => void,
  options: {
    /** Minimum time (ms) unfocused before callback fires. Default: 1000 */
    minUnfocusedTime?: number;
    /** Only fire if document was hidden (tab switch). Default: false */
    requireHidden?: boolean;
    /** Whether the callback is enabled. Default: true */
    enabled?: boolean;
  } = {}
) {
  const { minUnfocusedTime = 1000, requireHidden = false, enabled = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const wasHiddenRef = useRef(false);
  const isFocused = useVisibilityStore((state) => state.isFocused);
  const isVisible = useVisibilityStore((state) => state.isVisible);
  const unfocusedDuration = useVisibilityStore((state) => state.unfocusedDuration);
  const prevFocusedRef = useRef(isFocused);

  // Track if document was hidden
  useEffect(() => {
    if (!isVisible) {
      wasHiddenRef.current = true;
    }
  }, [isVisible]);

  // Fire callback when focus is regained
  useEffect(() => {
    if (!enabled) return;

    const justGainedFocus = isFocused && !prevFocusedRef.current;
    prevFocusedRef.current = isFocused;

    if (justGainedFocus) {
      const meetsTimeRequirement = unfocusedDuration >= minUnfocusedTime;
      const meetsHiddenRequirement = !requireHidden || wasHiddenRef.current;

      if (meetsTimeRequirement && meetsHiddenRequirement) {
        callbackRef.current(unfocusedDuration);
      }

      // Reset hidden tracking
      wasHiddenRef.current = false;
    }
  }, [isFocused, unfocusedDuration, minUnfocusedTime, requireHidden, enabled]);
}

/**
 * Convenience selectors for the visibility store
 */
export const selectIsVisible = (state: VisibilityState) => state.isVisible;
export const selectIsFocused = (state: VisibilityState) => state.isFocused;
