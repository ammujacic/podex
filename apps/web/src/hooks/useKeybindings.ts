'use client';

import { useEffect, useCallback } from 'react';
import { keybindingManager, defaultKeybindings } from '@/lib/keybindings';
import { useUIStore } from '@/stores/ui';
import { useKeybindingsStore } from '@/stores/keybindings';

/**
 * Hook to initialize and manage keyboard shortcuts
 *
 * This hook should be called once at the app root level to set up
 * all keyboard shortcuts and their command handlers.
 */
export function useKeybindings() {
  const {
    toggleQuickOpen,
    toggleCommandPalette,
    toggleTerminal,
    toggleSidebar,
    togglePanel,
    quickOpenOpen,
    commandPaletteOpen,
    activeModal,
    openModal,
  } = useUIStore();

  // Get user-customized keybindings from store
  const { keybindings: userKeybindings, loadFromServer } = useKeybindingsStore();

  // Load keybindings from server on mount
  useEffect(() => {
    loadFromServer().catch((error) => {
      console.error('Failed to load keybindings from server:', error);
      // Continue with localStorage fallback
    });
  }, [loadFromServer]);

  // Update keybinding context when UI state changes
  useEffect(() => {
    keybindingManager.setContext({
      quickOpenOpen,
      commandPaletteOpen,
      modalOpen: activeModal !== null,
    });
  }, [quickOpenOpen, commandPaletteOpen, activeModal]);

  // Register keybindings from both default config and user settings
  useEffect(() => {
    // Clear existing bindings
    keybindingManager.clearAllKeybindings();

    // Register default keybindings from lib/keybindings
    keybindingManager.registerKeybindings(defaultKeybindings);

    // Override with user-customized keybindings from settings store
    // Map the store format to KeybindingManager format
    const userBindings = userKeybindings.map((kb) => ({
      id: kb.id,
      key: kb.keys.join(' ').toLowerCase().replace(/cmd/g, 'mod'),
      command: kb.command,
      description: kb.label,
      category: kb.category,
      when: kb.when,
    }));

    keybindingManager.registerKeybindings(userBindings);
  }, [userKeybindings]);

  // Register core command handlers
  useEffect(() => {
    // Navigation commands
    keybindingManager.registerCommand('quickOpen.toggle', toggleQuickOpen);
    keybindingManager.registerCommand('nav.quickOpen', toggleQuickOpen);
    keybindingManager.registerCommand('commandPalette.toggle', toggleCommandPalette);
    keybindingManager.registerCommand('nav.commandPalette', toggleCommandPalette);

    // File commands
    keybindingManager.registerCommand('file.newFile', () => openModal('new-file'));

    // View commands
    keybindingManager.registerCommand('terminal.toggle', toggleTerminal);
    keybindingManager.registerCommand('view.toggleTerminal', toggleTerminal);
    keybindingManager.registerCommand('sidebar.toggle', () => toggleSidebar('left'));
    keybindingManager.registerCommand('view.toggleSidebar', () => toggleSidebar('left'));
    keybindingManager.registerCommand('sidebar.toggleRight', () => toggleSidebar('right'));
    keybindingManager.registerCommand('panel.toggle', togglePanel);
    keybindingManager.registerCommand('view.togglePanel', togglePanel);

    return () => {
      keybindingManager.unregisterCommand('quickOpen.toggle');
      keybindingManager.unregisterCommand('nav.quickOpen');
      keybindingManager.unregisterCommand('commandPalette.toggle');
      keybindingManager.unregisterCommand('nav.commandPalette');
      keybindingManager.unregisterCommand('file.newFile');
      keybindingManager.unregisterCommand('terminal.toggle');
      keybindingManager.unregisterCommand('view.toggleTerminal');
      keybindingManager.unregisterCommand('sidebar.toggle');
      keybindingManager.unregisterCommand('view.toggleSidebar');
      keybindingManager.unregisterCommand('sidebar.toggleRight');
      keybindingManager.unregisterCommand('panel.toggle');
      keybindingManager.unregisterCommand('view.togglePanel');
    };
  }, [
    toggleQuickOpen,
    toggleCommandPalette,
    toggleTerminal,
    toggleSidebar,
    togglePanel,
    openModal,
  ]);
}

/**
 * Hook to register a command handler
 *
 * @param command - The command name (e.g., 'editor.save')
 * @param handler - The function to call when the command is triggered
 */
export function useCommand(command: string, handler: () => void | Promise<void>) {
  const stableHandler = useCallback(handler, [handler]);

  useEffect(() => {
    keybindingManager.registerCommand(command, stableHandler);
    return () => keybindingManager.unregisterCommand(command);
  }, [command, stableHandler]);
}

/**
 * Hook to get the keyboard shortcut for a command
 *
 * @param command - The command name
 * @returns The formatted keyboard shortcut string, or undefined
 */
export function useKeybindingLabel(command: string): string | undefined {
  const binding = keybindingManager.getKeybindingForCommand(command);
  if (!binding) return undefined;
  return keybindingManager.formatKeyForDisplay(binding.key);
}

/**
 * Hook to programmatically execute a command
 */
export function useExecuteCommand() {
  return useCallback((command: string) => {
    keybindingManager.executeCommand(command);
  }, []);
}
