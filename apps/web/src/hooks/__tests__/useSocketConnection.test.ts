/**
 * Comprehensive tests for useSocketConnection, useIsSocketConnected, useSocketError, and useSocketStatus hooks
 * Tests socket connection state tracking and derived states
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSocketConnection,
  useIsSocketConnected,
  useSocketError,
  useSocketStatus,
} from '../useSocketConnection';
import type { ConnectionState } from '@/lib/socket';

// Mock the socket library
let mockConnectionState: ConnectionState = {
  connected: false,
  reconnecting: false,
  reconnectAttempt: 0,
  error: null,
};

let connectionStateChangeCallback: (() => void) | null = null;

// Helper to update mock state and return a new object reference
const updateMockState = (updates: Partial<ConnectionState>) => {
  mockConnectionState = { ...mockConnectionState, ...updates };
};

vi.mock('@/lib/socket', () => ({
  onConnectionStateChange: vi.fn((callback: () => void) => {
    connectionStateChangeCallback = callback;
    return () => {
      connectionStateChangeCallback = null;
    };
  }),
  getConnectionState: vi.fn(() => mockConnectionState),
}));

import * as socketModule from '@/lib/socket';

describe('useSocketConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionStateChangeCallback = null;

    // Reset mock state
    mockConnectionState = {
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return initial connection state', () => {
      const { result } = renderHook(() => useSocketConnection());

      expect(result.current).toEqual({
        connected: false,
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
      });
    });

    it('should subscribe to connection state changes', () => {
      renderHook(() => useSocketConnection());

      expect(socketModule.onConnectionStateChange).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should use getConnectionState for snapshot', () => {
      renderHook(() => useSocketConnection());

      expect(socketModule.getConnectionState).toHaveBeenCalled();
    });
  });

  // ========================================
  // Connection State Tests
  // ========================================

  describe('Connection States', () => {
    it('should return connected state', () => {
      updateMockState({ connected: true });

      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.connected).toBe(true);
    });

    it('should return disconnected state', () => {
      updateMockState({ connected: false });

      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.connected).toBe(false);
    });

    it('should return reconnecting state', () => {
      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 3,
      });

      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.reconnecting).toBe(true);
      expect(result.current.reconnectAttempt).toBe(3);
    });

    it('should return error state', () => {
      updateMockState({
        connected: false,
        error: 'Connection timeout',
      });

      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.error).toBe('Connection timeout');
    });

    it('should return disconnect reason', () => {
      updateMockState({
        connected: false,
        disconnectReason: 'transport close',
      });

      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.disconnectReason).toBe('transport close');
    });
  });

  // ========================================
  // State Updates Tests
  // ========================================

  describe('State Updates', () => {
    it('should update when connection state changes', async () => {
      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.connected).toBe(false);

      // Update mock state
      updateMockState({ connected: true });

      // Trigger state change
      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });
    });

    it('should update reconnect attempts', async () => {
      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.reconnectAttempt).toBe(0);

      // Simulate reconnection attempts
      for (let i = 1; i <= 5; i++) {
        updateMockState({
          reconnecting: true,
          reconnectAttempt: i,
        });

        act(() => {
          connectionStateChangeCallback?.();
        });

        await waitFor(() => {
          expect(result.current.reconnectAttempt).toBe(i);
        });
      }
    });

    it('should update error state', async () => {
      const { result } = renderHook(() => useSocketConnection());

      expect(result.current.error).toBeNull();

      updateMockState({
        error: 'Network error',
      });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });
    });
  });

  // ========================================
  // SSR Tests
  // ========================================

  describe('SSR Behavior', () => {
    it('should return disconnected state for server snapshot', () => {
      // The server snapshot always returns disconnected
      const { result } = renderHook(() => useSocketConnection());

      // On server, should show disconnected
      expect(result.current.connected).toBe(false);
      expect(result.current.reconnecting).toBe(false);
      expect(result.current.reconnectAttempt).toBe(0);
      expect(result.current.error).toBeNull();
    });
  });
});

// ========================================
// useIsSocketConnected Tests
// ========================================

describe('useIsSocketConnected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionStateChangeCallback = null;

    mockConnectionState = {
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    };
  });

  describe('Connection Status', () => {
    it('should return false when disconnected', () => {
      updateMockState({ connected: false });

      const { result } = renderHook(() => useIsSocketConnected());

      expect(result.current).toBe(false);
    });

    it('should return true when connected', () => {
      updateMockState({ connected: true });

      const { result } = renderHook(() => useIsSocketConnected());

      expect(result.current).toBe(true);
    });

    it('should update when connection status changes', async () => {
      const { result } = renderHook(() => useIsSocketConnected());

      expect(result.current).toBe(false);

      updateMockState({ connected: true });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current).toBe(true);
      });
    });
  });
});

// ========================================
// useSocketError Tests
// ========================================

describe('useSocketError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionStateChangeCallback = null;

    mockConnectionState = {
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    };
  });

  describe('Error Status', () => {
    it('should return null when no error', () => {
      updateMockState({ error: null });

      const { result } = renderHook(() => useSocketError());

      expect(result.current).toBeNull();
    });

    it('should return error message', () => {
      updateMockState({ error: 'Connection refused' });

      const { result } = renderHook(() => useSocketError());

      expect(result.current).toBe('Connection refused');
    });

    it('should update when error changes', async () => {
      const { result } = renderHook(() => useSocketError());

      expect(result.current).toBeNull();

      updateMockState({ error: 'Timeout error' });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current).toBe('Timeout error');
      });
    });

    it('should clear error', async () => {
      updateMockState({ error: 'Initial error' });

      const { result } = renderHook(() => useSocketError());

      expect(result.current).toBe('Initial error');

      updateMockState({ error: null });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current).toBeNull();
      });
    });
  });
});

// ========================================
// useSocketStatus Tests
// ========================================

describe('useSocketStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionStateChangeCallback = null;

    mockConnectionState = {
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    };
  });

  // ========================================
  // Basic Properties Tests
  // ========================================

  describe('Basic Properties', () => {
    it('should return isConnected', () => {
      updateMockState({ connected: true });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isConnected).toBe(true);
    });

    it('should return isReconnecting', () => {
      updateMockState({ reconnecting: true });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isReconnecting).toBe(true);
    });

    it('should return reconnectAttempt', () => {
      updateMockState({ reconnectAttempt: 5 });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.reconnectAttempt).toBe(5);
    });

    it('should return error', () => {
      updateMockState({ error: 'Test error' });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.error).toBe('Test error');
    });

    it('should return disconnectReason', () => {
      updateMockState({ disconnectReason: 'io server disconnect' });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.disconnectReason).toBe('io server disconnect');
    });
  });

  // ========================================
  // Derived States Tests
  // ========================================

  describe('Derived States', () => {
    it('should return isHealthy when connected and no error', () => {
      updateMockState({
        connected: true,
        error: null,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isHealthy).toBe(true);
    });

    it('should return isHealthy false when disconnected', () => {
      updateMockState({
        connected: false,
        error: null,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isHealthy).toBe(false);
    });

    it('should return isHealthy false when error exists', () => {
      updateMockState({
        connected: true,
        error: 'Some error',
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isHealthy).toBe(false);
    });

    it('should return needsAttention when disconnected', () => {
      updateMockState({
        connected: false,
        error: null,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.needsAttention).toBe(true);
    });

    it('should return needsAttention when error exists', () => {
      updateMockState({
        connected: true,
        error: 'Connection issue',
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.needsAttention).toBe(true);
    });

    it('should return needsAttention false when healthy', () => {
      updateMockState({
        connected: true,
        error: null,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.needsAttention).toBe(false);
    });
  });

  // ========================================
  // Combined States Tests
  // ========================================

  describe('Combined States', () => {
    it('should handle reconnecting with error', () => {
      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 2,
        error: 'Connection lost',
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isConnected).toBe(false);
      expect(result.current.isReconnecting).toBe(true);
      expect(result.current.reconnectAttempt).toBe(2);
      expect(result.current.error).toBe('Connection lost');
      expect(result.current.isHealthy).toBe(false);
      expect(result.current.needsAttention).toBe(true);
    });

    it('should handle all properties in healthy state', () => {
      updateMockState({
        connected: true,
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
        disconnectReason: undefined,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current).toEqual({
        isConnected: true,
        isReconnecting: false,
        reconnectAttempt: 0,
        error: null,
        disconnectReason: undefined,
        isHealthy: true,
        needsAttention: false,
      });
    });

    it('should handle all properties in unhealthy state', () => {
      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 5,
        error: 'Max retries exceeded',
        disconnectReason: 'transport error',
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current).toEqual({
        isConnected: false,
        isReconnecting: true,
        reconnectAttempt: 5,
        error: 'Max retries exceeded',
        disconnectReason: 'transport error',
        isHealthy: false,
        needsAttention: true,
      });
    });
  });

  // ========================================
  // State Transitions Tests
  // ========================================

  describe('State Transitions', () => {
    it('should transition from disconnected to connected', async () => {
      updateMockState({ connected: false });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isConnected).toBe(false);
      expect(result.current.isHealthy).toBe(false);

      updateMockState({ connected: true, error: null });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.isHealthy).toBe(true);
      });
    });

    it('should transition from connected to reconnecting', async () => {
      updateMockState({ connected: true });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isConnected).toBe(true);

      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 1,
      });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.isReconnecting).toBe(true);
      });
    });

    it('should transition from reconnecting to connected', async () => {
      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 3,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.isReconnecting).toBe(true);

      updateMockState({
        connected: true,
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
      });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
        expect(result.current.isReconnecting).toBe(false);
        expect(result.current.isHealthy).toBe(true);
      });
    });

    it('should transition from reconnecting to error', async () => {
      updateMockState({
        connected: false,
        reconnecting: true,
        reconnectAttempt: 5,
      });

      const { result } = renderHook(() => useSocketStatus());

      updateMockState({
        connected: false,
        reconnecting: false,
        reconnectAttempt: 5,
        error: 'Max reconnection attempts reached',
      });

      act(() => {
        connectionStateChangeCallback?.();
      });

      await waitFor(() => {
        expect(result.current.isReconnecting).toBe(false);
        expect(result.current.error).toBe('Max reconnection attempts reached');
        expect(result.current.needsAttention).toBe(true);
      });
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle rapid state changes', async () => {
      const { result } = renderHook(() => useSocketStatus());

      // Rapid connect/disconnect cycles
      for (let i = 0; i < 10; i++) {
        updateMockState({ connected: i % 2 === 0 });

        act(() => {
          connectionStateChangeCallback?.();
        });
      }

      // Final state should be disconnected (i=9, 9%2=1, so connected=false)
      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });
    });

    it('should handle empty error string', () => {
      updateMockState({
        connected: true,
        error: '',
      });

      const { result } = renderHook(() => useSocketStatus());

      // Empty string is falsy, so isHealthy should be true
      expect(result.current.isHealthy).toBe(true);
      expect(result.current.needsAttention).toBe(false);
    });

    it('should handle undefined disconnectReason', () => {
      updateMockState({
        connected: false,
        disconnectReason: undefined,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.disconnectReason).toBeUndefined();
    });

    it('should handle high reconnect attempt count', () => {
      updateMockState({
        reconnecting: true,
        reconnectAttempt: 999,
      });

      const { result } = renderHook(() => useSocketStatus());

      expect(result.current.reconnectAttempt).toBe(999);
    });
  });
});
