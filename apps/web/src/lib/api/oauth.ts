/**
 * OAuth API functions for managing connected accounts.
 *
 * Handles OAuth flows for personal plan providers:
 * - Anthropic (Claude Pro/Max)
 * - Google (Gemini)
 * - GitHub (Copilot)
 */

import { api } from '../api';

export interface OAuthProvider {
  id: string;
  name: string;
  configured: boolean;
}

export interface OAuthConnection {
  provider: string;
  status: 'connected' | 'error' | 'expired';
  email: string | null;
  name: string | null;
  expires_at: number | null;
}

export interface OAuthStartResponse {
  auth_url: string;
  state: string;
}

export interface OAuthCallbackRequest {
  code: string;
  state: string;
}

/**
 * Get available OAuth providers and their configuration status.
 */
export async function getOAuthProviders(): Promise<OAuthProvider[]> {
  const response = await api.get<{ providers: OAuthProvider[] }>('/api/llm-oauth/providers');
  return response.providers;
}

/**
 * Get user's OAuth connections.
 */
export async function getOAuthConnections(): Promise<OAuthConnection[]> {
  const response = await api.get<{ connections: OAuthConnection[] }>('/api/llm-oauth/connections');
  return response.connections;
}

/**
 * Start OAuth flow for a provider.
 * Returns the authorization URL to redirect/open in popup.
 */
export async function startOAuthFlow(provider: string): Promise<OAuthStartResponse> {
  return api.get<OAuthStartResponse>(`/api/llm-oauth/${provider}/start`);
}

/**
 * Complete OAuth flow by sending callback code/state.
 * Used when frontend handles the OAuth callback.
 */
export async function completeOAuthFlow(
  provider: string,
  data: OAuthCallbackRequest
): Promise<OAuthConnection> {
  return api.post<OAuthConnection>(`/api/llm-oauth/${provider}/callback`, data);
}

/**
 * Disconnect an OAuth provider.
 */
export async function disconnectOAuth(provider: string): Promise<void> {
  await api.delete(`/api/llm-oauth/${provider}`);
}

/**
 * Refresh an OAuth token.
 */
export async function refreshOAuthToken(provider: string): Promise<OAuthConnection> {
  return api.post<OAuthConnection>(`/api/llm-oauth/${provider}/refresh`, {});
}

/**
 * Opens OAuth flow in a popup window.
 * Returns a promise that resolves when OAuth is complete.
 */
export function openOAuthPopup(authUrl: string): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    // Calculate popup position (center of screen)
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      authUrl,
      'oauth_popup',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
    );

    if (!popup) {
      reject(new Error('Failed to open popup. Please check your popup blocker settings.'));
      return;
    }

    // Listen for messages from the popup
    const handleMessage = (event: MessageEvent) => {
      // Verify origin
      if (event.origin !== window.location.origin) return;

      const data = event.data;
      if (data?.type === 'oauth_callback') {
        window.removeEventListener('message', handleMessage);
        popup.close();

        if (data.error) {
          reject(new Error(data.error));
        } else {
          resolve({ code: data.code, state: data.state });
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Check if popup was closed manually
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        reject(new Error('OAuth flow was cancelled'));
      }
    }, 500);

    // Timeout after 5 minutes
    setTimeout(
      () => {
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        if (!popup.closed) {
          popup.close();
        }
        reject(new Error('OAuth flow timed out'));
      },
      5 * 60 * 1000
    );
  });
}
