/**
 * Node.js HTTP adapter for @podex/api-client.
 * Uses native fetch (Node 18+).
 */

import type { HttpAdapter, HttpRequestConfig, HttpResponse } from '@podex/api-client/adapters';

/**
 * Create a Node.js HTTP adapter using native fetch.
 */
export function createNodeHttpAdapter(): HttpAdapter {
  return {
    async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
      const { url, method, headers, body, signal, credentials } = config;

      // CLI requests need X-Requested-With header since we don't have browser Origin header
      const finalHeaders: Record<string, string> = {
        ...headers,
        'X-Requested-With': 'XMLHttpRequest',
      };

      const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body,
        signal,
        credentials: credentials === 'include' ? 'include' : undefined,
      });

      let data: T;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        // For non-JSON responses, return empty object or text
        const text = await response.text();
        data = (text ? { message: text } : {}) as T;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        data,
        ok: response.ok,
      };
    },
  };
}
