/**
 * @podex/api-client
 *
 * Platform-agnostic API client for Podex services.
 * Uses adapter pattern for HTTP, auth, and error reporting.
 *
 * @example
 * ```typescript
 * import { BaseApiClient } from '@podex/api-client';
 * import { FetchHttpAdapter, ZustandAuthProvider } from './adapters';
 *
 * const client = new BaseApiClient({
 *   baseUrl: 'https://api.podex.app',
 *   httpAdapter: new FetchHttpAdapter(),
 *   authProvider: new ZustandAuthProvider(),
 * });
 *
 * const user = await client.get('/api/auth/me');
 * ```
 */

// Core utilities
export { RequestCache } from './core/cache';
export {
  ApiRequestError,
  isAbortError,
  isAuthError,
  isForbiddenError,
  isNetworkError,
  isNotFoundError,
  isQuotaError,
  isServerError,
} from './core/errors';
export {
  buildQueryString,
  calculateExpiry,
  camelToSnake,
  isTokenExpiringSoon,
  joinPath,
  snakeToCamel,
  transformKeysToCamel,
  transformKeysToSnake,
} from './core/utils';

// Adapter interfaces
export type {
  ApiClientConfig,
  AuthProvider,
  ErrorReporter,
  HttpAdapter,
  HttpRequestConfig,
  HttpResponse,
  StorageAdapter,
} from './adapters/types';

// Client
export { BaseApiClient } from './client/base-client';

// Types
export type {
  ApiError,
  AuthResponse,
  AuthTokens,
  CachedRequestOptions,
  LoginRequest,
  OAuthTokenResponse,
  OAuthURLResponse,
  PaginatedResponse,
  RegisterRequest,
  RequestOptions,
  TokenResponse,
  User,
} from './types/index';
