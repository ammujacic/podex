/**
 * API error classes and utilities.
 * Platform-agnostic error handling.
 */

/**
 * Custom error class for API errors with status code.
 */
export class ApiRequestError extends Error {
  status: number;
  isAborted: boolean;

  constructor(message: string, status: number, isAborted = false) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.isAborted = isAborted;
  }
}

/**
 * Check if an error is an abort error.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof ApiRequestError && error.isAborted) {
    return true;
  }
  // DOMException check for browser environments
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return true;
  }
  return false;
}

/**
 * Check if an error is a quota/credit exhaustion error.
 */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    const msg = error.message.toLowerCase();
    // 402 Payment Required or 403 Forbidden with quota-related message
    return (
      error.status === 402 ||
      (error.status === 403 &&
        (msg.includes('quota') ||
          msg.includes('credit') ||
          msg.includes('exceeded') ||
          msg.includes('insufficient')))
    );
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('quota') ||
      msg.includes('credit') ||
      msg.includes('exceeded') ||
      msg.includes('insufficient')
    );
  }
  return false;
}

/**
 * Check if an error is a network connectivity error.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status === 503) {
    return true;
  }
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return true;
  }
  return false;
}

/**
 * Check if an error is an authentication error.
 */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

/**
 * Check if an error is a forbidden error.
 */
export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 403;
}

/**
 * Check if an error is a not found error.
 */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404;
}

/**
 * Check if an error is a server error (5xx).
 */
export function isServerError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status >= 500;
}
