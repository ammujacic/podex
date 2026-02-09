'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { sendAgentMessage } from '@/lib/api';
import { buildCommands, groupCommands } from './commandPaletteCommands';

export function CommandPalette() {
  const router = useRouter();
  const {
    commandPaletteOpen,
    closeCommandPalette,
    toggleTerminal,
    toggleSidebar,
    togglePanel,
    toggleFocusMode,
    focusMode,
    openModal,
    sidebarLayout,
    terminalVisible,
    announce,
    setTheme,
    openQuickOpen,
  } = useUIStore();
  const leftSidebarCollapsed = sidebarLayout.left.collapsed;
  const rightSidebarCollapsed = sidebarLayout.right.collapsed;
  const { sessions, currentSessionId, setViewMode } = useSessionStore();
  const [search, setSearch] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  const currentSession = currentSessionId ? sessions[currentSessionId] : null;
  const currentViewMode = currentSession?.viewMode ?? 'grid';

  // Find agents in current session
  const agents = useMemo(() => currentSession?.agents ?? [], [currentSession?.agents]);

  // Execute command with feedback
  const executeCommand = useCallback(
    async (action: () => void | Promise<void>, successMessage?: string) => {
      setIsExecuting(true);
      try {
        await action();
        if (successMessage) {
          announce(successMessage);
        }
      } catch (error) {
        console.error('Command failed:', error);
      } finally {
        setIsExecuting(false);
        closeCommandPalette();
      }
    },
    [closeCommandPalette, announce]
  );

  // Build and group commands using extracted functions
  const commands = useMemo(
    () =>
      buildCommands({
        currentSessionId,
        currentSession,
        currentViewMode,
        agents,
        terminalVisible,
        leftSidebarCollapsed,
        rightSidebarCollapsed,
        focusMode,
        openModal,
        toggleTerminal,
        toggleSidebar,
        togglePanel,
        toggleFocusMode,
        openQuickOpen,
        setViewMode,
        setTheme,
        announce,
        sendMessage: sendAgentMessage,
        router,
      }),
    [
      currentSessionId,
      currentSession,
      currentViewMode,
      agents,
      terminalVisible,
      leftSidebarCollapsed,
      rightSidebarCollapsed,
      focusMode,
      openModal,
      toggleTerminal,
      toggleSidebar,
      togglePanel,
      toggleFocusMode,
      openQuickOpen,
      setViewMode,
      setTheme,
      announce,
      router,
    ]
  );

  const groupedCommands = useMemo(() => groupCommands(commands), [commands]);

  // Close on escape
  useEffect(() => {
    if (!commandPaletteOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, closeCommandPalette]);

  // Reset search when opening
  useEffect(() => {
    if (commandPaletteOpen) {
      setSearch('');
    }
  }, [commandPaletteOpen]);

  if (!commandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center pt-[15vh] md:pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={closeCommandPalette}
        aria-hidden="true"
      />

      {/* Command dialog */}
      <Command
        className="relative w-full max-w-2xl mx-4 rounded-xl border border-border-default bg-surface shadow-modal overflow-hidden animate-scale-in"
        loop
        shouldFilter
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-4">
          <Search className="h-5 w-5 text-text-muted flex-shrink-0" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent py-4 text-text-primary placeholder:text-text-muted focus:outline-none min-h-touch"
            autoFocus
          />
          {isExecuting && (
            <div className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Commands list */}
        <Command.List className="max-h-[60vh] md:max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-text-muted">
            No commands found.
          </Command.Empty>

          {Object.entries(groupedCommands).map(([group, items]) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-2 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider"
            >
              {items.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                  onSelect={() => executeCommand(item.action)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer',
                    'text-text-secondary hover:bg-overlay hover:text-text-primary',
                    'data-[selected=true]:bg-overlay data-[selected=true]:text-text-primary',
                    'min-h-touch transition-colors'
                  )}
                >
                  <span className="text-text-muted flex-shrink-0">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-elevated px-2 py-0.5 text-xs text-text-muted">
                      {item.shortcut}
                    </kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle text-xs text-text-muted">
          <span>
            <kbd className="px-1.5 py-0.5 bg-elevated rounded">↑↓</kbd> to navigate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-elevated rounded">↵</kbd> to select
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-elevated rounded">esc</kbd> to close
          </span>
        </div>
      </Command>
    </div>
  );
}
