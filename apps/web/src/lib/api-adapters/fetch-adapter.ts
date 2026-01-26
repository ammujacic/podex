/**
 * Fetch-based HTTP adapter for web browsers.
 */

import type { HttpAdapter, HttpRequestConfig, HttpResponse } from '@podex/api-client';

export class FetchHttpAdapter implements HttpAdapter {
  async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: config.body,
      signal: config.signal,
      credentials: config.credentials,
    });

    // Parse response body
    let data: T;
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');

    // Handle empty responses (204 No Content, or empty body)
    if (response.status === 204 || contentLength === '0') {
      data = undefined as T;
    } else if (contentType?.includes('application/json')) {
      // Try to parse JSON, but handle empty body gracefully
      const text = await response.text();
      data = text ? JSON.parse(text) : (undefined as T);
    } else {
      data = (await response.text()) as T;
    }

    return {
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      data,
      ok: response.ok,
    };
  }
}
