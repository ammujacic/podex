/**
 * Platform-agnostic Socket.IO client wrapper.
 * Provides typed event handling and connection management.
 */

import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { ConnectionState, SocketClientConfig, SocketEvents } from './types';

export type ConnectionListener = (state: ConnectionState) => void;

/**
 * Create and manage a Socket.IO client connection.
 */
export class SocketClient {
  private socket: Socket | null = null;
  private config: Required<SocketClientConfig>;
  private connectionState: ConnectionState = {
    connected: false,
    reconnecting: false,
    reconnectAttempt: 0,
    error: null,
  };
  private connectionListeners = new Set<ConnectionListener>();
  private activeSession: { sessionId: string; userId: string; authToken?: string } | null = null;

  constructor(config: SocketClientConfig) {
    this.config = {
      url: config.url,
      getAuthToken: config.getAuthToken ?? (() => null),
      autoConnect: config.autoConnect ?? false,
      reconnectionAttempts: config.reconnectionAttempts ?? 10,
      reconnectionDelay: config.reconnectionDelay ?? 1000,
      reconnectionDelayMax: config.reconnectionDelayMax ?? 30000,
    };

    if (this.config.autoConnect) {
      this.connect();
    }
  }

  /**
   * Get or create the underlying socket.io Socket instance.
   */
  getSocket(): Socket {
    if (!this.socket) {
      this.socket = io(this.config.url, {
        autoConnect: false,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: this.config.reconnectionDelay,
        reconnectionDelayMax: this.config.reconnectionDelayMax,
        reconnectionAttempts: this.config.reconnectionAttempts,
        randomizationFactor: 0.5,
        timeout: 20000,
      });

      this.setupEventHandlers();
    }

    return this.socket;
  }

  /**
   * Set up internal event handlers for connection state.
   */
  private setupEventHandlers(): void {
    const socket = this.socket!;

    socket.on('connect', () => {
      this.updateConnectionState({
        connected: true,
        error: null,
        reconnecting: false,
        reconnectAttempt: 0,
      });
    });

    socket.on('disconnect', (reason: string) => {
      this.updateConnectionState({
        connected: false,
        disconnectReason: reason,
      });
    });

    socket.on('connect_error', (error: Error) => {
      this.updateConnectionState({
        connected: false,
        error: error.message,
      });
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      this.updateConnectionState({
        reconnecting: true,
        reconnectAttempt: attempt,
      });
    });

    socket.io.on('reconnect', () => {
      this.updateConnectionState({
        reconnecting: false,
        reconnectAttempt: 0,
        error: null,
      });

      // Auto-rejoin session after reconnection
      if (this.activeSession) {
        this.joinSession(
          this.activeSession.sessionId,
          this.activeSession.userId,
          this.activeSession.authToken
        );
      }
    });

    socket.io.on('reconnect_failed', () => {
      this.updateConnectionState({
        reconnecting: false,
        error: 'Reconnection failed after maximum attempts.',
      });
    });
  }

  /**
   * Update connection state and notify listeners.
   */
  private updateConnectionState(updates: Partial<ConnectionState>): void {
    this.connectionState = { ...this.connectionState, ...updates };
    this.notifyConnectionListeners();
  }

  /**
   * Notify all connection state listeners.
   */
  private notifyConnectionListeners(): void {
    const state = { ...this.connectionState };
    this.connectionListeners.forEach((listener) => listener(state));
  }

  /**
   * Subscribe to connection state changes.
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    // Immediately notify with current state
    listener({ ...this.connectionState });
    return () => this.connectionListeners.delete(listener);
  }

  /**
   * Get current connection state.
   */
  getConnectionState(): ConnectionState {
    return { ...this.connectionState };
  }

  /**
   * Connect to the socket server.
   */
  connect(): void {
    const socket = this.getSocket();
    if (!socket.connected) {
      socket.connect();
    }
  }

