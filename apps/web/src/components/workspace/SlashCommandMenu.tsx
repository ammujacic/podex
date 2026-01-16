'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BookOpen,
  Braces,
  ChevronRight,
  CircleSlash,
  Code2,
  Command,
  FileText,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitPullRequest,
  HelpCircle,
  History,
  Loader2,
  PackageCheck,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  TestTube2,
  Trash2,
  Undo2,
  Wand2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listCommands, type CustomCommand } from '@/lib/api';

// Built-in command definitions
export interface BuiltInCommand {
  name: string;
  description: string;
  category: 'builtin' | 'development' | 'git' | 'agent';
  icon: React.ElementType;
  // If true, command executes immediately without sending to agent
  immediate?: boolean;
  // Arguments the command accepts
  args?: { name: string; required: boolean; description: string }[];
  // For immediate commands, the action to perform
  action?: 'clear' | 'compact' | 'checkpoint' | 'undo' | 'mode' | 'model' | 'think' | 'help';
}

export const BUILTIN_COMMANDS: BuiltInCommand[] = [
  // Built-in commands
  {
    name: 'init',
    description: 'Initialize project with AGENTS.md',
    category: 'builtin',
    icon: FolderOpen,
  },
  {
    name: 'help',
    description: 'Show all available commands',
    category: 'builtin',
    icon: HelpCircle,
    immediate: true,
    action: 'help',
  },
  {
    name: 'clear',
    description: 'Clear conversation history',
    category: 'builtin',
    icon: Trash2,
    immediate: true,
    action: 'clear',
  },
  {
    name: 'compact',
    description: 'Compact context to save tokens',
    category: 'builtin',
    icon: RefreshCw,
    immediate: true,
    action: 'compact',
  },
  {
    name: 'checkpoint',
    description: 'Create a checkpoint of current changes',
    category: 'builtin',
    icon: History,
    immediate: true,
    action: 'checkpoint',
  },
  {
    name: 'undo',
    description: 'Restore to last checkpoint',
    category: 'builtin',
    icon: Undo2,
    immediate: true,
    action: 'undo',
  },
  // Agent control commands
  {
    name: 'mode',
    description: 'Open mode settings dialog',
    category: 'agent',
    icon: Settings2,
    immediate: true,
    action: 'mode',
  },
  {
    name: 'model',
    description: 'Open model selector',
    category: 'agent',
    icon: Sparkles,
    immediate: true,
    action: 'model',
  },
  {
    name: 'think',
    description: 'Configure extended thinking',
    category: 'agent',
    icon: Zap,
    immediate: true,
    action: 'think',
  },
  // Development commands
  {
    name: 'test',
    description: 'Run project tests',
    category: 'development',
    icon: TestTube2,
  },
  {
    name: 'lint',
    description: 'Run linter on the project',
    category: 'development',
    icon: CircleSlash,
  },
  {
    name: 'format',
    description: 'Format code files',
    category: 'development',
    icon: Braces,
  },
  {
    name: 'build',
    description: 'Build the project',
    category: 'development',
    icon: PackageCheck,
  },
  {
    name: 'run',
    description: 'Run a command in the terminal',
    category: 'development',
    icon: Play,
    args: [{ name: 'command', required: true, description: 'Command to execute' }],
  },
  {
    name: 'explain',
    description: 'Explain code or concept',
    category: 'development',
    icon: BookOpen,
    args: [{ name: 'topic', required: true, description: 'What to explain' }],
  },
  {
    name: 'refactor',
    description: 'Refactor code with instructions',
    category: 'development',
    icon: Wand2,
    args: [{ name: 'instructions', required: true, description: 'Refactoring instructions' }],
  },
  // Git commands
  {
    name: 'diff',
    description: 'Show current git changes',
    category: 'git',
    icon: Code2,
  },
  {
    name: 'commit',
    description: 'Create a git commit',
    category: 'git',
    icon: GitCommit,
    args: [
      {
        name: 'message',
        required: false,
        description: 'Commit message (auto-generated if not provided)',
      },
    ],
  },
  {
    name: 'push',
    description: 'Push changes to remote',
    category: 'git',
    icon: GitBranch,
  },
  {
    name: 'pr',
    description: 'Create a pull request',
    category: 'git',
    icon: GitPullRequest,
    args: [
      { name: 'title', required: false, description: 'PR title (auto-generated if not provided)' },
    ],
  },
];

