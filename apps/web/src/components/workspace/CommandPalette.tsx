'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import {
  Bot,
  Clock,
  FileCode,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Layout,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sun,
  Terminal,
  TestTube,
  RefreshCw,
  Keyboard,
  HelpCircle,
  Palette,
  Split,
  Monitor,
  Eye,
  EyeOff,
  Zap,
  Folder,
  Save,
  Download,
  Upload,
  MessageSquare,
  Users,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { sendAgentMessage } from '@/lib/api';

interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  group: string;
  action: () => void | Promise<void>;
  keywords?: string[];
}

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
  const architectAgent = agents.find((a) => a.role === 'architect');
  const coderAgent = agents.find((a) => a.role === 'coder');
  const reviewerAgent = agents.find((a) => a.role === 'reviewer');
  const testerAgent = agents.find((a) => a.role === 'tester');

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

  // View mode commands
  const viewModeLabel = useMemo(() => {
    switch (currentViewMode) {
      case 'grid':
        return 'Switch to Focus Mode';
      case 'focus':
        return 'Switch to Freeform Mode';
      case 'freeform':
        return 'Switch to Grid Mode';
      default:
        return 'Switch View Mode';
    }
  }, [currentViewMode]);

  // Build command list
  const commands: CommandItem[] = useMemo(() => {
    const baseCommands: CommandItem[] = [
      // Agent commands
      {
        id: 'new-agent',
        label: 'Create New Agent',
        shortcut: '⌘N',
        icon: <Plus className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['add', 'agent', 'new', 'create'],
        action: () => openModal('create-agent'),
      },
      {
        id: 'architect-plan',
        label: 'Ask Architect to Plan',
        icon: <Bot className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['architect', 'plan', 'design'],
        action: async () => {
          if (!currentSessionId || !architectAgent) {
            openModal('create-agent', { suggestedRole: 'architect' });
            return;
          }
          await sendAgentMessage(
            currentSessionId,
            architectAgent.id,
            'Please analyze and create a plan for the current task.'
          );
        },
      },
      {
        id: 'coder-implement',
        label: 'Ask Coder to Implement',
        icon: <Bot className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['coder', 'implement', 'code', 'write'],
        action: async () => {
          if (!currentSessionId || !coderAgent) {
            openModal('create-agent', { suggestedRole: 'coder' });
            return;
          }
          await sendAgentMessage(
            currentSessionId,
            coderAgent.id,
            'Please implement the planned changes.'
          );
        },
      },
      {
        id: 'review-code',
        label: 'Request Code Review',
        icon: <MessageSquare className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['review', 'feedback', 'check'],
        action: async () => {
          if (!currentSessionId || !reviewerAgent) {
            openModal('create-agent', { suggestedRole: 'reviewer' });
            return;
          }
          await sendAgentMessage(
            currentSessionId,
            reviewerAgent.id,
            'Please review the current code changes and provide feedback.'
          );
        },
      },
      {
        id: 'run-tests',
        label: 'Run Tests with Tester Agent',
        icon: <TestTube className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['test', 'testing', 'tester'],
        action: async () => {
          if (!currentSessionId || !testerAgent) {
            openModal('create-agent', { suggestedRole: 'tester' });
            return;
          }
          await sendAgentMessage(
            currentSessionId,
            testerAgent.id,
            'Please run the test suite and report results.'
          );
        },
      },
      {
        id: 'broadcast-all',
        label: 'Broadcast to All Agents',
        icon: <Users className="h-4 w-4" />,
        group: 'Agents',
        keywords: ['all', 'broadcast', 'everyone'],
        action: () => openModal('broadcast-message'),
      },

      // File commands
      {
        id: 'open-file',
        label: 'Open File...',
        shortcut: '⌘P',
        icon: <FileCode className="h-4 w-4" />,
        group: 'Files',
        keywords: ['file', 'open', 'quick'],
        action: () => openModal('file-picker'),
      },
      {
        id: 'new-file',
        label: 'New File',
        icon: <Plus className="h-4 w-4" />,
        group: 'Files',
        keywords: ['new', 'create', 'file'],
        action: () => openModal('new-file'),
      },
      {
        id: 'save-all',
        label: 'Save All Files',
        shortcut: '⌘⇧S',
        icon: <Save className="h-4 w-4" />,
        group: 'Files',
        keywords: ['save', 'all'],
        action: () => announce('All files saved'),
      },
      {
        id: 'open-folder',
        label: 'Open Folder...',
        icon: <Folder className="h-4 w-4" />,
        group: 'Files',
        keywords: ['folder', 'directory', 'workspace'],
        action: () => openModal('open-folder'),
      },

      // View commands
      {
        id: 'toggle-terminal',
        label: terminalVisible ? 'Hide Terminal' : 'Show Terminal',
        shortcut: '⌘`',
        icon: <Terminal className="h-4 w-4" />,
        group: 'View',
        keywords: ['terminal', 'console', 'shell'],
        action: toggleTerminal,
      },
      {
        id: 'toggle-left-sidebar',
        label: leftSidebarCollapsed ? 'Show Left Sidebar' : 'Hide Left Sidebar',
        shortcut: '⌘B',
        icon: leftSidebarCollapsed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />,
        group: 'View',
        keywords: ['sidebar', 'explorer', 'panel', 'left'],
        action: () => toggleSidebar('left'),
      },
      {
        id: 'toggle-right-sidebar',
        label: rightSidebarCollapsed ? 'Show Right Sidebar' : 'Hide Right Sidebar',
        shortcut: '⌘⇧B',
        icon: rightSidebarCollapsed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />,
        group: 'View',
        keywords: ['sidebar', 'agents', 'panel', 'right'],
        action: () => toggleSidebar('right'),
      },
      {
        id: 'toggle-panel',
        label: 'Toggle Bottom Panel',
        shortcut: '⌘J',
        icon: <Layout className="h-4 w-4" />,
        group: 'View',
        keywords: ['panel', 'output', 'problems'],
        action: togglePanel,
      },
      {
        id: 'toggle-layout',
        label: viewModeLabel,
        icon: <LayoutGrid className="h-4 w-4" />,
        group: 'View',
        keywords: ['layout', 'grid', 'focus', 'freeform'],
        action: () => {
          if (currentSessionId) {
            const modes: Array<'grid' | 'focus' | 'freeform'> = ['grid', 'focus', 'freeform'];
            const currentIndex = modes.indexOf(currentViewMode);
            const nextMode = modes[(currentIndex + 1) % modes.length] ?? 'grid';
            setViewMode(currentSessionId, nextMode);
            announce(`Switched to ${nextMode} mode`);
          }
        },
      },
      {
        id: 'focus-mode',
        label: focusMode ? 'Exit Focus Mode' : 'Enter Focus Mode',
        icon: focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />,
        group: 'View',
        keywords: ['focus', 'zen', 'distraction'],
        action: toggleFocusMode,
      },
      {
        id: 'split-view',
        label: 'Split Editor',
        icon: <Split className="h-4 w-4" />,
        group: 'View',
        keywords: ['split', 'editor', 'pane'],
        action: () => openModal('split-editor'),
      },

      // Git commands
      {
        id: 'git-commit',
        label: 'Git: Commit',
        icon: <GitCommit className="h-4 w-4" />,
        group: 'Git',
        keywords: ['git', 'commit', 'save'],
        action: () => openModal('git-commit'),
      },
      {
        id: 'git-push',
        label: 'Git: Push',
        icon: <Upload className="h-4 w-4" />,
        group: 'Git',
        keywords: ['git', 'push', 'upload'],
        action: () => openModal('git-push'),
      },
      {
        id: 'git-pull',
        label: 'Git: Pull',
        icon: <Download className="h-4 w-4" />,
        group: 'Git',
        keywords: ['git', 'pull', 'fetch'],
        action: () => openModal('git-pull'),
      },
      {
        id: 'create-branch',
        label: 'Git: Create Branch',
        icon: <GitBranch className="h-4 w-4" />,
        group: 'Git',
        keywords: ['git', 'branch', 'new'],
        action: () => openModal('git-branch'),
      },
      {
        id: 'create-pr',
        label: 'Create Pull Request',
        icon: <GitPullRequest className="h-4 w-4" />,
        group: 'Git',
        keywords: ['pr', 'pull request', 'merge'],
        action: () => openModal('create-pr'),
      },

      // Theme commands
      {
        id: 'theme-dark',
        label: 'Theme: Dark',
        icon: <Moon className="h-4 w-4" />,
        group: 'Appearance',
        keywords: ['theme', 'dark', 'night'],
        action: () => {
          setTheme('dark');
          announce('Dark theme enabled');
        },
      },
      {
        id: 'theme-light',
        label: 'Theme: Light',
        icon: <Sun className="h-4 w-4" />,
        group: 'Appearance',
        keywords: ['theme', 'light', 'day'],
        action: () => {
          setTheme('light');
          announce('Light theme enabled');
        },
      },
      {
        id: 'theme-system',
        label: 'Theme: System',
        icon: <Monitor className="h-4 w-4" />,
        group: 'Appearance',
        keywords: ['theme', 'system', 'auto'],
        action: () => {
          setTheme('system');
          announce('System theme enabled');
        },
      },
      {
        id: 'color-theme',
        label: 'Color Theme...',
        icon: <Palette className="h-4 w-4" />,
        group: 'Appearance',
        keywords: ['color', 'theme', 'customize'],
        action: () => router.push('/settings/themes'),
      },

      // Navigation commands
      {
        id: 'go-dashboard',
        label: 'Go to Dashboard',
        icon: <LayoutGrid className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['dashboard', 'home', 'main'],
        action: () => router.push('/dashboard'),
      },
      {
        id: 'go-settings',
        label: 'Open Settings',
        shortcut: '⌘,',
        icon: <Settings className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['settings', 'preferences', 'config'],
        action: () => router.push('/settings'),
      },
      {
        id: 'keyboard-shortcuts',
        label: 'Keyboard Shortcuts',
        shortcut: '⌘K ⌘S',
        icon: <Keyboard className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['keyboard', 'shortcuts', 'keybindings'],
        action: () => router.push('/settings/keybindings'),
      },
      {
        id: 'new-session',
        label: 'New Session',
        icon: <Zap className="h-4 w-4" />,
        group: 'Navigation',
        keywords: ['new', 'session', 'pod'],
        action: () => router.push('/session/new'),
      },

      // Help commands
      {
        id: 'show-help',
        label: 'Show All Commands',
        shortcut: '⌘⇧P',
        icon: <HelpCircle className="h-4 w-4" />,
        group: 'Help',
        keywords: ['help', 'commands', 'all'],
        action: () => {}, // Already open
      },
      {
        id: 'docs',
        label: 'Open Documentation',
        icon: <HelpCircle className="h-4 w-4" />,
        group: 'Help',
        keywords: ['docs', 'documentation', 'help'],
        action: () => window.open('https://docs.podex.dev', '_blank'),
      },
    ];

    // Add session-specific commands
    if (currentSession) {
      baseCommands.push(
        {
          id: 'pause-session',
          label: 'Pause Session (Standby)',
          icon: <Pause className="h-4 w-4" />,
          group: 'Session',
          keywords: ['pause', 'standby', 'stop', 'save'],
          action: () => openModal('pause-session'),
        },
        {
          id: 'resume-session',
          label: 'Resume Session',
          icon: <Play className="h-4 w-4" />,
          group: 'Session',
          keywords: ['resume', 'start', 'wake', 'unpause'],
          action: () => openModal('resume-session'),
        },
        {
          id: 'standby-settings',
          label: 'Configure Auto-Standby',
          icon: <Clock className="h-4 w-4" />,
          group: 'Session',
          keywords: ['standby', 'timeout', 'idle', 'auto', 'settings'],
          action: () => openModal('standby-settings'),
        },
        {
          id: 'restart-session',
          label: 'Restart Session',
          icon: <RefreshCw className="h-4 w-4" />,
          group: 'Session',
          keywords: ['restart', 'reload', 'session'],
          action: () => openModal('restart-session'),
        }
      );
    }

    return baseCommands;
  }, [
    currentSessionId,
    currentSession,
    currentViewMode,
    architectAgent,
    coderAgent,
    reviewerAgent,
    testerAgent,
    terminalVisible,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    focusMode,
    viewModeLabel,
    openModal,
    toggleTerminal,
    toggleSidebar,
    togglePanel,
    toggleFocusMode,
    setViewMode,
    setTheme,
    announce,
    router,
  ]);

  // Group commands
  const groupedCommands = useMemo(() => {
    return commands.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
      const group = acc[cmd.group] ?? [];
      group.push(cmd);
      acc[cmd.group] = group;
      return acc;
    }, {});
  }, [commands]);

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
