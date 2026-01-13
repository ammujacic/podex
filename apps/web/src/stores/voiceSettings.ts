import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

// ============================================================================
// Voice Settings Store
// ============================================================================

// TTS settings aligned with backend voice_defaults schema
export interface VoiceSettings {
  // Text-to-Speech (matches backend voice_defaults)
  tts_enabled: boolean;
  auto_play: boolean;
  voice_id: string | null;
  speed: number;
  language: string;

  // Speech-to-Text (browser-only settings)
  stt_enabled: boolean;
  stt_language: string;
  stt_input_device_id: string | null;
}

const defaultSettings: VoiceSettings = {
  // TTS defaults (matches backend)
  tts_enabled: false,
  auto_play: false,
  voice_id: null,
  speed: 1.0,
  language: 'en-US',

  // STT defaults (browser-only)
  stt_enabled: true,
  stt_language: 'en-US',
  stt_input_device_id: null,
};

interface VoiceSettingsState extends VoiceSettings {
  isLoading: boolean;
  lastSyncedAt: number | null;
  updateSetting: <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => void;
  resetToDefaults: () => void;
  loadFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

// Debounce helper
let voiceSyncTimeout: NodeJS.Timeout | null = null;

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      isLoading: false,
      lastSyncedAt: null,

      updateSetting: (key, value) => {
        set({ [key]: value });

        // Debounced sync to server (500ms)
        if (voiceSyncTimeout) clearTimeout(voiceSyncTimeout);
        voiceSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      resetToDefaults: () => {
        set(defaultSettings);
        if (voiceSyncTimeout) clearTimeout(voiceSyncTimeout);
        voiceSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      loadFromServer: async () => {
        set({ isLoading: true });
        try {
          const config = await getUserConfig();

          // If null (not authenticated), silently use localStorage defaults
          if (!config) {
            set({ isLoading: false });
            return;
          }

          const serverSettings = config.voice_preferences || {};

          set({
            ...defaultSettings,
            ...serverSettings,
            lastSyncedAt: Date.now(),
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load voice settings from server:', error);
          set({ isLoading: false });
        }
      },

      syncToServer: async () => {
        const state = get();
        const {
          isLoading: _isLoading,
          lastSyncedAt: _lastSyncedAt,
          updateSetting: _updateSetting,
          resetToDefaults: _resetToDefaults,
          loadFromServer: _loadFromServer,
          syncToServer: _syncToServer,
          ...settingsToSync
        } = state;

        try {
          const result = await updateUserConfig({ voice_preferences: settingsToSync });
          // If null, user is not authenticated - silently skip
          if (result !== null) {
            set({ lastSyncedAt: Date.now() });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Silently ignore auth errors (401/403) and network errors (503)
          if (error?.status === 401 || error?.status === 403 || error?.status === 503) {
            console.warn('Skipping voice settings sync - user not authenticated or network error');
            return;
          }
          console.error('Failed to sync voice settings to server:', error);
        }
      },
    }),
    {
      name: 'podex-voice-settings',
      partialize: (state) => {
        const {
          isLoading: _isLoading,
          lastSyncedAt: _lastSyncedAt,
          updateSetting: _updateSetting,
          resetToDefaults: _resetToDefaults,
          loadFromServer: _loadFromServer,
          syncToServer: _syncToServer,
          ...settings
        } = state;
        return settings;
      },
    }
  )
);
