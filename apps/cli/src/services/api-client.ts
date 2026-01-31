/**
 * Configured API client for CLI.
 */

import { BaseApiClient } from '@podex/api-client';
import { createNodeHttpAdapter } from '../adapters/http-adapter';
import { getCliAuthProvider } from '../adapters/auth-provider';
import { getCliConfigStore } from '../stores/cli-config';

let apiClientInstance: BaseApiClient | null = null;

/**
 * Get the configured API client instance.
 */
export function getApiClient(): BaseApiClient {
  if (!apiClientInstance) {
    const configStore = getCliConfigStore();
    const authProvider = getCliAuthProvider();

    apiClientInstance = new BaseApiClient({
      baseUrl: configStore.getState().apiUrl,
      httpAdapter: createNodeHttpAdapter(),
      authProvider,
    });
  }

  return apiClientInstance;
}

/**
 * Update the API client base URL.
 */
export function setApiClientBaseUrl(url: string): void {
  const client = getApiClient();
  client.setBaseUrl(url);
}

/**
 * Clear the API client instance (useful for testing).
 */
export function clearApiClient(): void {
  apiClientInstance = null;
}
