/**
 * Tests for VSCode HTTP adapter (Node fetch).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNodeHttpAdapter } from '../vscode-http-adapter';

vi.mock('../../utils/logger', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
}));

describe('createNodeHttpAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return an adapter with request method', () => {
    const adapter = createNodeHttpAdapter();
    expect(adapter).toHaveProperty('request');
    expect(typeof adapter.request).toBe('function');
  });

  it('should perform GET request and parse JSON response', async () => {
    const mockJson = { id: 1, name: 'test' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/foo',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(mockJson),
      text: () => Promise.resolve(JSON.stringify(mockJson)),
    });

    const adapter = createNodeHttpAdapter();
    const res = await adapter.request<typeof mockJson>({
      method: 'GET',
      url: 'https://api.example.com/foo',
    });

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(mockJson);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/foo',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        }),
      })
    );
  });

  it('should perform POST with body and parse JSON response', async () => {
    const body = { key: 'value' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      url: 'https://api.example.com/bar',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ created: true }),
      text: () => Promise.resolve('{"created":true}'),
    });

    const adapter = createNodeHttpAdapter();
    const res = await adapter.request({
      method: 'POST',
      url: 'https://api.example.com/bar',
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    expect(res.data).toEqual({ created: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/bar',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  });

  it('should parse non-JSON response as text', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/text',
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve('plain text'),
    });

    const adapter = createNodeHttpAdapter();
    const res = await adapter.request<string>({
      method: 'GET',
      url: 'https://api.example.com/text',
    });

    expect(res.data).toBe('plain text');
  });

  it('should pass custom headers and signal', async () => {
    const abort = new AbortController();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('{}'),
    });

    const adapter = createNodeHttpAdapter();
    await adapter.request({
      method: 'GET',
      url: 'https://api.example.com/',
      headers: { Authorization: 'Bearer token' },
      signal: abort.signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
        signal: abort.signal,
      })
    );
  });

  it('should rethrow AbortError', async () => {
    const abortError = new Error('aborted');
    (abortError as Error & { name: string }).name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const adapter = createNodeHttpAdapter();
    await expect(
      adapter.request({ method: 'GET', url: 'https://api.example.com/' })
    ).rejects.toThrow('aborted');
  });

  it('should wrap non-Abort errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failed'));

    const adapter = createNodeHttpAdapter();
    await expect(
      adapter.request({ method: 'GET', url: 'https://api.example.com/' })
    ).rejects.toThrow('HTTP request failed: network failed');
  });

  it('should wrap non-Error rejections', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string error');

    const adapter = createNodeHttpAdapter();
    await expect(
      adapter.request({ method: 'GET', url: 'https://api.example.com/' })
    ).rejects.toThrow('HTTP request failed: string error');
  });
});
