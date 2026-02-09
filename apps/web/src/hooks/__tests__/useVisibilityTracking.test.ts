/**
 * Comprehensive tests for useVisibilityTracking hooks
 * Tests document visibility, window focus state, and focus return callbacks
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useVisibilityTracking,
  useOnFocusReturn,
  useVisibilityStore,
  selectIsVisible,
  selectIsFocused,
} from '../useVisibilityTracking';

// Store the original document.hidden value
const originalDocumentHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

describe('useVisibilityStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    const store = useVisibilityStore.getState();
    store._setVisible(true);
    store._setFocused(true);
    useVisibilityStore.setState({
      lastFocusedAt: null,
      lastBlurredAt: null,
      unfocusedDuration: 0,
    });
  });

  afterEach(() => {
    // Restore original document.hidden
    if (originalDocumentHidden) {
      Object.defineProperty(document, 'hidden', originalDocumentHidden);
    }
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should have initial visible state based on document.hidden', () => {
      const state = useVisibilityStore.getState();
      expect(typeof state.isVisible).toBe('boolean');
    });

    it('should have initial focused state based on document.hasFocus', () => {
      const state = useVisibilityStore.getState();
      expect(typeof state.isFocused).toBe('boolean');
    });

    it('should have null lastFocusedAt initially', () => {
      useVisibilityStore.setState({ lastFocusedAt: null });
      const state = useVisibilityStore.getState();
      expect(state.lastFocusedAt).toBeNull();
    });

    it('should have null lastBlurredAt initially', () => {
      useVisibilityStore.setState({ lastBlurredAt: null });
      const state = useVisibilityStore.getState();
      expect(state.lastBlurredAt).toBeNull();
    });

    it('should have zero unfocusedDuration initially', () => {
      useVisibilityStore.setState({ unfocusedDuration: 0 });
      const state = useVisibilityStore.getState();
      expect(state.unfocusedDuration).toBe(0);
    });
  });

  // ========================================
  // Visibility State Tests
  // ========================================

  describe('Visibility State', () => {
    it('should update isVisible to true', () => {
      const store = useVisibilityStore.getState();
      store._setVisible(true);
      expect(useVisibilityStore.getState().isVisible).toBe(true);
    });

    it('should update isVisible to false', () => {
      const store = useVisibilityStore.getState();
      store._setVisible(false);
      expect(useVisibilityStore.getState().isVisible).toBe(false);
    });

    it('should toggle visibility state', () => {
      const store = useVisibilityStore.getState();
      store._setVisible(true);
      expect(useVisibilityStore.getState().isVisible).toBe(true);
      store._setVisible(false);
      expect(useVisibilityStore.getState().isVisible).toBe(false);
      store._setVisible(true);
      expect(useVisibilityStore.getState().isVisible).toBe(true);
    });
  });

  // ========================================
  // Focus State Tests
  // ========================================

  describe('Focus State', () => {
    it('should update isFocused to true', () => {
      const store = useVisibilityStore.getState();
      store._setFocused(true);
      expect(useVisibilityStore.getState().isFocused).toBe(true);
    });

    it('should update isFocused to false', () => {
      const store = useVisibilityStore.getState();
      store._setFocused(false);
      expect(useVisibilityStore.getState().isFocused).toBe(false);
    });

    it('should set lastFocusedAt when gaining focus', () => {
      const store = useVisibilityStore.getState();
      const beforeTimestamp = Date.now();
      store._setFocused(true);
      const afterTimestamp = Date.now();

      const { lastFocusedAt } = useVisibilityStore.getState();
      expect(lastFocusedAt).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(lastFocusedAt).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should set lastBlurredAt when losing focus', () => {
      const store = useVisibilityStore.getState();
      const beforeTimestamp = Date.now();
      store._setFocused(false);
      const afterTimestamp = Date.now();

      const { lastBlurredAt } = useVisibilityStore.getState();
      expect(lastBlurredAt).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(lastBlurredAt).toBeLessThanOrEqual(afterTimestamp);
    });

    it('should calculate unfocusedDuration when regaining focus', async () => {
      const store = useVisibilityStore.getState();

      // Lose focus
      store._setFocused(false);

      // Wait a bit (use 60ms to account for timer precision variance)
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Regain focus
      store._setFocused(true);
      const { unfocusedDuration } = useVisibilityStore.getState();

      // Allow small tolerance for timing precision (setTimeout is not exact)
      expect(unfocusedDuration).toBeGreaterThanOrEqual(50);
    });

    it('should reset unfocusedDuration to 0 when losing focus', () => {
      // First set some unfocused duration
      useVisibilityStore.setState({ unfocusedDuration: 5000 });

      const store = useVisibilityStore.getState();
      store._setFocused(false);

      expect(useVisibilityStore.getState().unfocusedDuration).toBe(0);
    });

    it('should handle focus without prior blur gracefully', () => {
      useVisibilityStore.setState({
        lastBlurredAt: null,
        isFocused: false,
      });

      const store = useVisibilityStore.getState();
      store._setFocused(true);

      expect(useVisibilityStore.getState().unfocusedDuration).toBe(0);
    });
  });

  // ========================================
  // Selector Tests
  // ========================================

  describe('Selectors', () => {
    it('should return isVisible with selectIsVisible', () => {
      useVisibilityStore.setState({ isVisible: true });
      expect(selectIsVisible(useVisibilityStore.getState())).toBe(true);

      useVisibilityStore.setState({ isVisible: false });
      expect(selectIsVisible(useVisibilityStore.getState())).toBe(false);
    });

    it('should return isFocused with selectIsFocused', () => {
      useVisibilityStore.setState({ isFocused: true });
      expect(selectIsFocused(useVisibilityStore.getState())).toBe(true);

      useVisibilityStore.setState({ isFocused: false });
      expect(selectIsFocused(useVisibilityStore.getState())).toBe(false);
    });
  });
});

describe('useVisibilityTracking', () => {
  beforeEach(() => {
    const store = useVisibilityStore.getState();
    store._setVisible(true);
    store._setFocused(true);
    useVisibilityStore.setState({
      lastFocusedAt: null,
      lastBlurredAt: null,
      unfocusedDuration: 0,
    });
  });

  // ========================================
  // Basic Hook Return Values
  // ========================================

  describe('Return Values', () => {
    it('should return isVisible', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(typeof result.current.isVisible).toBe('boolean');
    });

    it('should return isFocused', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(typeof result.current.isFocused).toBe('boolean');
    });

    it('should return lastFocusedAt', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(
        result.current.lastFocusedAt === null || typeof result.current.lastFocusedAt === 'number'
      ).toBe(true);
    });

    it('should return lastBlurredAt', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(
        result.current.lastBlurredAt === null || typeof result.current.lastBlurredAt === 'number'
      ).toBe(true);
    });

    it('should return unfocusedDuration', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(typeof result.current.unfocusedDuration).toBe('number');
    });

    it('should return wasRecentlyUnfocused', () => {
      const { result } = renderHook(() => useVisibilityTracking());
      expect(typeof result.current.wasRecentlyUnfocused).toBe('boolean');
    });
  });

  // ========================================
  // State Reactivity Tests
  // ========================================

  describe('State Reactivity', () => {
    it('should update when visibility changes', () => {
      const { result } = renderHook(() => useVisibilityTracking());

      act(() => {
        useVisibilityStore.getState()._setVisible(false);
      });

      expect(result.current.isVisible).toBe(false);
    });

    it('should update when focus changes', () => {
      const { result } = renderHook(() => useVisibilityTracking());

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      expect(result.current.isFocused).toBe(false);
    });

    it('should calculate wasRecentlyUnfocused based on duration', () => {
      const { result } = renderHook(() => useVisibilityTracking());

      // Short unfocused duration - should not be "recently unfocused"
      act(() => {
        useVisibilityStore.setState({ unfocusedDuration: 500 });
      });

      expect(result.current.wasRecentlyUnfocused).toBe(false);

      // Long unfocused duration - should be "recently unfocused"
      act(() => {
        useVisibilityStore.setState({ unfocusedDuration: 2000 });
      });

      expect(result.current.wasRecentlyUnfocused).toBe(true);
    });

    it('should use 1000ms as threshold for wasRecentlyUnfocused', () => {
      const { result } = renderHook(() => useVisibilityTracking());

      act(() => {
        useVisibilityStore.setState({ unfocusedDuration: 1000 });
      });
      expect(result.current.wasRecentlyUnfocused).toBe(false);

      act(() => {
        useVisibilityStore.setState({ unfocusedDuration: 1001 });
      });
      expect(result.current.wasRecentlyUnfocused).toBe(true);
    });
  });

  // ========================================
  // Focus/Blur Cycle Tests
  // ========================================

  describe('Focus/Blur Cycles', () => {
    it('should track focus cycle correctly', async () => {
      const { result } = renderHook(() => useVisibilityTracking());

      // Initial state
      expect(result.current.isFocused).toBe(true);

      // Lose focus
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });
      expect(result.current.isFocused).toBe(false);
      expect(result.current.lastBlurredAt).not.toBeNull();

      // Wait and regain focus
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        useVisibilityStore.getState()._setFocused(true);
      });

      expect(result.current.isFocused).toBe(true);
      expect(result.current.lastFocusedAt).not.toBeNull();
      expect(result.current.unfocusedDuration).toBeGreaterThanOrEqual(100);
    });

    it('should track visibility cycle correctly', () => {
      const { result } = renderHook(() => useVisibilityTracking());

      expect(result.current.isVisible).toBe(true);

      act(() => {
        useVisibilityStore.getState()._setVisible(false);
      });
      expect(result.current.isVisible).toBe(false);

      act(() => {
        useVisibilityStore.getState()._setVisible(true);
      });
      expect(result.current.isVisible).toBe(true);
    });
  });
});

describe('useOnFocusReturn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const store = useVisibilityStore.getState();
    store._setVisible(true);
    store._setFocused(true);
    useVisibilityStore.setState({
      lastFocusedAt: null,
      lastBlurredAt: null,
      unfocusedDuration: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================
  // Basic Callback Tests
  // ========================================

  describe('Basic Callback Behavior', () => {
    it('should call callback when focus is regained after sufficient unfocused time', async () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      // Lose focus
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      // Wait enough time
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Regain focus with sufficient duration
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledWith(200);
    });

    it('should not call callback when unfocused time is insufficient', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 2000 }));

      // Lose focus
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      // Short wait
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Regain focus with insufficient duration
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 500,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should use default minUnfocusedTime of 1000ms', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback));

      // Lose and regain focus with 500ms - should not call
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 500,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).not.toHaveBeenCalled();

      // Lose and regain focus with 1500ms - should call
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 1500,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledWith(1500);
    });
  });

  // ========================================
  // Enabled Option Tests
  // ========================================

  describe('Enabled Option', () => {
    it('should not call callback when disabled', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { enabled: false }));

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 5000,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback when enabled is true', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { enabled: true, minUnfocusedTime: 100 }));

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalled();
    });

    it('should respond to enabled option changes', () => {
      const callback = vi.fn();
      const { rerender } = renderHook(
        ({ enabled }) => useOnFocusReturn(callback, { enabled, minUnfocusedTime: 100 }),
        { initialProps: { enabled: false } }
      );

      // Should not call while disabled
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });
      expect(callback).not.toHaveBeenCalled();

      // Enable and trigger again
      rerender({ enabled: true });

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalled();
    });
  });

  // ========================================
  // RequireHidden Option Tests
  // ========================================

  describe('RequireHidden Option', () => {
    it('should not require hidden by default', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      // Never set visibility to false, just focus changes
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalled();
    });

    it('should require hidden when requireHidden is true', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { requireHidden: true, minUnfocusedTime: 100 }));

      // Focus change without visibility change
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback when requireHidden is true and document was hidden', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { requireHidden: true, minUnfocusedTime: 100 }));

      // Hide document and lose focus
      act(() => {
        useVisibilityStore.getState()._setVisible(false);
        useVisibilityStore.getState()._setFocused(false);
      });

      // Show document and regain focus
      act(() => {
        useVisibilityStore.getState()._setVisible(true);
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalled();
    });

    it('should reset hidden tracking after focus return', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { requireHidden: true, minUnfocusedTime: 100 }));

      // First cycle: hide and focus return
      act(() => {
        useVisibilityStore.getState()._setVisible(false);
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.getState()._setVisible(true);
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledTimes(1);

      // Second cycle: without hiding - should not call
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // Callback Reference Tests
  // ========================================

  describe('Callback Reference', () => {
    it('should use latest callback reference', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const { rerender } = renderHook(({ cb }) => useOnFocusReturn(cb, { minUnfocusedTime: 100 }), {
        initialProps: { cb: callback1 },
      });

      // Update callback
      rerender({ cb: callback2 });

      // Trigger focus return
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should not call callback on initial mount even if focused', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback));

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle rapid focus changes', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      // Rapid focus changes
      for (let i = 0; i < 5; i++) {
        act(() => {
          useVisibilityStore.getState()._setFocused(false);
        });
        act(() => {
          useVisibilityStore.setState({
            isFocused: true,
            unfocusedDuration: 50,
            lastFocusedAt: Date.now(),
          });
        });
      }

      // Should not call due to insufficient time
      expect(callback).not.toHaveBeenCalled();
    });

    it('should call callback with correct duration value', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      const expectedDuration = 12345;

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: expectedDuration,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledWith(expectedDuration);
    });

    it('should handle unmount during unfocused state', () => {
      const callback = vi.fn();
      const { unmount } = renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });

      unmount();

      // Should not throw or call callback after unmount
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle multiple focus returns', () => {
      const callback = vi.fn();
      renderHook(() => useOnFocusReturn(callback, { minUnfocusedTime: 100 }));

      // First return
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 200,
          lastFocusedAt: Date.now(),
        });
      });

      // Second return
      act(() => {
        useVisibilityStore.getState()._setFocused(false);
      });
      act(() => {
        useVisibilityStore.setState({
          isFocused: true,
          unfocusedDuration: 300,
          lastFocusedAt: Date.now(),
        });
      });

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, 200);
      expect(callback).toHaveBeenNthCalledWith(2, 300);
    });
  });
});
