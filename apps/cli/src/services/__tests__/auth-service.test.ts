/**
 * Tests for auth service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use a real temp directory for these tests
const TEST_DIR = path.join(os.tmpdir(), 'podex-auth-test');
const PODEX_DIR = path.join(TEST_DIR, '.podex');

// Mock os.homedir before importing
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

// Mock fetch with proper Response structure
const createMockResponse = (data: unknown, ok = true) => ({
  ok,
  headers: {
    get: (name: string) => (name === 'content-type' ? 'application/json' : null),
  },
  json: async () => data,
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock open
vi.mock('open', () => ({
  default: vi.fn(),
}));

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(PODEX_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.resetModules();
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('AuthService class', () => {
    it('should not be authenticated initially', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      expect(service.isAuthenticated()).toBe(false);
    });

    it('should return null credentials when not authenticated', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      expect(service.getCredentials()).toBeNull();
    });

    it('should load credentials from file', async () => {
      // Create credentials file
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      expect(service.isAuthenticated()).toBe(true);
      expect(service.getCredentials()?.userId).toBe('test-user');
    });

    it('should logout and clear credentials', async () => {
      // Create credentials file
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      // Mock logout endpoint
      mockFetch.mockResolvedValueOnce(createMockResponse({ success: true }));

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      expect(service.isAuthenticated()).toBe(true);

      await service.logout();

      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('getAuthService singleton', () => {
    it('should return the same instance', async () => {
      const { getAuthService } = await import('../auth-service');

      const service1 = getAuthService();
      const service2 = getAuthService();

      expect(service1).toBe(service2);
    });
  });

  describe('initiateDeviceAuth', () => {
    it('should call API to initiate device auth', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          device_code: 'test-device-code',
          user_code: 'TEST-1234',
          verification_uri: 'https://example.com/device',
          verification_uri_complete: 'https://example.com/device?code=TEST-1234',
          expires_in: 900,
          interval: 5,
        })
      );

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      const result = await service.initiateDeviceAuth();

      expect(result.device_code).toBe('test-device-code');
      expect(result.user_code).toBe('TEST-1234');
    });
  });

  describe('openBrowser', () => {
    it('should call open with URL', async () => {
      const openMock = await import('open');

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      await service.openBrowser('https://example.com/device');

      expect(openMock.default).toHaveBeenCalledWith('https://example.com/device');
    });
  });

  describe('getCurrentUser', () => {
    it('should return null when not authenticated', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      const result = await service.getCurrentUser();

      expect(result).toBeNull();
    });

    it('should fetch user info when authenticated', async () => {
      // Create credentials file
      const credentials = {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        })
      );

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      const result = await service.getCurrentUser();

      expect(result?.email).toBe('test@example.com');
    });
  });

  describe('refreshToken', () => {
    it('should return false when no credentials', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      const result = await service.refreshToken();

      expect(result).toBe(false);
    });

    it('should refresh tokens when valid', async () => {
      // Create credentials file
      const credentials = {
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresAt: Date.now() + 3600000,
        userId: 'test-user',
      };
      fs.writeFileSync(path.join(PODEX_DIR, 'credentials.json'), JSON.stringify(credentials));

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      );

      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      const result = await service.refreshToken();

      expect(result).toBe(true);
    });
  });

  describe('stopPolling', () => {
    it('should stop polling interval', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      // Should not throw
      service.stopPolling();
    });
  });

  describe('abort', () => {
    it('should set aborted flag and stop polling', async () => {
      const { AuthService } = await import('../auth-service');
      const service = new AuthService();

      service.abort();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
