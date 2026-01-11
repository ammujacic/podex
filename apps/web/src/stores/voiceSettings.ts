import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  updateSetting: <K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) => void;
  resetToDefaults: () => void;
}

export const useVoiceSettingsStore = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      updateSetting: (key, value) => set({ [key]: value }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'podex-voice-settings',
    }
  )
);
