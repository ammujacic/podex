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
    if (contentType?.includes('application/json')) {
      data = await response.json();
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
