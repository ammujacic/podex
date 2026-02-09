/**
 * Workspace panel manager tests.
 */

import type { Uri } from 'vscode';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Type aliases for mocks
type MockUri = Pick<Uri, 'fsPath'>;
type MockWebviewPanel = typeof mockPanel;

// Mock webview panel
const mockPostMessage = vi.fn();
const mockReveal = vi.fn();
const mockPanelDispose = vi.fn();
const mockOnDidDispose = vi.fn();
const mockOnDidReceiveMessage = vi.fn();
const mockOnDidChangeViewState = vi.fn();

const mockWebview = {
  postMessage: mockPostMessage,
  html: '',
  asWebviewUri: vi.fn((uri) => uri),
  cspSource: 'https://example.com',
};

const mockPanel = {
  webview: mockWebview,
  reveal: mockReveal,
  dispose: mockPanelDispose,
  visible: true,
  onDidDispose: mockOnDidDispose,
  onDidChangeViewState: mockOnDidChangeViewState,
};

// Mock vscode module
const mockCreateWebviewPanel = vi.fn(() => {
  // Set up the mock to capture the message handler
  mockPanel.webview.onDidReceiveMessage = mockOnDidReceiveMessage;
  return mockPanel;
});

vi.mock('vscode', () => ({
  window: {
    createWebviewPanel: mockCreateWebviewPanel,
    activeTextEditor: undefined,
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
  },
  Uri: {
    joinPath: vi.fn((...args) => ({
      fsPath: args.join('/'),
      toString: () => args.join('/'),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
  },
}));

// Mock services
const mockOnSocketEvent = vi.fn(() => vi.fn());
const mockSendApprovalResponse = vi.fn();
const mockSendNativeApprovalResponse = vi.fn();

vi.mock('../../services', () => ({
  onSocketEvent: mockOnSocketEvent,
  sendApprovalResponse: mockSendApprovalResponse,
  sendNativeApprovalResponse: mockSendNativeApprovalResponse,
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

describe('WorkspacePanelManager', () => {
  const mockExtensionUri = { fsPath: '/test/extension' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createOrShow', () => {
    it('should create a new panel when none exists', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      // Ensure no current panel
      WorkspacePanelManager.currentPanel = undefined;

      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      expect(mockCreateWebviewPanel).toHaveBeenCalledWith(
        'podex.workspacePanel',
        'Podex Workspace',
        expect.any(Number),
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        })
      );
      expect(manager).toBeDefined();
      expect(WorkspacePanelManager.currentPanel).toBe(manager);
    });

    it('should reveal existing panel instead of creating new one', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      // Create first panel
      WorkspacePanelManager.currentPanel = undefined;
      const firstManager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      // Clear mocks
      mockCreateWebviewPanel.mockClear();

      // Try to create again
      const secondManager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      expect(mockCreateWebviewPanel).not.toHaveBeenCalled();
      expect(mockReveal).toHaveBeenCalled();
      expect(secondManager).toBe(firstManager);
    });

    it('should set session when provided', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri, 'session-123');

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'session:connected',
        payload: { sessionId: 'session-123' },
      });
    });
  });

  describe('revive', () => {
    it('should create manager from existing panel', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;

      WorkspacePanelManager.revive(mockPanel as MockWebviewPanel, mockExtensionUri as MockUri);

      expect(WorkspacePanelManager.currentPanel).toBeDefined();
    });
  });

  describe('setSession', () => {
    it('should set up socket listeners and notify webview', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      manager.setSession('new-session-456');

      // Should subscribe to socket events
      expect(mockOnSocketEvent).toHaveBeenCalledWith('agent_message', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith('agent_token', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith('agent_stream_end', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith('agent_status', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith('approval_request', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith(
        'native_approval_request',
        expect.any(Function)
      );
      expect(mockOnSocketEvent).toHaveBeenCalledWith('tool_call_start', expect.any(Function));
      expect(mockOnSocketEvent).toHaveBeenCalledWith('tool_call_end', expect.any(Function));

      // Should notify webview
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'session:connected',
        payload: { sessionId: 'new-session-456' },
      });
    });

    it('should clean up previous socket listeners', async () => {
      const mockUnsubscribe = vi.fn();
      mockOnSocketEvent.mockReturnValue(mockUnsubscribe);

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      manager.setSession('session-1');

      // Clear call tracking
      mockUnsubscribe.mockClear();

      // Set another session - should clean up previous subscriptions
      manager.setSession('session-2');

      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  describe('socket event forwarding', () => {
    it('should forward agent_message events to webview', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let messageHandler: (event: any) => void;
      mockOnSocketEvent.mockImplementation((event, handler) => {
        if (event === 'agent_message') {
          messageHandler = handler;
        }
        return vi.fn();
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Simulate agent message event
      messageHandler!({
        id: 'msg-1',
        session_id: 'session-123',
        agent_id: 'agent-1',
        agent_name: 'Test Agent',
        role: 'assistant',
        content: 'Hello!',
        created_at: '2024-01-01T00:00:00Z',
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'chat:message',
        payload: expect.objectContaining({
          id: 'msg-1',
          content: 'Hello!',
        }),
      });
    });

    it('should forward agent_status events to webview', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let statusHandler: (event: any) => void;
      mockOnSocketEvent.mockImplementation((event, handler) => {
        if (event === 'agent_status') {
          statusHandler = handler;
        }
        return vi.fn();
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Simulate agent status event
      statusHandler!({
        agent_id: 'agent-1',
        status: 'thinking',
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'agent:status',
        payload: {
          agent_id: 'agent-1',
          status: 'thinking',
        },
      });
    });
  });

  describe('webview message handling', () => {
    it('should handle ready message and send session state', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let webviewMessageHandler: (message: any) => void;
      mockOnDidReceiveMessage.mockImplementation((handler) => {
        webviewMessageHandler = handler;
        return { dispose: vi.fn() };
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Clear previous calls
      mockPostMessage.mockClear();

      // Simulate ready message from webview
      webviewMessageHandler!({ type: 'ready' });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'session:connected',
        payload: { sessionId: 'session-123' },
      });
    });

    it('should handle approval:respond for regular approval', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let webviewMessageHandler: (message: any) => void;
      mockOnDidReceiveMessage.mockImplementation((handler) => {
        webviewMessageHandler = handler;
        return { dispose: vi.fn() };
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Simulate approval response from webview
      webviewMessageHandler!({
        type: 'approval:respond',
        payload: {
          agentId: 'agent-1',
          approvalId: 'approval-1',
          approved: true,
          addToAllowlist: false,
          isNative: false,
        },
      });

      expect(mockSendApprovalResponse).toHaveBeenCalledWith(
        'session-123',
        'agent-1',
        'approval-1',
        true,
        false
      );
    });

    it('should handle approval:respond for native approval', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let webviewMessageHandler: (message: any) => void;
      mockOnDidReceiveMessage.mockImplementation((handler) => {
        webviewMessageHandler = handler;
        return { dispose: vi.fn() };
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Simulate native approval response from webview
      webviewMessageHandler!({
        type: 'approval:respond',
        payload: {
          agentId: 'agent-1',
          approvalId: 'approval-1',
          approved: false,
          addToAllowlist: true,
          isNative: true,
        },
      });

      expect(mockSendNativeApprovalResponse).toHaveBeenCalledWith(
        'session-123',
        'agent-1',
        'approval-1',
        false,
        true
      );
    });

    it('should handle chat:send message', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let webviewMessageHandler: (message: any) => void;
      mockOnDidReceiveMessage.mockImplementation((handler) => {
        webviewMessageHandler = handler;
        return { dispose: vi.fn() };
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Clear previous calls
      mockPostMessage.mockClear();

      // Simulate chat send from webview
      webviewMessageHandler!({
        type: 'chat:send',
        payload: {
          content: 'Test message',
          agentId: 'agent-1',
        },
      });

      // Should echo back (placeholder implementation)
      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'chat:message',
        payload: expect.objectContaining({
          content: 'Test message',
          role: 'user',
        }),
      });
    });
  });

  describe('postMessage', () => {
    it('should post message to webview', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      manager.postMessage('test:event', { data: 'test' });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: 'test:event',
        payload: { data: 'test' },
      });
    });
  });

  describe('dispose', () => {
    it('should clean up resources on dispose', async () => {
      const mockUnsubscribe = vi.fn();
      mockOnSocketEvent.mockReturnValue(mockUnsubscribe);

      let disposeHandler: () => void;
      mockOnDidDispose.mockImplementation((handler) => {
        disposeHandler = handler;
        return { dispose: vi.fn() };
      });

      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      const manager = WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);
      manager.setSession('session-123');

      // Trigger dispose
      disposeHandler!();

      expect(WorkspacePanelManager.currentPanel).toBeUndefined();
      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockPanelDispose).toHaveBeenCalled();
    });
  });

  describe('HTML content', () => {
    it('should generate HTML with CSP and script references', async () => {
      const { WorkspacePanelManager } = await import('../workspace-panel');

      WorkspacePanelManager.currentPanel = undefined;
      WorkspacePanelManager.createOrShow(mockExtensionUri as MockUri);

      // Check that HTML was set
      expect(mockWebview.html).toContain('<!DOCTYPE html>');
      expect(mockWebview.html).toContain('Podex Workspace');
      expect(mockWebview.html).toContain('Content-Security-Policy');
      expect(mockWebview.html).toContain('nonce-');
      expect(mockWebview.html).toContain('index.js');
      expect(mockWebview.html).toContain('index.css');
    });
  });
});
