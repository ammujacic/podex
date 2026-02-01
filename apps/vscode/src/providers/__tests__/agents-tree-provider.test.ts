/**
 * Agents tree provider tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  TreeItem: class MockTreeItem {
    id?: string;
    label?: string;
    description?: string;
    tooltip?: unknown;
    contextValue?: string;
    iconPath?: unknown;
    collapsibleState?: number;

    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ThemeIcon: class MockThemeIcon {
    constructor(
      public id: string,
      public color?: unknown
    ) {}
  },
  ThemeColor: class MockThemeColor {
    constructor(public id: string) {}
  },
  MarkdownString: class MockMarkdownString {
    value = '';
    appendMarkdown(text: string) {
      this.value += text;
      return this;
    }
  },
  EventEmitter: class MockEventEmitter {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handlers: ((data?: any) => void)[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event = (handler: (data?: any) => void) => {
      this.handlers.push(handler);
      return { dispose: () => {} };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fire(data?: any) {
      this.handlers.forEach((h) => h(data));
    }
    dispose() {}
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
  },
}));

// Mock API client
const mockGetAgents = vi.fn();

vi.mock('../../services/api-client', () => ({
  sessionApi: {
    getAgents: mockGetAgents,
  },
}));

// Mock socket service
const mockIsSocketConnected = vi.fn(() => false);
const mockOnSocketEvent = vi.fn(() => vi.fn());

vi.mock('../../services/socket-service', () => ({
  isSocketConnected: mockIsSocketConnected,
  onSocketEvent: mockOnSocketEvent,
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

describe('AgentsTreeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('AgentTreeItem', () => {
    it('should create tree item with correct properties', async () => {
      const { AgentTreeItem } = await import('../agents-tree-provider');

      const agent = {
        id: 'agent-123',
        name: 'Test Agent',
        role: 'assistant',
        model: 'anthropic/claude-3-5-sonnet',
        status: 'idle' as const,
        color: 'cyan' as const,
      };

      const item = new AgentTreeItem(agent, 0);

      expect(item.id).toBe('agent-123');
      expect(item.label).toBe('Test Agent');
      expect(item.description).toContain('idle');
      expect(item.description).toContain('claude-3-5-sonnet');
      expect(item.contextValue).toBe('agent-idle');
    });

    it('should show different icons for different statuses', async () => {
      const { AgentTreeItem } = await import('../agents-tree-provider');

      const idleAgent = {
        id: 'agent-1',
        name: 'Idle',
        role: 'assistant',
        model: 'model',
        status: 'idle' as const,
        color: 'cyan' as const,
      };

      const thinkingAgent = {
        id: 'agent-2',
        name: 'Thinking',
        role: 'assistant',
        model: 'model',
        status: 'thinking' as const,
        color: 'cyan' as const,
      };

      const executingAgent = {
        id: 'agent-3',
        name: 'Executing',
        role: 'assistant',
        model: 'model',
        status: 'executing' as const,
        color: 'cyan' as const,
      };

      const waitingAgent = {
        id: 'agent-4',
        name: 'Waiting',
        role: 'assistant',
        model: 'model',
        status: 'waiting' as const,
        color: 'cyan' as const,
      };

      const errorAgent = {
        id: 'agent-5',
        name: 'Error',
        role: 'assistant',
        model: 'model',
        status: 'error' as const,
        color: 'cyan' as const,
      };

      const idleItem = new AgentTreeItem(idleAgent, 0);
      const thinkingItem = new AgentTreeItem(thinkingAgent, 0);
      const executingItem = new AgentTreeItem(executingAgent, 0);
      const waitingItem = new AgentTreeItem(waitingAgent, 0);
      const errorItem = new AgentTreeItem(errorAgent, 0);

      expect(idleItem.iconPath?.id).toBe('hubot');
      expect(thinkingItem.iconPath?.id).toBe('loading~spin');
      expect(executingItem.iconPath?.id).toBe('play');
      expect(waitingItem.iconPath?.id).toBe('bell');
      expect(errorItem.iconPath?.id).toBe('error');
    });

    it('should map agent colors to theme colors', async () => {
      const { AgentTreeItem } = await import('../agents-tree-provider');

      const colors = ['cyan', 'purple', 'green', 'orange', 'pink', 'yellow'] as const;

      for (const color of colors) {
        const agent = {
          id: `agent-${color}`,
          name: `Agent ${color}`,
          role: 'assistant',
          model: 'model',
          status: 'idle' as const,
          color,
        };

        const item = new AgentTreeItem(agent, 0);
        expect(item.iconPath?.color).toBeDefined();
      }
    });
  });

  describe('AgentsTreeProvider', () => {
    it('should show no active session message when no session set', async () => {
      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('No active session');
    });

    it('should fetch agents when session is set', async () => {
      const agents = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          role: 'assistant',
          model: 'model',
          status: 'idle' as const,
          color: 'cyan' as const,
        },
      ];

      mockGetAgents.mockResolvedValue(agents);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      const children = await provider.getChildren();

      expect(mockGetAgents).toHaveBeenCalledWith('session-123');
      expect(children).toHaveLength(1);
      expect(children[0].agent.name).toBe('Agent 1');
    });

    it('should clear agents when session is set to null', async () => {
      mockGetAgents.mockResolvedValue([
        {
          id: 'agent-1',
          name: 'Agent 1',
          role: 'assistant',
          model: 'model',
          status: 'idle',
          color: 'cyan',
        },
      ]);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      await provider.setActiveSession(null);

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('No active session');
    });

    it('should show no agents message when session has no agents', async () => {
      mockGetAgents.mockResolvedValue([]);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toBe('No agents in session');
    });

    it('should handle API errors', async () => {
      mockGetAgents.mockRejectedValue(new Error('API Error'));

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0].label).toContain('Error');
    });

    it('should return empty array for nested elements', async () => {
      mockGetAgents.mockResolvedValue([]);

      const { AgentsTreeProvider, AgentTreeItem } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      const agent = {
        id: 'agent-1',
        name: 'Agent',
        role: 'assistant',
        model: 'model',
        status: 'idle' as const,
        color: 'cyan' as const,
      };
      const item = new AgentTreeItem(agent, 0);

      const children = await provider.getChildren(item);

      expect(children).toEqual([]);
    });

    it('should setup socket listeners when connected', async () => {
      mockIsSocketConnected.mockReturnValue(true);
      mockGetAgents.mockResolvedValue([]);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');

      expect(mockOnSocketEvent).toHaveBeenCalledWith('agent_status', expect.any(Function));
    });

    it('should get agent by ID', async () => {
      const agents = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          role: 'assistant',
          model: 'model',
          status: 'idle' as const,
          color: 'cyan' as const,
        },
      ];

      mockGetAgents.mockResolvedValue(agents);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      const agent = provider.getAgent('agent-1');

      expect(agent?.name).toBe('Agent 1');
    });

    it('should return undefined for unknown agent ID', async () => {
      mockGetAgents.mockResolvedValue([]);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      const agent = provider.getAgent('unknown-agent');

      expect(agent).toBeUndefined();
    });

    it('should dispose socket listeners', async () => {
      const mockUnsubscribe = vi.fn();
      mockOnSocketEvent.mockReturnValue(mockUnsubscribe);
      mockIsSocketConnected.mockReturnValue(true);
      mockGetAgents.mockResolvedValue([]);

      const { AgentsTreeProvider } = await import('../agents-tree-provider');
      const provider = new AgentsTreeProvider();

      await provider.setActiveSession('session-123');
      provider.dispose();

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });
});
