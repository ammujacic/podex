import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

// ============================================================================
// Editor Settings Store
// ============================================================================

export interface EditorSettings {
  // Font
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  fontLigatures: boolean;

  // Display
  wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  wordWrapColumn: number;
  lineNumbers: 'on' | 'off' | 'relative' | 'interval';
  rulers: number[];
  minimap: boolean;
  minimapScale: number;
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  renderControlCharacters: boolean;
  renderLineHighlight: 'none' | 'gutter' | 'line' | 'all';

  // Editing
  tabSize: number;
  insertSpaces: boolean;
  autoClosingBrackets: 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
  autoClosingQuotes: 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';
  autoIndent: 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
  formatOnPaste: boolean;
  formatOnSave: boolean;
  formatOnType: boolean;

  // Cursor
  cursorStyle: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
  cursorWidth: number;
  cursorSmoothCaretAnimation: 'off' | 'explicit' | 'on';

  // Intellisense
  quickSuggestions: boolean;
  suggestOnTriggerCharacters: boolean;
  acceptSuggestionOnEnter: 'on' | 'smart' | 'off';
  snippetSuggestions: 'top' | 'bottom' | 'inline' | 'none';
  parameterHints: boolean;

  // Scrolling
  smoothScrolling: boolean;
  mouseWheelScrollSensitivity: number;
  fastScrollSensitivity: number;
  scrollBeyondLastLine: boolean;
}

const defaultSettings: EditorSettings = {
  fontFamily: '"Fira Code", "JetBrains Mono", Menlo, Monaco, monospace',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.6,
  fontLigatures: true,

  wordWrap: 'off',
  wordWrapColumn: 80,
  lineNumbers: 'on',
  rulers: [80, 120],
  minimap: true,
  minimapScale: 1,
  renderWhitespace: 'selection',
  renderControlCharacters: false,
  renderLineHighlight: 'all',

  tabSize: 2,
  insertSpaces: true,
  autoClosingBrackets: 'languageDefined',
  autoClosingQuotes: 'languageDefined',
  autoIndent: 'full',
  formatOnPaste: true,
  formatOnSave: true,
  formatOnType: false,

  cursorStyle: 'line',
  cursorBlinking: 'smooth',
  cursorWidth: 2,
  cursorSmoothCaretAnimation: 'on',

  quickSuggestions: true,
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'on',
  snippetSuggestions: 'top',
  parameterHints: true,

  smoothScrolling: true,
  mouseWheelScrollSensitivity: 1,
  fastScrollSensitivity: 5,
  scrollBeyondLastLine: true,
};

interface EditorSettingsState extends EditorSettings {
  isLoading: boolean;
  lastSyncedAt: number | null;
  updateSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  resetToDefaults: () => void;
  loadFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

// Debounce helper
let editorSyncTimeout: NodeJS.Timeout | null = null;

export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      isLoading: false,
      lastSyncedAt: null,

      updateSetting: (key, value) => {
        set({ [key]: value });

        // Debounced sync to server (500ms)
        if (editorSyncTimeout) clearTimeout(editorSyncTimeout);
        editorSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      resetToDefaults: () => {
        set(defaultSettings);
        // Sync to server
        if (editorSyncTimeout) clearTimeout(editorSyncTimeout);
        editorSyncTimeout = setTimeout(() => {
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

          const serverSettings = config.editor_settings || {};

          // Merge server settings with defaults
          set({
            ...defaultSettings,
            ...serverSettings,
            lastSyncedAt: Date.now(),
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load editor settings from server:', error);
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
          const result = await updateUserConfig({ editor_settings: settingsToSync });
          // If null, user is not authenticated - silently skip
          if (result !== null) {
            set({ lastSyncedAt: Date.now() });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Silently ignore auth errors (401/403) and network errors (503)
          if (error?.status === 401 || error?.status === 403 || error?.status === 503) {
            console.warn('Skipping editor settings sync - user not authenticated or network error');
            return;
          }
          console.error('Failed to sync editor settings to server:', error);
        }
      },
    }),
    {
      name: 'podex-editor-settings',
      partialize: (state) => {
        // Exclude loading state and methods from persistence
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
