/**
 * Authentication service for CLI.
 * Implements device flow authentication.
 */

import open from 'open';
import { getApiClient } from './api-client';
import { getCliAuthProvider } from '../adapters/auth-provider';
import type { CliCredentials } from '../types/config';

/**
 * Device code response from API.
 */
export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

/**
 * Token response from API.
 */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Error response during device flow.
 */
export interface DeviceFlowError {
  error: 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | string;
  error_description?: string;
}

/**
 * User info response.
 */
export interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

/**
 * Authentication service for device flow.
 */
export class AuthService {
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private aborted = false;

  /**
   * Initiate the device authentication flow.
   * Returns the device code info for display to the user.
   */
  async initiateDeviceAuth(): Promise<DeviceCodeResponse> {
    const client = getApiClient();
    return client.post<DeviceCodeResponse>(
      '/api/v1/auth/device/code',
      {
        device_type: 'cli',
        device_name: `Podex CLI on ${process.platform}`,
      },
      false
    );
  }

  /**
   * Poll for token completion.
   * Resolves when the user completes authentication.
   *
   * @param deviceCode The device code from initiateDeviceAuth
   * @param interval Polling interval in seconds
   * @param onPending Optional callback when polling (user hasn't completed yet)
   */
  async pollForToken(
    deviceCode: string,
    interval: number,
    onPending?: () => void
  ): Promise<TokenResponse> {
    const client = getApiClient();
    this.aborted = false;

    return new Promise((resolve, reject) => {
      let currentInterval = interval;

      const poll = async () => {
        if (this.aborted) {
          this.stopPolling();
          reject(new Error('Authentication cancelled'));
          return;
        }

        try {
          const response = await client.post<TokenResponse | DeviceFlowError>(
            '/api/v1/auth/device/token',
            { device_code: deviceCode },
            false
          );

          if ('error' in response) {
            if (response.error === 'authorization_pending') {
              onPending?.();
              return; // Continue polling
            }

            if (response.error === 'slow_down') {
              // Increase interval by 5 seconds
              currentInterval += 5;
              this.restartPolling(poll, currentInterval);
              return;
            }

            if (response.error === 'expired_token') {
              this.stopPolling();
              reject(new Error('Device code expired. Please try again.'));
              return;
            }

            if (response.error === 'access_denied') {
              this.stopPolling();
              reject(new Error('Access denied. User cancelled authentication.'));
              return;
            }

            this.stopPolling();
            reject(new Error(response.error_description || response.error));
            return;
          }

          // Success
          this.stopPolling();

          // Store credentials
          const authProvider = getCliAuthProvider();
          const credentials: CliCredentials = {
            accessToken: response.access_token,
            refreshToken: response.refresh_token,
            expiresAt: Date.now() + response.expires_in * 1000,
          };
          authProvider.setCredentials(credentials);

          // Fetch and store user info
          try {
            const userInfo = await this.getCurrentUser();
            if (userInfo) {
              authProvider.setCredentials({
                ...credentials,
                userId: userInfo.id,
                email: userInfo.email,
              });
            }
          } catch {
            // User info fetch failed, but we have tokens
          }

          resolve(response);
        } catch {
          // Network error, continue polling
          onPending?.();
        }
      };

      // Start polling
      this.pollInterval = setInterval(poll, currentInterval * 1000);
      // Also run immediately
      poll();
    });
  }

  /**
   * Restart polling with a new interval.
   */
  private restartPolling(pollFn: () => void, intervalSeconds: number): void {
    this.stopPolling();
    this.pollInterval = setInterval(pollFn, intervalSeconds * 1000);
  }

  /**
   * Stop the polling interval.
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Abort the authentication flow.
   */
  abort(): void {
    this.aborted = true;
    this.stopPolling();
  }

  /**
   * Open the verification URL in the user's browser.
   */
  async openBrowser(url: string): Promise<void> {
    await open(url);
  }

  /**
   * Get the current authenticated user.
   */
  async getCurrentUser(): Promise<UserInfo | null> {
    const authProvider = getCliAuthProvider();
    if (!authProvider.isAuthenticated()) {
      return null;
    }

    try {
      const client = getApiClient();
      return await client.get<UserInfo>('/api/v1/users/me');
    } catch {
      return null;
    }
  }

  /**
   * Refresh the access token.
   */
  async refreshToken(): Promise<boolean> {
    const authProvider = getCliAuthProvider();
    const credentials = authProvider.getCredentials();

    if (!credentials?.refreshToken) {
      return false;
    }

    try {
      const client = getApiClient();
      const response = await client.post<TokenResponse>(
        '/api/v1/auth/refresh',
        { refresh_token: credentials.refreshToken },
        false
      );

      authProvider.setCredentials({
        ...credentials,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: Date.now() + response.expires_in * 1000,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Log out the current user.
   */
  async logout(): Promise<void> {
    const authProvider = getCliAuthProvider();

    try {
      const client = getApiClient();
      await client.post('/api/v1/auth/logout', {});
    } catch {
      // Ignore logout errors
    }

    authProvider.clearCredentials();
  }

  /**
   * Check if the user is currently authenticated.
   */
  isAuthenticated(): boolean {
    const authProvider = getCliAuthProvider();
    return authProvider.isAuthenticated();
  }

  /**
   * Get stored credentials.
   */
  getCredentials(): CliCredentials | null {
    const authProvider = getCliAuthProvider();
    return authProvider.getCredentials();
  }
}

// Singleton instance
let authServiceInstance: AuthService | null = null;

/**
 * Get the singleton auth service instance.
 */
export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    authServiceInstance = new AuthService();
  }
  return authServiceInstance;
}
