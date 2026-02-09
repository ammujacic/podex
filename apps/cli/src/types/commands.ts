/**
 * Command option types for CLI commands.
 */

export interface GlobalOptions {
  /** Use local pod instead of cloud */
  local?: boolean;
  /** API URL override */
  apiUrl?: string;
  /** Enable debug output */
  debug?: boolean;
}

export interface ChatOptions extends GlobalOptions {
  /** Session ID to resume */
  session?: string;
}

export interface RunOptions extends GlobalOptions {
  /** Session ID to resume */
  session?: string;
  /** Exit after task completion */
  exit?: boolean;
}

export interface AuthLoginOptions {
  /** Skip browser open */
  noBrowser?: boolean;
}

export interface SessionsListOptions {
  /** Output format */
  format?: 'table' | 'json';
  /** Maximum number of sessions to show */
  limit?: number;
}

export interface ConfigSetOptions {
  /** Set globally (user-wide) instead of project-local */
  global?: boolean;
}
