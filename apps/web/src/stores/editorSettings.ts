import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  updateSetting: <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => void;
  resetToDefaults: () => void;
}

export const useEditorSettingsStore = create<EditorSettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      updateSetting: (key, value) => set({ [key]: value }),
      resetToDefaults: () => set(defaultSettings),
    }),
    {
      name: 'podex-editor-settings',
    }
  )
);
