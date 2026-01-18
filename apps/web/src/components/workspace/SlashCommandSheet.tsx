'use client';

import { useState, useMemo } from 'react';
import { Search, Slash, Terminal, Star, Loader2 } from 'lucide-react';
import {
  useCliAgentCommands,
  type SlashCommand,
  type CliAgentType,
} from '@/hooks/useCliAgentCommands';

interface SlashCommandSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: string) => void;
  agentType?: CliAgentType;
}

/**
 * Mobile-friendly sheet for browsing and selecting CLI agent slash commands.
 * Features search, categories, and quick selection.
 */
export function SlashCommandSheet({
  isOpen,
  onClose,
  onSelect,
  agentType = 'claude-code',
}: SlashCommandSheetProps) {
  const { commands, isLoading } = useCliAgentCommands(agentType);
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

  if (!isOpen) return null;

  return (
    <>
      {/* Invisible backdrop to catch clicks */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover positioned above the input area */}
      <div className="fixed bottom-20 left-3 right-3 z-50">
        <div className="bg-surface border border-border-default rounded-xl shadow-xl overflow-hidden">
          {/* Header with search */}
          <div className="p-3 border-b border-border-subtle">
            <div className="flex items-center gap-2 mb-2">
              <Slash className="h-4 w-4 text-accent-primary" />
              <h2 className="text-sm font-semibold text-text-primary">Slash Commands</h2>
            </div>
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full pl-8 pr-3 py-2 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                autoFocus
              />
            </div>
          </div>

          {/* Content - compact scrollable list */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              </div>
            ) : filteredCommands.length === 0 ? (
              <div className="text-center py-6 text-text-muted">
                <Terminal className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
                <p className="text-sm">No commands found</p>
              </div>
            ) : (
              <div className="py-1">
                {groupedCommands.builtin.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                      Built-in Commands
                    </div>
                    {groupedCommands.builtin.map((cmd) => (
                      <CommandItem key={cmd.name} command={cmd} onSelect={handleSelect} />
                    ))}
                  </div>
                )}

                {groupedCommands.custom.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1 border-t border-border-subtle mt-1 pt-2">
                      <Star className="h-3 w-3" />
                      Custom Commands
                    </div>
                    {groupedCommands.custom.map((cmd) => (
                      <CommandItem key={cmd.name} command={cmd} onSelect={handleSelect} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
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
      className="w-full px-3 py-2 text-left hover:bg-surface-hover active:bg-elevated transition-colors touch-manipulation"
    >
      <code className="text-sm font-mono text-accent-primary">/{command.name}</code>
      <p className="text-xs text-text-secondary">{command.description}</p>
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
  agentType?: CliAgentType;
}

export function SlashCommandDialog({
  isOpen,
  onClose,
  onSelect,
  agentType = 'claude-code',
}: SlashCommandDialogProps) {
  const { commands, isLoading } = useCliAgentCommands(agentType);
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
    <>
      {/* Invisible backdrop to catch clicks - pointer-events only for click, not scroll */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover positioned above the input area within the card */}
      <div className="absolute bottom-16 left-2 right-2 z-50">
        <div className="bg-surface border border-border-default rounded-xl shadow-xl overflow-hidden">
          {/* Header with search */}
          <div className="p-3 border-b border-border-subtle">
            <div className="flex items-center gap-2 mb-2">
              <Slash className="h-4 w-4 text-accent-primary" />
              <h2 className="text-sm font-semibold text-text-primary">Slash Commands</h2>
            </div>
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                className="w-full pl-8 pr-3 py-2 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                autoFocus
              />
            </div>
          </div>

          {/* Content - compact scrollable list */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              </div>
            ) : filteredCommands.length === 0 ? (
              <div className="text-center py-6 text-text-muted">
                <Terminal className="h-6 w-6 mx-auto mb-1.5 opacity-50" />
                <p className="text-sm">No commands found</p>
              </div>
            ) : (
              <div className="py-1">
                {groupedCommands.builtin.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                      Built-in Commands
                    </div>
                    {groupedCommands.builtin.map((cmd) => (
                      <button
                        key={cmd.name}
                        onClick={() => handleSelect(cmd)}
                        className="w-full px-3 py-2 text-left hover:bg-surface-hover transition-colors"
                      >
                        <code className="text-sm font-mono text-accent-primary">/{cmd.name}</code>
                        <p className="text-xs text-text-secondary">{cmd.description}</p>
                      </button>
                    ))}
                  </div>
                )}

                {groupedCommands.custom.length > 0 && (
                  <div>
                    <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider flex items-center gap-1 border-t border-border-subtle mt-1 pt-2">
                      <Star className="h-3 w-3" />
                      Custom Commands
                    </div>
                    {groupedCommands.custom.map((cmd) => (
                      <button
                        key={cmd.name}
                        onClick={() => handleSelect(cmd)}
                        className="w-full px-3 py-2 text-left hover:bg-surface-hover transition-colors"
                      >
                        <code className="text-sm font-mono text-accent-primary">/{cmd.name}</code>
                        <p className="text-xs text-text-secondary">{cmd.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
