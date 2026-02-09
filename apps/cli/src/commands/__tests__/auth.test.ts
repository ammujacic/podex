/**
 * Tests for auth commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerAuthCommands } from '../auth';

// Mock the services
const mockAuthService = {
  isAuthenticated: vi.fn(() => false),
  getCredentials: vi.fn(() => null),
  initiateDeviceAuth: vi.fn(() =>
    Promise.resolve({
      device_code: 'test-device',
      user_code: 'TEST-1234',
      verification_uri: 'https://example.com/device',
      verification_uri_complete: 'https://example.com/device?code=TEST-1234',
      interval: 5,
      expires_in: 900,
    })
  ),
  pollForToken: vi.fn(() => Promise.resolve()),
  openBrowser: vi.fn(() => Promise.resolve()),
  getCurrentUser: vi.fn(() => Promise.resolve({ email: 'test@example.com' })),
  logout: vi.fn(() => Promise.resolve()),
};

vi.mock('../../services/auth-service', () => ({
  getAuthService: () => mockAuthService,
}));

vi.mock('qrcode-terminal', () => ({
  default: { generate: vi.fn() },
}));

describe('Auth Commands', () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit
    registerAuthCommands(program);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('auth command', () => {
    it('should register auth command', () => {
      const authCommand = program.commands.find((c) => c.name() === 'auth');
      expect(authCommand).toBeDefined();
    });

    it('should have login subcommand', () => {
      const authCommand = program.commands.find((c) => c.name() === 'auth');
      const loginCommand = authCommand?.commands.find((c) => c.name() === 'login');
      expect(loginCommand).toBeDefined();
    });

    it('should have logout subcommand', () => {
      const authCommand = program.commands.find((c) => c.name() === 'auth');
      const logoutCommand = authCommand?.commands.find((c) => c.name() === 'logout');
      expect(logoutCommand).toBeDefined();
    });

    it('should have status subcommand', () => {
      const authCommand = program.commands.find((c) => c.name() === 'auth');
      const statusCommand = authCommand?.commands.find((c) => c.name() === 'status');
      expect(statusCommand).toBeDefined();
    });
  });

  describe('auth status', () => {
    it('should show not logged in when no credentials', async () => {
      mockAuthService.getCredentials.mockReturnValue(null);

      await program.parseAsync(['node', 'test', 'auth', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    });

    it('should show user info when logged in', async () => {
      mockAuthService.getCredentials.mockReturnValue({
        email: 'user@example.com',
        userId: 'user-123',
        accessToken: 'token',
        expiresAt: Date.now() + 3600000,
      });

      await program.parseAsync(['node', 'test', 'auth', 'status']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Authentication Status'));
    });

    it('should show expired status when token expired', async () => {
      mockAuthService.getCredentials.mockReturnValue({
        email: 'user@example.com',
        userId: 'user-123',
        accessToken: 'token',
        expiresAt: Date.now() - 1000, // Expired
      });

      await program.parseAsync(['node', 'test', 'auth', 'status']);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('auth logout', () => {
    it('should show message when not logged in', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);

      await program.parseAsync(['node', 'test', 'auth', 'logout']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    });

    it('should call logout service when logged in', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);

      await program.parseAsync(['node', 'test', 'auth', 'logout']);

      expect(mockAuthService.logout).toHaveBeenCalled();
    });
  });

  describe('auth login', () => {
    it('should show already logged in message', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);
      mockAuthService.getCredentials.mockReturnValue({ email: 'user@example.com' });

      await program.parseAsync(['node', 'test', 'auth', 'login']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Already logged in'));
    });
  });
});
