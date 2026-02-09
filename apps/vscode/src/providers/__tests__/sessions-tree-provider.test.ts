/**
 * Sessions tree provider tests.
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
    command?: unknown;
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

// Mock auth provider
const mockIsAuthenticated = vi.fn();

vi.mock('../../adapters', () => ({
  getAuthProvider: vi.fn(() => ({
    isAuthenticated: mockIsAuthenticated,
    getAccessToken: vi.fn(() => 'test-token'),
  })),
  createNodeHttpAdapter: vi.fn(() => ({
    request: vi.fn(),
  })),
}));

// Mock API client
const mockListSessions = vi.fn();

vi.mock('../../services/api-client', () => ({
  sessionApi: {
    listSessions: mockListSessions,
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

describe('SessionsTreeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.mockReturnValue(true);
  });

  describe('SessionTreeItem', () => {
    it('should create tree item with correct properties', async () => {
      const { SessionTreeItem } = await import('../sessions-tree-provider');

      const session = {
        id: 'session-123',
        name: 'Test Session',
        status: 'active' as const,
        branch: 'feature-branch',
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'workspace-1',
        project_id: 'project-1',
      };

      const item = new SessionTreeItem(session, 0);

      expect(item.id).toBe('session-123');
      expect(item.label).toBe('Test Session');
      expect(item.description).toContain('active');
      expect(item.description).toContain('feature-branch');
      expect(item.contextValue).toBe('session-active');
    });

    it('should have command to open session', async () => {
      const { SessionTreeItem } = await import('../sessions-tree-provider');

      const session = {
        id: 'session-456',
        name: 'Another Session',
        status: 'paused' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'workspace-1',
        project_id: 'project-1',
      };

      const item = new SessionTreeItem(session, 0);

      expect(item.command).toEqual({
        command: 'podex.openSession',
        title: 'Open Session',
        arguments: ['session-456'],
      });
    });

    it('should use main branch as default', async () => {
      const { SessionTreeItem } = await import('../sessions-tree-provider');

      const session = {
        id: 'session-789',
        name: 'Session Without Branch',
        status: 'active' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'workspace-1',
        project_id: 'project-1',
      };

      const item = new SessionTreeItem(session, 0);

      expect(item.description).toContain('main');
    });

    it('should have different icons for different statuses', async () => {
      const { SessionTreeItem } = await import('../sessions-tree-provider');

      const activeSession = {
        id: 'session-1',
        name: 'Active',
        status: 'active' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'w1',
        project_id: 'p1',
      };

      const pausedSession = {
        id: 'session-2',
        name: 'Paused',
        status: 'paused' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'w1',
        project_id: 'p1',
      };

      const terminatedSession = {
        id: 'session-3',
        name: 'Terminated',
        status: 'terminated' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'w1',
        project_id: 'p1',
      };

      const activeItem = new SessionTreeItem(activeSession, 0);
      const pausedItem = new SessionTreeItem(pausedSession, 0);
      const terminatedItem = new SessionTreeItem(terminatedSession, 0);

      expect(activeItem.iconPath?.id).toBe('circle-filled');
      expect(pausedItem.iconPath?.id).toBe('circle-outline');
      expect(terminatedItem.iconPath?.id).toBe('circle-slash');
    });
  });

  describe('SessionsTreeProvider', () => {
    it('should fetch sessions on construction', async () => {
      mockListSessions.mockResolvedValue({
        sessions: [
          {
            id: 'session-1',
            name: 'Test',
            status: 'active',
            created_at: '2024-01-01T00:00:00Z',
            workspace_id: 'w1',
            project_id: 'p1',
          },
        ],
      });

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      new SessionsTreeProvider();

      // Wait for async refresh
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockListSessions).toHaveBeenCalled();
    });

    it('should not fetch sessions when not authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();

      expect(mockListSessions).not.toHaveBeenCalled();
    });

    it('should return sessions as children', async () => {
      const sessions = [
        {
          id: 'session-1',
          name: 'Session 1',
          status: 'active' as const,
          created_at: '2024-01-01T00:00:00Z',
          workspace_id: 'w1',
          project_id: 'p1',
        },
        {
          id: 'session-2',
          name: 'Session 2',
          status: 'paused' as const,
          created_at: '2024-01-01T00:00:00Z',
          workspace_id: 'w1',
          project_id: 'p1',
        },
      ];

      mockListSessions.mockResolvedValue({ sessions });

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();
      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0].session.name).toBe('Session 1');
      expect(children[1].session.name).toBe('Session 2');
    });

    it('should return empty array for nested elements', async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      const { SessionsTreeProvider, SessionTreeItem } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();

      const session = {
        id: 'session-1',
        name: 'Test',
        status: 'active' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'w1',
        project_id: 'p1',
      };
      const item = new SessionTreeItem(session, 0);

      const children = await provider.getChildren(item);

      expect(children).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockListSessions.mockRejectedValue(new Error('API Error'));

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();
      const children = await provider.getChildren();

      // Should show error item
      expect(children).toHaveLength(1);
      expect(children[0].label).toContain('Error');
    });

    it('should return tree item for getTreeItem', async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      const { SessionsTreeProvider, SessionTreeItem } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      const session = {
        id: 'session-1',
        name: 'Test',
        status: 'active' as const,
        created_at: '2024-01-01T00:00:00Z',
        workspace_id: 'w1',
        project_id: 'p1',
      };
      const item = new SessionTreeItem(session, 0);

      const result = provider.getTreeItem(item);

      expect(result).toBe(item);
    });

    it('should get session by ID', async () => {
      const sessions = [
        {
          id: 'session-1',
          name: 'Session 1',
          status: 'active' as const,
          created_at: '2024-01-01T00:00:00Z',
          workspace_id: 'w1',
          project_id: 'p1',
        },
      ];

      mockListSessions.mockResolvedValue({ sessions });

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();
      const session = provider.getSession('session-1');

      expect(session?.name).toBe('Session 1');
    });

    it('should return undefined for unknown session ID', async () => {
      mockListSessions.mockResolvedValue({ sessions: [] });

      const { SessionsTreeProvider } = await import('../sessions-tree-provider');
      const provider = new SessionsTreeProvider();

      await provider.refresh();
      const session = provider.getSession('unknown-session');

      expect(session).toBeUndefined();
    });
  });
});
