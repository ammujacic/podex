/**
 * Tests for auth provider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use a real temp directory for these tests
const TEST_DIR = path.join(os.tmpdir(), 'podex-auth-provider-test');
const PODEX_DIR = path.join(TEST_DIR, '.podex');

// Mock os.homedir before importing
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

describe('Auth Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(PODEX_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createCliAuthProvider', () => {
    it('should create auth provider', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider).toBeDefined();
      expect(provider.getAccessToken).toBeDefined();
      expect(provider.setCredentials).toBeDefined();
    });

    it('should return null access token when not authenticated', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.getAccessToken()).toBeNull();
    });

    it('should return access token when authenticated', async () => {
      const credentials = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.getAccessToken()).toBe('test-access-token');
    });

    it('should return null when token is expired', async () => {
      const credentials = {
        accessToken: 'expired-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() - 1000, // Expired
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.getAccessToken()).toBeNull();
    });

    it('should check if authenticated', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.isAuthenticated()).toBe(false);
    });

    it('should be authenticated with valid credentials', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.isAuthenticated()).toBe(true);
    });

    it('should check if token is expired', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      // No credentials means expired
      expect(provider.isTokenExpired()).toBe(true);
    });

    it('should report token not expired with valid credentials', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.isTokenExpired()).toBe(false);
    });

    it('should handle onUnauthorized', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.isAuthenticated()).toBe(true);

      provider.onUnauthorized();

      expect(provider.isAuthenticated()).toBe(false);
    });

    it('should check if refresh is possible', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      const result = await provider.refreshToken();

      expect(result).toBe(true);
    });

    it('should return false for refresh when no refresh token', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      const result = await provider.refreshToken();

      expect(result).toBe(false);
    });

    it('should set credentials', async () => {
      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      provider.setCredentials({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'new-user',
      });

      expect(provider.getAccessToken()).toBe('new-token');
      expect(provider.isAuthenticated()).toBe(true);
    });

    it('should clear credentials', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      expect(provider.isAuthenticated()).toBe(true);

      provider.clearCredentials();

      expect(provider.isAuthenticated()).toBe(false);
    });

    it('should get credentials', async () => {
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { createCliAuthProvider } = await import('../auth-provider');
      const provider = createCliAuthProvider();

      const creds = provider.getCredentials();

      expect(creds?.userId).toBe('test-user');
    });
  });

  describe('getCliAuthProvider', () => {
    it('should return singleton instance', async () => {
      const { getCliAuthProvider } = await import('../auth-provider');

      const provider1 = getCliAuthProvider();
      const provider2 = getCliAuthProvider();

      expect(provider1).toBe(provider2);
    });
  });
});