const categoryLabels: Record<string, { label: string; icon: React.ElementType }> = {
  builtin: { label: 'Built-in', icon: Command },
  agent: { label: 'Agent Control', icon: Settings2 },
  development: { label: 'Development', icon: Code2 },
  git: { label: 'Git', icon: GitBranch },
  custom: { label: 'Custom', icon: Sparkles },
};

export interface SlashCommandMenuProps {
  query: string; // The text after the slash (e.g., "ini" for "/ini")
  sessionId: string;
  onSelect: (command: BuiltInCommand | CustomCommand, args?: string) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

export function SlashCommandMenu({
  query,
  sessionId,
  onSelect,
  onClose,
  position,
}: SlashCommandMenuProps) {
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  // Fetch custom commands
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    listCommands({ sessionId, includeGlobal: true, enabledOnly: true })
      .then((response) => {
        if (!cancelled) {
          setCustomCommands(response.commands);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch commands:', error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Filter commands based on query
  const filteredBuiltIn = useMemo(() => {
    const q = query.toLowerCase();
    return BUILTIN_COMMANDS.filter(
      (cmd) => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    );
  }, [query]);

  const filteredCustom = useMemo(() => {
    const q = query.toLowerCase();
    return customCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) || (cmd.description?.toLowerCase().includes(q) ?? false)
    );
  }, [query, customCommands]);

  // Group built-in commands by category
  const groupedBuiltIn = useMemo(() => {
    const groups: Record<string, BuiltInCommand[]> = {};
    for (const cmd of filteredBuiltIn) {
      if (!groups[cmd.category]) {
        groups[cmd.category] = [];
      }
      groups[cmd.category]!.push(cmd);
    }
    return groups;
  }, [filteredBuiltIn]);

  // Build flat list for keyboard navigation
  const flatList = useMemo(() => {
    const items: Array<
      { type: 'builtin'; command: BuiltInCommand } | { type: 'custom'; command: CustomCommand }
    > = [];

    // Add built-in by category order
    const categoryOrder = ['builtin', 'agent', 'development', 'git'];
    for (const category of categoryOrder) {
      const commands = groupedBuiltIn[category];
      if (commands) {
        for (const cmd of commands) {
          items.push({ type: 'builtin', command: cmd });
        }
      }
    }

    // Add custom commands
    for (const cmd of filteredCustom) {
      items.push({ type: 'custom', command: cmd });
    }

    return items;
  }, [groupedBuiltIn, filteredCustom]);

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatList.length]);

