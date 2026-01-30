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
export { ApiRequestError, isAbortError, isQuotaError } from './core/errors';
export { calculateExpiry } from './core/utils';

// Adapter interfaces
export type {
  ApiClientConfig,
  AuthProvider,
  ErrorReporter,
  HttpAdapter,
  HttpRequestConfig,
  HttpResponse,
} from './adapters/types';

// Client
export { BaseApiClient } from './client/base-client';

// Types
export type { AuthResponse, TokenResponse } from './types/index';
