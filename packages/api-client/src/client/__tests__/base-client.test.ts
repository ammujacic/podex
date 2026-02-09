import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseApiClient } from '../base-client';
import { ApiRequestError } from '../../core/errors';
import type { HttpAdapter, HttpResponse, AuthProvider, ErrorReporter } from '../../adapters/types';

function createHttpResponse<T>(overrides: Partial<HttpResponse<T>>): HttpResponse<T> {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/test',
    data: {} as T,
    ...overrides,
  };
}

describe('BaseApiClient', () => {
  let httpAdapter: HttpAdapter;
  let authProvider: AuthProvider;
  let errorReporter: ErrorReporter;
  let client: BaseApiClient;

  beforeEach(() => {
    httpAdapter = {
      request: vi.fn(),
    };

    authProvider = {
      getAccessToken: vi.fn(() => 'token-123'),
      refreshToken: vi.fn(async () => true),
      onUnauthorized: vi.fn(),
    };

    errorReporter = {
      captureError: vi.fn(),
    };

    client = new BaseApiClient({
      baseUrl: 'https://api.example.com/',
      httpAdapter,
      authProvider,
      errorReporter,
    });
  });

  it('normalizes base URL by stripping trailing slash', () => {
    // @ts-expect-error accessing protected for test
    expect(client.baseUrl).toBe('https://api.example.com');
    client.setBaseUrl('https://api.example.com/base/');
    // @ts-expect-error accessing protected for test
    expect(client.baseUrl).toBe('https://api.example.com/base');
  });

  it('builds headers with and without auth', () => {
    // @ts-expect-error protected method
    const withAuth = client.getHeaders(true);
    expect(withAuth.Authorization).toBe('Bearer token-123');

    // @ts-expect-error protected method
    const withoutAuth = client.getHeaders(false);
    expect(withoutAuth.Authorization).toBeUndefined();
  });

  it('handles successful responses', () => {
    const response = createHttpResponse({ ok: true, data: { ok: true } });
    // @ts-expect-error protected method
    const data = client.handleResponse(response, false);
    expect(data).toEqual({ ok: true });
  });

  it('maps 422 pydantic validation errors to readable message and reports it', () => {
    const response = createHttpResponse({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      data: {
        // @ts-expect-error partial shape
        detail: [{ msg: 'field required' }, { msg: 'invalid value' }],
      },
    });

    // @ts-expect-error protected method
    expect(() => client.handleResponse(response, false)).toThrowError(
      new ApiRequestError('field required, invalid value', 422)
    );
    expect(errorReporter.captureError).toHaveBeenCalledTimes(1);
    const [err, context] = (errorReporter.captureError as vi.Mock).mock.calls[0];
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(context.tags).toMatchObject({ apiError: true, statusCode: 422 });
  });

  it('reports 500 errors via errorReporter', () => {
    const response = createHttpResponse({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      data: { detail: 'boom' } as never,
    });

    // @ts-expect-error protected method
    expect(() => client.handleResponse(response, true)).toThrow(ApiRequestError);
    expect(errorReporter.captureError).toHaveBeenCalled();
  });

  it('attempts token refresh on 401 and retries request', async () => {
    const firstError = new ApiRequestError('unauthorized', 401);
    const successResponse = createHttpResponse({ ok: true, data: { ok: true } });

    // First call rejects with 401, second succeeds
    (httpAdapter.request as vi.Mock)
      .mockRejectedValueOnce(firstError)
      .mockResolvedValueOnce(successResponse);

    const result = await client['requestWithRetry'](
      () => httpAdapter.request<{ ok: true }>({ url: '/test', method: 'GET' }),
      true
    );

    expect(authProvider.refreshToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it('logs out when refresh fails after 401', async () => {
    const firstError = new ApiRequestError('unauthorized', 401);
    (httpAdapter.request as vi.Mock).mockRejectedValue(firstError);
    (authProvider.refreshToken as vi.Mock).mockResolvedValue(false);

    await expect(
      client['requestWithRetry'](() => httpAdapter.request({ url: '/test', method: 'GET' }), true)
    ).rejects.toBe(firstError);

    expect(authProvider.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('wraps AbortError into ApiRequestError with isAborted flag', () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });

    expect(() =>
      // @ts-expect-error protected
      client.handleRequestError(abortError)
    ).toThrowError(
      expect.objectContaining({
        message: 'Request was cancelled',
        status: 0,
        isAborted: true,
      })
    );
  });

  it('maps fetch network errors to user-friendly message', () => {
    const fetchError = new TypeError('failed to fetch');

    expect(() =>
      // @ts-expect-error protected
      client.handleRequestError(fetchError)
    ).toThrowError(
      new ApiRequestError('Unable to connect to the API server. Please check your connection.', 503)
    );
  });
});
