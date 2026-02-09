import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVoiceSettingsStore } from '../voiceSettings';

// Mock API functions
vi.mock('@/lib/api/user-config', () => ({
  getUserConfig: vi.fn(),
  updateUserConfig: vi.fn(),
}));

import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

describe('voiceSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset store to initial state after each test
    act(() => {
      useVoiceSettingsStore.setState(
        {
          tts_enabled: false,
          auto_play: false,
          voice_id: null,
          speed: 1.0,
          language: 'en-US',
          stt_enabled: true,
          stt_language: 'en-US',
          stt_input_device_id: null,
          isLoading: false,
          lastSyncedAt: null,
        },
        false
      ); // false = partial update, preserves methods
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has TTS enabled by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.tts_enabled).toBe(true);
    });

    it('has auto_play disabled by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.auto_play).toBe(false);
    });

    it('has no voice_id selected by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.voice_id).toBeNull();
    });

    it('has default speech rate of 1.0', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.speed).toBe(1.0);
    });

    it('has default language of en-US', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.language).toBe('en-US');
    });

    it('has STT enabled by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.stt_enabled).toBe(true);
    });

    it('has STT language of en-US by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.stt_language).toBe('en-US');
    });

    it('has no STT input device by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.stt_input_device_id).toBeNull();
    });

    it('is not loading by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.isLoading).toBe(false);
    });

    it('has no last sync timestamp by default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());
      expect(result.current.lastSyncedAt).toBeNull();
    });
  });

  // ========================================================================
  // TTS Settings
  // ========================================================================

  describe('TTS Settings', () => {
    it('enables TTS', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('tts_enabled', true);
      });

      expect(result.current.tts_enabled).toBe(true);
    });

    it('disables TTS', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('tts_enabled', true);
        result.current.updateSetting('tts_enabled', false);
      });

      expect(result.current.tts_enabled).toBe(false);
    });

    it('enables auto_play', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('auto_play', true);
      });

      expect(result.current.auto_play).toBe(true);
    });

    it('sets voice_id', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('voice_id', 'voice-123');
      });

      expect(result.current.voice_id).toBe('voice-123');
    });

    it('changes voice_id', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('voice_id', 'voice-1');
        result.current.updateSetting('voice_id', 'voice-2');
      });

      expect(result.current.voice_id).toBe('voice-2');
    });

    it('clears voice_id by setting to null', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('voice_id', 'voice-123');
        result.current.updateSetting('voice_id', null);
      });

      expect(result.current.voice_id).toBeNull();
    });
  });

  // ========================================================================
  // Speech Rate/Pitch/Volume
  // ========================================================================

  describe('Speech Rate', () => {
    it('sets speech rate to slower', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('speed', 0.5);
      });

      expect(result.current.speed).toBe(0.5);
    });

    it('sets speech rate to faster', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('speed', 1.5);
      });

      expect(result.current.speed).toBe(1.5);
    });

    it('resets speech rate to default', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('speed', 2.0);
        result.current.updateSetting('speed', 1.0);
      });

      expect(result.current.speed).toBe(1.0);
    });

    it('handles decimal speech rates', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('speed', 0.75);
      });

      expect(result.current.speed).toBe(0.75);
    });
  });

  // ========================================================================
  // Language Settings
  // ========================================================================

  describe('Language Settings', () => {
    it('changes TTS language', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('language', 'es-ES');
      });

      expect(result.current.language).toBe('es-ES');
    });

    it('changes STT language', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_language', 'fr-FR');
      });

      expect(result.current.stt_language).toBe('fr-FR');
    });

    it('supports multiple language changes', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('language', 'de-DE');
        result.current.updateSetting('language', 'ja-JP');
        result.current.updateSetting('language', 'en-GB');
      });

      expect(result.current.language).toBe('en-GB');
    });

    it('TTS and STT languages are independent', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('language', 'es-ES');
        result.current.updateSetting('stt_language', 'fr-FR');
      });

      expect(result.current.language).toBe('es-ES');
      expect(result.current.stt_language).toBe('fr-FR');
    });
  });

  // ========================================================================
  // STT Settings
  // ========================================================================

  describe('STT Settings', () => {
    it('disables STT', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_enabled', false);
      });

      expect(result.current.stt_enabled).toBe(false);
    });

    it('re-enables STT', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_enabled', false);
        result.current.updateSetting('stt_enabled', true);
      });

      expect(result.current.stt_enabled).toBe(true);
    });

    it('sets STT input device', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_input_device_id', 'device-123');
      });

      expect(result.current.stt_input_device_id).toBe('device-123');
    });

    it('changes STT input device', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_input_device_id', 'device-1');
        result.current.updateSetting('stt_input_device_id', 'device-2');
      });

      expect(result.current.stt_input_device_id).toBe('device-2');
    });

    it('clears STT input device', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_input_device_id', 'device-123');
        result.current.updateSetting('stt_input_device_id', null);
      });

      expect(result.current.stt_input_device_id).toBeNull();
    });
  });

  // ========================================================================
  // Reset to Defaults
  // ========================================================================

  describe('Reset to Defaults', () => {
    it('resets all settings to defaults', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('tts_enabled', true);
        result.current.updateSetting('auto_play', true);
        result.current.updateSetting('voice_id', 'voice-123');
        result.current.updateSetting('speed', 1.5);
        result.current.updateSetting('language', 'es-ES');
        result.current.resetToDefaults();
      });

      expect(result.current.tts_enabled).toBe(true);
      expect(result.current.auto_play).toBe(false);
      expect(result.current.voice_id).toBeNull();
      expect(result.current.speed).toBe(1.0);
      expect(result.current.language).toBe('en-US');
    });

    it('resets STT settings to defaults', () => {
      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('stt_enabled', false);
        result.current.updateSetting('stt_language', 'fr-FR');
        result.current.updateSetting('stt_input_device_id', 'device-123');
        result.current.resetToDefaults();
      });

      expect(result.current.stt_enabled).toBe(true);
      expect(result.current.stt_language).toBe('en-US');
      expect(result.current.stt_input_device_id).toBeNull();
    });
  });

  // ========================================================================
  // Server Sync
  // ========================================================================

  describe('Server Sync', () => {
    it('loads settings from server', async () => {
      vi.mocked(getUserConfig).mockResolvedValue({
        voice_preferences: {
          tts_enabled: true,
          auto_play: true,
          voice_id: 'server-voice',
          speed: 1.2,
          language: 'es-ES',
          stt_enabled: false,
          stt_language: 'fr-FR',
          stt_input_device_id: 'server-device',
        },
      });

      const { result } = renderHook(() => useVoiceSettingsStore());

      await act(async () => {
        await result.current.loadFromServer();
      });

      expect(result.current.tts_enabled).toBe(true);
      expect(result.current.auto_play).toBe(true);
      expect(result.current.voice_id).toBe('server-voice');
      expect(result.current.speed).toBe(1.2);
      expect(result.current.language).toBe('es-ES');
      expect(result.current.stt_enabled).toBe(false);
      expect(result.current.stt_language).toBe('fr-FR');
      expect(result.current.stt_input_device_id).toBe('server-device');
    });

    it('sets loading state during server load', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(getUserConfig).mockReturnValue(promise as Promise<unknown>);

      const { result } = renderHook(() => useVoiceSettingsStore());

      // Start the async operation without awaiting to check loading state
      act(() => {
        result.current.loadFromServer();
      });

      // Check that loading state is true while promise is pending
      expect(result.current.isLoading).toBe(true);

      // Resolve the promise and wait for state updates
      await act(async () => {
        resolvePromise!({ voice_preferences: {} });
        await promise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('handles null response from server (unauthenticated)', async () => {
      vi.mocked(getUserConfig).mockResolvedValue(null);

      const { result } = renderHook(() => useVoiceSettingsStore());

      await act(async () => {
        await result.current.loadFromServer();
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.lastSyncedAt).toBeNull();
    });

    it('handles server load error gracefully', async () => {
      vi.mocked(getUserConfig).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useVoiceSettingsStore());

      await act(async () => {
        await result.current.loadFromServer();
      });

      expect(result.current.isLoading).toBe(false);
    });

    it('syncs settings to server', async () => {
      vi.mocked(updateUserConfig).mockResolvedValue({});

      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('tts_enabled', true);
        result.current.updateSetting('voice_id', 'test-voice');
      });

      await act(async () => {
        await result.current.syncToServer();
      });

      expect(updateUserConfig).toHaveBeenCalledWith({
        voice_preferences: expect.objectContaining({
          tts_enabled: true,
          voice_id: 'test-voice',
        }),
      });
    });

    it('sets lastSyncedAt after successful sync', async () => {
      vi.mocked(updateUserConfig).mockResolvedValue({});

      const { result } = renderHook(() => useVoiceSettingsStore());
      const beforeSync = Date.now();

      await act(async () => {
        await result.current.syncToServer();
      });

      expect(result.current.lastSyncedAt).toBeGreaterThanOrEqual(beforeSync);
    });

    it('handles sync to server when unauthenticated', async () => {
      vi.mocked(updateUserConfig).mockResolvedValue(null);

      const { result } = renderHook(() => useVoiceSettingsStore());

      await act(async () => {
        await result.current.syncToServer();
      });

      expect(result.current.lastSyncedAt).toBeNull();
    });

    it('silently handles auth errors during sync', async () => {
      vi.mocked(updateUserConfig).mockRejectedValue({ status: 401 });

      const { result } = renderHook(() => useVoiceSettingsStore());

      await expect(
        act(async () => {
          await result.current.syncToServer();
        })
      ).resolves.not.toThrow();
    });
  });

  // ========================================================================
  // Debounced Sync
  // ========================================================================

  describe('Debounced Sync', () => {
    it('debounces sync after updateSetting', async () => {
      vi.mocked(updateUserConfig).mockResolvedValue({});

      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.updateSetting('speed', 0.5);
        result.current.updateSetting('speed', 1.0);
        result.current.updateSetting('speed', 1.5);
      });

      // Should not have called yet (debounced)
      expect(updateUserConfig).not.toHaveBeenCalled();

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(updateUserConfig).toHaveBeenCalledTimes(1);
    });

    it('debounces sync after resetToDefaults', async () => {
      vi.mocked(updateUserConfig).mockResolvedValue({});

      const { result } = renderHook(() => useVoiceSettingsStore());

      act(() => {
        result.current.resetToDefaults();
      });

      expect(updateUserConfig).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(updateUserConfig).toHaveBeenCalled();
    });
  });
});
