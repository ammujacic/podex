/**
 * Hook to initialize and sync all user settings from server
 * Should be called once at app root level
 */

import { useEffect } from 'react';
import { useKeybindingsStore } from '@/stores/keybindings';
import { useEditorSettingsStore } from '@/stores/editorSettings';
import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { useUIStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';

export function useSettingsSync() {
  const { user } = useAuthStore();
  const isAuthenticated = !!user;

  const loadKeybindings = useKeybindingsStore((state) => state.loadFromServer);
  const loadEditorSettings = useEditorSettingsStore((state) => state.loadFromServer);
  const loadVoiceSettings = useVoiceSettingsStore((state) => state.loadFromServer);
  const loadUIPreferences = useUIStore((state) => state.loadFromServer);

  useEffect(() => {
    // Only load settings if user is authenticated
    if (!isAuthenticated) return;

    // Load all settings from server in parallel (only if functions exist)
    const loadPromises: Promise<void>[] = [];

    if (typeof loadKeybindings === 'function') {
      loadPromises.push(
        loadKeybindings().catch((err) => console.error('Failed to load keybindings:', err))
      );
    }
    if (typeof loadEditorSettings === 'function') {
      loadPromises.push(
        loadEditorSettings().catch((err) => console.error('Failed to load editor settings:', err))
      );
    }
    if (typeof loadVoiceSettings === 'function') {
      loadPromises.push(
        loadVoiceSettings().catch((err) => console.error('Failed to load voice settings:', err))
      );
    }
    if (typeof loadUIPreferences === 'function') {
      loadPromises.push(
        loadUIPreferences().catch((err) => console.error('Failed to load UI preferences:', err))
      );
    }

    if (loadPromises.length > 0) {
      // Await all settings loads and handle any failures
      Promise.all(loadPromises).catch((err) => {
        console.error('Failed to load some settings:', err);
      });
    }
  }, [isAuthenticated, loadKeybindings, loadEditorSettings, loadVoiceSettings, loadUIPreferences]);
}
