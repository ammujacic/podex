/**
 * VSCode auth provider for @podex/api-client.
 * Shares credentials with CLI via ~/.podex/credentials.json for SSO.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import type { AuthProvider } from '@podex/api-client/adapters';
import {
  readConfigFile,
  writeConfigFile,
  deleteConfigFile,
  PODEX_CONFIG_DIR,
} from './vscode-storage-adapter';
import type { PodexCredentials } from '../types';
import { CREDENTIALS_FILE } from '../utils/constants';
import { logInfo, logDebug, logError } from '../utils/logger';

/**
 * Extended auth provider interface for VSCode.
 */
export interface VSCodeAuthProvider extends AuthProvider {
  /** Set credentials and persist to file */
  setCredentials: (credentials: PodexCredentials) => void;
  /** Get current credentials */
  getCredentials: () => PodexCredentials | null;
  /** Clear credentials from file and memory */
  clearCredentials: () => void;
  /** Check if user is authenticated with valid token */
  isAuthenticated: () => boolean;
  /** Check if token has expired */
  isTokenExpired: () => boolean;
  /** Event fired when credentials change (including from CLI) */
  onCredentialsChange: vscode.Event<PodexCredentials | null>;
  /** Dispose file watcher and resources */
  dispose: () => void;
}

/**
 * Create a VSCode auth provider that shares credentials with CLI.
 * Watches ~/.podex/credentials.json for external changes.
 */
export function createVSCodeAuthProvider(_context: vscode.ExtensionContext): VSCodeAuthProvider {
  // Event emitter for credential changes
  const onCredentialsChangeEmitter = new vscode.EventEmitter<PodexCredentials | null>();

  // In-memory cache for faster access
  let cachedCredentials: PodexCredentials | null = null;
  let loaded = false;

  // File watcher for external changes (e.g., CLI login)
  let fileWatcher: fs.FSWatcher | null = null;

  /**
   * Load credentials from file with caching.
   */
  const loadCredentials = (): PodexCredentials | null => {
    if (!loaded) {
      cachedCredentials = readConfigFile<PodexCredentials>(CREDENTIALS_FILE);
      loaded = true;
      logDebug(`Loaded credentials: ${cachedCredentials ? 'found' : 'not found'}`);
    }
    return cachedCredentials;
  };

  /**
   * Invalidate cache and reload credentials.
   */
  const reloadCredentials = (): PodexCredentials | null => {
    loaded = false;
    cachedCredentials = null;
    return loadCredentials();
  };

  /**
   * Set up file watcher for external credential changes.
   */
  const setupFileWatcher = (): void => {
    try {
      // Watch the parent directory since the file might not exist yet
      const watchPath = PODEX_CONFIG_DIR;

      if (!fs.existsSync(watchPath)) {
        fs.mkdirSync(watchPath, { recursive: true, mode: 0o700 });
      }

      fileWatcher = fs.watch(watchPath, (eventType, filename) => {
        if (filename === CREDENTIALS_FILE) {
          logDebug(`Credentials file changed (${eventType})`);
          const newCreds = reloadCredentials();
          onCredentialsChangeEmitter.fire(newCreds);
        }
      });

      fileWatcher.on('error', (error) => {
        logError('File watcher error', error);
      });

      logDebug('File watcher set up for credentials');
    } catch (error) {
      logError('Failed to set up file watcher', error);
    }
  };

  // Set up file watcher on creation
  setupFileWatcher();

  return {
    getAccessToken(): string | null {
      const creds = loadCredentials();
      if (!creds) return null;

      // Check if token is expired
      if (Date.now() >= creds.expiresAt) {
        logDebug('Access token expired');
        return null;
      }

      return creds.accessToken;
    },

    onUnauthorized(): void {
      logInfo('Received 401, clearing credentials');
      cachedCredentials = null;
      deleteConfigFile(CREDENTIALS_FILE);
      loaded = true;
      onCredentialsChangeEmitter.fire(null);
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

    setCredentials(credentials: PodexCredentials): void {
      logInfo(
        `Setting credentials for user: ${credentials.email || credentials.userId || 'unknown'}`
      );
      cachedCredentials = credentials;
      writeConfigFile(CREDENTIALS_FILE, credentials);
      loaded = true;
      onCredentialsChangeEmitter.fire(credentials);
    },

    getCredentials(): PodexCredentials | null {
      return loadCredentials();
    },

    clearCredentials(): void {
      logInfo('Clearing credentials');
      cachedCredentials = null;
      deleteConfigFile(CREDENTIALS_FILE);
      loaded = true;
      onCredentialsChangeEmitter.fire(null);
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

    onCredentialsChange: onCredentialsChangeEmitter.event,

    dispose(): void {
      if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
      }
      onCredentialsChangeEmitter.dispose();
      logDebug('Auth provider disposed');
    },
  };
}

// Singleton instance
let authProviderInstance: VSCodeAuthProvider | null = null;

/**
 * Initialize the singleton auth provider.
 */
export function initializeAuthProvider(context: vscode.ExtensionContext): VSCodeAuthProvider {
  if (!authProviderInstance) {
    authProviderInstance = createVSCodeAuthProvider(context);
    context.subscriptions.push({ dispose: () => authProviderInstance?.dispose() });
  }
  return authProviderInstance;
}

/**
 * Get the singleton auth provider instance.
 * Must call initializeAuthProvider first.
 */
export function getAuthProvider(): VSCodeAuthProvider {
  if (!authProviderInstance) {
    throw new Error('Auth provider not initialized. Call initializeAuthProvider first.');
  }
  return authProviderInstance;
}
