/**
 * Comprehensive tests for useWorkspaceKeybindingCommands hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkspaceKeybindingCommands } from '@/hooks/useWorkspaceKeybindingCommands';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  })),
}));

// Mock keybinding manager
vi.mock('@/lib/keybindings', () => ({
  keybindingManager: {
    registerCommand: vi.fn(),
    unregisterCommand: vi.fn(),
    executeCommand: vi.fn(),
    getKeybindings: vi.fn(() => []),
  },
}));

// Mock stores
const mockUIStore = {
  toggleSidebar: vi.fn(),
  addPanel: vi.fn(),
  announce: vi.fn(),
  defaultShell: 'bash' as const,
};

const mockEditorStore = {
  getTabsForPane: vi.fn(() => []),
  getActiveTab: vi.fn(() => null),
  closeTab: vi.fn(),
  reopenClosedTab: vi.fn(() => null),
  setActiveTab: vi.fn(),
  paneOrder: ['pane-1'],
  panes: {
    'pane-1': {
      id: 'pane-1',
      activeTabId: 'tab-1',
      orientation: 'horizontal' as const,
      size: 100,
    },
  },
  activePaneId: 'pane-1',
};

const mockSessionStore = {
  addTerminalWindow: vi.fn(),
};

vi.mock('@/stores/ui', () => ({
  useUIStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockUIStore);
    }
    return mockUIStore;
  }),
}));

vi.mock('@/stores/editor', () => ({
  useEditorStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockEditorStore);
    }
    return mockEditorStore;
  }),
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector(mockSessionStore);
    }
    return mockSessionStore;
  }),
}));

import { keybindingManager } from '@/lib/keybindings';
import { useRouter } from 'next/navigation';

describe('useWorkspaceKeybindingCommands', () => {
  const mockSessionId = 'session-123';
  let mockRouter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
    };
    vi.mocked(useRouter).mockReturnValue(mockRouter);

    // Reset editor store
    mockEditorStore.paneOrder = ['pane-1'];
    mockEditorStore.panes = {
      'pane-1': {
        id: 'pane-1',
        activeTabId: 'tab-1',
        orientation: 'horizontal' as const,
        size: 100,
      },
    };
    mockEditorStore.activePaneId = 'pane-1';
    mockEditorStore.getTabsForPane.mockReturnValue([]);
    mockEditorStore.getActiveTab.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Hook Initialization', () => {
    it('should register all keybinding commands on mount', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      expect(keybindingManager.registerCommand).toHaveBeenCalledTimes(38);
    });

    it('should unregister all commands on unmount', () => {
      const { unmount } = renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      unmount();

      expect(keybindingManager.unregisterCommand).toHaveBeenCalledTimes(38);
    });

    it('should accept sessionId parameter', () => {
      const { rerender } = renderHook(
        ({ sessionId }) => useWorkspaceKeybindingCommands(sessionId),
        { initialProps: { sessionId: 'session-1' } }
      );

      rerender({ sessionId: 'session-2' });
      expect(keybindingManager.registerCommand).toHaveBeenCalled();
    });
  });

  describe('File Explorer Commands', () => {
    it('should register fileExplorer.focus command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'fileExplorer.focus',
        expect.any(Function)
      );
    });

    it('should toggle sidebar and add files panel when fileExplorer.focus is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const fileExplorerCall = registerCalls.find((call) => call[0] === 'fileExplorer.focus');
      const handler = fileExplorerCall![1];

      handler();

      expect(mockUIStore.toggleSidebar).toHaveBeenCalledWith('left');
      expect(mockUIStore.addPanel).toHaveBeenCalledWith('files', 'left');
      expect(mockUIStore.announce).toHaveBeenCalledWith('File explorer focused');
    });
  });

  describe('Git Commands', () => {
    it('should register git.focus command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      expect(keybindingManager.registerCommand).toHaveBeenCalledWith(
        'git.focus',
        expect.any(Function)
      );
    });

    it('should toggle sidebar and add git panel when git.focus is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const gitFocusCall = registerCalls.find((call) => call[0] === 'git.focus');
      const handler = gitFocusCall![1];

      handler();

      expect(mockUIStore.toggleSidebar).toHaveBeenCalledWith('left');
      expect(mockUIStore.addPanel).toHaveBeenCalledWith('git', 'left');
      expect(mockUIStore.announce).toHaveBeenCalledWith('Git panel focused');
    });

    it('should register git.commit command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const gitCommitCall = registerCalls.find((call) => call[0] === 'git.commit');
      const handler = gitCommitCall![1];

      handler();

      expect(mockUIStore.toggleSidebar).toHaveBeenCalledWith('left');
      expect(mockUIStore.addPanel).toHaveBeenCalledWith('git', 'left');
      expect(toast.info).toHaveBeenCalledWith('Git commit shortcut is not yet implemented.');
    });

    it('should register git.push command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const gitPushCall = registerCalls.find((call) => call[0] === 'git.push');
      const handler = gitPushCall![1];

      handler();

      expect(toast.info).toHaveBeenCalledWith('Git push shortcut is not yet implemented.');
    });

    it('should register git.pull command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const gitPullCall = registerCalls.find((call) => call[0] === 'git.pull');
      const handler = gitPullCall![1];

      handler();

      expect(toast.info).toHaveBeenCalledWith('Git pull shortcut is not yet implemented.');
    });
  });

  describe('Editor Tab Commands', () => {
    it('should close active tab when editor.closeTab is executed', () => {
      mockEditorStore.getActiveTab.mockReturnValue({
        id: 'tab-1',
        paneId: 'pane-1',
        type: 'file',
        title: 'test.ts',
      });

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const closeTabCall = registerCalls.find((call) => call[0] === 'editor.closeTab');
      const handler = closeTabCall![1];

      handler();

      expect(mockEditorStore.closeTab).toHaveBeenCalledWith('tab-1');
    });

    it('should not close tab if no active tab', () => {
      mockEditorStore.getActiveTab.mockReturnValue(null);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const closeTabCall = registerCalls.find((call) => call[0] === 'editor.closeTab');
      const handler = closeTabCall![1];

      handler();

      expect(mockEditorStore.closeTab).not.toHaveBeenCalled();
    });

    it('should reopen closed tab when editor.reopenClosedTab is executed', () => {
      mockEditorStore.reopenClosedTab.mockReturnValue({ id: 'tab-2' });

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const reopenCall = registerCalls.find((call) => call[0] === 'editor.reopenClosedTab');
      const handler = reopenCall![1];

      handler();

      expect(mockEditorStore.reopenClosedTab).toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
    });

    it('should show toast if no tabs to reopen', () => {
      mockEditorStore.reopenClosedTab.mockReturnValue(null);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const reopenCall = registerCalls.find((call) => call[0] === 'editor.reopenClosedTab');
      const handler = reopenCall![1];

      handler();

      expect(toast.info).toHaveBeenCalledWith('No recently closed tabs to reopen.');
    });

    it('should navigate to next tab when editor.nextTab is executed', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
        { id: 'tab-3', title: 'file3.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);
      mockEditorStore.panes['pane-1'].activeTabId = 'tab-1';

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-2');
    });

    it('should wrap to first tab when at end', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
        { id: 'tab-3', title: 'file3.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);
      mockEditorStore.panes['pane-1'].activeTabId = 'tab-3';

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-1');
    });

    it('should navigate to previous tab when editor.prevTab is executed', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
        { id: 'tab-3', title: 'file3.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);
      mockEditorStore.panes['pane-1'].activeTabId = 'tab-2';

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const prevTabCall = registerCalls.find((call) => call[0] === 'editor.prevTab');
      const handler = prevTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-1');
    });

    it('should wrap to last tab when at beginning', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
        { id: 'tab-3', title: 'file3.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);
      mockEditorStore.panes['pane-1'].activeTabId = 'tab-1';

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const prevTabCall = registerCalls.find((call) => call[0] === 'editor.prevTab');
      const handler = prevTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-3');
    });

    it('should focus tab by index for editor.focusTab1', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const focusTab1Call = registerCalls.find((call) => call[0] === 'editor.focusTab1');
      const handler = focusTab1Call![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-1');
    });

    it('should focus tab by index for editor.focusTab2', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const focusTab2Call = registerCalls.find((call) => call[0] === 'editor.focusTab2');
      const handler = focusTab2Call![1];

      handler();

      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-2');
    });

    it('should handle focusTab3 through focusTab5', () => {
      const mockTabs = [
        { id: 'tab-1', title: 'file1.ts' },
        { id: 'tab-2', title: 'file2.ts' },
        { id: 'tab-3', title: 'file3.ts' },
        { id: 'tab-4', title: 'file4.ts' },
        { id: 'tab-5', title: 'file5.ts' },
      ];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;

      const focusTab3 = registerCalls.find((call) => call[0] === 'editor.focusTab3')![1];
      focusTab3();
      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-3');

      const focusTab4 = registerCalls.find((call) => call[0] === 'editor.focusTab4')![1];
      focusTab4();
      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-4');

      const focusTab5 = registerCalls.find((call) => call[0] === 'editor.focusTab5')![1];
      focusTab5();
      expect(mockEditorStore.setActiveTab).toHaveBeenCalledWith('tab-5');
    });

    it('should not focus tab if index out of bounds', () => {
      const mockTabs = [{ id: 'tab-1', title: 'file1.ts' }];

      mockEditorStore.getTabsForPane.mockReturnValue(mockTabs);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const focusTab5Call = registerCalls.find((call) => call[0] === 'editor.focusTab5');
      const handler = focusTab5Call![1];

      vi.mocked(mockEditorStore.setActiveTab).mockClear();
      handler();

      expect(mockEditorStore.setActiveTab).not.toHaveBeenCalled();
    });

    it('should show toast for unimplemented editor.split command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const splitCall = registerCalls.find((call) => call[0] === 'editor.split');
      const handler = splitCall![1];

      handler();

      expect(toast.info).toHaveBeenCalledWith('Editor split is not yet implemented.');
    });
  });

  describe('Search Commands', () => {
    it('should open search panel when search.findInFiles is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const findCall = registerCalls.find((call) => call[0] === 'search.findInFiles');
      const handler = findCall![1];

      handler();

      expect(mockUIStore.toggleSidebar).toHaveBeenCalledWith('left');
      expect(mockUIStore.addPanel).toHaveBeenCalledWith('search', 'left');
      expect(mockUIStore.announce).toHaveBeenCalledWith('Search in files opened');
    });

    it('should open search panel when search.replaceInFiles is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const replaceCall = registerCalls.find((call) => call[0] === 'search.replaceInFiles');
      const handler = replaceCall![1];

      handler();

      expect(mockUIStore.toggleSidebar).toHaveBeenCalledWith('left');
      expect(mockUIStore.addPanel).toHaveBeenCalledWith('search', 'left');
      expect(mockUIStore.announce).toHaveBeenCalledWith('Search and replace in files opened');
    });
  });

  describe('Settings Commands', () => {
    it('should navigate to settings when settings.open is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const settingsCall = registerCalls.find((call) => call[0] === 'settings.open');
      const handler = settingsCall![1];

      handler();

      expect(mockRouter.push).toHaveBeenCalledWith('/settings');
    });

    it('should navigate to keybindings settings when settings.openKeyboardShortcuts is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const keybindingsCall = registerCalls.find(
        (call) => call[0] === 'settings.openKeyboardShortcuts'
      );
      const handler = keybindingsCall![1];

      handler();

      expect(mockRouter.push).toHaveBeenCalledWith('/settings/keybindings');
    });
  });

  describe('Terminal Commands', () => {
    it('should create new terminal when terminal.new is executed', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const newTermCall = registerCalls.find((call) => call[0] === 'terminal.new');
      const handler = newTermCall![1];

      handler();

      expect(mockSessionStore.addTerminalWindow).toHaveBeenCalledWith(
        mockSessionId,
        'panel',
        undefined,
        'bash'
      );
      expect(mockUIStore.announce).toHaveBeenCalledWith('New terminal created');
    });

    it('should show toast for unimplemented terminal.clear command', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const clearCall = registerCalls.find((call) => call[0] === 'terminal.clear');
      const handler = clearCall![1];

      handler();

      expect(toast.info).toHaveBeenCalledWith(
        'Clearing the terminal from keyboard is not yet implemented.'
      );
    });
  });

  describe('Agent/AI Commands', () => {
    it('should show not implemented toast for agent commands', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const agentCommands = [
        'agent.inlineChat',
        'agent.explainCode',
        'agent.fixCode',
        'agent.refactorCode',
        'agent.generateTests',
        'agent.addDocumentation',
        'agent.acceptSuggestion',
        'agent.dismissSuggestion',
        'agent.nextSuggestion',
        'agent.prevSuggestion',
      ];

      agentCommands.forEach((cmd) => {
        const call = registerCalls.find((c) => c[0] === cmd);
        expect(call).toBeDefined();

        const handler = call![1];
        handler();

        expect(toast.info).toHaveBeenCalled();
      });
    });
  });

  describe('Debug Commands', () => {
    it('should show not implemented toast for debug commands', () => {
      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const debugCommands = [
        'debug.start',
        'debug.stop',
        'debug.restart',
        'debug.stepOver',
        'debug.stepInto',
        'debug.stepOut',
        'debug.toggleBreakpoint',
      ];

      debugCommands.forEach((cmd) => {
        const call = registerCalls.find((c) => c[0] === cmd);
        expect(call).toBeDefined();

        const handler = call![1];
        handler();

        expect(toast.info).toHaveBeenCalledWith('Debugging is not yet implemented.');
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty pane order', () => {
      mockEditorStore.paneOrder = [];
      mockEditorStore.activePaneId = null;

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).not.toHaveBeenCalled();
    });

    it('should handle missing active pane', () => {
      mockEditorStore.activePaneId = 'non-existent';
      mockEditorStore.panes = {};

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).not.toHaveBeenCalled();
    });

    it('should handle empty tabs array', () => {
      mockEditorStore.getTabsForPane.mockReturnValue([]);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).not.toHaveBeenCalled();
    });

    it('should handle no active tab in pane', () => {
      mockEditorStore.panes['pane-1'].activeTabId = null;
      mockEditorStore.getTabsForPane.mockReturnValue([{ id: 'tab-1', title: 'file1.ts' }]);

      renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      const registerCalls = vi.mocked(keybindingManager.registerCommand).mock.calls;
      const nextTabCall = registerCalls.find((call) => call[0] === 'editor.nextTab');
      const handler = nextTabCall![1];

      handler();

      expect(mockEditorStore.setActiveTab).not.toHaveBeenCalled();
    });
  });

  describe('Dependency Changes', () => {
    it('should re-register commands when sessionId changes', () => {
      const { rerender } = renderHook(
        ({ sessionId }) => useWorkspaceKeybindingCommands(sessionId),
        { initialProps: { sessionId: 'session-1' } }
      );

      vi.mocked(keybindingManager.registerCommand).mockClear();
      vi.mocked(keybindingManager.unregisterCommand).mockClear();

      rerender({ sessionId: 'session-2' });

      expect(keybindingManager.unregisterCommand).toHaveBeenCalled();
      expect(keybindingManager.registerCommand).toHaveBeenCalled();
    });

    it('should re-register commands when store values change', () => {
      const { rerender } = renderHook(() => useWorkspaceKeybindingCommands(mockSessionId));

      vi.mocked(keybindingManager.registerCommand).mockClear();
      vi.mocked(keybindingManager.unregisterCommand).mockClear();

      mockEditorStore.activePaneId = 'pane-2';
      rerender();

      expect(keybindingManager.unregisterCommand).toHaveBeenCalled();
      expect(keybindingManager.registerCommand).toHaveBeenCalled();
    });
  });
});
