/**
 * Tests for api-url (getApiBaseUrl, getApiBaseUrlSync).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('api-url', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
    vi.resetModules();
  });

  it('getApiBaseUrlSync returns env URL when set', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    vi.resetModules();
    const { getApiBaseUrlSync } = await import('../api-url');
    expect(getApiBaseUrlSync()).toBe('https://api.example.com');
  });

  it('getApiBaseUrlSync returns default when env not set', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.resetModules();
    const { getApiBaseUrlSync } = await import('../api-url');
    expect(getApiBaseUrlSync()).toBe('http://localhost:3001');
  });

  it('getApiBaseUrl returns env URL when set', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    vi.resetModules();
    const { getApiBaseUrl } = await import('../api-url');
    await expect(getApiBaseUrl()).resolves.toBe('https://api.example.com');
  });

  it('getApiBaseUrl returns default when env not set', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    vi.resetModules();
    const { getApiBaseUrl } = await import('../api-url');
    await expect(getApiBaseUrl()).resolves.toBe('http://localhost:3001');
  });
});
