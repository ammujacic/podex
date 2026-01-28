/**
 * Adapter interfaces for platform-agnostic API client.
 * Implementations are provided by the consuming application.
 */

/**
 * HTTP request configuration.
 */
export interface HttpRequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  credentials?: 'include' | 'omit' | 'same-origin';
}

/**
 * HTTP response wrapper.
 */
export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  url: string;
  data: T;
  ok: boolean;
}

/**
 * HTTP adapter interface for making network requests.
 * Implement with fetch (web) or native HTTP client (React Native).
 */
export interface HttpAdapter {
  request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>>;
}

/**
 * Storage adapter interface for persistent key-value storage.
 * Implement with localStorage (web) or AsyncStorage (React Native).
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

/**
 * Auth provider interface for token management.
 * Connects to your auth store (e.g., Zustand).
 */
export interface AuthProvider {
  /** Get current access token, or null if not authenticated. */
  getAccessToken(): string | null;
  /** Called when API returns 401 to trigger logout. */
  onUnauthorized(): void;
  /** Attempt to refresh the access token using refresh token. Returns true if successful. */
  refreshToken(): Promise<boolean>;
}

/**
 * Error reporter interface for capturing API errors.
 * Implement with Sentry, LogRocket, or other error tracking.
 */
export interface ErrorReporter {
  captureError(
    error: Error,
    context: {
      tags?: Record<string, string | number | boolean>;
      extra?: Record<string, unknown>;
    }
  ): void;
}

/**
 * Configuration for creating an API client.
 */
export interface ApiClientConfig {
  /** Base URL for API requests. */
  baseUrl: string;
  /** HTTP adapter for making requests. */
  httpAdapter: HttpAdapter;
  /** Auth provider for token management. */
  authProvider: AuthProvider;
  /** Optional error reporter for capturing errors. */
  errorReporter?: ErrorReporter;
  /** Default request timeout in milliseconds. */
  timeout?: number;
}
