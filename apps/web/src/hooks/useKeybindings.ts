'use client';

import { useEffect, useCallback } from 'react';
import { keybindingManager, defaultKeybindings } from '@/lib/keybindings';
import { useUIStore } from '@/stores/ui';

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
  } = useUIStore();

  // Update keybinding context when UI state changes
  useEffect(() => {
    keybindingManager.setContext({
      quickOpenOpen,
      commandPaletteOpen,
      modalOpen: activeModal !== null,
    });
  }, [quickOpenOpen, commandPaletteOpen, activeModal]);

  // Register default keybindings
  useEffect(() => {
    keybindingManager.registerKeybindings(defaultKeybindings);
  }, []);

  // Register core command handlers
  useEffect(() => {
    // Navigation commands
    keybindingManager.registerCommand('quickOpen.toggle', toggleQuickOpen);
    keybindingManager.registerCommand('commandPalette.toggle', toggleCommandPalette);

    // View commands
    keybindingManager.registerCommand('terminal.toggle', toggleTerminal);
    keybindingManager.registerCommand('sidebar.toggle', () => toggleSidebar('left'));
    keybindingManager.registerCommand('sidebar.toggleRight', () => toggleSidebar('right'));
    keybindingManager.registerCommand('panel.toggle', togglePanel);

    return () => {
      keybindingManager.unregisterCommand('quickOpen.toggle');
      keybindingManager.unregisterCommand('commandPalette.toggle');
      keybindingManager.unregisterCommand('terminal.toggle');
      keybindingManager.unregisterCommand('sidebar.toggle');
      keybindingManager.unregisterCommand('sidebar.toggleRight');
      keybindingManager.unregisterCommand('panel.toggle');
    };
  }, [toggleQuickOpen, toggleCommandPalette, toggleTerminal, toggleSidebar, togglePanel]);
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