  /**
   * Disconnect from the socket server.
   */
  disconnect(): void {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }
  }

  /**
   * Manually trigger a reconnection attempt.
   */
  reconnect(): void {
    if (this.socket) {
      this.updateConnectionState({
        error: null,
        reconnecting: true,
        reconnectAttempt: 1,
      });
      this.socket.disconnect();
      this.socket.connect();
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connectionState.connected;
  }

  /**
   * Join a session room for real-time updates.
   * Stores session info for auto-rejoin on reconnection.
   */
  joinSession(sessionId: string, userId: string, authToken?: string): void {
    const socket = this.getSocket();
    this.activeSession = { sessionId, userId, authToken };

    const emitJoin = () => {
      socket.emit('session_join', {
        session_id: sessionId,
        user_id: userId,
        ...(authToken && { auth_token: authToken }),
      });
    };

    if (socket.connected) {
      emitJoin();
    } else {
      socket.once('connect', emitJoin);
    }
  }

  /**
   * Leave a session room.
   */
  leaveSession(sessionId: string, userId: string): void {
    const socket = this.getSocket();
    socket.emit('session_leave', { session_id: sessionId, user_id: userId });

    if (this.activeSession?.sessionId === sessionId) {
      this.activeSession = null;
    }
  }

  /**
   * Subscribe to a typed socket event.
   * Returns an unsubscribe function.
   */
  on<K extends keyof SocketEvents>(event: K, handler: SocketEvents[K]): () => void {
    const socket = this.getSocket();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on(event, handler as any);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off(event, handler as any);
    };
  }

  /**
   * Remove an event listener.
   */
  off<K extends keyof SocketEvents>(event: K, handler: SocketEvents[K]): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket?.off(event, handler as any);
  }

  /**
   * Emit a typed event.
   */
  emit(event: string, data: unknown): void {
    this.getSocket().emit(event, data);
  }

  // ============================================================================
  // Convenience Methods for Common Operations
  // ============================================================================

  /**
   * Emit a cursor update to other users.
   */
  emitCursorUpdate(data: {
    session_id: string;
    user_id: string;
    file_path: string;
    position: { line: number; column: number };
  }): void {
    this.emit('cursor_update', data);
  }

  /**
   * Emit a file change event.
   */
  emitFileChange(data: {
    session_id: string;
    file_path: string;
    change_type: 'created' | 'modified' | 'deleted';
    changed_by: string;
  }): void {
    this.emit('file_change', data);
  }

  /**
   * Attach to a workspace terminal.
   */
  attachTerminal(workspaceId: string): void {
    this.emit('terminal_attach', { workspace_id: workspaceId });
  }

  /**
   * Detach from a workspace terminal.
   */
  detachTerminal(workspaceId: string): void {
    this.emit('terminal_detach', { workspace_id: workspaceId });
  }

  /**
   * Send input to a terminal.
   */
  sendTerminalInput(workspaceId: string, data: string): void {
    this.emit('terminal_input', { workspace_id: workspaceId, data });
  }

  /**
   * Resize a terminal.
   */
  resizeTerminal(workspaceId: string, rows: number, cols: number): void {
    this.emit('terminal_resize', { workspace_id: workspaceId, rows, cols });
  }

  /**
   * Send an approval response.
   */
  emitApprovalResponse(
    sessionId: string,
    agentId: string,
    approvalId: string,
    approved: boolean,
    addToAllowlist: boolean = false
  ): void {
    this.emit('approval_response', {
      session_id: sessionId,
      agent_id: agentId,
      approval_id: approvalId,
      approved,
      added_to_allowlist: addToAllowlist,
    });
  }

  /**
   * Send a native approval response (for Podex native agents).
   */
  emitNativeApprovalResponse(
    sessionId: string,
    agentId: string,
    approvalId: string,
    approved: boolean,
    addToAllowlist: boolean = false
  ): void {
    this.emit('native_approval_response', {
      session_id: sessionId,
      agent_id: agentId,
      approval_id: approvalId,
      approved,
      add_to_allowlist: addToAllowlist,
    });
  }

  /**
   * Mark an attention item as read.
   */
  emitAttentionRead(sessionId: string, attentionId: string): void {
    this.emit('agent_attention_read', {
      session_id: sessionId,
      attention_id: attentionId,
    });
  }

  /**
   * Dismiss an attention item.
   */
  emitAttentionDismiss(sessionId: string, attentionId: string, agentId?: string): void {
    this.emit('agent_attention_dismiss', {
      session_id: sessionId,
      attention_id: attentionId,
      agent_id: agentId || null,
    });
  }

  /**
   * Dispose the client and clean up resources.
   */
  dispose(): void {
    this.disconnect();
    this.connectionListeners.clear();
    this.activeSession = null;
    this.socket = null;
  }
}

/**
 * Create a new SocketClient instance.
 */
export function createSocketClient(config: SocketClientConfig): SocketClient {
  return new SocketClient(config);
}
