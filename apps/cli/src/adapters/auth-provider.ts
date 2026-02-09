/**
 * CLI auth provider for @podex/api-client.
 * Manages authentication state with file-based persistence.
 */

import type { AuthProvider } from '@podex/api-client/adapters';
import { readConfigFile, writeConfigFile, deleteConfigFile } from './storage-adapter';
import type { CliCredentials } from '../types/config';

const CREDENTIALS_FILE = 'credentials.json';

/**
 * Create a CLI auth provider that persists tokens to ~/.podex/credentials.json
 */
export function createCliAuthProvider(): AuthProvider & {
  setCredentials: (credentials: CliCredentials) => void;
  getCredentials: () => CliCredentials | null;
  clearCredentials: () => void;
  isAuthenticated: () => boolean;
  isTokenExpired: () => boolean;
} {
  // In-memory cache for faster access
  let cachedCredentials: CliCredentials | null = null;
  let loaded = false;

  const loadCredentials = (): CliCredentials | null => {
    if (!loaded) {
      cachedCredentials = readConfigFile<CliCredentials>(CREDENTIALS_FILE);
      loaded = true;
    }
    return cachedCredentials;
  };

  return {
    getAccessToken(): string | null {
      const creds = loadCredentials();
      if (!creds) return null;

      // Check if token is expired
      if (Date.now() >= creds.expiresAt) {
        return null;
      }

      return creds.accessToken;
    },

    onUnauthorized(): void {
      // Clear credentials on 401
      cachedCredentials = null;
      deleteConfigFile(CREDENTIALS_FILE);
      loaded = true;
    },

    async refreshToken(): Promise<boolean> {
      const creds = loadCredentials();
      if (!creds?.refreshToken) {
        return false;
      }

      // Note: Actual refresh logic is handled by auth-service
      // This just indicates whether refresh is possible
      return true;
    },

    setCredentials(credentials: CliCredentials): void {
      cachedCredentials = credentials;
      writeConfigFile(CREDENTIALS_FILE, credentials);
      loaded = true;
    },

    getCredentials(): CliCredentials | null {
      return loadCredentials();
    },

    clearCredentials(): void {
      cachedCredentials = null;
      deleteConfigFile(CREDENTIALS_FILE);
      loaded = true;
    },

    isAuthenticated(): boolean {
      const creds = loadCredentials();
      if (!creds) return false;
      return Date.now() < creds.expiresAt;
    },

    isTokenExpired(): boolean {
      const creds = loadCredentials();
      if (!creds) return true;
      return Date.now() >= creds.expiresAt;
    },
  };
}

// Singleton instance
let authProviderInstance: ReturnType<typeof createCliAuthProvider> | null = null;

/**
 * Get the singleton auth provider instance.
 */
export function getCliAuthProvider(): ReturnType<typeof createCliAuthProvider> {
  if (!authProviderInstance) {
    authProviderInstance = createCliAuthProvider();
  }
  return authProviderInstance;
}
