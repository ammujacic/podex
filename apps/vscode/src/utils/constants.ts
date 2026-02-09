/**
 * Extension constants.
 */

import * as path from 'path';
import * as os from 'os';

/** Extension ID */
export const EXTENSION_ID = 'podex.podex-vscode';

/** Extension display name */
export const EXTENSION_NAME = 'Podex';

/** Default API URL */
export const DEFAULT_API_URL = 'https://api.podex.dev';

/** Config directory path (~/.podex/) */
export const PODEX_CONFIG_DIR = path.join(os.homedir(), '.podex');

/** Credentials file name */
export const CREDENTIALS_FILE = 'credentials.json';

/** Context keys for when clauses */
export const CONTEXT_KEYS = {
  isAuthenticated: 'podex.isAuthenticated',
  hasActiveSession: 'podex.hasActiveSession',
  localPodRunning: 'podex.localPodRunning',
} as const;

/** Command IDs */
export const COMMANDS = {
  login: 'podex.login',
  logout: 'podex.logout',
  status: 'podex.status',
  openWorkspace: 'podex.openWorkspace',
  createSession: 'podex.createSession',
  openSession: 'podex.openSession',
  refreshSessions: 'podex.refreshSessions',
  startLocalPod: 'podex.startLocalPod',
  stopLocalPod: 'podex.stopLocalPod',
  connectLocalPod: 'podex.connectLocalPod',
} as const;

/** View IDs */
export const VIEWS = {
  sessions: 'podex.sessions',
  agents: 'podex.agents',
  localPods: 'podex.localPods',
} as const;
