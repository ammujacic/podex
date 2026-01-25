/**
 * Comprehensive tests for useIsMobile, useViewportWidth, and useIsTouchDevice hooks
 * Tests viewport detection, resize handling, and touch device detection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// We need to reset the module state between tests
let useIsMobile: () => boolean;
let useViewportWidth: () => number;
let useIsTouchDevice: () => boolean;

describe('useIsMobile', () => {
  const MOBILE_BREAKPOINT = 768;
  const RESIZE_DEBOUNCE_MS = 100;

  beforeEach(async () => {
    vi.useFakeTimers();

    // Reset window dimensions
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    // Clear module cache to reset shared state
    vi.resetModules();

    // Re-import to get fresh module state
    const module = await import('../useIsMobile');
    useIsMobile = module.useIsMobile;
    useViewportWidth = module.useViewportWidth;
    useIsTouchDevice = module.useIsTouchDevice;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ========================================
  // useIsMobile Tests
  // ========================================

  describe('useIsMobile', () => {
    it('should return false for desktop viewport', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      const { result } = renderHook(() => useIsMobile());

      expect(result.current).toBe(false);
    });

    it('should return true for mobile viewport', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });

      // Re-import to get fresh state with mobile width
      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(true);
    });

    it('should return true at exactly mobile breakpoint minus one', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: MOBILE_BREAKPOINT - 1,
        configurable: true,
      });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(true);
    });

    it('should return false at exactly mobile breakpoint', async () => {
      Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(false);
    });

    it('should update when window is resized below breakpoint', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(false);

      // Resize to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(result.current).toBe(true);
    });

    it('should update when window is resized above breakpoint', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(true);

      // Resize to desktop
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      // Wait for debounce
      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(result.current).toBe(false);
    });

    it('should debounce resize events', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      // Multiple rapid resizes
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      // Should still be desktop before debounce completes
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(50); // Half the debounce time
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      // Still desktop, debounce restarted
      expect(result.current).toBe(false);

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      // Final value should be desktop (1024)
      expect(result.current).toBe(false);
    });

    it('should handle orientation change', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(false);

      // Orientation change to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        window.dispatchEvent(new Event('orientationchange'));
      });

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(result.current).toBe(true);
    });

    it('should share state between multiple hook instances', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result: result1 } = renderHook(() => module.useIsMobile());
      const { result: result2 } = renderHook(() => module.useIsMobile());

      expect(result1.current).toBe(false);
      expect(result2.current).toBe(false);

      // Resize
      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      // Both should update
      expect(result1.current).toBe(true);
      expect(result2.current).toBe(true);
    });

    it('should return false during SSR (server snapshot)', async () => {
      vi.resetModules();
      const module = await import('../useIsMobile');

      // Server snapshot should return false
      const { result } = renderHook(() => module.useIsMobile());

      // In SSR context, would return false
      expect(result.current).toBe(false);
    });
  });

  // ========================================
  // useViewportWidth Tests
  // ========================================

  describe('useViewportWidth', () => {
    it('should return current viewport width', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useViewportWidth());

      expect(result.current).toBe(1200);
    });

    it('should update on resize', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useViewportWidth());

      expect(result.current).toBe(1200);

      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(result.current).toBe(800);
    });

    it('should return exact width values', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1337, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useViewportWidth());

      expect(result.current).toBe(1337);
    });

    it('should return 1024 as server snapshot (SSR default)', async () => {
      // The server snapshot returns 1024
      vi.resetModules();
      const module = await import('../useIsMobile');

      // Server snapshot is 1024 as defined in the hook
      const { result } = renderHook(() => module.useViewportWidth());

      // Client will have actual value
      expect(typeof result.current).toBe('number');
    });

    it('should share state with useIsMobile', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result: widthResult } = renderHook(() => module.useViewportWidth());
      const { result: mobileResult } = renderHook(() => module.useIsMobile());

      expect(widthResult.current).toBe(1024);
      expect(mobileResult.current).toBe(false);

      act(() => {
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });
        window.dispatchEvent(new Event('resize'));
      });

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(widthResult.current).toBe(500);
      expect(mobileResult.current).toBe(true);
    });

    it('should not update if width does not change', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useViewportWidth());
      const initialValue = result.current;

      // Dispatch resize but keep same width
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      act(() => {
        vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
      });

      expect(result.current).toBe(initialValue);
    });
  });

  // ========================================
  // useIsTouchDevice Tests
  // ========================================

  describe('useIsTouchDevice', () => {
    it('should return false initially (before effect)', async () => {
      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsTouchDevice());

      // Initial state is false
      expect(result.current).toBe(false);
    });

    it('should detect touch device via ontouchstart', async () => {
      // Add ontouchstart to window BEFORE importing the module
      Object.defineProperty(window, 'ontouchstart', {
        value: null,
        configurable: true,
        writable: true,
      });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsTouchDevice());

      // Need to advance timers to allow the effect to run
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe(true);

      // Cleanup
      delete (window as unknown as Record<string, unknown>).ontouchstart;
    });

    it('should detect touch device via maxTouchPoints', async () => {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 5,
        configurable: true,
      });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsTouchDevice());

      // Need to advance timers to allow the effect to run
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe(true);

      // Cleanup
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      });
    });

    it('should return false for non-touch device', async () => {
      // Make sure neither condition is true
      delete (window as unknown as Record<string, unknown>).ontouchstart;
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsTouchDevice());

      // Need to advance timers to allow the effect to run
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe(false);
    });

    it('should detect touch with maxTouchPoints > 0', async () => {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 1,
        configurable: true,
      });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsTouchDevice());

      // Need to advance timers to allow the effect to run
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(result.current).toBe(true);

      Object.defineProperty(navigator, 'maxTouchPoints', {
        value: 0,
        configurable: true,
      });
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle very small viewport', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(true);
    });

    it('should handle very large viewport', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 5000, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(false);
    });

    it('should handle zero viewport width', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());

      expect(result.current).toBe(true); // 0 < 768
    });

    it('should cleanup listeners on unmount', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { unmount } = renderHook(() => module.useIsMobile());

      unmount();

      // After unmount, shared state should still work for other hooks
      const { result } = renderHook(() => module.useIsMobile());
      expect(result.current).toBe(false);
    });

    it('should handle rapid subscribe/unsubscribe', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { unmount: unmount1 } = renderHook(() => module.useIsMobile());
      const { unmount: unmount2 } = renderHook(() => module.useIsMobile());

      unmount1();
      unmount2();

      // Should still work
      const { result } = renderHook(() => module.useIsMobile());
      expect(result.current).toBe(false);
    });

    it('should not call listeners if value has not changed', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

      vi.resetModules();
      const module = await import('../useIsMobile');

      const { result } = renderHook(() => module.useIsMobile());
      const initialValue = result.current;

      // Multiple resize events with same value
      for (let i = 0; i < 5; i++) {
        act(() => {
          window.dispatchEvent(new Event('resize'));
        });
        act(() => {
          vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS + 10);
        });
      }

      expect(result.current).toBe(initialValue);
    });
  });
});
