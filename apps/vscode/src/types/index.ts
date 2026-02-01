/**
 * VSCode extension type definitions.
 */

/**
 * Credentials stored in ~/.podex/credentials.json
 * Shared with CLI for SSO.
 */
export interface PodexCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId?: string;
  email?: string;
}

/**
 * Extension configuration (from VSCode settings).
 */
export interface ExtensionConfig {
  apiUrl: string;
  autoConnect: boolean;
  localPod: {
    autoStart: boolean;
    pythonPath: string;
  };
  workspace: {
    defaultLayout: 'grid' | 'split' | 'single';
  };
}

/**
 * Messages sent from extension host to webview.
 */
export type ExtensionToWebviewMessage =
  | { type: 'session:update'; payload: unknown }
  | { type: 'session:agents'; payload: unknown[] }
  | { type: 'agent:message'; payload: unknown }
  | { type: 'agent:stream:start'; payload: { agentId: string } }
  | { type: 'agent:stream:token'; payload: { agentId: string; token: string } }
  | { type: 'agent:stream:end'; payload: { agentId: string } }
  | { type: 'approval:request'; payload: unknown }
  | { type: 'theme:changed'; payload: { kind: 'light' | 'dark' } }
  | { type: 'config:update'; payload: ExtensionConfig };

/**
 * Messages sent from webview to extension host.
 */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'chat:send'; payload: { agentId: string; content: string } }
  | { type: 'agent:stop'; payload: { agentId: string } }
  | { type: 'approval:respond'; payload: { id: string; approved: boolean } }
  | { type: 'file:open'; payload: { path: string } };
