/**
 * Service exports.
 */

export {
  initializeApiClient,
  getApiClient,
  updateApiClientUrl,
  sessionApi,
  type SessionResponse,
  type SessionListResponse,
  type AgentResponse,
} from './api-client';

export {
  initializeSocketClient,
  getSocketClient,
  connectSocket,
  disconnectSocket,
  isSocketConnected,
  getConnectionState,
  onConnectionStateChange,
  joinSession,
  leaveSession,
  onSocketEvent,
  sendApprovalResponse,
  sendNativeApprovalResponse,
} from './socket-service';

export {
  startLocalPod,
  stopLocalPod,
  getLocalPodProcess,
  isLocalPodRunning,
  type LocalPodProcess,
  type StartPodOptions,
} from './local-pod-service';
