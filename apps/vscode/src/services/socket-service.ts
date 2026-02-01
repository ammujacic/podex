/**
 * Socket service for real-time communication.
 * Wraps @podex/api-client SocketClient.
 */

import * as vscode from 'vscode';
import {
  createSocketClient,
  SocketClient,
  type ConnectionState,
  type SocketEvents,
} from '@podex/api-client';
import { getAuthProvider } from '../adapters';
import { DEFAULT_API_URL } from '../utils/constants';
import { logInfo, logDebug } from '../utils/logger';

let socketInstance: SocketClient | null = null;

// Event emitter for connection state changes
const onConnectionStateChangeEmitter = new vscode.EventEmitter<ConnectionState>();

/**
 * Get the API URL from VSCode settings.
 */
function getApiUrl(): string {
  const config = vscode.workspace.getConfiguration('podex');
  return config.get<string>('apiUrl', DEFAULT_API_URL);
}

/**
 * Initialize the socket client singleton.
 */
export function initializeSocketClient(context: vscode.ExtensionContext): SocketClient {
  if (!socketInstance) {
    const apiUrl = getApiUrl();
    logDebug(`Initializing socket client with URL: ${apiUrl}`);

    const authProvider = getAuthProvider();

    socketInstance = createSocketClient({
      url: apiUrl,
      getAuthToken: () => authProvider.getAccessToken(),
      autoConnect: false,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    // Forward connection state changes
    socketInstance.onConnectionStateChange((state) => {
      logDebug(`Socket connection state: ${JSON.stringify(state)}`);
      onConnectionStateChangeEmitter.fire(state);
    });

    // Clean up on deactivation
    context.subscriptions.push({
      dispose: () => {
        socketInstance?.dispose();
        socketInstance = null;
      },
    });
  }
  return socketInstance;
}

/**
 * Get the socket client singleton.
 */
export function getSocketClient(): SocketClient {
  if (!socketInstance) {
    throw new Error('Socket client not initialized. Call initializeSocketClient first.');
  }
  return socketInstance;
}

/**
 * Connect to the socket server.
 */
export function connectSocket(): void {
  const socket = getSocketClient();
  if (!socket.isConnected()) {
    logInfo('Connecting to socket server...');
    socket.connect();
  }
}

/**
 * Disconnect from the socket server.
 */
export function disconnectSocket(): void {
  if (socketInstance?.isConnected()) {
    logInfo('Disconnecting from socket server...');
    socketInstance.disconnect();
  }
}

/**
 * Check if socket is connected.
 */
export function isSocketConnected(): boolean {
  return socketInstance?.isConnected() ?? false;
}

/**
 * Get current connection state.
 */
export function getConnectionState(): ConnectionState {
  return (
    socketInstance?.getConnectionState() ?? {
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      error: null,
    }
  );
}

/**
 * Event fired when connection state changes.
 */
export const onConnectionStateChange = onConnectionStateChangeEmitter.event;

/**
 * Join a session for real-time updates.
 */
export function joinSession(sessionId: string, userId: string): void {
  const socket = getSocketClient();
  const authToken = getAuthProvider().getAccessToken() ?? undefined;

  logInfo(`Joining session: ${sessionId}`);
  socket.joinSession(sessionId, userId, authToken);
}

/**
 * Leave a session.
 */
export function leaveSession(sessionId: string, userId: string): void {
  const socket = getSocketClient();
  logInfo(`Leaving session: ${sessionId}`);
  socket.leaveSession(sessionId, userId);
}

/**
 * Subscribe to a socket event.
 * Returns an unsubscribe function.
 */
export function onSocketEvent<K extends keyof SocketEvents>(
  event: K,
  handler: SocketEvents[K]
): () => void {
  const socket = getSocketClient();
  return socket.on(event, handler);
}

/**
 * Send an approval response.
 */
export function sendApprovalResponse(
  sessionId: string,
  agentId: string,
  approvalId: string,
  approved: boolean,
  addToAllowlist = false
): void {
  const socket = getSocketClient();
  socket.emitApprovalResponse(sessionId, agentId, approvalId, approved, addToAllowlist);
}

/**
 * Send a native approval response (for Podex native agents).
 */
export function sendNativeApprovalResponse(
  sessionId: string,
  agentId: string,
  approvalId: string,
  approved: boolean,
  addToAllowlist = false
): void {
  const socket = getSocketClient();
  socket.emitNativeApprovalResponse(sessionId, agentId, approvalId, approved, addToAllowlist);
}
