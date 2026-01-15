/**
 * Hook to initialize and sync all user settings from server
 * Should be called once at app root level
 */

import { useEffect } from 'react';
import { useKeybindingsStore } from '@/stores/keybindings';
import { useEditorSettingsStore } from '@/stores/editorSettings';
import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { useAgentSettingsStore } from '@/stores/agentSettings';
import { useUIStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';

export function useSettingsSync() {
  const { user } = useAuthStore();
  const isAuthenticated = !!user;

  const loadKeybindings = useKeybindingsStore((state) => state.loadFromServer);
  const loadEditorSettings = useEditorSettingsStore((state) => state.loadFromServer);
  const loadVoiceSettings = useVoiceSettingsStore((state) => state.loadFromServer);
  const loadAgentSettings = useAgentSettingsStore((state) => state.loadFromServer);
  const loadUIPreferences = useUIStore((state) => state.loadFromServer);

  useEffect(() => {
    // Only load settings if user is authenticated
    if (!isAuthenticated) return;

    // Load all settings from server in parallel
    Promise.all([
      loadKeybindings().catch((err) => console.error('Failed to load keybindings:', err)),
      loadEditorSettings().catch((err) => console.error('Failed to load editor settings:', err)),
      loadVoiceSettings().catch((err) => console.error('Failed to load voice settings:', err)),
      loadAgentSettings().catch((err) => console.error('Failed to load agent settings:', err)),
      loadUIPreferences().catch((err) => console.error('Failed to load UI preferences:', err)),
    ]);
  }, [
    isAuthenticated,
    loadKeybindings,
    loadEditorSettings,
    loadVoiceSettings,
    loadAgentSettings,
    loadUIPreferences,
  ]);
}
