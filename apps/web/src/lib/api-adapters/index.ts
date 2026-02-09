/**
 * Web-specific adapters for @podex/api-client.
 */

export { FetchHttpAdapter } from './fetch-adapter';
export { PodexApiClient } from './podex-client';
export type { LoginRequest, RegisterRequest } from './podex-client';
export { SentryErrorReporter } from './sentry-error-reporter';
export { ZustandAuthProvider } from './zustand-auth-provider';
