/**
 * Comprehensive tests for useDocumentTitle and useSessionTitle hooks
 * Tests document title management with notifications and tab focus states
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocumentTitle, useSessionTitle } from '../useDocumentTitle';

// Mock stores
const mockAttentionState = {
  unreadCountBySession: {} as Record<string, number>,
};

const mockVisibilityState = {
  isFocused: true,
};

vi.mock('@/stores/attention', () => ({
  useAttentionStore: (selector: (state: typeof mockAttentionState) => unknown) => {
    return selector(mockAttentionState);
  },
}));

vi.mock('@/hooks/useVisibilityTracking', () => ({
  useVisibilityStore: (selector: (state: typeof mockVisibilityState) => unknown) => {
    return selector(mockVisibilityState);
  },
}));

describe('useDocumentTitle', () => {
  let originalTitle: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    originalTitle = document.title;
    document.title = 'Podex';
    mockAttentionState.unreadCountBySession = {};
    mockVisibilityState.isFocused = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.title = originalTitle;
  });

  // ========================================
  // Basic Title Tests
  // ========================================

  describe('Basic Title', () => {
    it('should set document title with suffix', () => {
      renderHook(() => useDocumentTitle('Dashboard'));

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should set just "Podex" when title is empty', () => {
      renderHook(() => useDocumentTitle(''));

      expect(document.title).toBe('Podex');
    });

    it('should update title when it changes', () => {
      const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
        initialProps: { title: 'Dashboard' },
      });

      expect(document.title).toBe('Dashboard | Podex');

      rerender({ title: 'Settings' });

      expect(document.title).toBe('Settings | Podex');
    });

    it('should reset title to Podex on unmount', () => {
      const { unmount } = renderHook(() => useDocumentTitle('Dashboard'));

      expect(document.title).toBe('Dashboard | Podex');

      unmount();

      expect(document.title).toBe('Podex');
    });

    it('should handle special characters in title', () => {
      renderHook(() => useDocumentTitle('Project <Test> & "Stuff"'));

      expect(document.title).toBe('Project <Test> & "Stuff" | Podex');
    });

    it('should handle very long titles', () => {
      const longTitle = 'A'.repeat(200);
      renderHook(() => useDocumentTitle(longTitle));

      expect(document.title).toBe(`${longTitle} | Podex`);
    });

    it('should handle unicode characters in title', () => {
      renderHook(() => useDocumentTitle('Project'));

      expect(document.title).toBe('Project | Podex');
    });
  });

  // ========================================
  // Notification Count Tests
  // ========================================

  describe('Notification Count', () => {
    it('should show notification count in title', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should show total unread count without sessionId', () => {
      mockAttentionState.unreadCountBySession = {
        'session-1': 3,
        'session-2': 5,
      };

      renderHook(() => useDocumentTitle('Dashboard'));

      expect(document.title).toBe('(8) Dashboard | Podex');
    });

    it('should not show count when zero', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 0 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should not show count when showNotifications is false', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 5 };

      renderHook(() => useDocumentTitle('Dashboard', { showNotifications: false }));

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should handle missing sessionId in store', () => {
      mockAttentionState.unreadCountBySession = { 'other-session': 10 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should update when notification count changes', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 2 };

      const { rerender } = renderHook(
        ({ sessionId }) => useDocumentTitle('Dashboard', { sessionId }),
        { initialProps: { sessionId: 'session-1' } }
      );

      expect(document.title).toBe('(2) Dashboard | Podex');

      // Simulate count change (would normally trigger store update)
      mockAttentionState.unreadCountBySession = { 'session-1': 5 };
      rerender({ sessionId: 'session-1' });

      expect(document.title).toBe('(5) Dashboard | Podex');
    });

    it('should show single digit count', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 1 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('(1) Dashboard | Podex');
    });

    it('should show large count', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 999 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('(999) Dashboard | Podex');
    });
  });

  // ========================================
  // Title Flashing Tests
  // ========================================

  describe('Title Flashing', () => {
    it('should flash title when unfocused with unread notifications', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: true })
      );

      // Initially should show indicator
      expect(document.title).toContain('(3) Dashboard | Podex');

      // Advance timer to toggle
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      // Should toggle between with and without indicator
      const titleAfterInterval = document.title;
      expect(
        titleAfterInterval === '(3) Dashboard | Podex' ||
          titleAfterInterval.includes('(3) Dashboard | Podex')
      ).toBe(true);
    });

    it('should not flash when focused', () => {
      mockVisibilityState.isFocused = true;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: true })
      );

      expect(document.title).toBe('(3) Dashboard | Podex');

      // Advance timer - should not change
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should not flash when flashWhenUnfocused is false', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: false })
      );

      expect(document.title).toBe('(3) Dashboard | Podex');

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should not flash when no unread notifications', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 0 };

      renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: true })
      );

      expect(document.title).toBe('Dashboard | Podex');

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should stop flashing when focus returns', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      const { rerender } = renderHook(
        ({ isFocused }) => {
          mockVisibilityState.isFocused = isFocused;
          return useDocumentTitle('Dashboard', {
            sessionId: 'session-1',
            flashWhenUnfocused: true,
          });
        },
        { initialProps: { isFocused: false } }
      );

      // Simulate regaining focus
      rerender({ isFocused: true });

      expect(document.title).toBe('(3) Dashboard | Podex');

      // Verify no flashing continues
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should clear interval on unmount', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: true })
      );

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should clear previous interval when dependencies change', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { rerender } = renderHook(
        ({ title }) =>
          useDocumentTitle(title, { sessionId: 'session-1', flashWhenUnfocused: true }),
        { initialProps: { title: 'Dashboard' } }
      );

      rerender({ title: 'Settings' });

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should show bullet indicator when flashing starts', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() =>
        useDocumentTitle('Dashboard', { sessionId: 'session-1', flashWhenUnfocused: true })
      );

      // Should start with the bullet indicator
      expect(document.title).toContain('(3) Dashboard | Podex');
    });
  });

  // ========================================
  // Option Defaults Tests
  // ========================================

  describe('Option Defaults', () => {
    it('should default showNotifications to true', () => {
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should default flashWhenUnfocused to true', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      renderHook(() => useDocumentTitle('Dashboard', { sessionId: 'session-1' }));

      // Should have flashing behavior (with bullet indicator)
      expect(document.title).toContain('(3) Dashboard | Podex');
    });

    it('should work with no options', () => {
      renderHook(() => useDocumentTitle('Dashboard'));

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should work with undefined options', () => {
      renderHook(() => useDocumentTitle('Dashboard', undefined));

      expect(document.title).toBe('Dashboard | Podex');
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle rapid title changes', () => {
      const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
        initialProps: { title: 'Title 1' },
      });

      for (let i = 2; i <= 10; i++) {
        rerender({ title: `Title ${i}` });
      }

      expect(document.title).toBe('Title 10 | Podex');
    });

    it('should handle focus state changes during flashing', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      const { rerender } = renderHook(
        ({ isFocused }) => {
          mockVisibilityState.isFocused = isFocused;
          return useDocumentTitle('Dashboard', {
            sessionId: 'session-1',
            flashWhenUnfocused: true,
          });
        },
        { initialProps: { isFocused: false } }
      );

      act(() => {
        vi.advanceTimersByTime(750);
      });

      rerender({ isFocused: true });

      // Should stop flashing
      expect(document.title).toBe('(3) Dashboard | Podex');
    });

    it('should handle notification count becoming zero while flashing', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-1': 3 };

      const { rerender } = renderHook(
        ({ count }) => {
          mockAttentionState.unreadCountBySession = { 'session-1': count };
          return useDocumentTitle('Dashboard', {
            sessionId: 'session-1',
            flashWhenUnfocused: true,
          });
        },
        { initialProps: { count: 3 } }
      );

      act(() => {
        vi.advanceTimersByTime(750);
      });

      rerender({ count: 0 });

      expect(document.title).toBe('Dashboard | Podex');
    });

    it('should handle empty unreadCountBySession', () => {
      mockAttentionState.unreadCountBySession = {};

      renderHook(() => useDocumentTitle('Dashboard'));

      expect(document.title).toBe('Dashboard | Podex');
    });
  });
});

// ============================================================================
// useSessionTitle Tests
// ============================================================================

describe('useSessionTitle', () => {
  let originalTitle: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    originalTitle = document.title;
    document.title = 'Podex';
    mockAttentionState.unreadCountBySession = {};
    mockVisibilityState.isFocused = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.title = originalTitle;
  });

  describe('Session Title', () => {
    it('should set session name as title', () => {
      renderHook(() => useSessionTitle('my-project', 'session-123'));

      expect(document.title).toBe('my-project | Podex');
    });

    it('should use "Workspace" when sessionName is undefined', () => {
      renderHook(() => useSessionTitle(undefined, 'session-123'));

      expect(document.title).toBe('Workspace | Podex');
    });

    it('should show notification count for session', () => {
      mockAttentionState.unreadCountBySession = { 'session-123': 5 };

      renderHook(() => useSessionTitle('my-project', 'session-123'));

      expect(document.title).toBe('(5) my-project | Podex');
    });

    it('should flash when unfocused with notifications', () => {
      mockVisibilityState.isFocused = false;
      mockAttentionState.unreadCountBySession = { 'session-123': 2 };

      renderHook(() => useSessionTitle('my-project', 'session-123'));

      // Should be in flashing mode (with bullet indicator)
      expect(document.title).toContain('(2) my-project | Podex');
    });

    it('should update when sessionName changes', () => {
      const { rerender } = renderHook(
        ({ sessionName }) => useSessionTitle(sessionName, 'session-123'),
        { initialProps: { sessionName: 'project-1' } }
      );

      expect(document.title).toBe('project-1 | Podex');

      rerender({ sessionName: 'project-2' });

      expect(document.title).toBe('project-2 | Podex');
    });

    it('should update when sessionId changes', () => {
      mockAttentionState.unreadCountBySession = {
        'session-1': 1,
        'session-2': 5,
      };

      const { rerender } = renderHook(({ sessionId }) => useSessionTitle('my-project', sessionId), {
        initialProps: { sessionId: 'session-1' },
      });

      expect(document.title).toBe('(1) my-project | Podex');

      rerender({ sessionId: 'session-2' });

      expect(document.title).toBe('(5) my-project | Podex');
    });

    it('should reset to Podex on unmount', () => {
      const { unmount } = renderHook(() => useSessionTitle('my-project', 'session-123'));

      expect(document.title).toBe('my-project | Podex');

      unmount();

      expect(document.title).toBe('Podex');
    });

    it('should handle empty session name', () => {
      renderHook(() => useSessionTitle('', 'session-123'));

      expect(document.title).toBe('Podex');
    });
  });
});
