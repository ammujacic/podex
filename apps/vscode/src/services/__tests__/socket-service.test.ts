/**
 * Socket service tests.
 */

import type { ExtensionContext } from 'vscode';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Type for minimal mock context
type MockContext = Pick<ExtensionContext, 'subscriptions'>;

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// Mock auth provider
const mockGetAccessToken = vi.fn(() => 'test-token');

vi.mock('../../adapters', () => ({
  getAuthProvider: vi.fn(() => ({
    getAccessToken: mockGetAccessToken,
  })),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

// Mock socket client
const mockSocketClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  getConnectionState: vi.fn(() => ({
    connected: false,
    reconnecting: false,
    reconnectAttempt: 0,
    error: null,
  })),
  onConnectionStateChange: vi.fn(),
  joinSession: vi.fn(),
  leaveSession: vi.fn(),
  on: vi.fn(() => vi.fn()),
  emitApprovalResponse: vi.fn(),
  emitNativeApprovalResponse: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('@podex/api-client', () => ({
  createSocketClient: vi.fn(() => mockSocketClient),
}));

describe('Socket Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state between tests
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initializeSocketClient', () => {
    it('should create socket client with correct config', async () => {
      const { createSocketClient } = await import('@podex/api-client');
      const { initializeSocketClient } = await import('../socket-service');

      const mockContext = {
        subscriptions: {
          push: vi.fn(),
        },
      };

      initializeSocketClient(mockContext as MockContext);

      expect(createSocketClient).toHaveBeenCalledWith({
        url: 'https://api.podex.dev',
        getAuthToken: expect.any(Function),
        autoConnect: false,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
      });
    });

    it('should return same instance on subsequent calls', async () => {
      const { initializeSocketClient } = await import('../socket-service');

      const mockContext = {
        subscriptions: {
          push: vi.fn(),
        },
      };

      const client1 = initializeSocketClient(mockContext as MockContext);
      const client2 = initializeSocketClient(mockContext as MockContext);

      expect(client1).toBe(client2);
    });

    it('should add dispose handler to context', async () => {
      const { initializeSocketClient } = await import('../socket-service');

      const mockContext = {
        subscriptions: {
          push: vi.fn(),
        },
      };

      initializeSocketClient(mockContext as MockContext);

      expect(mockContext.subscriptions.push).toHaveBeenCalledWith({
        dispose: expect.any(Function),
      });
    });
  });

  describe('getSocketClient', () => {
    it('should throw if not initialized', async () => {
      vi.resetModules();
      const { getSocketClient } = await import('../socket-service');

      expect(() => getSocketClient()).toThrow(
        'Socket client not initialized. Call initializeSocketClient first.'
      );
    });

    it('should return client after initialization', async () => {
      const { initializeSocketClient, getSocketClient } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      const client = getSocketClient();

      expect(client).toBeDefined();
    });
  });

  describe('connectSocket', () => {
    it('should connect if not already connected', async () => {
      const { initializeSocketClient, connectSocket } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.isConnected.mockReturnValue(false);

      connectSocket();

      expect(mockSocketClient.connect).toHaveBeenCalled();
    });

    it('should not connect if already connected', async () => {
      const { initializeSocketClient, connectSocket } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.isConnected.mockReturnValue(true);

      connectSocket();

      expect(mockSocketClient.connect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectSocket', () => {
    it('should disconnect if connected', async () => {
      const { initializeSocketClient, disconnectSocket } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.isConnected.mockReturnValue(true);

      disconnectSocket();

      expect(mockSocketClient.disconnect).toHaveBeenCalled();
    });

    it('should not disconnect if not connected', async () => {
      const { initializeSocketClient, disconnectSocket } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.isConnected.mockReturnValue(false);

      disconnectSocket();

      expect(mockSocketClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('isSocketConnected', () => {
    it('should return true when connected', async () => {
      const { initializeSocketClient, isSocketConnected } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.isConnected.mockReturnValue(true);

      expect(isSocketConnected()).toBe(true);
    });

    it('should return false when not initialized', async () => {
      vi.resetModules();
      const { isSocketConnected } = await import('../socket-service');

      expect(isSocketConnected()).toBe(false);
    });
  });

  describe('getConnectionState', () => {
    it('should return connection state', async () => {
      const { initializeSocketClient, getConnectionState } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      mockSocketClient.getConnectionState.mockReturnValue({
        connected: true,
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
      });

      const state = getConnectionState();

      expect(state.connected).toBe(true);
    });

    it('should return default state when not initialized', async () => {
      vi.resetModules();
      const { getConnectionState } = await import('../socket-service');

      const state = getConnectionState();

      expect(state.connected).toBe(false);
      expect(state.reconnecting).toBe(false);
    });
  });

  describe('joinSession', () => {
    it('should join session with correct parameters', async () => {
      const { initializeSocketClient, joinSession } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      joinSession('session-123', 'user-456');

      expect(mockSocketClient.joinSession).toHaveBeenCalledWith(
        'session-123',
        'user-456',
        'test-token'
      );
    });
  });

  describe('leaveSession', () => {
    it('should leave session with correct parameters', async () => {
      const { initializeSocketClient, leaveSession } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      leaveSession('session-123', 'user-456');

      expect(mockSocketClient.leaveSession).toHaveBeenCalledWith('session-123', 'user-456');
    });
  });

  describe('onSocketEvent', () => {
    it('should subscribe to events', async () => {
      const { initializeSocketClient, onSocketEvent } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);

      const handler = vi.fn();
      onSocketEvent('agent_status', handler);

      expect(mockSocketClient.on).toHaveBeenCalledWith('agent_status', handler);
    });
  });

  describe('sendApprovalResponse', () => {
    it('should emit approval response', async () => {
      const { initializeSocketClient, sendApprovalResponse } = await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      sendApprovalResponse('session-123', 'agent-456', 'approval-789', true, false);

      expect(mockSocketClient.emitApprovalResponse).toHaveBeenCalledWith(
        'session-123',
        'agent-456',
        'approval-789',
        true,
        false
      );
    });
  });

  describe('sendNativeApprovalResponse', () => {
    it('should emit native approval response', async () => {
      const { initializeSocketClient, sendNativeApprovalResponse } =
        await import('../socket-service');

      const mockContext = {
        subscriptions: { push: vi.fn() },
      };

      initializeSocketClient(mockContext as MockContext);
      sendNativeApprovalResponse('session-123', 'agent-456', 'approval-789', false, true);

      expect(mockSocketClient.emitNativeApprovalResponse).toHaveBeenCalledWith(
        'session-123',
        'agent-456',
        'approval-789',
        false,
        true
      );
    });
  });
});
