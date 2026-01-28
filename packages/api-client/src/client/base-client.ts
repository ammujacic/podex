/**
 * Base API client with adapter pattern.
 * Platform-agnostic - uses injected adapters for HTTP, auth, and error reporting.
 */

import type {
  ApiClientConfig,
  AuthProvider,
  ErrorReporter,
  HttpAdapter,
  HttpResponse,
} from '../adapters/types';
import { RequestCache } from '../core/cache';
import { ApiRequestError } from '../core/errors';
import type { CachedRequestOptions, RequestOptions } from '../types/api';

export class BaseApiClient {
  protected baseUrl: string;
  protected httpAdapter: HttpAdapter;
  protected authProvider: AuthProvider;
  protected errorReporter?: ErrorReporter;
  protected cache: RequestCache;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.httpAdapter = config.httpAdapter;
    this.authProvider = config.authProvider;
    this.errorReporter = config.errorReporter;
    this.cache = new RequestCache();
  }

  /**
   * Get the request cache instance.
   */
  getCache(): RequestCache {
    return this.cache;
  }

  /**
   * Update the base URL (useful for Electron apps that need to configure it at runtime).
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Build headers for a request.
   */
  protected getHeaders(includeAuth = true): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (includeAuth) {
      const token = this.authProvider.getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Attempt to refresh the access token.
   * Ensures only one refresh happens at a time by reusing the same promise.
   */
  private async attemptTokenRefresh(): Promise<boolean> {
    // If already refreshing, wait for the existing refresh to complete
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh operation
    this.refreshPromise = this.authProvider
      .refreshToken()
      .then((success) => {
        this.refreshPromise = null;
        return success;
      })
      .catch(() => {
        this.refreshPromise = null;
        return false;
      });

    return this.refreshPromise;
  }

  /**
   * Handle HTTP response and errors.
   */
  protected handleResponse<T>(response: HttpResponse<T>, isRetry: boolean = false): T {
    if (!response.ok) {
      const error = response.data as { detail?: string | Array<{ msg: string }> };

      // Handle Pydantic validation errors (422) which return detail as an array
      let message: string;
      if (Array.isArray(error?.detail)) {
        message = error.detail.map((e) => e.msg).join(', ');
      } else if (typeof error?.detail === 'string') {
        message = error.detail;
      } else {
        message = `HTTP ${response.status}: ${response.statusText}`;
      }

      const err = new ApiRequestError(message, response.status);

      // On 401, only logout if this was already a retry (refresh failed)
      // If not a retry, the calling method will attempt to refresh and retry
      if (response.status === 401 && isRetry) {
        this.authProvider.onUnauthorized();
      }

      // Report API errors (skip 401/403 as they're expected auth errors)
      if (
        this.errorReporter &&
        (response.status >= 500 ||
          (response.status >= 400 && response.status !== 401 && response.status !== 403))
      ) {
        this.errorReporter.captureError(err, {
          tags: {
            apiError: true,
            statusCode: response.status,
          },
          extra: {
            url: response.url,
            status: response.status,
            statusText: response.statusText,
            isRetry,
          },
        });
      }

      throw err;
    }

    return response.data;
  }

  /**
   * Handle fetch/network errors.
   */
  protected handleRequestError(error: unknown): never {
    // Re-throw ApiRequestError as-is
    if (error instanceof ApiRequestError) {
      throw error;
    }

    // Handle abort errors (check for AbortError name pattern)
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || (error as Error & { code?: string }).code === 'ABORT_ERR')
    ) {
      throw new ApiRequestError('Request was cancelled', 0, true);
    }

    // Handle network errors
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiRequestError(
        'Unable to connect to the API server. Please check your connection.',
        503
      );
    }

    throw error;
  }

  /**
   * Execute a request with automatic retry on 401 (expired token).
   * If the first request fails with 401, attempts to refresh the token and retry once.
   */
  protected async requestWithRetry<T>(
    requestFn: () => Promise<HttpResponse<T>>,
    includeAuth: boolean
  ): Promise<T> {
    try {
      // First attempt
      const response = await requestFn();
      return this.handleResponse(response, false);
    } catch (error) {
      // If it's a 401 and we're using auth, try to refresh and retry
      if (
        error instanceof ApiRequestError &&
        error.status === 401 &&
        includeAuth &&
        !error.isAborted
      ) {
        const refreshed = await this.attemptTokenRefresh();

        if (refreshed) {
          // Token refreshed successfully, retry the request
          try {
            const response = await requestFn();
            return this.handleResponse(response, true);
          } catch (retryError) {
            this.handleRequestError(retryError);
          }
        } else {
          // Refresh failed, logout and throw
          this.authProvider.onUnauthorized();
          throw error;
        }
      }

      // Not a 401 or refresh not applicable, re-throw
      this.handleRequestError(error);
    }
  }

  /**
   * Make a GET request.
   */
  async get<T>(path: string, options: RequestOptions | boolean = true): Promise<T> {
    const opts: RequestOptions = typeof options === 'boolean' ? { includeAuth: options } : options;
    const { includeAuth = true, signal } = opts;

    return this.requestWithRetry(
      () =>
        this.httpAdapter.request<T>({
          url: `${this.baseUrl}${path}`,
          method: 'GET',
          headers: this.getHeaders(includeAuth),
          credentials: 'include',
          signal,
        }),
      includeAuth
    );
  }

  /**
   * GET request with caching and deduplication.
   */
  async getCached<T>(path: string, options: CachedRequestOptions = {}): Promise<T> {
    const { ttl, includeAuth = true, forceRefresh = false, signal } = options;
    const cacheKey = `GET:${path}`;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Deduplicate concurrent requests
    return this.cache.deduplicateRequest(cacheKey, async () => {
      const data = await this.get<T>(path, { includeAuth, signal });
      this.cache.set(cacheKey, data, ttl);
      return data;
    });
  }

  /**
   * Make a POST request.
   */
  async post<T>(path: string, data: unknown, options: RequestOptions | boolean = true): Promise<T> {
    const opts: RequestOptions = typeof options === 'boolean' ? { includeAuth: options } : options;
    const { includeAuth = true, signal } = opts;

    return this.requestWithRetry(
      () =>
        this.httpAdapter.request<T>({
          url: `${this.baseUrl}${path}`,
          method: 'POST',
          headers: this.getHeaders(includeAuth),
          credentials: 'include',
          body: JSON.stringify(data),
          signal,
        }),
      includeAuth
    );
  }

  /**
   * Make a PUT request.
   */
  async put<T>(path: string, data: unknown, options: RequestOptions = {}): Promise<T> {
    const { includeAuth = true, signal } = options;

    return this.requestWithRetry(
      () =>
        this.httpAdapter.request<T>({
          url: `${this.baseUrl}${path}`,
          method: 'PUT',
          headers: this.getHeaders(includeAuth),
          credentials: 'include',
          body: JSON.stringify(data),
          signal,
        }),
      includeAuth
    );
  }

  /**
   * Make a PATCH request.
   */
  async patch<T>(path: string, data: unknown, options: RequestOptions = {}): Promise<T> {
    const { includeAuth = true, signal } = options;

    return this.requestWithRetry(
      () =>
        this.httpAdapter.request<T>({
          url: `${this.baseUrl}${path}`,
          method: 'PATCH',
          headers: this.getHeaders(includeAuth),
          credentials: 'include',
          body: JSON.stringify(data),
          signal,
        }),
      includeAuth
    );
  }

  /**
   * Make a DELETE request.
   */
  async delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { includeAuth = true, signal } = options;

    return this.requestWithRetry(
      () =>
        this.httpAdapter.request<T>({
          url: `${this.baseUrl}${path}`,
          method: 'DELETE',
          headers: this.getHeaders(includeAuth),
          credentials: 'include',
          signal,
        }),
      includeAuth
    );
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidateCache(pattern: string | RegExp): void {
    this.cache.invalidatePattern(pattern);
  }

  /**
   * Clear all cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
