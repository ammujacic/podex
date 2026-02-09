/**
 * CLI configuration types.
 */

/**
 * CLI configuration schema.
 */
export interface CliConfig {
  /** API base URL */
  apiUrl: string;
  /** Default to local pod */
  defaultLocal: boolean;
  /** Auto-approve certain tool categories */
  autoApprove: string[];
  /** Maximum message history to keep in memory */
  maxMessageHistory: number;
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default CLI configuration values.
 */
export const DEFAULT_CLI_CONFIG: CliConfig = {
  apiUrl: 'https://api.podex.dev',
  defaultLocal: false,
  autoApprove: [],
  maxMessageHistory: 100,
  debug: false,
};

/**
 * Credentials stored in ~/.podex/credentials.json
 */
export interface CliCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId?: string;
  email?: string;
}
