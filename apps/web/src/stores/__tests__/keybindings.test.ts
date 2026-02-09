import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useKeybindingsStore, defaultKeybindings, type Keybinding } from '../keybindings';

// Mock the user-config API
vi.mock('@/lib/api/user-config', () => ({
  getUserConfig: vi.fn(),
  updateUserConfig: vi.fn(),
}));

import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

describe('keybindingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state before each test
    useKeybindingsStore.setState({
      keybindings: defaultKeybindings.map((k) => ({ ...k, isDefault: true })),
      customOverrides: {},
      isLoading: false,
      lastSyncedAt: null,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has default keybindings loaded', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      expect(result.current.keybindings.length).toBeGreaterThan(0);
      expect(result.current.keybindings.length).toBe(defaultKeybindings.length);
    });

    it('marks all initial keybindings as default', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      result.current.keybindings.forEach((kb) => {
        expect(kb.isDefault).toBe(true);
      });
    });

    it('has no custom overrides initially', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      expect(result.current.customOverrides).toEqual({});
    });

    it('all standard file commands have bindings', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      const fileCommands = [
        'file.new',
        'file.open',
        'file.save',
        'file.saveAll',
        'file.close',
        'file.closeAll',
      ];

      fileCommands.forEach((cmd) => {
        const binding = result.current.keybindings.find((kb) => kb.command === cmd);
        expect(binding).toBeDefined();
        expect(binding?.keys.length).toBeGreaterThan(0);
      });
    });

    it('all standard editor commands have bindings', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      const editorCommands = [
        'editor.selectAll',
        'editor.cut',
        'editor.copy',
        'editor.paste',
        'editor.undo',
        'editor.redo',
      ];

      editorCommands.forEach((cmd) => {
        const binding = result.current.keybindings.find((kb) => kb.command === cmd);
        expect(binding).toBeDefined();
        expect(binding?.keys.length).toBeGreaterThan(0);
      });
    });
  });

  // ========================================================================
  // Keybinding Registration
  // ========================================================================

  describe('Keybinding Registration', () => {
    describe('updateKeybinding', () => {
      it('updates keybinding with new keys', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.keys).toEqual(['Ctrl+S']);
      });

      it('marks updated keybinding as custom', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.isCustom).toBe(true);
      });

      it('stores custom override in customOverrides', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
        });

        expect(result.current.customOverrides['file.save']).toEqual(['Ctrl+S']);
      });

      it('can override existing custom binding', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
          result.current.updateKeybinding('file.save', ['Alt+S']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.keys).toEqual(['Alt+S']);
        expect(result.current.customOverrides['file.save']).toEqual(['Alt+S']);
      });

      it('supports multiple keys per command', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('search.findNext', ['F3', 'Ctrl+G', 'Cmd+G']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'search.findNext');
        expect(binding?.keys).toEqual(['F3', 'Ctrl+G', 'Cmd+G']);
      });

      it('preserves other keybinding properties', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const originalBinding = result.current.keybindings.find((kb) => kb.id === 'file.save');

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
        });

        const updatedBinding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(updatedBinding?.command).toBe(originalBinding?.command);
        expect(updatedBinding?.label).toBe(originalBinding?.label);
        expect(updatedBinding?.category).toBe(originalBinding?.category);
      });

      it('handles updating non-existent keybinding gracefully', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        expect(() => {
          act(() => {
            result.current.updateKeybinding('non.existent', ['Ctrl+X']);
          });
        }).not.toThrow();
      });

      it('accepts platform-specific modifiers for Mac', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Cmd+S']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.keys).toEqual(['Cmd+S']);
      });

      it('accepts platform-specific modifiers for Windows/Linux', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+S']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.keys).toEqual(['Ctrl+S']);
      });

      it('supports chord keybindings', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.closeAll', ['Cmd+K Cmd+W']);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.closeAll');
        expect(binding?.keys).toContain('Cmd+K Cmd+W');
      });
    });

    describe('addCustomKeybinding', () => {
      it('adds new custom keybinding', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const customBinding: Keybinding = {
          id: 'custom.command',
          command: 'custom.command',
          label: 'Custom Command',
          category: 'Custom',
          keys: ['Ctrl+Shift+X'],
        };

        act(() => {
          result.current.addCustomKeybinding(customBinding);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'custom.command');
        expect(binding).toBeDefined();
        expect(binding?.keys).toEqual(['Ctrl+Shift+X']);
      });

      it('marks added keybinding as custom', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const customBinding: Keybinding = {
          id: 'custom.command',
          command: 'custom.command',
          label: 'Custom Command',
          category: 'Custom',
          keys: ['Ctrl+X'],
        };

        act(() => {
          result.current.addCustomKeybinding(customBinding);
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'custom.command');
        expect(binding?.isCustom).toBe(true);
      });
    });

    describe('removeCustomKeybinding', () => {
      it('removes custom keybinding', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const customBinding: Keybinding = {
          id: 'custom.command',
          command: 'custom.command',
          label: 'Custom Command',
          category: 'Custom',
          keys: ['Ctrl+X'],
        };

        act(() => {
          result.current.addCustomKeybinding(customBinding);
          result.current.removeCustomKeybinding('custom.command');
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'custom.command');
        expect(binding).toBeUndefined();
      });

      it('does not remove default keybindings', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const initialCount = result.current.keybindings.length;

        act(() => {
          result.current.removeCustomKeybinding('file.save');
        });

        expect(result.current.keybindings.length).toBe(initialCount);
        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding).toBeDefined();
      });

      it('handles removing non-existent keybinding gracefully', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        expect(() => {
          act(() => {
            result.current.removeCustomKeybinding('non.existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Keybinding Customization
  // ========================================================================

  describe('Keybinding Customization', () => {
    describe('resetKeybinding', () => {
      it('resets customized keybinding to default', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const defaultBinding = defaultKeybindings.find((kb) => kb.id === 'file.save');

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.resetKeybinding('file.save');
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.keys).toEqual(defaultBinding?.keys);
      });

      it('marks reset keybinding as default', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.resetKeybinding('file.save');
        });

        const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        expect(binding?.isDefault).toBe(true);
        expect(binding?.isCustom).toBe(false);
      });

      it('removes override from customOverrides', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.resetKeybinding('file.save');
        });

        expect(result.current.customOverrides['file.save']).toBeUndefined();
      });

      it('only resets specified keybinding', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.updateKeybinding('file.open', ['Ctrl+Y']);
          result.current.resetKeybinding('file.save');
        });

        const saveBinding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        const openBinding = result.current.keybindings.find((kb) => kb.id === 'file.open');

        expect(saveBinding?.isCustom).toBe(false);
        expect(openBinding?.isCustom).toBe(true);
      });

      it('handles resetting non-existent keybinding gracefully', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        expect(() => {
          act(() => {
            result.current.resetKeybinding('non.existent');
          });
        }).not.toThrow();
      });

      it('handles resetting already default keybinding gracefully', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        expect(() => {
          act(() => {
            result.current.resetKeybinding('file.save');
          });
        }).not.toThrow();
      });
    });

    describe('resetAll', () => {
      it('resets all keybindings to defaults', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.updateKeybinding('file.open', ['Ctrl+Y']);
          result.current.updateKeybinding('editor.copy', ['Ctrl+Z']);
          result.current.resetAll();
        });

        result.current.keybindings.forEach((kb) => {
          const defaultBinding = defaultKeybindings.find((db) => db.id === kb.id);
          if (defaultBinding) {
            expect(kb.keys).toEqual(defaultBinding.keys);
          }
        });
      });

      it('marks all keybindings as default after reset', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.resetAll();
        });

        result.current.keybindings.forEach((kb) => {
          expect(kb.isDefault).toBe(true);
        });
      });

      it('clears all custom overrides', () => {
        const { result } = renderHook(() => useKeybindingsStore());

        act(() => {
          result.current.updateKeybinding('file.save', ['Ctrl+X']);
          result.current.updateKeybinding('file.open', ['Ctrl+Y']);
          result.current.resetAll();
        });

        expect(result.current.customOverrides).toEqual({});
      });

      it('removes custom keybindings', () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const customBinding: Keybinding = {
          id: 'custom.command',
          command: 'custom.command',
          label: 'Custom Command',
          category: 'Custom',
          keys: ['Ctrl+X'],
        };

        act(() => {
          result.current.addCustomKeybinding(customBinding);
          result.current.resetAll();
        });

        expect(result.current.keybindings.length).toBe(defaultKeybindings.length);
        const binding = result.current.keybindings.find((kb) => kb.id === 'custom.command');
        expect(binding).toBeUndefined();
      });
    });
  });

  // ========================================================================
  // Server Sync
  // ========================================================================

  describe('Server Synchronization', () => {
    describe('loadFromServer', () => {
      it('loads keybindings from server', async () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const serverOverrides = {
          'file.save': ['Ctrl+S'],
          'file.open': ['Ctrl+O'],
        };

        vi.mocked(getUserConfig).mockResolvedValue({
          custom_keybindings: serverOverrides,
        });

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.customOverrides).toEqual(serverOverrides);
      });

      it('merges server overrides with defaults', async () => {
        const { result } = renderHook(() => useKeybindingsStore());
        const serverOverrides = {
          'file.save': ['Ctrl+S'],
        };

        vi.mocked(getUserConfig).mockResolvedValue({
          custom_keybindings: serverOverrides,
        });

        await act(async () => {
          await result.current.loadFromServer();
        });

        const saveBinding = result.current.keybindings.find((kb) => kb.id === 'file.save');
        const openBinding = result.current.keybindings.find((kb) => kb.id === 'file.open');

        expect(saveBinding?.keys).toEqual(['Ctrl+S']);
        expect(saveBinding?.isCustom).toBe(true);
        expect(openBinding?.isDefault).toBe(true);
      });

      it('sets loading state during load', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(getUserConfig).mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
        );

        let loadPromise: Promise<void>;

        // Start the load inside act
        act(() => {
          loadPromise = result.current.loadFromServer();
        });

        // The loading state should be set immediately
        expect(result.current.isLoading).toBe(true);

        // Wait for the promise to complete
        await act(async () => {
          await loadPromise;
        });

        expect(result.current.isLoading).toBe(false);
      });

      it('updates lastSyncedAt timestamp', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(getUserConfig).mockResolvedValue({});

        const beforeSync = Date.now();

        await act(async () => {
          await result.current?.loadFromServer();
        });

        expect(result.current?.lastSyncedAt).toBeGreaterThanOrEqual(beforeSync);
      });

      it('handles null config from server (not authenticated)', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(getUserConfig).mockResolvedValue(null);

        await act(async () => {
          await result.current?.loadFromServer();
        });

        expect(result.current?.isLoading).toBe(false);
      });

      it('handles server error gracefully', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(getUserConfig).mockRejectedValue(new Error('Server error'));

        await act(async () => {
          await result.current?.loadFromServer();
        });

        expect(result.current?.isLoading).toBe(false);
      });
    });

    describe('syncToServer', () => {
      it('syncs custom overrides to server', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(updateUserConfig).mockResolvedValue({});

        act(() => {
          result.current?.updateKeybinding('file.save', ['Ctrl+S']);
        });

        await act(async () => {
          await result.current?.syncToServer();
        });

        expect(updateUserConfig).toHaveBeenCalledWith({
          custom_keybindings: {
            'file.save': ['Ctrl+S'],
          },
        });
      });

      it('updates lastSyncedAt timestamp on successful sync', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(updateUserConfig).mockResolvedValue({});

        const beforeSync = Date.now();

        await act(async () => {
          await result.current?.syncToServer();
        });

        expect(result.current?.lastSyncedAt).toBeGreaterThanOrEqual(beforeSync);
      });

      it('handles null response (not authenticated)', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        vi.mocked(updateUserConfig).mockResolvedValue(null);

        await act(async () => {
          await result.current?.syncToServer();
        });

        // Test passes if no error was thrown
        expect(result.current).toBeTruthy();
      });

      it('handles 401 auth error silently', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        const authError = new Error('Unauthorized');
        (authError as any).status = 401;
        vi.mocked(updateUserConfig).mockRejectedValue(authError);

        await act(async () => {
          await result.current?.syncToServer();
        });

        // Test passes if no error was thrown
        expect(result.current).toBeTruthy();
      });

      it('handles 403 auth error silently', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        const authError = new Error('Forbidden');
        (authError as any).status = 403;
        vi.mocked(updateUserConfig).mockRejectedValue(authError);

        await act(async () => {
          await result.current?.syncToServer();
        });

        // Test passes if no error was thrown
        expect(result.current).toBeTruthy();
      });

      it('handles 503 network error silently', async () => {
        const { result } = renderHook(() => useKeybindingsStore());

        const networkError = new Error('Service Unavailable');
        (networkError as any).status = 503;
        vi.mocked(updateUserConfig).mockRejectedValue(networkError);

        await act(async () => {
          await result.current?.syncToServer();
        });

        // Test passes if no error was thrown
        expect(result.current).toBeTruthy();
      });
    });
  });

  // ========================================================================
  // Context-specific Keybindings
  // ========================================================================

  describe('Context-specific Keybindings', () => {
    it('includes keybindings with when clause', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const contextBinding = result.current.keybindings.find(
        (kb) => kb.id === 'agent.acceptSuggestion'
      );
      expect(contextBinding).toBeDefined();
      expect(contextBinding?.when).toBe('hasInlineSuggestion');
    });

    it('debug commands have appropriate when clauses', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const debugContinue = result.current.keybindings.find((kb) => kb.id === 'debug.continue');
      expect(debugContinue?.when).toBe('inDebugMode');
    });

    it('preserves when clause after customization', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      act(() => {
        result.current?.updateKeybinding('agent.acceptSuggestion', ['Enter']);
      });

      const binding = result.current?.keybindings.find((kb) => kb.id === 'agent.acceptSuggestion');
      expect(binding?.when).toBe('hasInlineSuggestion');
    });

    it('preserves when clause after reset', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      act(() => {
        result.current?.updateKeybinding('agent.acceptSuggestion', ['Enter']);
        result.current?.resetKeybinding('agent.acceptSuggestion');
      });

      const binding = result.current?.keybindings.find((kb) => kb.id === 'agent.acceptSuggestion');
      expect(binding?.when).toBe('hasInlineSuggestion');
    });
  });

  // ========================================================================
  // Keybinding Categories
  // ========================================================================

  describe('Keybinding Categories', () => {
    it('organizes keybindings by category', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const categories = [...new Set(result.current.keybindings.map((kb) => kb.category))];
      expect(categories).toContain('File');
      expect(categories).toContain('Editor');
      expect(categories).toContain('Navigation');
      expect(categories).toContain('Search');
      expect(categories).toContain('View');
      expect(categories).toContain('Debug');
      expect(categories).toContain('Agent');
    });

    it('all keybindings have a category', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      result.current.keybindings.forEach((kb) => {
        expect(kb.category).toBeDefined();
        expect(kb.category.length).toBeGreaterThan(0);
      });
    });

    it('preserves category after customization', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      const originalBinding = result.current.keybindings.find((kb) => kb.id === 'file.save');

      act(() => {
        result.current.updateKeybinding('file.save', ['Ctrl+S']);
      });

      const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
      expect(binding?.category).toBe(originalBinding?.category);
    });
  });

  // ========================================================================
  // Multiple Keybindings for Same Command
  // ========================================================================

  describe('Multiple Keybindings per Command', () => {
    it('supports multiple keybindings for same command', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      // Find all bindings for command palette
      const commandPaletteBindings = result.current.keybindings.filter(
        (kb) => kb.command === 'nav.commandPalette'
      );

      expect(commandPaletteBindings.length).toBeGreaterThan(1);
    });

    it('each keybinding for same command has unique ID', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const commandPaletteBindings = result.current.keybindings.filter(
        (kb) => kb.command === 'nav.commandPalette'
      );

      const ids = commandPaletteBindings.map((kb) => kb.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it('can customize one binding without affecting other bindings for same command', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const primaryId = 'nav.commandPalette';
      const altId = 'nav.commandPaletteAlt';

      act(() => {
        result.current.updateKeybinding(primaryId, ['Ctrl+Shift+K']);
      });

      const primaryBinding = result.current.keybindings.find((kb) => kb.id === primaryId);
      const altBinding = result.current.keybindings.find((kb) => kb.id === altId);

      expect(primaryBinding?.isCustom).toBe(true);
      expect(altBinding?.isDefault).toBe(true);
    });
  });

  // ========================================================================
  // Special Key Combinations
  // ========================================================================

  describe('Special Key Combinations', () => {
    it('supports function keys', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const f5Binding = result.current.keybindings.find((kb) => kb.keys.includes('F5'));
      expect(f5Binding).toBeDefined();
    });

    it('supports modifier combinations', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const multiModifier = result.current.keybindings.find((kb) =>
        kb.keys.some((k) => k.includes('Cmd+Alt'))
      );
      expect(multiModifier).toBeDefined();
    });

    it('supports special characters', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      // Backtick for terminal toggle
      const backtickBinding = result.current.keybindings.find((kb) => kb.keys.includes('Cmd+`'));
      expect(backtickBinding).toBeDefined();
    });

    it('supports symbol keys', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      // Backslash for split editor
      const backslashBinding = result.current.keybindings.find((kb) => kb.keys.includes('Cmd+\\'));
      expect(backslashBinding).toBeDefined();
    });

    it('can update to chord keybindings', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      act(() => {
        result.current.updateKeybinding('file.save', ['Cmd+K Cmd+S']);
      });

      const binding = result.current.keybindings.find((kb) => kb.id === 'file.save');
      expect(binding?.keys).toContain('Cmd+K Cmd+S');
    });
  });

  // ========================================================================
  // Keybinding Metadata
  // ========================================================================

  describe('Keybinding Metadata', () => {
    it('all keybindings have labels', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      result.current.keybindings.forEach((kb) => {
        expect(kb.label).toBeDefined();
        expect(kb.label.length).toBeGreaterThan(0);
      });
    });

    it('all keybindings have commands', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      result.current.keybindings.forEach((kb) => {
        expect(kb.command).toBeDefined();
        expect(kb.command.length).toBeGreaterThan(0);
      });
    });

    it('keybinding IDs match commands for default bindings', () => {
      const { result } = renderHook(() => useKeybindingsStore());

      const defaultBindings = result.current.keybindings.filter(
        (kb) => kb.isDefault && !kb.id.includes('Alt')
      );

      defaultBindings.forEach((kb) => {
        expect(kb.id).toBe(kb.command);
      });
    });

    it('preserves all metadata after customization', () => {
      const { result } = renderHook(() => useKeybindingsStore());
      const original = result.current.keybindings.find((kb) => kb.id === 'file.save');

      act(() => {
        result.current.updateKeybinding('file.save', ['Ctrl+S']);
      });

      const updated = result.current.keybindings.find((kb) => kb.id === 'file.save');

      expect(updated?.id).toBe(original?.id);
      expect(updated?.command).toBe(original?.command);
      expect(updated?.label).toBe(original?.label);
      expect(updated?.category).toBe(original?.category);
      expect(updated?.when).toBe(original?.when);
    });
  });
});
