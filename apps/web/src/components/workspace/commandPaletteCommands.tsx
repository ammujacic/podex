/**
 * Command definitions for the Command Palette.
 * Extracted to keep the CommandPalette component focused on rendering.
 */

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
  Plus,
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
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Session, Agent } from '@/stores/session';

export interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ReactNode;
  group: string;
  action: () => void | Promise<void>;
  keywords?: string[];
}

interface CommandDependencies {
  // Session state
  currentSessionId: string | null;
  currentSession: Session | null | undefined;
  currentViewMode: 'grid' | 'focus' | 'freeform';
  agents: Agent[];

  // UI state
  terminalVisible: boolean;
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  focusMode: boolean;

  // Actions
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  toggleTerminal: () => void;
  toggleSidebar: (side: 'left' | 'right') => void;
  togglePanel: () => void;
  toggleFocusMode: () => void;
  setViewMode: (sessionId: string, mode: 'grid' | 'focus' | 'freeform') => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  announce: (message: string) => void;
  sendMessage: (
    sessionId: string,
    agentId: string,
    message: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options?: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Promise<any>;
  router: AppRouterInstance;
}

export function buildCommands(deps: CommandDependencies): CommandItem[] {
  const {
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
    setViewMode,
    setTheme,
    announce,
    sendMessage,
    router,
  } = deps;

  const architectAgent = agents.find((a) => a.role === 'architect');
  const coderAgent = agents.find((a) => a.role === 'coder');
  const reviewerAgent = agents.find((a) => a.role === 'reviewer');
  const testerAgent = agents.find((a) => a.role === 'tester');

  const viewModeLabel = (() => {
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
  })();

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
        await sendMessage(
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
        await sendMessage(currentSessionId, coderAgent.id, 'Please implement the planned changes.');
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
        await sendMessage(
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
        await sendMessage(
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

    // Skill commands
    {
      id: 'skills-list',
      label: 'Skills: List Available',
      icon: <Zap className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'list', 'available', 'show'],
      action: async () => {
        // Send command to coder agent to list skills
        if (!currentSessionId || !coderAgent) {
          announce('No agent available to list skills');
          return;
        }
        await sendMessage(
          currentSessionId,
          coderAgent.id,
          '/skills - Please list all available skills I can use.'
        );
      },
    },
    {
      id: 'skills-run-bug-fix',
      label: 'Skills: Run Bug Fix',
      icon: <Zap className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'bug', 'fix', 'debug', 'run'],
      action: async () => {
        if (!currentSessionId || !coderAgent) {
          announce('No coder agent available');
          return;
        }
        await sendMessage(
          currentSessionId,
          coderAgent.id,
          '/run bug_fix - Please run the bug fix skill to diagnose and fix the current issue.'
        );
      },
    },
    {
      id: 'skills-run-code-review',
      label: 'Skills: Run Code Review',
      icon: <Zap className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'review', 'code', 'run'],
      action: async () => {
        if (!currentSessionId || !reviewerAgent) {
          if (!currentSessionId || !coderAgent) {
            announce('No agent available');
            return;
          }
          await sendMessage(
            currentSessionId,
            coderAgent.id,
            '/run code_review - Please run the code review skill on the current changes.'
          );
          return;
        }
        await sendMessage(
          currentSessionId,
          reviewerAgent.id,
          '/run code_review - Please run the code review skill on the current changes.'
        );
      },
    },
    {
      id: 'skills-run-tests',
      label: 'Skills: Run Test Runner',
      icon: <Zap className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'test', 'tests', 'run', 'runner'],
      action: async () => {
        if (!currentSessionId || !testerAgent) {
          if (!currentSessionId || !coderAgent) {
            announce('No agent available');
            return;
          }
          await sendMessage(
            currentSessionId,
            coderAgent.id,
            '/run test_runner - Please run the test runner skill.'
          );
          return;
        }
        await sendMessage(
          currentSessionId,
          testerAgent.id,
          '/run test_runner - Please run the test runner skill.'
        );
      },
    },
    {
      id: 'skills-run-security',
      label: 'Skills: Run Security Scan',
      icon: <Zap className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'security', 'scan', 'vulnerability', 'audit'],
      action: async () => {
        if (!currentSessionId || !coderAgent) {
          announce('No agent available');
          return;
        }
        await sendMessage(
          currentSessionId,
          coderAgent.id,
          '/run security_scan - Please run the security scan skill to check for vulnerabilities.'
        );
      },
    },
    {
      id: 'skills-manage',
      label: 'Skills: Manage My Skills',
      icon: <Settings className="h-4 w-4" />,
      group: 'Skills',
      keywords: ['skills', 'manage', 'settings', 'custom'],
      action: () => router.push('/settings/skills'),
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
}

export function groupCommands(commands: CommandItem[]): Record<string, CommandItem[]> {
  return commands.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    const group = acc[cmd.group] ?? [];
    group.push(cmd);
    acc[cmd.group] = group;
    return acc;
  }, {});
}
