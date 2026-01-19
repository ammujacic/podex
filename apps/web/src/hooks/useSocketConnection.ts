'use client';

import { useSyncExternalStore } from 'react';
import { onConnectionStateChange, getConnectionState, type ConnectionState } from '@/lib/socket';

/**
 * Hook to track socket connection state for UI feedback.
 * Uses useSyncExternalStore for optimal performance.
 */
export function useSocketConnection(): ConnectionState {
  return useSyncExternalStore(
    onConnectionStateChange,
    getConnectionState,
    // Server snapshot - assume disconnected during SSR
    () => ({
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    })
  );
}

/**
 * Hook to check if the socket is connected.
 * Simple boolean for conditional rendering.
 */
export function useIsSocketConnected(): boolean {
  const state = useSocketConnection();
  return state.connected;
}

/**
 * Hook to get socket connection error if any.
 */
export function useSocketError(): string | null {
  const state = useSocketConnection();
  return state.error;
}

/**
 * Combined hook for common use cases.
 */
export function useSocketStatus() {
  const state = useSocketConnection();

  return {
    isConnected: state.connected,
    isReconnecting: state.reconnecting,
    reconnectAttempt: state.reconnectAttempt,
    error: state.error,
    disconnectReason: state.disconnectReason,
    // Derived states
    isHealthy: state.connected && !state.error,
    needsAttention: !state.connected || !!state.error,
  };
}
