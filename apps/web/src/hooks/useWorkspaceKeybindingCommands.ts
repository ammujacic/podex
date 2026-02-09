import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { keybindingManager } from '@/lib/keybindings';
import { useEditorStore } from '@/stores/editor';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';

/**
 * Registers workspace-wide keybinding command handlers that are not
 * tied to a specific Monaco editor instance.
 *
 * This is where we wire up the commands listed in `defaultKeybindings.ts`
 * to actual behavior (or, for not-yet-built features, to clear feedback).
 */
export function useWorkspaceKeybindingCommands(sessionId: string) {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const addPanel = useUIStore((s) => s.addPanel);
  const announce = useUIStore((s) => s.announce);
  const defaultShell = useUIStore((s) => s.defaultShell);

  const getTabsForPane = useEditorStore((s) => s.getTabsForPane);
  const getActiveTab = useEditorStore((s) => s.getActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const reopenClosedTab = useEditorStore((s) => s.reopenClosedTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const paneOrder = useEditorStore((s) => s.paneOrder);
  const panes = useEditorStore((s) => s.panes);
  const activePaneId = useEditorStore((s) => s.activePaneId);

  const addTerminalWindow = useSessionStore((s) => s.addTerminalWindow);

  const router = useRouter();

  useEffect(() => {
    // Helper: get active editor pane and its tabs
    const getActiveEditorContext = () => {
      const paneId = activePaneId && panes[activePaneId] ? activePaneId : paneOrder[0];
      if (!paneId) return null;
      const pane = panes[paneId];
      if (!pane) return null;
      const tabs = getTabsForPane(paneId);
      return { paneId, pane, tabs };
    };

    // ==================== View / Sidebars ====================
    keybindingManager.registerCommand('fileExplorer.focus', () => {
      // Ensure left sidebar is visible and the Files panel is present
      toggleSidebar('left');
      addPanel('files', 'left');
      announce('File explorer focused');
    });

    keybindingManager.registerCommand('git.focus', () => {
      toggleSidebar('left');
      addPanel('git', 'left');
      announce('Git panel focused');
    });

    // ==================== Editor / Tabs ====================
    keybindingManager.registerCommand('editor.split', () => {
      // The actual split behavior is handled via the editor UI; for now,
      // we simply announce that the command was received.
      toast.info('Editor split is not yet implemented.');
    });

    keybindingManager.registerCommand('editor.closeTab', () => {
      const active = getActiveTab();
      if (active) {
        closeTab(active.id);
      }
    });

    keybindingManager.registerCommand('editor.reopenClosedTab', () => {
      const reopened = reopenClosedTab();
      if (!reopened) {
        toast.info('No recently closed tabs to reopen.');
      }
    });

    keybindingManager.registerCommand('editor.nextTab', () => {
      const ctx = getActiveEditorContext();
      if (!ctx) return;
      const { pane, tabs } = ctx;
      if (!pane.activeTabId || tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === pane.activeTabId);
      const next = tabs[(index + 1) % tabs.length];
      if (next) setActiveTab(next.id);
    });

    keybindingManager.registerCommand('editor.prevTab', () => {
      const ctx = getActiveEditorContext();
      if (!ctx) return;
      const { pane, tabs } = ctx;
      if (!pane.activeTabId || tabs.length === 0) return;
      const index = tabs.findIndex((t) => t.id === pane.activeTabId);
      const prev = tabs[(index - 1 + tabs.length) % tabs.length];
      if (prev) setActiveTab(prev.id);
    });

    // Focus tab 1-5
    const focusTabByIndex = (index: number) => {
      const ctx = getActiveEditorContext();
      if (!ctx) return;
      const { tabs } = ctx;
      const tab = tabs[index];
      if (tab) setActiveTab(tab.id);
    };

    keybindingManager.registerCommand('editor.focusTab1', () => focusTabByIndex(0));
    keybindingManager.registerCommand('editor.focusTab2', () => focusTabByIndex(1));
    keybindingManager.registerCommand('editor.focusTab3', () => focusTabByIndex(2));
    keybindingManager.registerCommand('editor.focusTab4', () => focusTabByIndex(3));
    keybindingManager.registerCommand('editor.focusTab5', () => focusTabByIndex(4));

    // ==================== Search / Find in files ====================
    keybindingManager.registerCommand('search.findInFiles', () => {
      toggleSidebar('left');
      addPanel('search', 'left');
      announce('Search in files opened');
    });

    keybindingManager.registerCommand('search.replaceInFiles', () => {
      toggleSidebar('left');
      addPanel('search', 'left');
      announce('Search and replace in files opened');
    });

    // ==================== Settings ====================
    keybindingManager.registerCommand('settings.open', () => {
      router.push('/settings');
    });

    keybindingManager.registerCommand('settings.openKeyboardShortcuts', () => {
      router.push('/settings/keybindings');
    });

    // ==================== Terminal ====================
    keybindingManager.registerCommand('terminal.new', () => {
      addTerminalWindow(sessionId, 'panel', undefined, defaultShell);
      announce('New terminal created');
    });

    keybindingManager.registerCommand('terminal.clear', () => {
      // We don't currently have a direct handle to the xterm instance here.
      // Provide clear feedback rather than silently doing nothing.
      toast.info('Clearing the terminal from keyboard is not yet implemented.');
    });

    // ==================== AI / Agent ====================
    keybindingManager.registerCommand('agent.inlineChat', () => {
      toast.info('Inline chat shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.explainCode', () => {
      toast.info('Explain code shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.fixCode', () => {
      toast.info('Fix code shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.refactorCode', () => {
      toast.info('Refactor code shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.generateTests', () => {
      toast.info('Generate tests shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.addDocumentation', () => {
      toast.info('Add documentation shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.acceptSuggestion', () => {
      toast.info('Accept suggestion shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.dismissSuggestion', () => {
      toast.info('Dismiss suggestion shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.nextSuggestion', () => {
      toast.info('Next suggestion shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('agent.prevSuggestion', () => {
      toast.info('Previous suggestion shortcut is not yet implemented.');
    });

    // ==================== Git ====================
    keybindingManager.registerCommand('git.commit', () => {
      toggleSidebar('left');
      addPanel('git', 'left');
      toast.info('Git commit shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('git.push', () => {
      toggleSidebar('left');
      addPanel('git', 'left');
      toast.info('Git push shortcut is not yet implemented.');
    });
    keybindingManager.registerCommand('git.pull', () => {
      toggleSidebar('left');
      addPanel('git', 'left');
      toast.info('Git pull shortcut is not yet implemented.');
    });

    // ==================== Debug ====================
    keybindingManager.registerCommand('debug.start', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.stop', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.restart', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.stepOver', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.stepInto', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.stepOut', () => {
      toast.info('Debugging is not yet implemented.');
    });
    keybindingManager.registerCommand('debug.toggleBreakpoint', () => {
      toast.info('Debugging is not yet implemented.');
    });

    // Cleanup
    return () => {
      const commands = [
        'fileExplorer.focus',
        'git.focus',
        'editor.split',
        'editor.closeTab',
        'editor.reopenClosedTab',
        'editor.nextTab',
        'editor.prevTab',
        'editor.focusTab1',
        'editor.focusTab2',
        'editor.focusTab3',
        'editor.focusTab4',
        'editor.focusTab5',
        'search.findInFiles',
        'search.replaceInFiles',
        'settings.open',
        'settings.openKeyboardShortcuts',
        'terminal.new',
        'terminal.clear',
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
        'git.commit',
        'git.push',
        'git.pull',
        'debug.start',
        'debug.stop',
        'debug.restart',
        'debug.stepOver',
        'debug.stepInto',
        'debug.stepOut',
        'debug.toggleBreakpoint',
      ];

      for (const cmd of commands) {
        keybindingManager.unregisterCommand(cmd);
      }
    };
  }, [
    activePaneId,
    addPanel,
    addTerminalWindow,
    announce,
    closeTab,
    defaultShell,
    getActiveTab,
    getTabsForPane,
    paneOrder,
    panes,
    reopenClosedTab,
    router,
    sessionId,
    setActiveTab,
    toggleSidebar,
  ]);
}
