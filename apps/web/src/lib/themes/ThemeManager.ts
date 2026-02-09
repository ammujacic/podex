import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from './types';
import { themes, podexTheme } from './themes';
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

// ============================================================================
// Theme Store
// ============================================================================

interface ThemeState {
  currentThemeId: string;
  customThemes: Theme[];
  cssVariablesApplied: boolean;
  isLoading: boolean;
  lastSyncedAt: number | null;

  // Computed
  currentTheme: Theme;

  // Actions
  setTheme: (themeId: string) => void;
  addCustomTheme: (theme: Theme) => void;
  removeCustomTheme: (themeId: string) => void;
  updateCustomTheme: (themeId: string, updates: Partial<Theme>) => void;
  applyTheme: (theme: Theme) => void;
  loadFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

// Debounce helper for syncing
let themeSyncTimeout: NodeJS.Timeout | null = null;

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      currentThemeId: 'podex',
      customThemes: [],
      cssVariablesApplied: false,
      isLoading: false,
      lastSyncedAt: null,

      get currentTheme() {
        const state = get();
        const allThemes = [...themes, ...state.customThemes];
        return allThemes.find((t) => t.id === state.currentThemeId) || podexTheme;
      },

      setTheme: (themeId) => {
        const state = get();
        const allThemes = [...themes, ...state.customThemes];
        const theme = allThemes.find((t) => t.id === themeId);
        if (theme) {
          set({ currentThemeId: themeId });
          state.applyTheme(theme);

          // Debounced sync to server (500ms)
          if (themeSyncTimeout) clearTimeout(themeSyncTimeout);
          themeSyncTimeout = setTimeout(() => {
            get().syncToServer().catch(console.error);
          }, 500);
        }
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

          // Load theme from server if it exists and is valid
          if (config.theme) {
            const state = get();
            const allThemes = [...themes, ...state.customThemes];
            const theme = allThemes.find((t) => t.id === config.theme);
            if (theme) {
              set({ currentThemeId: config.theme, lastSyncedAt: Date.now() });
              applyThemeToCss(theme);
            }
          }

          set({ isLoading: false });
        } catch (error) {
          console.error('Failed to load theme from server:', error);
          set({ isLoading: false });
        }
      },

      syncToServer: async () => {
        const state = get();
        try {
          const result = await updateUserConfig({ theme: state.currentThemeId });
          // If null, user is not authenticated - silently skip
          if (result !== null) {
            set({ lastSyncedAt: Date.now() });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Silently ignore auth errors (401/403) and network errors (503)
          if (error?.status === 401 || error?.status === 403 || error?.status === 503) {
            console.warn('Skipping theme sync - user not authenticated or network error');
            return;
          }
          console.error('Failed to sync theme to server:', error);
        }
      },

      addCustomTheme: (theme) => {
        set((state) => ({
          customThemes: [...state.customThemes, theme],
        }));
      },

      removeCustomTheme: (themeId) => {
        const state = get();
        // If removing current theme, switch to default
        if (state.currentThemeId === themeId) {
          state.setTheme('podex');
        }
        set((state) => ({
          customThemes: state.customThemes.filter((t) => t.id !== themeId),
        }));
      },

      updateCustomTheme: (themeId, updates) => {
        set((state) => ({
          customThemes: state.customThemes.map((t) =>
            t.id === themeId ? { ...t, ...updates } : t
          ),
        }));
        // Re-apply if current
        const state = get();
        if (state.currentThemeId === themeId) {
          const theme = state.customThemes.find((t) => t.id === themeId);
          if (theme) {
            state.applyTheme(theme);
          }
        }
      },

      applyTheme: (theme) => {
        applyThemeToCss(theme);
        set({ cssVariablesApplied: true });
      },
    }),
    {
      name: 'podex-theme',
      partialize: (state) => ({
        currentThemeId: state.currentThemeId,
        customThemes: state.customThemes,
      }),
    }
  )
);

// Load theme from server when store is available
if (typeof window !== 'undefined') {
  // Small delay to ensure store is initialized
  setTimeout(() => {
    useThemeStore.getState().loadFromServer().catch(console.error);
  }, 100);
}

// ============================================================================
// CSS Variable Application
// ============================================================================

function colorToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result || !result[1] || !result[2] || !result[3]) return '0 0 0';
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

