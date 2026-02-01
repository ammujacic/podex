/**
 * Local pods tree provider tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

// Mock local-pod-discovery
const mockDiscoverAllLocalPods = vi.fn();

vi.mock('@podex/local-pod-discovery', () => ({
  discoverAllLocalPods: mockDiscoverAllLocalPods,
}));

describe('LocalPodsTreeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  describe('LocalPodTreeItem', () => {
    it('should create tree item with correct properties', async () => {
      const { LocalPodTreeItem } = await import('../local-pods-tree-provider');

      const pod = {
        pid: 1234,
        port: 3001,
        workspacePath: '/path/to/workspace',
        startedAt: new Date('2024-01-01T00:00:00Z'),
        name: 'Test Pod',
      };

      const item = new LocalPodTreeItem(pod, 0);

      expect(item.id).toBe('local-pod-1234');
      expect(item.label).toBe('Test Pod');
      expect(item.description).toBe('Port 3001');
      expect(item.contextValue).toBe('local-pod');
    });

    it('should use port in label when name is not set', async () => {
      const { LocalPodTreeItem } = await import('../local-pods-tree-provider');

      const pod = {
        pid: 1234,
        port: 3001,
        workspacePath: '/path/to/workspace',
        startedAt: new Date(),
      };

      const item = new LocalPodTreeItem(pod, 0);

      expect(item.label).toBe('Pod (port 3001)');
    });

    it('should have command to connect to pod', async () => {
      const { LocalPodTreeItem } = await import('../local-pods-tree-provider');

      const pod = {
        pid: 5678,
        port: 3002,
        workspacePath: '/path/to/workspace',
        startedAt: new Date(),
      };

      const item = new LocalPodTreeItem(pod, 0);

      expect(item.command).toEqual({
        command: 'podex.connectLocalPod',
        title: 'Connect to Local Pod',
        arguments: [pod],
      });
    });

    it('should have server icon with green color', async () => {
      const { LocalPodTreeItem } = await import('../local-pods-tree-provider');

      const pod = {
        pid: 1234,
        port: 3001,
        workspacePath: '/path/to/workspace',
        startedAt: new Date(),
      };

      const item = new LocalPodTreeItem(pod, 0);

      expect(item.iconPath?.id).toBe('server');
      expect(item.iconPath?.color?.id).toBe('charts.green');
    });
  });

  describe('LocalPodsTreeProvider', () => {
    it('should start periodic discovery on construction', async () => {
      mockDiscoverAllLocalPods.mockResolvedValue([]);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      new LocalPodsTreeProvider();

      // Wait for initial discovery
      await vi.advanceTimersByTimeAsync(100);

      expect(mockDiscoverAllLocalPods).toHaveBeenCalled();
    });

    it('should poll for pods every 5 seconds', async () => {
      mockDiscoverAllLocalPods.mockResolvedValue([]);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      new LocalPodsTreeProvider();

      // Initial call
      await vi.advanceTimersByTimeAsync(100);
      expect(mockDiscoverAllLocalPods).toHaveBeenCalledTimes(1);

      // After 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockDiscoverAllLocalPods).toHaveBeenCalledTimes(2);

      // After another 5 seconds
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockDiscoverAllLocalPods).toHaveBeenCalledTimes(3);
    });

    it('should return pods as children', async () => {
      const pods = [
        {
          pid: 1234,
          port: 3001,
          workspacePath: '/path/1',
          startedAt: '2024-01-01T00:00:00Z',
          name: 'Pod 1',
        },
        {
          pid: 5678,
          port: 3002,
          workspacePath: '/path/2',
          startedAt: '2024-01-01T00:00:00Z',
          name: 'Pod 2',
        },
      ];

      mockDiscoverAllLocalPods.mockResolvedValue(pods);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      // Wait for async discovery to complete
      await vi.advanceTimersByTimeAsync(100);
      await provider.refresh();
      await vi.advanceTimersByTimeAsync(100);

      const children = await provider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0].pod.name).toBe('Pod 1');
      expect(children[1].pod.name).toBe('Pod 2');
    });

    it('should return empty array for nested elements', async () => {
      mockDiscoverAllLocalPods.mockResolvedValue([]);

      const { LocalPodsTreeProvider, LocalPodTreeItem } =
        await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      const pod = {
        pid: 1234,
        port: 3001,
        workspacePath: '/path',
        startedAt: new Date(),
      };
      const item = new LocalPodTreeItem(pod, 0);

      const children = await provider.getChildren(item);

      expect(children).toEqual([]);
    });

    it('should handle discovery errors gracefully', async () => {
      // Errors during discovery are caught silently per the implementation
      // The discoverPods method catches errors and logs them
      mockDiscoverAllLocalPods.mockRejectedValue(new Error('Discovery failed'));

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      // Wait for async discovery to complete
      await vi.advanceTimersByTimeAsync(100);

      // Even with errors, the provider should return an empty list
      // (errors are logged but not shown to user per current implementation)
      const children = await provider.getChildren();

      // With no pods discovered, returns empty array
      expect(children).toHaveLength(0);
    });

    it('should get pod by PID', async () => {
      const pods = [
        {
          pid: 1234,
          port: 3001,
          workspacePath: '/path/1',
          startedAt: '2024-01-01T00:00:00Z',
          name: 'Pod 1',
        },
      ];

      mockDiscoverAllLocalPods.mockResolvedValue(pods);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      // Wait for async discovery to complete
      await vi.advanceTimersByTimeAsync(100);
      await provider.refresh();
      await vi.advanceTimersByTimeAsync(100);

      const pod = provider.getPod(1234);

      expect(pod?.name).toBe('Pod 1');
    });

    it('should return undefined for unknown PID', async () => {
      mockDiscoverAllLocalPods.mockResolvedValue([]);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      await provider.refresh();
      const pod = provider.getPod(9999);

      expect(pod).toBeUndefined();
    });

    it('should stop discovery on dispose', async () => {
      mockDiscoverAllLocalPods.mockResolvedValue([]);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      await vi.advanceTimersByTimeAsync(100);
      provider.dispose();

      const callCount = mockDiscoverAllLocalPods.mock.calls.length;

      // After dispose, no more polling should happen
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockDiscoverAllLocalPods.mock.calls.length).toBe(callCount);
    });

    it('should only update tree when pods change', async () => {
      // This test verifies that the provider only fires change events
      // when the pod list actually changes
      const pods = [
        {
          pid: 1234,
          port: 3001,
          workspacePath: '/path/1',
          startedAt: '2024-01-01T00:00:00Z',
          name: 'Pod 1',
        },
      ];

      mockDiscoverAllLocalPods.mockResolvedValue(pods);

      const { LocalPodsTreeProvider } = await import('../local-pods-tree-provider');
      const provider = new LocalPodsTreeProvider();

      // Track tree data changes
      let changeCount = 0;
      provider.onDidChangeTreeData(() => {
        changeCount++;
      });

      // Wait for initial discovery
      await vi.advanceTimersByTimeAsync(100);
      await provider.refresh();
      await vi.advanceTimersByTimeAsync(100);

      const initialChangeCount = changeCount;

      // Same pods returned - should not trigger additional changes during poll
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(100); // Let promises resolve

      // The periodic discovery should NOT fire change events if pods haven't changed
      // (it uses a comparison check before firing)
      expect(changeCount).toBe(initialChangeCount);
    });
  });
});