  // Scroll selected item into view
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = flatList[selectedIndex];
        if (selected) {
          if (selected.type === 'builtin') {
            onSelect(selected.command);
          } else {
            onSelect(selected.command);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Tab completes the command name
        const selected = flatList[selectedIndex];
        if (selected) {
          // Let parent handle completion
          onSelect(selected.command);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flatList, selectedIndex, onSelect, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleItemClick = useCallback(
    (item: (typeof flatList)[0]) => {
      if (item.type === 'builtin') {
        onSelect(item.command);
      } else {
        onSelect(item.command);
      }
    },
    [onSelect]
  );

  const isEmpty = flatList.length === 0 && !isLoading;

  // Render category section
  const renderCategory = (category: string, commands: BuiltInCommand[], startIndex: number) => {
    const config = categoryLabels[category];
    const CategoryIcon = config?.icon ?? Command;

    return (
      <div key={category}>
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-text-muted">
          <CategoryIcon className="h-3 w-3" />
          <span>{config?.label ?? category}</span>
        </div>
        {commands.map((cmd, idx) => {
          const globalIdx = startIndex + idx;
          const isSelected = globalIdx === selectedIndex;
          const CmdIcon = cmd.icon;

          return (
            <button
              key={cmd.name}
              ref={isSelected ? selectedItemRef : undefined}
              onClick={() => handleItemClick({ type: 'builtin', command: cmd })}
              className={cn(
                'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors rounded-md mx-1 cursor-pointer',
                isSelected
                  ? 'bg-accent-primary/20 text-text-primary'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
              )}
            >
              <CmdIcon className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">/{cmd.name}</span>
                  {cmd.args && cmd.args.length > 0 && (
                    <span className="text-text-muted text-xs">
                      {cmd.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(' ')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted truncate">{cmd.description}</p>
              </div>
              {cmd.immediate && (
                <span className="text-xs text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">
                  instant
                </span>
              )}
              {isSelected && <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
            </button>
          );
        })}
      </div>
    );
  };

  // Calculate start indices for each category
  let currentIndex = 0;
  const categoryStartIndices: Record<string, number> = {};
  const categoryOrder = ['builtin', 'agent', 'development', 'git'];
  for (const category of categoryOrder) {
    const commands = groupedBuiltIn[category];
    if (commands) {
      categoryStartIndices[category] = currentIndex;
      currentIndex += commands.length;
    }
  }
  const customStartIndex = currentIndex;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 w-80 max-h-80 overflow-y-auto rounded-lg border border-border-default bg-surface shadow-xl"
      style={
        position
          ? { top: position.top, left: position.left }
          : { bottom: '100%', left: 0, marginBottom: '4px' }
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : isEmpty ? (
        <div className="py-8 text-center text-sm text-text-muted">
          <p>No commands found for "{query}"</p>
        </div>
      ) : (
        <div className="py-1">
          {/* Built-in commands by category */}
          {categoryOrder.map((category) => {
            const commands = groupedBuiltIn[category];
            if (!commands || commands.length === 0) return null;
            return renderCategory(category, commands, categoryStartIndices[category] ?? 0);
          })}

          {/* Custom commands */}
          {filteredCustom.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-text-muted border-t border-border-subtle mt-1 pt-2">
                <Sparkles className="h-3 w-3" />
                <span>Custom</span>
              </div>
              {filteredCustom.map((cmd, idx) => {
                const globalIdx = customStartIndex + idx;
                const isSelected = globalIdx === selectedIndex;

                return (
                  <button
                    key={cmd.id}
                    ref={isSelected ? selectedItemRef : undefined}
                    onClick={() => handleItemClick({ type: 'custom', command: cmd })}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors rounded-md mx-1 cursor-pointer',
                      isSelected
                        ? 'bg-accent-primary/20 text-text-primary'
                        : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">/{cmd.name}</span>
                        {cmd.arguments && cmd.arguments.length > 0 && (
                          <span className="text-text-muted text-xs">
                            {cmd.arguments
                              .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
                              .join(' ')}
                          </span>
                        )}
                      </div>
                      {cmd.description && (
                        <p className="text-xs text-text-muted truncate">{cmd.description}</p>
                      )}
                    </div>
                    {isSelected && <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Keyboard hints */}
          <div className="flex items-center justify-between px-2 py-1.5 text-xs text-text-muted border-t border-border-subtle mt-1">
            <span>
              <kbd className="px-1 py-0.5 bg-elevated rounded text-[10px]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-elevated rounded text-[10px]">↵</kbd> select
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-elevated rounded text-[10px]">esc</kbd> close
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper to check if a command is a built-in command
export function isBuiltInCommand(
  command: BuiltInCommand | CustomCommand
): command is BuiltInCommand {
  return 'icon' in command;
}
