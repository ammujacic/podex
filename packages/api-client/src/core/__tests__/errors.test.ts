import { describe, it, expect } from 'vitest';
import {
  ApiRequestError,
  isAbortError,
  isQuotaError,
  isNetworkError,
  isAuthError,
  isForbiddenError,
  isNotFoundError,
  isServerError,
} from '../errors';

describe('ApiRequestError', () => {
  it('should create error with message and status', () => {
    const error = new ApiRequestError('Test error', 404);
    expect(error.message).toBe('Test error');
    expect(error.status).toBe(404);
    expect(error.isAborted).toBe(false);
    expect(error.name).toBe('ApiRequestError');
  });

  it('should create error with abort flag', () => {
    const error = new ApiRequestError('Aborted', 0, true);
    expect(error.isAborted).toBe(true);
  });

  it('should be instance of Error', () => {
    const error = new ApiRequestError('Test', 500);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiRequestError);
  });
});

describe('Error Type Checkers', () => {
  describe('isAbortError', () => {
    it('should return true for ApiRequestError with isAborted flag', () => {
      const error = new ApiRequestError('Aborted', 0, true);
      expect(isAbortError(error)).toBe(true);
    });

    it('should return false for regular ApiRequestError', () => {
      const error = new ApiRequestError('Not aborted', 500);
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isAbortError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isAbortError(null)).toBe(false);
      expect(isAbortError(undefined)).toBe(false);
      expect(isAbortError('error')).toBe(false);
    });
  });

  describe('isQuotaError', () => {
    it('should return true for 402 status', () => {
      const error = new ApiRequestError('Payment required', 402);
      expect(isQuotaError(error)).toBe(true);
    });

    it('should return true for 403 with quota message', () => {
      const error = new ApiRequestError('Quota exceeded', 403);
      expect(isQuotaError(error)).toBe(true);
    });

    it('should return true for 403 with credit message', () => {
      const error = new ApiRequestError('Insufficient credits', 403);
      expect(isQuotaError(error)).toBe(true);
    });

    it('should return true for Error with quota message', () => {
      const error = new Error('Quota limit exceeded');
      expect(isQuotaError(error)).toBe(true);
    });

    it('should return false for regular 403', () => {
      const error = new ApiRequestError('Forbidden', 403);
      expect(isQuotaError(error)).toBe(false);
    });

    it('should return false for other errors', () => {
      const error = new ApiRequestError('Not found', 404);
      expect(isQuotaError(error)).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('should return true for 503 status', () => {
      const error = new ApiRequestError('Service unavailable', 503);
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return true for Failed to fetch TypeError', () => {
      const error = new TypeError('Failed to fetch');
      expect(isNetworkError(error)).toBe(true);
    });

    it('should return false for other TypeErrors', () => {
      const error = new TypeError('Some other type error');
      expect(isNetworkError(error)).toBe(false);
    });

    it('should return false for other status codes', () => {
      const error = new ApiRequestError('Bad request', 400);
      expect(isNetworkError(error)).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('should return true for 401 status', () => {
      const error = new ApiRequestError('Unauthorized', 401);
      expect(isAuthError(error)).toBe(true);
    });

    it('should return false for other status codes', () => {
      expect(isAuthError(new ApiRequestError('Forbidden', 403))).toBe(false);
      expect(isAuthError(new ApiRequestError('Not found', 404))).toBe(false);
      expect(isAuthError(new Error('Error'))).toBe(false);
    });
  });

  describe('isForbiddenError', () => {
    it('should return true for 403 status', () => {
      const error = new ApiRequestError('Forbidden', 403);
      expect(isForbiddenError(error)).toBe(true);
    });

    it('should return false for other status codes', () => {
      expect(isForbiddenError(new ApiRequestError('Unauthorized', 401))).toBe(false);
      expect(isForbiddenError(new ApiRequestError('Not found', 404))).toBe(false);
    });
  });

  describe('isNotFoundError', () => {
    it('should return true for 404 status', () => {
      const error = new ApiRequestError('Not found', 404);
      expect(isNotFoundError(error)).toBe(true);
    });

    it('should return false for other status codes', () => {
      expect(isNotFoundError(new ApiRequestError('Forbidden', 403))).toBe(false);
      expect(isNotFoundError(new ApiRequestError('Server error', 500))).toBe(false);
    });
  });

  describe('isServerError', () => {
    it('should return true for 500 status', () => {
      const error = new ApiRequestError('Internal server error', 500);
      expect(isServerError(error)).toBe(true);
    });

    it('should return true for 502 status', () => {
      const error = new ApiRequestError('Bad gateway', 502);
      expect(isServerError(error)).toBe(true);
    });

    it('should return true for 503 status', () => {
      const error = new ApiRequestError('Service unavailable', 503);
      expect(isServerError(error)).toBe(true);
    });

    it('should return false for 4xx status codes', () => {
      expect(isServerError(new ApiRequestError('Bad request', 400))).toBe(false);
      expect(isServerError(new ApiRequestError('Not found', 404))).toBe(false);
    });

    it('should return false for non-ApiRequestError', () => {
      expect(isServerError(new Error('Error'))).toBe(false);
    });
  });
});
