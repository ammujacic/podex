/**
 * Socket.IO service wrapper for CLI.
 */

import { createSocketClient, type SocketClient, type SocketClientConfig } from '@podex/api-client';
import { getCliAuthProvider } from '../adapters/auth-provider';
import { getCliConfigStore } from '../stores/cli-config';

let socketClientInstance: SocketClient | null = null;

/**
 * Get the configured Socket.IO client instance.
 */
export function getSocketClient(): SocketClient {
  if (!socketClientInstance) {
    const configStore = getCliConfigStore();
    const authProvider = getCliAuthProvider();

    const config: SocketClientConfig = {
      url: configStore.getState().apiUrl,
      getAuthToken: () => authProvider.getAccessToken(),
      autoConnect: false,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    };

    socketClientInstance = createSocketClient(config);
  }

  return socketClientInstance;
}

/**
 * Connect to the socket server.
 */
export function connectSocket(): void {
  const client = getSocketClient();
  client.connect();
}

/**
 * Disconnect from the socket server.
 */
export function disconnectSocket(): void {
  if (socketClientInstance) {
    socketClientInstance.disconnect();
  }
}

/**
 * Dispose the socket client.
 */
export function disposeSocket(): void {
  if (socketClientInstance) {
    socketClientInstance.dispose();
    socketClientInstance = null;
  }
}

/**
 * Check if socket is connected.
 */
export function isSocketConnected(): boolean {
  return socketClientInstance?.isConnected() ?? false;
}