export function applyThemeToCss(theme: Theme): void {
  const root = document.documentElement;
  const { colors } = theme;

  // Set data attribute for conditional styling
  root.setAttribute('data-theme', theme.type);
  root.setAttribute('data-theme-id', theme.id);

  // Background colors
  root.style.setProperty('--color-void', colors.void);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-elevated', colors.elevated);
  root.style.setProperty('--color-overlay', colors.overlay);

  // Text colors
  root.style.setProperty('--color-text-primary', colors.textPrimary);
  root.style.setProperty('--color-text-secondary', colors.textSecondary);
  root.style.setProperty('--color-text-muted', colors.textMuted);

  // Border colors
  root.style.setProperty('--color-border-default', colors.borderDefault);
  root.style.setProperty('--color-border-subtle', colors.borderSubtle);

  // Accent colors (with RGB for alpha variants)
  root.style.setProperty('--color-accent-primary', colors.accentPrimary);
  root.style.setProperty('--color-accent-secondary', colors.accentSecondary);
  root.style.setProperty('--color-accent-muted', colors.accentMuted);
  root.style.setProperty('--color-accent-primary-rgb', colorToRgb(colors.accentPrimary));

  // Semantic colors
  root.style.setProperty('--color-success', colors.success);
  root.style.setProperty('--color-warning', colors.warning);
  root.style.setProperty('--color-error', colors.error);
  root.style.setProperty('--color-info', colors.info);

  // Editor colors
  root.style.setProperty('--editor-background', colors.editor.background);
  root.style.setProperty('--editor-foreground', colors.editor.foreground);
  root.style.setProperty('--editor-line-highlight', colors.editor.lineHighlight);
  root.style.setProperty('--editor-selection', colors.editor.selection);
  root.style.setProperty('--editor-cursor', colors.editor.cursor);
  root.style.setProperty('--editor-gutter-background', colors.editor.gutterBackground);
  root.style.setProperty('--editor-gutter-foreground', colors.editor.gutterForeground);
  root.style.setProperty('--editor-line-number', colors.editor.lineNumber);
  root.style.setProperty('--editor-line-number-active', colors.editor.lineNumberActive);

  // Terminal colors
  root.style.setProperty('--terminal-background', colors.terminal.background);
  root.style.setProperty('--terminal-foreground', colors.terminal.foreground);
  root.style.setProperty('--terminal-cursor', colors.terminal.cursor);
  root.style.setProperty('--terminal-black', colors.terminal.black);
  root.style.setProperty('--terminal-red', colors.terminal.red);
  root.style.setProperty('--terminal-green', colors.terminal.green);
  root.style.setProperty('--terminal-yellow', colors.terminal.yellow);
  root.style.setProperty('--terminal-blue', colors.terminal.blue);
  root.style.setProperty('--terminal-magenta', colors.terminal.magenta);
  root.style.setProperty('--terminal-cyan', colors.terminal.cyan);
  root.style.setProperty('--terminal-white', colors.terminal.white);

  // Syntax colors
  root.style.setProperty('--syntax-keyword', colors.syntax.keyword);
  root.style.setProperty('--syntax-string', colors.syntax.string);
  root.style.setProperty('--syntax-number', colors.syntax.number);
  root.style.setProperty('--syntax-comment', colors.syntax.comment);
  root.style.setProperty('--syntax-function', colors.syntax.function);
  root.style.setProperty('--syntax-variable', colors.syntax.variable);
  root.style.setProperty('--syntax-type', colors.syntax.type);
  root.style.setProperty('--syntax-operator', colors.syntax.operator);
  root.style.setProperty('--syntax-property', colors.syntax.property);
  root.style.setProperty('--syntax-punctuation', colors.syntax.punctuation);
  root.style.setProperty('--syntax-class-name', colors.syntax.className);
  root.style.setProperty('--syntax-constant', colors.syntax.constant);
  root.style.setProperty('--syntax-parameter', colors.syntax.parameter);
  root.style.setProperty('--syntax-tag', colors.syntax.tag);
  root.style.setProperty('--syntax-attribute', colors.syntax.attribute);

  // Set Tailwind-compatible CSS variables for common patterns
  root.style.setProperty('--tw-ring-color', colors.accentPrimary);
}

// ============================================================================
// Monaco Theme Definitions
// ============================================================================

