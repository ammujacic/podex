/**
 * Tests for socket-service.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const mockSocketClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  dispose: vi.fn(),
  isConnected: vi.fn(() => false),
};

vi.mock('@podex/api-client', () => ({
  createSocketClient: vi.fn(() => mockSocketClient),
}));

vi.mock('../../adapters/auth-provider', () => ({
  getCliAuthProvider: () => ({
    getAccessToken: vi.fn(() => 'test-token'),
  }),
}));

vi.mock('../../stores/cli-config', () => ({
  getCliConfigStore: () => ({
    getState: () => ({
      apiUrl: 'https://api.example.com',
    }),
  }),
}));

// Reset module before each test to clear singleton
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('Socket Service', () => {
  describe('getSocketClient', () => {
    it('should create socket client', async () => {
      const { getSocketClient } = await import('../socket-service');
      const client = getSocketClient();

      expect(client).toBeDefined();
    });

    it('should return same instance on multiple calls', async () => {
      const { getSocketClient } = await import('../socket-service');
      const client1 = getSocketClient();
      const client2 = getSocketClient();

      expect(client1).toBe(client2);
    });
  });

  describe('connectSocket', () => {
    it('should connect to socket server', async () => {
      const { connectSocket, getSocketClient } = await import('../socket-service');
      getSocketClient(); // Initialize
      connectSocket();

      expect(mockSocketClient.connect).toHaveBeenCalled();
    });
  });

  describe('disconnectSocket', () => {
    it('should disconnect from socket server', async () => {
      const { disconnectSocket, getSocketClient } = await import('../socket-service');
      getSocketClient(); // Initialize
      disconnectSocket();

      expect(mockSocketClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('disposeSocket', () => {
    it('should dispose socket client', async () => {
      const { disposeSocket, getSocketClient } = await import('../socket-service');
      getSocketClient(); // Initialize
      disposeSocket();

      expect(mockSocketClient.dispose).toHaveBeenCalled();
    });
  });

  describe('isSocketConnected', () => {
    it('should return connection status', async () => {
      const { isSocketConnected, getSocketClient } = await import('../socket-service');
      getSocketClient(); // Initialize

      expect(isSocketConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      mockSocketClient.isConnected.mockReturnValue(true);
      const { isSocketConnected, getSocketClient } = await import('../socket-service');
      getSocketClient(); // Initialize

      expect(isSocketConnected()).toBe(true);
    });
  });
});
