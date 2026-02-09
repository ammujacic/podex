/**
 * Tests for useNotificationSound hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotificationSound } from '../useNotificationSound';
import { api } from '@/lib/api';

const mockPlay = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({});
  // Audio must be a constructor (class) for `new Audio()` to work
  class MockAudio {
    play = mockPlay;
    pause = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    currentTime = 0;
    volume = 0.5;
  }
  vi.stubGlobal('Audio', MockAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useNotificationSound', () => {
  it('returns playSound and showDesktopNotification', async () => {
    const { result } = renderHook(() => useNotificationSound());

    await waitFor(() => {
      expect(result.current).toHaveProperty('playSound');
      expect(result.current).toHaveProperty('showDesktopNotification');
      expect(typeof result.current.playSound).toBe('function');
      expect(typeof result.current.showDesktopNotification).toBe('function');
    });
  });

  it('playSound calls Audio play when sound is enabled', async () => {
    const { result } = renderHook(() => useNotificationSound());

    await waitFor(() => {
      expect(result.current.playSound).toBeDefined();
    });

    act(() => {
      result.current.playSound();
    });

    expect(mockPlay).toHaveBeenCalled();
  });

  it('loads preferences from api on mount', async () => {
    renderHook(() => useNotificationSound());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/user/config');
    });
  });

  it('handles preference load error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    renderHook(() => useNotificationSound());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
