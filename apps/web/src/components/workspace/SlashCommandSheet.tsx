'use client';

import { useState, useMemo } from 'react';
import { Search, Slash, Terminal, Star, Loader2 } from 'lucide-react';
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet';
import { cn } from '@/lib/utils';
import { useClaudeCodeCommands, type SlashCommand } from '@/hooks/useClaudeCodeCommands';

interface SlashCommandSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
}

/**
 * Mobile-friendly sheet for browsing and selecting Claude Code slash commands.
 * Features search, categories, and quick selection.
 */
export function SlashCommandSheet({ isOpen, onClose, onSelect }: SlashCommandSheetProps) {
  const { commands, isLoading } = useClaudeCodeCommands();
  const [search, setSearch] = useState('');

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;

    const term = search.toLowerCase();
    return commands.filter(
      (cmd) => cmd.name.toLowerCase().includes(term) || cmd.description.toLowerCase().includes(term)
    );
  }, [commands, search]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const builtin = filteredCommands.filter((cmd) => cmd.builtin);
    const custom = filteredCommands.filter((cmd) => !cmd.builtin);
    return { builtin, custom };
  }, [filteredCommands]);

  const handleSelect = (command: SlashCommand) => {
    onSelect(command.name);
    onClose();
  };

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Slash Commands"
      icon={<Slash className="h-5 w-5" />}
      height="half"
      draggable={true}
    >
      {/* Search input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search commands..."
          className="w-full pl-10 pr-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          autoFocus
        />
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      ) : filteredCommands.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No commands found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Built-in commands */}
          {groupedCommands.builtin.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 px-1">
                Built-in Commands
              </h4>
              <div className="space-y-1">
                {groupedCommands.builtin.map((cmd) => (
                  <CommandItem key={cmd.name} command={cmd} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          )}

          {/* Custom commands */}
          {groupedCommands.custom.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                <Star className="h-3 w-3" />
                Custom Commands
              </h4>
              <div className="space-y-1">
                {groupedCommands.custom.map((cmd) => (
                  <CommandItem key={cmd.name} command={cmd} onSelect={handleSelect} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </MobileBottomSheet>
  );
}

interface CommandItemProps {
  command: SlashCommand;
  onSelect: (command: SlashCommand) => void;
}

function CommandItem({ command, onSelect }: CommandItemProps) {
  return (
    <button
      onClick={() => onSelect(command)}
      className={cn(
        'w-full p-3 text-left rounded-lg transition-colors',
        'hover:bg-surface-hover active:bg-elevated',
        'touch-manipulation min-h-[56px]'
      )}
    >
      <div className="flex items-center gap-2">
        <code className="text-sm font-mono text-accent-primary">/{command.name}</code>
        {command.builtin && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-elevated text-text-muted">
            built-in
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary mt-1 line-clamp-2">{command.description}</p>
    </button>
  );
}

/**
 * Desktop-friendly dialog version for larger screens.
 * Uses the same command list but in a dialog format.
 */
interface SlashCommandDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
}

export function SlashCommandDialog({ isOpen, onClose, onSelect }: SlashCommandDialogProps) {
  const { commands, isLoading } = useClaudeCodeCommands();
  const [search, setSearch] = useState('');

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;

    const term = search.toLowerCase();
    return commands.filter(
      (cmd) => cmd.name.toLowerCase().includes(term) || cmd.description.toLowerCase().includes(term)
    );
  }, [commands, search]);

  const groupedCommands = useMemo(() => {
    const builtin = filteredCommands.filter((cmd) => cmd.builtin);
    const custom = filteredCommands.filter((cmd) => !cmd.builtin);
    return { builtin, custom };
  }, [filteredCommands]);

  const handleSelect = (cmd: SlashCommand) => {
    onSelect(cmd.name);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 hidden md:flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-surface border border-border-default rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-border-subtle">
          <div className="flex items-center gap-2 mb-3">
            <Slash className="h-5 w-5 text-accent-primary" />
            <h2 className="text-lg font-semibold text-text-primary">Slash Commands</h2>
          </div>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search commands..."
              className="w-full pl-10 pr-4 py-2 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              autoFocus
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <Terminal className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No commands found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedCommands.builtin.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
                    Built-in Commands
                  </h4>
                  <div className="space-y-1">
                    {groupedCommands.builtin.map((cmd) => (
                      <button
                        key={cmd.name}
                        onClick={() => handleSelect(cmd)}
                        className="w-full p-2.5 text-left rounded-lg hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-accent-primary">/{cmd.name}</code>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">{cmd.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupedCommands.custom.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                    <Star className="h-3 w-3" />
                    Custom Commands
                  </h4>
                  <div className="space-y-1">
                    {groupedCommands.custom.map((cmd) => (
                      <button
                        key={cmd.name}
                        onClick={() => handleSelect(cmd)}
                        className="w-full p-2.5 text-left rounded-lg hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-accent-primary">/{cmd.name}</code>
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">{cmd.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