export function getMonacoThemeData(theme: Theme): object {
  const { colors } = theme;

  return {
    base: theme.type === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      {
        token: '',
        foreground: colors.editor.foreground.replace('#', ''),
        background: colors.editor.background.replace('#', ''),
      },
      { token: 'comment', foreground: colors.syntax.comment.replace('#', ''), fontStyle: 'italic' },
      { token: 'keyword', foreground: colors.syntax.keyword.replace('#', '') },
      { token: 'string', foreground: colors.syntax.string.replace('#', '') },
      { token: 'number', foreground: colors.syntax.number.replace('#', '') },
      { token: 'type', foreground: colors.syntax.type.replace('#', '') },
      { token: 'class', foreground: colors.syntax.className.replace('#', '') },
      { token: 'function', foreground: colors.syntax.function.replace('#', '') },
      { token: 'variable', foreground: colors.syntax.variable.replace('#', '') },
      { token: 'constant', foreground: colors.syntax.constant.replace('#', '') },
      { token: 'parameter', foreground: colors.syntax.parameter.replace('#', '') },
      { token: 'property', foreground: colors.syntax.property.replace('#', '') },
      { token: 'punctuation', foreground: colors.syntax.punctuation.replace('#', '') },
      { token: 'operator', foreground: colors.syntax.operator.replace('#', '') },
      { token: 'tag', foreground: colors.syntax.tag.replace('#', '') },
      { token: 'attribute.name', foreground: colors.syntax.attribute.replace('#', '') },
      { token: 'attribute.value', foreground: colors.syntax.string.replace('#', '') },
      // TypeScript/JavaScript specific
      { token: 'keyword.control', foreground: colors.syntax.keyword.replace('#', '') },
      { token: 'entity.name.function', foreground: colors.syntax.function.replace('#', '') },
      { token: 'entity.name.type', foreground: colors.syntax.type.replace('#', '') },
      { token: 'entity.name.class', foreground: colors.syntax.className.replace('#', '') },
      { token: 'support.type', foreground: colors.syntax.type.replace('#', '') },
      { token: 'support.function', foreground: colors.syntax.function.replace('#', '') },
    ],
    colors: {
      'editor.background': colors.editor.background,
      'editor.foreground': colors.editor.foreground,
      'editor.lineHighlightBackground': colors.editor.lineHighlight,
      'editor.selectionBackground': colors.editor.selection,
      'editorCursor.foreground': colors.editor.cursor,
      'editorLineNumber.foreground': colors.editor.lineNumber,
      'editorLineNumber.activeForeground': colors.editor.lineNumberActive,
      'editorGutter.background': colors.editor.gutterBackground,
      'editorBracketMatch.background': colors.editor.matchingBracket,
      'editorIndentGuide.background': colors.editor.indentGuide,
      'editorIndentGuide.activeBackground': colors.editor.activeIndentGuide,
      'editor.findMatchBackground': colors.editor.findMatch,
      'editor.findMatchHighlightBackground': colors.editor.findMatchHighlight,
      'editorWidget.background': colors.elevated,
      'editorWidget.border': colors.borderDefault,
      'input.background': colors.surface,
      'input.border': colors.borderDefault,
      'input.foreground': colors.textPrimary,
      'dropdown.background': colors.elevated,
      'dropdown.border': colors.borderDefault,
      'dropdown.foreground': colors.textPrimary,
      'list.hoverBackground': colors.overlay,
      'list.activeSelectionBackground': colors.accentPrimary + '33',
      'list.activeSelectionForeground': colors.textPrimary,
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': colors.overlay,
      'scrollbarSlider.hoverBackground': colors.borderDefault,
      'scrollbarSlider.activeBackground': colors.borderDefault,
    },
  };
}

// ============================================================================
// Initialize Theme on App Load
// ============================================================================

export function initializeTheme(): void {
  const state = useThemeStore.getState();
  const allThemes = [...themes, ...state.customThemes];
  const theme = allThemes.find((t) => t.id === state.currentThemeId) || podexTheme;
  applyThemeToCss(theme);
}

// ============================================================================
// Theme Utilities
// ============================================================================

export function getAllThemes(): Theme[] {
  const state = useThemeStore.getState();
  return [...themes, ...state.customThemes];
}

export function getThemeById(id: string): Theme | undefined {
  return getAllThemes().find((t) => t.id === id);
}

export function getThemePresets() {
  return themes.map((theme) => ({
    id: theme.id,
    name: theme.name,
    type: theme.type,
    preview: {
      background: theme.colors.void,
      accent: theme.colors.accentPrimary,
      foreground: theme.colors.textPrimary,
    },
  }));
}
