import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorSettingsStore } from '../editorSettings';
import * as userConfigApi from '@/lib/api/user-config';

// Mock the user-config API
vi.mock('@/lib/api/user-config', () => ({
  getUserConfig: vi.fn(),
  updateUserConfig: vi.fn(),
}));

describe('editorSettingsStore', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Reset store to initial/default state before each test
    act(() => {
      useEditorSettingsStore.setState({
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
        isLoading: false,
        lastSyncedAt: null,
      });
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has default font settings', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      expect(result.current.fontFamily).toBe(
        '"Fira Code", "JetBrains Mono", Menlo, Monaco, monospace'
      );
      expect(result.current.fontSize).toBe(14);
      expect(result.current.fontWeight).toBe(400);
      expect(result.current.lineHeight).toBe(1.6);
      expect(result.current.fontLigatures).toBe(true);
    });

    it('has default display settings', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      expect(result.current.wordWrap).toBe('off');
      expect(result.current.lineNumbers).toBe('on');
      expect(result.current.minimap).toBe(true);
      expect(result.current.renderWhitespace).toBe('selection');
    });

    it('has default editing behavior settings', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      expect(result.current.tabSize).toBe(2);
      expect(result.current.insertSpaces).toBe(true);
      expect(result.current.formatOnSave).toBe(true);
      expect(result.current.formatOnPaste).toBe(true);
      expect(result.current.autoIndent).toBe('full');
    });

    it('has default intellisense settings', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      expect(result.current.quickSuggestions).toBe(true);
      expect(result.current.parameterHints).toBe(true);
      expect(result.current.acceptSuggestionOnEnter).toBe('on');
    });

    it('is not loading initially', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.lastSyncedAt).toBeNull();
    });
  });

  // ========================================================================
  // General Settings
  // ========================================================================

  describe('General Settings', () => {
    describe('Font settings', () => {
      it('updates font size', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('fontSize', 16);
        });

        expect(result.current.fontSize).toBe(16);
      });

      it('updates font family', () => {
        const { result } = renderHook(() => useEditorSettingsStore());
        const newFamily = '"Cascadia Code", monospace';

        act(() => {
          result.current.updateSetting('fontFamily', newFamily);
        });

        expect(result.current.fontFamily).toBe(newFamily);
      });

      it('updates font weight', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('fontWeight', 500);
        });

        expect(result.current.fontWeight).toBe(500);
      });

      it('updates line height', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('lineHeight', 1.8);
        });

        expect(result.current.lineHeight).toBe(1.8);
      });

      it('toggles font ligatures', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('fontLigatures', false);
        });

        expect(result.current.fontLigatures).toBe(false);
      });
    });

    describe('Tab and spacing settings', () => {
      it('updates tab size', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('tabSize', 4);
        });

        expect(result.current.tabSize).toBe(4);
      });

      it('toggles insert spaces', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('insertSpaces', false);
        });

        expect(result.current.insertSpaces).toBe(false);
      });
    });

    describe('Display settings', () => {
      it('updates word wrap mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('wordWrap', 'on');
        });

        expect(result.current.wordWrap).toBe('on');
      });

      it('updates line numbers mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('lineNumbers', 'relative');
        });

        expect(result.current.lineNumbers).toBe('relative');
      });

      it('toggles minimap', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('minimap', false);
        });

        expect(result.current.minimap).toBe(false);
      });

      it('updates render whitespace mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('renderWhitespace', 'all');
        });

        expect(result.current.renderWhitespace).toBe('all');
      });
    });
  });

  // ========================================================================
  // Editor Behavior
  // ========================================================================

  describe('Editor Behavior', () => {
    describe('Auto-formatting settings', () => {
      it('toggles format on save', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('formatOnSave', false);
        });

        expect(result.current.formatOnSave).toBe(false);
      });

      it('toggles format on paste', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('formatOnPaste', false);
        });

        expect(result.current.formatOnPaste).toBe(false);
      });

      it('toggles format on type', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('formatOnType', true);
        });

        expect(result.current.formatOnType).toBe(true);
      });
    });

    describe('Auto-completion settings', () => {
      it('toggles quick suggestions', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('quickSuggestions', false);
        });

        expect(result.current.quickSuggestions).toBe(false);
      });

      it('toggles suggest on trigger characters', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('suggestOnTriggerCharacters', false);
        });

        expect(result.current.suggestOnTriggerCharacters).toBe(false);
      });

      it('updates accept suggestion on enter mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('acceptSuggestionOnEnter', 'smart');
        });

        expect(result.current.acceptSuggestionOnEnter).toBe('smart');
      });

      it('toggles parameter hints', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('parameterHints', false);
        });

        expect(result.current.parameterHints).toBe(false);
      });
    });

    describe('Auto-closing settings', () => {
      it('updates auto closing brackets mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('autoClosingBrackets', 'never');
        });

        expect(result.current.autoClosingBrackets).toBe('never');
      });

      it('updates auto closing quotes mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('autoClosingQuotes', 'always');
        });

        expect(result.current.autoClosingQuotes).toBe('always');
      });
    });

    describe('Cursor settings', () => {
      it('updates cursor style', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('cursorStyle', 'block');
        });

        expect(result.current.cursorStyle).toBe('block');
      });

      it('updates cursor blinking mode', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('cursorBlinking', 'blink');
        });

        expect(result.current.cursorBlinking).toBe('blink');
      });
    });

    describe('Scrolling settings', () => {
      it('toggles smooth scrolling', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('smoothScrolling', false);
        });

        expect(result.current.smoothScrolling).toBe(false);
      });

      it('toggles scroll beyond last line', () => {
        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('scrollBeyondLastLine', false);
        });

        expect(result.current.scrollBeyondLastLine).toBe(false);
      });
    });
  });

  // ========================================================================
  // Complex Settings Operations
  // ========================================================================

  describe('Complex Settings Operations', () => {
    it('updates multiple settings independently', () => {
      const { result } = renderHook(() => useEditorSettingsStore());

      act(() => {
        result.current.updateSetting('fontSize', 18);
        result.current.updateSetting('tabSize', 4);
        result.current.updateSetting('minimap', false);
      });

      expect(result.current.fontSize).toBe(18);
      expect(result.current.tabSize).toBe(4);
      expect(result.current.minimap).toBe(false);
    });

    it('preserves other settings when updating one', () => {
      const { result } = renderHook(() => useEditorSettingsStore());
      const originalFamily = result.current.fontFamily;
      const originalTabSize = result.current.tabSize;

      act(() => {
        result.current.updateSetting('fontSize', 20);
      });

      expect(result.current.fontFamily).toBe(originalFamily);
      expect(result.current.tabSize).toBe(originalTabSize);
    });

    it('resets to default settings', () => {
      const { result } = renderHook(() => useEditorSettingsStore());

      // Modify multiple settings
      act(() => {
        result.current.updateSetting('fontSize', 20);
        result.current.updateSetting('tabSize', 4);
        result.current.updateSetting('minimap', false);
      });

      // Reset to defaults
      act(() => {
        result.current.resetToDefaults();
      });

      expect(result.current.fontSize).toBe(14);
      expect(result.current.tabSize).toBe(2);
      expect(result.current.minimap).toBe(true);
    });

    it('resets all settings including nested ones', () => {
      const { result } = renderHook(() => useEditorSettingsStore());

      // Modify various settings
      act(() => {
        result.current.updateSetting('wordWrap', 'on');
        result.current.updateSetting('lineNumbers', 'relative');
        result.current.updateSetting('cursorStyle', 'block');
        result.current.updateSetting('formatOnSave', false);
      });

      // Reset to defaults
      act(() => {
        result.current.resetToDefaults();
      });

      expect(result.current.wordWrap).toBe('off');
      expect(result.current.lineNumbers).toBe('on');
      expect(result.current.cursorStyle).toBe('line');
      expect(result.current.formatOnSave).toBe(true);
    });
  });

  // ========================================================================
  // Settings Persistence
  // ========================================================================

  describe('Settings Persistence', () => {
    describe('syncToServer', () => {
      it('syncs settings to server', async () => {
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        expect(userConfigApi.updateUserConfig).toHaveBeenCalledWith({
          editor_settings: expect.objectContaining({
            fontSize: 14,
            tabSize: 2,
            minimap: true,
          }),
        });
      });

      it('updates lastSyncedAt after successful sync', async () => {
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        expect(result.current.lastSyncedAt).not.toBeNull();
        expect(result.current.lastSyncedAt).toBeGreaterThan(0);
      });

      it('does not include store methods in sync payload', async () => {
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        const callArgs = vi.mocked(userConfigApi.updateUserConfig).mock.calls[0][0];
        expect(callArgs.editor_settings).not.toHaveProperty('updateSetting');
        expect(callArgs.editor_settings).not.toHaveProperty('resetToDefaults');
        expect(callArgs.editor_settings).not.toHaveProperty('loadFromServer');
        expect(callArgs.editor_settings).not.toHaveProperty('syncToServer');
        expect(callArgs.editor_settings).not.toHaveProperty('isLoading');
        expect(callArgs.editor_settings).not.toHaveProperty('lastSyncedAt');
      });

      it('handles sync error gracefully for unauthenticated users', async () => {
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(null);

        const { result } = renderHook(() => useEditorSettingsStore());

        await expect(
          act(async () => {
            await result.current.syncToServer();
          })
        ).resolves.not.toThrow();

        expect(result.current.lastSyncedAt).toBeNull();
      });

      it('handles 401 error silently', async () => {
        const error = new Error('Unauthorized');
        (error as any).status = 401;
        vi.mocked(userConfigApi.updateUserConfig).mockRejectedValue(error);

        const { result } = renderHook(() => useEditorSettingsStore());

        await expect(
          act(async () => {
            await result.current.syncToServer();
          })
        ).resolves.not.toThrow();
      });

      it('handles 503 error silently', async () => {
        const error = new Error('Service Unavailable');
        (error as any).status = 503;
        vi.mocked(userConfigApi.updateUserConfig).mockRejectedValue(error);

        const { result } = renderHook(() => useEditorSettingsStore());

        await expect(
          act(async () => {
            await result.current.syncToServer();
          })
        ).resolves.not.toThrow();
      });
    });

    describe('loadFromServer', () => {
      it('loads settings from server', async () => {
        const serverSettings = {
          fontSize: 18,
          tabSize: 4,
          minimap: false,
          formatOnSave: false,
        };
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: serverSettings,
        };
        vi.mocked(userConfigApi.getUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.fontSize).toBe(18);
        expect(result.current.tabSize).toBe(4);
        expect(result.current.minimap).toBe(false);
        expect(result.current.formatOnSave).toBe(false);
      });

      it('merges server settings with defaults', async () => {
        const serverSettings = {
          fontSize: 18, // Override default
          // tabSize not provided, should use default
        };
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: serverSettings,
        };
        vi.mocked(userConfigApi.getUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.fontSize).toBe(18);
        expect(result.current.tabSize).toBe(2); // Default value
      });

      it('sets loading state during load', async () => {
        let resolvePromise: (value: any) => void;
        const promise = new Promise((resolve) => {
          resolvePromise = resolve;
        });
        vi.mocked(userConfigApi.getUserConfig).mockReturnValue(promise as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.loadFromServer();
        });

        expect(result.current.isLoading).toBe(true);

        await act(async () => {
          resolvePromise!({
            id: 'config-1',
            user_id: 'user-1',
            editor_settings: {},
          });
          await promise;
        });

        expect(result.current.isLoading).toBe(false);
      });

      it('updates lastSyncedAt after successful load', async () => {
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.getUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.lastSyncedAt).not.toBeNull();
      });

      it('handles null config from server gracefully', async () => {
        vi.mocked(userConfigApi.getUserConfig).mockResolvedValue(null);

        const { result } = renderHook(() => useEditorSettingsStore());
        const originalFontSize = result.current.fontSize;

        await act(async () => {
          await result.current.loadFromServer();
        });

        // Should maintain default values
        expect(result.current.fontSize).toBe(originalFontSize);
        expect(result.current.isLoading).toBe(false);
      });

      it('handles load error gracefully', async () => {
        vi.mocked(userConfigApi.getUserConfig).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useEditorSettingsStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.isLoading).toBe(false);
      });
    });

    describe('Debounced sync on setting update', () => {
      it('triggers debounced sync after updating setting', async () => {
        vi.useFakeTimers();
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('fontSize', 18);
        });

        // Sync should not happen immediately
        expect(userConfigApi.updateUserConfig).not.toHaveBeenCalled();

        // Fast-forward time to trigger debounced sync
        act(() => {
          vi.advanceTimersByTime(500);
        });

        // Switch to real timers and wait for async operations
        vi.useRealTimers();
        await waitFor(() => {
          expect(userConfigApi.updateUserConfig).toHaveBeenCalled();
        });
      });

      it('debounces multiple rapid updates', async () => {
        vi.useFakeTimers();
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.updateSetting('fontSize', 16);
          result.current.updateSetting('fontSize', 18);
          result.current.updateSetting('fontSize', 20);
        });

        // Fast-forward time
        act(() => {
          vi.advanceTimersByTime(500);
        });

        // Switch to real timers and wait for async operations
        vi.useRealTimers();
        await waitFor(() => {
          // Should only sync once despite multiple updates
          expect(userConfigApi.updateUserConfig).toHaveBeenCalledTimes(1);
        });
      });

      it('triggers debounced sync after reset', async () => {
        vi.useFakeTimers();
        const mockConfig = {
          id: 'config-1',
          user_id: 'user-1',
          editor_settings: {},
        };
        vi.mocked(userConfigApi.updateUserConfig).mockResolvedValue(mockConfig as any);

        const { result } = renderHook(() => useEditorSettingsStore());

        act(() => {
          result.current.resetToDefaults();
        });

        // Fast-forward time
        act(() => {
          vi.advanceTimersByTime(500);
        });

        // Switch to real timers and wait for async operations
        vi.useRealTimers();
        await waitFor(() => {
          expect(userConfigApi.updateUserConfig).toHaveBeenCalled();
        });
      });
    });
  });
});
