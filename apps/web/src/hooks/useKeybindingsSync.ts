'use client';

import { useEffect } from 'react';
import { useKeybindingsStore, type Keybinding } from '@/stores/keybindings';
import { keybindingManager } from '@/lib/keybindings';

/**
 * Map keybinding store format (e.g., "Cmd+F") to KeybindingManager format (e.g., "mod+f")
 */
function convertKeyFormat(keys: string[]): string {
  return keys
    .map((key) =>
      key
        .toLowerCase()
        .replace(/cmd/g, 'mod')
        .replace(/meta/g, 'mod')
        .replace(/control/g, 'ctrl')
        .replace(/option/g, 'alt')
    )
    .join(' ');
}

/**
 * Command classification - determines which commands are editor-native vs application-level
 */
export const EDITOR_COMMANDS = new Set([
  // Search
  'search.find',
  'search.replace',
  'search.findNext',
  'search.findPrevious',

  // Editor operations
  'editor.selectAll',
  'editor.cut',
  'editor.copy',
  'editor.paste',
  'editor.undo',
  'editor.redo',
  'editor.comment',
  'editor.blockComment',
  'editor.deleteLine',
  'editor.moveLineUp',
  'editor.moveLineDown',
  'editor.copyLineUp',
  'editor.copyLineDown',
  'editor.addCursorAbove',
  'editor.addCursorBelow',
  'editor.selectNextOccurrence',
  'editor.selectAllOccurrences',
  'editor.rename',
  'editor.quickFix',
  'editor.format',
  'editor.formatSelection',

  // Navigation within editor
  'nav.goToLine',
  'nav.goToSymbol',
  'nav.goToDefinition',
  'nav.peekDefinition',
  'nav.findReferences',
]);

/**
 * Application-level commands (handled by KeybindingManager, not Monaco)
 */
export const APP_COMMANDS = new Set([
  // File operations
  'file.new',
  'file.open',
  'file.save',
  'file.saveAll',
  'file.close',
  'file.closeAll',
  'file.reopenClosed',

  // Navigation (app-level)
  'nav.quickOpen',
  'nav.commandPalette',
  'nav.commandPaletteAlt',
  'nav.back',
  'nav.forward',

  // View
  'view.toggleSidebar',
  'view.togglePanel',
  'view.toggleTerminal',
  'view.splitEditor',
  'view.focusExplorer',
  'view.focusSearch',
  'view.focusGit',
  'view.focusDebug',
  'view.zoomIn',
  'view.zoomOut',
  'view.resetZoom',

  // Search (global)
  'search.findInFiles',

  // Debug
  'debug.start',
  'debug.stop',
  'debug.restart',
  'debug.continue',
  'debug.stepOver',
  'debug.stepInto',
  'debug.stepOut',
  'debug.toggleBreakpoint',

  // Agent
  'agent.inlineChat',
  'agent.chat',
  'agent.acceptSuggestion',
  'agent.dismissSuggestion',
]);

/**
 * Maps keybinding IDs from the store to command names used by KeybindingManager
 */
const COMMAND_MAP: Record<string, string> = {
  // Search
  'search.find': 'editor.find',
  'search.replace': 'editor.replace',
  'search.findInFiles': 'search.findInFiles',
  'search.findNext': 'editor.findNext',
  'search.findPrevious': 'editor.findPrev',

  // Editor
  'editor.selectAll': 'editor.selectAll',
  'editor.comment': 'editor.toggleComment',
  'editor.blockComment': 'editor.toggleBlockComment',
  'editor.deleteLine': 'editor.deleteLine',
  'editor.moveLineUp': 'editor.moveLineUp',
  'editor.moveLineDown': 'editor.moveLineDown',
  'editor.copyLineUp': 'editor.copyLineUp',
  'editor.copyLineDown': 'editor.copyLineDown',
  'editor.addCursorAbove': 'editor.addCursorAbove',
  'editor.addCursorBelow': 'editor.addCursorBelow',
  'editor.selectNextOccurrence': 'editor.addSelectionToNextMatch',
  'editor.selectAllOccurrences': 'editor.selectAllOccurrences',
  'editor.rename': 'editor.rename',
  'editor.quickFix': 'editor.quickFix',
  'editor.format': 'editor.formatDocument',
  'editor.undo': 'editor.undo',
  'editor.redo': 'editor.redo',

  // Navigation
  'nav.goToLine': 'editor.goToLine',
  'nav.goToSymbol': 'editor.goToSymbol',
  'nav.goToDefinition': 'editor.goToDefinition',
  'nav.peekDefinition': 'editor.peekDefinition',
  'nav.findReferences': 'editor.findReferences',
  'nav.quickOpen': 'quickOpen.toggle',
  'nav.commandPalette': 'commandPalette.toggle',
  'nav.commandPaletteAlt': 'commandPalette.toggle',

  // View
  'view.toggleSidebar': 'sidebar.toggle',
  'view.togglePanel': 'panel.toggle',
  'view.toggleTerminal': 'terminal.toggle',

  // File operations
  'file.save': 'file.save',
  'file.saveAll': 'file.saveAll',
  'file.close': 'file.close',
  'file.new': 'file.new',
};

/**
 * Hook to sync keybindings from the Zustand store to the KeybindingManager
 *
 * This ensures that when users customize keybindings in settings,
 * those changes are reflected in the global keyboard handler.
 */
export function useKeybindingsSync() {
  const keybindings = useKeybindingsStore((s) => s.keybindings);

  useEffect(() => {
    // Clear existing bindings and re-register with current keybindings
    keybindingManager.clearAllKeybindings();

    for (const binding of keybindings) {
      const commandName = COMMAND_MAP[binding.id] || binding.command;
      const keyString = convertKeyFormat(binding.keys);

      keybindingManager.registerKeybinding({
        id: binding.id,
        key: keyString,
        command: commandName,
        when: binding.when,
        description: binding.label,
        category: binding.category,
      });
    }
  }, [keybindings]);
}

/**
 * Get display info for a keybinding
 */
export function getKeybindingInfo(binding: Keybinding): {
  isEditorCommand: boolean;
  isAppCommand: boolean;
  badgeLabel: 'Editor' | 'App' | 'Both';
} {
  const isEditorCommand = EDITOR_COMMANDS.has(binding.id);
  const isAppCommand = APP_COMMANDS.has(binding.id);

  return {
    isEditorCommand,
    isAppCommand,
    badgeLabel: isEditorCommand && isAppCommand ? 'Both' : isEditorCommand ? 'Editor' : 'App',
  };
}
