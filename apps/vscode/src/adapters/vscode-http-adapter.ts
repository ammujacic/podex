/**
 * HTTP adapter for VSCode extension using Node.js fetch.
 */

import type { HttpAdapter, HttpRequestConfig, HttpResponse } from '@podex/api-client/adapters';
import { logDebug, logError } from '../utils/logger';

/**
 * Create an HTTP adapter using Node.js native fetch.
 */
export function createNodeHttpAdapter(): HttpAdapter {
  return {
    async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
      const { method, url, headers, body, signal, credentials } = config;

      logDebug(`HTTP ${method} ${url}`);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest', // CSRF protection
            ...headers,
          },
          body: body ?? undefined,
          signal: signal ?? undefined,
          credentials: credentials ?? 'same-origin',
        });

        // Parse response
        let data: T;
        const contentType = response.headers.get('content-type');

        if (contentType?.includes('application/json')) {
          data = (await response.json()) as T;
        } else {
          // Return text as T (caller is responsible for type safety)
          data = (await response.text()) as T;
        }

        logDebug(`HTTP ${method} ${url} -> ${response.status}`);

        return {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          data,
          ok: response.ok,
        };
      } catch (error) {
        logError(`HTTP ${method} ${url} failed`, error);

        // Re-throw abort errors
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }

        // Wrap other errors
        throw new Error(
          `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  };
}
