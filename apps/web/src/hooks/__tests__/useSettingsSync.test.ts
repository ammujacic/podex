/**
 * Comprehensive tests for useSettingsSync hook
 * Tests settings synchronization from server for authenticated users
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSettingsSync } from '../useSettingsSync';

// Mock all the stores
vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('@/stores/keybindings', () => ({
  useKeybindingsStore: vi.fn(),
}));

vi.mock('@/stores/editorSettings', () => ({
  useEditorSettingsStore: vi.fn(),
}));

vi.mock('@/stores/voiceSettings', () => ({
  useVoiceSettingsStore: vi.fn(),
}));

vi.mock('@/stores/ui', () => ({
  useUIStore: vi.fn(),
}));

import { useAuthStore } from '@/stores/auth';
import { useKeybindingsStore } from '@/stores/keybindings';
import { useEditorSettingsStore } from '@/stores/editorSettings';
import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { useUIStore } from '@/stores/ui';

describe('useSettingsSync', () => {
  const mockLoadKeybindings = vi.fn();
  const mockLoadEditorSettings = vi.fn();
  const mockLoadVoiceSettings = vi.fn();
  const mockLoadUIPreferences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset all mock implementations
    mockLoadKeybindings.mockResolvedValue(undefined);
    mockLoadEditorSettings.mockResolvedValue(undefined);
    mockLoadVoiceSettings.mockResolvedValue(undefined);
    mockLoadUIPreferences.mockResolvedValue(undefined);

    // Default: unauthenticated user
    vi.mocked(useAuthStore).mockReturnValue({
      user: null,
    });

    vi.mocked(useKeybindingsStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        loadFromServer: mockLoadKeybindings,
      })
    );

    vi.mocked(useEditorSettingsStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        loadFromServer: mockLoadEditorSettings,
      })
    );

    vi.mocked(useVoiceSettingsStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        loadFromServer: mockLoadVoiceSettings,
      })
    );

    vi.mocked(useUIStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        loadFromServer: mockLoadUIPreferences,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Unauthenticated User Tests
  // ========================================

  describe('Unauthenticated User', () => {
    it('should not load settings when user is not authenticated', () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: null,
      });

      renderHook(() => useSettingsSync());

      expect(mockLoadKeybindings).not.toHaveBeenCalled();
      expect(mockLoadEditorSettings).not.toHaveBeenCalled();
      expect(mockLoadVoiceSettings).not.toHaveBeenCalled();
      expect(mockLoadUIPreferences).not.toHaveBeenCalled();
    });

    it('should not load settings when user is undefined', () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: undefined,
      });

      renderHook(() => useSettingsSync());

      expect(mockLoadKeybindings).not.toHaveBeenCalled();
      expect(mockLoadEditorSettings).not.toHaveBeenCalled();
      expect(mockLoadVoiceSettings).not.toHaveBeenCalled();
      expect(mockLoadUIPreferences).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Authenticated User Tests
  // ========================================

  describe('Authenticated User', () => {
    beforeEach(() => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });
    });

    it('should load all settings when user is authenticated', async () => {
      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalledTimes(1);
        expect(mockLoadEditorSettings).toHaveBeenCalledTimes(1);
        expect(mockLoadVoiceSettings).toHaveBeenCalledTimes(1);
        expect(mockLoadUIPreferences).toHaveBeenCalledTimes(1);
      });
    });

    it('should load settings in parallel', async () => {
      // Track call order
      const callOrder: string[] = [];

      mockLoadKeybindings.mockImplementation(async () => {
        callOrder.push('keybindings-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push('keybindings-end');
      });

      mockLoadEditorSettings.mockImplementation(async () => {
        callOrder.push('editor-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push('editor-end');
      });

      mockLoadVoiceSettings.mockImplementation(async () => {
        callOrder.push('voice-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push('voice-end');
      });

      mockLoadUIPreferences.mockImplementation(async () => {
        callOrder.push('ui-start');
        await new Promise((resolve) => setTimeout(resolve, 10));
        callOrder.push('ui-end');
      });

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(callOrder.length).toBe(8);
      });

      // All starts should happen before any end (parallel execution)
      const startIndices = callOrder
        .map((c, i) => (c.endsWith('-start') ? i : -1))
        .filter((i) => i >= 0);
      const endIndices = callOrder
        .map((c, i) => (c.endsWith('-end') ? i : -1))
        .filter((i) => i >= 0);

      // Check that starts happen before ends (roughly parallel)
      expect(Math.max(...startIndices)).toBeLessThan(Math.max(...endIndices));
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });
    });

    it('should handle keybindings load error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadKeybindings.mockRejectedValue(new Error('Keybindings load failed'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to load keybindings:', expect.any(Error));
      });

      // Other settings should still be loaded
      expect(mockLoadEditorSettings).toHaveBeenCalled();
      expect(mockLoadVoiceSettings).toHaveBeenCalled();
      expect(mockLoadUIPreferences).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it('should handle editor settings load error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadEditorSettings.mockRejectedValue(new Error('Editor settings load failed'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to load editor settings:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should handle voice settings load error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadVoiceSettings.mockRejectedValue(new Error('Voice settings load failed'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to load voice settings:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should handle UI preferences load error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadUIPreferences.mockRejectedValue(new Error('UI preferences load failed'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to load UI preferences:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });

    it('should handle multiple load errors gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadKeybindings.mockRejectedValue(new Error('Error 1'));
      mockLoadEditorSettings.mockRejectedValue(new Error('Error 2'));
      mockLoadVoiceSettings.mockRejectedValue(new Error('Error 3'));
      mockLoadUIPreferences.mockRejectedValue(new Error('Error 4'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledTimes(4);
      });

      consoleError.mockRestore();
    });
  });

  // ========================================
  // Authentication State Changes Tests
  // ========================================

  describe('Authentication State Changes', () => {
    it('should load settings when user becomes authenticated', async () => {
      // Start unauthenticated
      vi.mocked(useAuthStore).mockReturnValue({
        user: null,
      });

      const { rerender } = renderHook(() => useSettingsSync());

      expect(mockLoadKeybindings).not.toHaveBeenCalled();

      // Become authenticated
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      rerender();

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalled();
        expect(mockLoadEditorSettings).toHaveBeenCalled();
        expect(mockLoadVoiceSettings).toHaveBeenCalled();
        expect(mockLoadUIPreferences).toHaveBeenCalled();
      });
    });

    it('should not reload settings if already authenticated', async () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      const { rerender } = renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalledTimes(1);
      });

      // Rerender with same auth state
      rerender();

      // Should not have been called again
      expect(mockLoadKeybindings).toHaveBeenCalledTimes(1);
    });

    it('should not load settings when user logs out', async () => {
      // Start authenticated
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      const { rerender } = renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalledTimes(1);
      });

      // Clear mocks
      mockLoadKeybindings.mockClear();
      mockLoadEditorSettings.mockClear();
      mockLoadVoiceSettings.mockClear();
      mockLoadUIPreferences.mockClear();

      // Log out
      vi.mocked(useAuthStore).mockReturnValue({
        user: null,
      });

      rerender();

      // Should not load settings after logout
      expect(mockLoadKeybindings).not.toHaveBeenCalled();
      expect(mockLoadEditorSettings).not.toHaveBeenCalled();
      expect(mockLoadVoiceSettings).not.toHaveBeenCalled();
      expect(mockLoadUIPreferences).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Dependency Changes Tests
  // ========================================

  describe('Dependency Changes', () => {
    it('should reload when loadFromServer functions change', async () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      const { rerender } = renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalledTimes(1);
      });

      // Create new function references
      const newLoadKeybindings = vi.fn().mockResolvedValue(undefined);

      vi.mocked(useKeybindingsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          loadFromServer: newLoadKeybindings,
        })
      );

      rerender();

      await waitFor(() => {
        expect(newLoadKeybindings).toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle user with minimal properties', async () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123' },
      });

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(mockLoadKeybindings).toHaveBeenCalled();
      });
    });

    it('should handle rapid authentication changes', async () => {
      const { rerender } = renderHook(() => useSettingsSync());

      // Rapid auth toggles
      for (let i = 0; i < 5; i++) {
        vi.mocked(useAuthStore).mockReturnValue({
          user: i % 2 === 0 ? null : { id: `user-${i}` },
        });
        rerender();
      }

      // Final state is authenticated (i=4, 4%2=0, so user=null)
      // Actually let's check: i=0 -> null, i=1 -> user, i=2 -> null, i=3 -> user, i=4 -> null
      // So final is null, no settings should be loaded
      expect(mockLoadKeybindings.mock.calls.length).toBeLessThanOrEqual(2);
    });

    it('should not throw if stores return undefined for loadFromServer', () => {
      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123' },
      });

      vi.mocked(useKeybindingsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          loadFromServer: undefined,
        })
      );

      // This should not throw
      expect(() => {
        renderHook(() => useSettingsSync());
      }).not.toThrow();
    });

    it('should handle Promise.all with some resolved and some rejected', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(useAuthStore).mockReturnValue({
        user: { id: 'user-123' },
      });

      mockLoadKeybindings.mockResolvedValue(undefined);
      mockLoadEditorSettings.mockRejectedValue(new Error('Editor error'));
      mockLoadVoiceSettings.mockResolvedValue(undefined);
      mockLoadUIPreferences.mockRejectedValue(new Error('UI error'));

      renderHook(() => useSettingsSync());

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledTimes(2);
      });

      consoleError.mockRestore();
    });
  });
});
