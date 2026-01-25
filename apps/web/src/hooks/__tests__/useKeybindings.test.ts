/**
 * Comprehensive tests for useKeybindings hooks
 * Tests keyboard shortcut management, command registration, and keybinding lifecycle
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useKeybindings,
  useCommand,
  useKeybindingLabel,
  useExecuteCommand,
} from '../useKeybindings';
import { keybindingManager, defaultKeybindings } from '@/lib/keybindings';
import { useUIStore } from '@/stores/ui';
import { useKeybindingsStore } from '@/stores/keybindings';

// Mock the keybinding manager
vi.mock('@/lib/keybindings', () => ({
  keybindingManager: {
    setContext: vi.fn(),
    clearAllKeybindings: vi.fn(),
    registerKeybindings: vi.fn(),
    registerCommand: vi.fn(),
    unregisterCommand: vi.fn(),
    getKeybindingForCommand: vi.fn(),
    formatKeyForDisplay: vi.fn(),
    executeCommand: vi.fn(),
  },
  defaultKeybindings: [
    { id: 'file.save', key: 'mod+s', command: 'file.save', description: 'Save file' },
    { id: 'nav.quickOpen', key: 'mod+p', command: 'nav.quickOpen', description: 'Quick open' },
  ],
}));

// Create mock UI store functions
const mockToggleQuickOpen = vi.fn();
const mockToggleCommandPalette = vi.fn();
const mockToggleTerminal = vi.fn();
const mockToggleSidebar = vi.fn();
const mockTogglePanel = vi.fn();
const mockOpenModal = vi.fn();

vi.mock('@/stores/ui', () => ({
  useUIStore: vi.fn(() => ({
    toggleQuickOpen: mockToggleQuickOpen,
    toggleCommandPalette: mockToggleCommandPalette,
    toggleTerminal: mockToggleTerminal,
    toggleSidebar: mockToggleSidebar,
    togglePanel: mockTogglePanel,
    openModal: mockOpenModal,
    quickOpenOpen: false,
    commandPaletteOpen: false,
    activeModal: null,
  })),
}));

// Create mock keybindings store
const mockLoadFromServer = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/keybindings', () => ({
  useKeybindingsStore: vi.fn(() => ({
    keybindings: [],
    loadFromServer: mockLoadFromServer,
  })),
}));

describe('useKeybindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should load keybindings from server on mount', async () => {
      renderHook(() => useKeybindings());

      await waitFor(() => {
        expect(mockLoadFromServer).toHaveBeenCalled();
      });
    });

    it('should handle server load error gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLoadFromServer.mockRejectedValueOnce(new Error('Network error'));

      renderHook(() => useKeybindings());

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to load keybindings from server:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('should clear all keybindings before registering', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.clearAllKeybindings).toHaveBeenCalled();
    });

    it('should register default keybindings', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerKeybindings).toHaveBeenCalledWith(defaultKeybindings);
    });
  });

  // ========================================
  // Context Update Tests
  // ========================================

  describe('Context Updates', () => {
    it('should set context when quickOpenOpen changes', () => {
      const { rerender } = renderHook(() => useKeybindings());

      // Initial call
      expect(keybindingManager.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          quickOpenOpen: false,
        })
      );

      // Update mock to return quickOpenOpen: true
      (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        toggleQuickOpen: mockToggleQuickOpen,
        toggleCommandPalette: mockToggleCommandPalette,
        toggleTerminal: mockToggleTerminal,
        toggleSidebar: mockToggleSidebar,
        togglePanel: mockTogglePanel,
        openModal: mockOpenModal,
        quickOpenOpen: true,
        commandPaletteOpen: false,
        activeModal: null,
      });

      rerender();

      expect(keybindingManager.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          quickOpenOpen: true,
        })
      );
    });

    it('should set context when commandPaletteOpen changes', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          commandPaletteOpen: false,
        })
      );
    });

    it('should set modalOpen based on activeModal', () => {
      (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        toggleQuickOpen: mockToggleQuickOpen,
        toggleCommandPalette: mockToggleCommandPalette,
        toggleTerminal: mockToggleTerminal,
        toggleSidebar: mockToggleSidebar,
        togglePanel: mockTogglePanel,
        openModal: mockOpenModal,
        quickOpenOpen: false,
        commandPaletteOpen: false,
        activeModal: 'settings',
      });

      renderHook(() => useKeybindings());

      expect(keybindingManager.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          modalOpen: true,
        })
      );
    });

    it('should set modalOpen to false when activeModal is null', () => {
      // Reset mock to default state with null activeModal
      (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        toggleQuickOpen: mockToggleQuickOpen,
        toggleCommandPalette: mockToggleCommandPalette,
        toggleTerminal: mockToggleTerminal,
        toggleSidebar: mockToggleSidebar,
        togglePanel: mockTogglePanel,
        openModal: mockOpenModal,
        quickOpenOpen: false,
        commandPaletteOpen: false,
        activeModal: null,
      });

      renderHook(() => useKeybindings());

      expect(keybindingManager.setContext).toHaveBeenCalledWith(
        expect.objectContaining({
          modalOpen: false,
        })
      );
    });
  });

  // ========================================
  // User Keybindings Tests
  // ========================================

  describe('User Keybindings', () => {
    it('should register user keybindings after defaults', () => {
      const userKeybindings = [
        {
          id: 'custom.action',
          command: 'custom.action',
          label: 'Custom Action',
          category: 'Custom',
          keys: ['Cmd+Shift+X'],
        },
      ];

      (useKeybindingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        keybindings: userKeybindings,
        loadFromServer: mockLoadFromServer,
      });

      renderHook(() => useKeybindings());

      expect(keybindingManager.registerKeybindings).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'custom.action',
            command: 'custom.action',
          }),
        ])
      );
    });

    it('should normalize key format for user keybindings', () => {
      const userKeybindings = [
        {
          id: 'test.command',
          command: 'test.command',
          label: 'Test',
          category: 'Test',
          keys: ['Cmd+K'],
          when: 'editorFocus',
        },
      ];

      (useKeybindingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        keybindings: userKeybindings,
        loadFromServer: mockLoadFromServer,
      });

      renderHook(() => useKeybindings());

      // Should convert Cmd to mod
      expect(keybindingManager.registerKeybindings).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'mod+k',
          }),
        ])
      );
    });

    it('should handle multi-key bindings', () => {
      const userKeybindings = [
        {
          id: 'chord.command',
          command: 'chord.command',
          label: 'Chord Command',
          category: 'Test',
          keys: ['Cmd+K', 'Cmd+C'],
        },
      ];

      (useKeybindingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        keybindings: userKeybindings,
        loadFromServer: mockLoadFromServer,
      });

      renderHook(() => useKeybindings());

      expect(keybindingManager.registerKeybindings).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'mod+k mod+c',
          }),
        ])
      );
    });
  });

  // ========================================
  // Command Handler Registration Tests
  // ========================================

  describe('Command Handler Registration', () => {
    it('should register quickOpen.toggle command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'quickOpen.toggle',
        mockToggleQuickOpen
      );
    });

    it('should register nav.quickOpen command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'nav.quickOpen',
        mockToggleQuickOpen
      );
    });

    it('should register commandPalette.toggle command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'commandPalette.toggle',
        mockToggleCommandPalette
      );
    });

    it('should register nav.commandPalette command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'nav.commandPalette',
        mockToggleCommandPalette
      );
    });

    it('should register terminal.toggle command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'terminal.toggle',
        mockToggleTerminal
      );
    });

    it('should register view.toggleTerminal command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'view.toggleTerminal',
        mockToggleTerminal
      );
    });

    it('should register sidebar.toggle command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'sidebar.toggle',
        expect.any(Function)
      );
    });

    it('should register sidebar.toggleRight command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'sidebar.toggleRight',
        expect.any(Function)
      );
    });

    it('should register panel.toggle command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'panel.toggle',
        mockTogglePanel
      );
    });

    it('should register file.newFile command', () => {
      renderHook(() => useKeybindings());

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'file.newFile',
        expect.any(Function)
      );
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unregister all commands on unmount', () => {
      const { unmount } = renderHook(() => useKeybindings());

      unmount();

      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('quickOpen.toggle');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('nav.quickOpen');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('commandPalette.toggle');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('nav.commandPalette');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('file.newFile');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('terminal.toggle');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('view.toggleTerminal');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('sidebar.toggle');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('view.toggleSidebar');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('sidebar.toggleRight');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('panel.toggle');
      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('view.togglePanel');
    });
  });

  // ========================================
  // Sidebar Toggle Tests
  // ========================================

  describe('Sidebar Toggle Handlers', () => {
    it('should toggle left sidebar', () => {
      renderHook(() => useKeybindings());

      // Find the sidebar.toggle handler
      const sidebarToggleCall = (
        keybindingManager.registerCommand as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === 'sidebar.toggle');

      expect(sidebarToggleCall).toBeDefined();

      // Call the handler
      const handler = sidebarToggleCall![1];
      handler();

      expect(mockToggleSidebar).toHaveBeenCalledWith('left');
    });

    it('should toggle right sidebar', () => {
      renderHook(() => useKeybindings());

      // Find the sidebar.toggleRight handler
      const sidebarToggleRightCall = (
        keybindingManager.registerCommand as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === 'sidebar.toggleRight');

      expect(sidebarToggleRightCall).toBeDefined();

      // Call the handler
      const handler = sidebarToggleRightCall![1];
      handler();

      expect(mockToggleSidebar).toHaveBeenCalledWith('right');
    });
  });

  // ========================================
  // New File Modal Tests
  // ========================================

  describe('New File Modal Handler', () => {
    it('should open new-file modal', () => {
      renderHook(() => useKeybindings());

      // Find the file.newFile handler
      const newFileCall = (
        keybindingManager.registerCommand as ReturnType<typeof vi.fn>
      ).mock.calls.find((call) => call[0] === 'file.newFile');

      expect(newFileCall).toBeDefined();

      // Call the handler
      const handler = newFileCall![1];
      handler();

      expect(mockOpenModal).toHaveBeenCalledWith('new-file');
    });
  });
});

describe('useCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Registration Tests
  // ========================================

  describe('Registration', () => {
    it('should register command handler', () => {
      const handler = vi.fn();

      renderHook(() => useCommand('test.command', handler));

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('test.command', handler);
    });

    it('should unregister command on unmount', () => {
      const handler = vi.fn();

      const { unmount } = renderHook(() => useCommand('test.command', handler));

      unmount();

      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('test.command');
    });

    it('should re-register when command name changes', () => {
      const handler = vi.fn();

      const { rerender } = renderHook(({ command }) => useCommand(command, handler), {
        initialProps: { command: 'command.one' },
      });

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('command.one', handler);

      rerender({ command: 'command.two' });

      expect(keybindingManager.unregisterCommand).toHaveBeenCalledWith('command.one');
      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('command.two', handler);
    });

    it('should update handler when it changes', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const { rerender } = renderHook(({ handler }) => useCommand('test.command', handler), {
        initialProps: { handler: handler1 },
      });

      rerender({ handler: handler2 });

      // Should have been called with both handlers
      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('test.command', handler1);
      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('test.command', handler2);
    });
  });

  // ========================================
  // Async Handler Tests
  // ========================================

  describe('Async Handlers', () => {
    it('should accept async handler', () => {
      const asyncHandler = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      };

      renderHook(() => useCommand('async.command', asyncHandler));

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith('async.command', asyncHandler);
    });
  });
});

describe('useKeybindingLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Label Retrieval Tests
  // ========================================

  describe('Label Retrieval', () => {
    it('should return formatted key for existing command', () => {
      (keybindingManager.getKeybindingForCommand as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'file.save',
        key: 'mod+s',
        command: 'file.save',
      });
      (keybindingManager.formatKeyForDisplay as ReturnType<typeof vi.fn>).mockReturnValue(
        '\u2318S'
      );

      const { result } = renderHook(() => useKeybindingLabel('file.save'));

      expect(result.current).toBe('\u2318S');
    });

    it('should return undefined for non-existent command', () => {
      (keybindingManager.getKeybindingForCommand as ReturnType<typeof vi.fn>).mockReturnValue(
        undefined
      );

      const { result } = renderHook(() => useKeybindingLabel('non.existent'));

      expect(result.current).toBeUndefined();
    });

    it('should call getKeybindingForCommand with correct command', () => {
      renderHook(() => useKeybindingLabel('test.command'));

      expect(keybindingManager.getKeybindingForCommand).toHaveBeenCalledWith('test.command');
    });

    it('should call formatKeyForDisplay with binding key', () => {
      (keybindingManager.getKeybindingForCommand as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'test',
        key: 'mod+shift+p',
        command: 'test',
      });

      renderHook(() => useKeybindingLabel('test'));

      expect(keybindingManager.formatKeyForDisplay).toHaveBeenCalledWith('mod+shift+p');
    });
  });
});

describe('useExecuteCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Execute Command Tests
  // ========================================

  describe('Execute Command', () => {
    it('should return a function', () => {
      const { result } = renderHook(() => useExecuteCommand());

      expect(typeof result.current).toBe('function');
    });

    it('should call keybindingManager.executeCommand', () => {
      const { result } = renderHook(() => useExecuteCommand());

      act(() => {
        result.current('file.save');
      });

      expect(keybindingManager.executeCommand).toHaveBeenCalledWith('file.save');
    });

    it('should pass command name correctly', () => {
      const { result } = renderHook(() => useExecuteCommand());

      act(() => {
        result.current('custom.action');
      });

      expect(keybindingManager.executeCommand).toHaveBeenCalledWith('custom.action');
    });

    it('should return stable function reference', () => {
      const { result, rerender } = renderHook(() => useExecuteCommand());

      const firstRef = result.current;

      rerender();

      expect(result.current).toBe(firstRef);
    });

    it('should execute multiple commands', () => {
      const { result } = renderHook(() => useExecuteCommand());

      act(() => {
        result.current('command.one');
        result.current('command.two');
        result.current('command.three');
      });

      expect(keybindingManager.executeCommand).toHaveBeenCalledTimes(3);
      expect(keybindingManager.executeCommand).toHaveBeenNthCalledWith(1, 'command.one');
      expect(keybindingManager.executeCommand).toHaveBeenNthCalledWith(2, 'command.two');
      expect(keybindingManager.executeCommand).toHaveBeenNthCalledWith(3, 'command.three');
    });
  });
});

describe('Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toggleQuickOpen: mockToggleQuickOpen,
      toggleCommandPalette: mockToggleCommandPalette,
      toggleTerminal: mockToggleTerminal,
      toggleSidebar: mockToggleSidebar,
      togglePanel: mockTogglePanel,
      openModal: mockOpenModal,
      quickOpenOpen: false,
      commandPaletteOpen: false,
      activeModal: null,
    });
    (useKeybindingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      keybindings: [],
      loadFromServer: mockLoadFromServer,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Integration Scenarios
  // ========================================

  it('should work with useCommand to add custom handlers', () => {
    const customHandler = vi.fn();

    renderHook(() => {
      useKeybindings();
      useCommand('custom.action', customHandler);
    });

    // Both should have registered
    expect(keybindingManager.registerCommand).toHaveBeenCalledWith('custom.action', customHandler);
    expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
      'quickOpen.toggle',
      expect.any(Function)
    );
  });

  it('should work with useExecuteCommand to trigger actions', () => {
    const { result } = renderHook(() => {
      useKeybindings();
      return useExecuteCommand();
    });

    act(() => {
      result.current('nav.quickOpen');
    });

    expect(keybindingManager.executeCommand).toHaveBeenCalledWith('nav.quickOpen');
  });

  it('should update context in response to UI changes', () => {
    const { rerender } = renderHook(() => useKeybindings());

    // First render - modal closed
    expect(keybindingManager.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        modalOpen: false,
      })
    );

    // Open modal
    (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toggleQuickOpen: mockToggleQuickOpen,
      toggleCommandPalette: mockToggleCommandPalette,
      toggleTerminal: mockToggleTerminal,
      toggleSidebar: mockToggleSidebar,
      togglePanel: mockTogglePanel,
      openModal: mockOpenModal,
      quickOpenOpen: false,
      commandPaletteOpen: false,
      activeModal: 'settings',
    });

    rerender();

    // Should update context
    expect(keybindingManager.setContext).toHaveBeenCalledWith(
      expect.objectContaining({
        modalOpen: true,
      })
    );
  });

  it('should reload keybindings when user settings change', () => {
    const { rerender } = renderHook(() => useKeybindings());

    // Initial registration
    expect(keybindingManager.clearAllKeybindings).toHaveBeenCalledTimes(1);
    expect(keybindingManager.registerKeybindings).toHaveBeenCalledTimes(2); // defaults + user

    // User adds custom keybinding
    (useKeybindingsStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      keybindings: [
        {
          id: 'new.binding',
          command: 'new.binding',
          label: 'New Binding',
          category: 'Custom',
          keys: ['Cmd+Shift+N'],
        },
      ],
      loadFromServer: mockLoadFromServer,
    });

    rerender();

    // Should re-register
    expect(keybindingManager.clearAllKeybindings).toHaveBeenCalledTimes(2);
  });
});
