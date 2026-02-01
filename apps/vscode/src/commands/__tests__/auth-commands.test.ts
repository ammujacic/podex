/**
 * Auth commands tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module
const mockShowInformationMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockExecuteCommand = vi.fn();
const mockOpenExternal = vi.fn();
const mockWriteText = vi.fn();

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
    withProgress: mockWithProgress,
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
  },
  commands: {
    executeCommand: mockExecuteCommand,
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  env: {
    openExternal: mockOpenExternal,
    clipboard: {
      writeText: mockWriteText,
    },
  },
  Uri: {
    parse: vi.fn((uri: string) => ({ toString: () => uri })),
  },
  ProgressLocation: {
    Notification: 15,
  },
}));

// Mock auth provider
const mockIsAuthenticated = vi.fn();
const mockGetCredentials = vi.fn();
const mockSetCredentials = vi.fn();
const mockClearCredentials = vi.fn();
const mockIsTokenExpired = vi.fn();

vi.mock('../../adapters', () => ({
  getAuthProvider: vi.fn(() => ({
    isAuthenticated: mockIsAuthenticated,
    getCredentials: mockGetCredentials,
    setCredentials: mockSetCredentials,
    clearCredentials: mockClearCredentials,
    isTokenExpired: mockIsTokenExpired,
  })),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  showOutput: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Auth Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.mockReturnValue(false);
    mockIsTokenExpired.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loginCommand', () => {
    it('should show already logged in message when authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      mockGetCredentials.mockReturnValue({ email: 'test@example.com' });

      const { loginCommand } = await import('../auth-commands');
      await loginCommand();

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        'Already logged in as test@example.com'
      );
    });

    it('should show user ID when email not available', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      mockGetCredentials.mockReturnValue({ userId: 'user-123' });

      const { loginCommand } = await import('../auth-commands');
      await loginCommand();

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Already logged in as user-123');
    });

    it('should initiate device flow authentication when not authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      // Mock withProgress to just call the callback immediately
      mockWithProgress.mockImplementation(async (_options, callback) => {
        const mockProgress = { report: vi.fn() };
        const mockToken = { isCancellationRequested: false };
        await callback(mockProgress, mockToken);
      });

      // Mock device code response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: 'device-123',
            user_code: 'ABC-123',
            verification_uri: 'https://example.com/verify',
            expires_in: 300,
            interval: 0, // Use 0 to avoid setTimeout delays
          }),
      });

      // User clicks "Open Browser"
      mockShowInformationMessage.mockResolvedValueOnce('Open Browser');

      // Mock token response - success immediately
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'access-token-123',
            refresh_token: 'refresh-token-123',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      });

      // Mock user info response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'user-123',
            email: 'test@example.com',
          }),
      });

      const { loginCommand } = await import('../auth-commands');
      await loginCommand();

      expect(mockWithProgress).toHaveBeenCalled();
      expect(mockOpenExternal).toHaveBeenCalled();
      expect(mockSetCredentials).toHaveBeenCalled();
      expect(mockExecuteCommand).toHaveBeenCalledWith('setContext', 'podex.isAuthenticated', true);
    });

    it('should handle device code request failure', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      mockWithProgress.mockImplementation(async (_options, callback) => {
        const mockProgress = { report: vi.fn() };
        const mockToken = { isCancellationRequested: false };

        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: 'Bad Request',
        });

        await callback(mockProgress, mockToken);
      });

      const { loginCommand } = await import('../auth-commands');
      await loginCommand();

      expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Login failed'));
    });

    it('should copy code when user clicks Copy Code', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      mockWithProgress.mockImplementation(async (_options, callback) => {
        const mockProgress = { report: vi.fn() };
        const mockToken = { isCancellationRequested: false };
        await callback(mockProgress, mockToken);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: 'device-123',
            user_code: 'ABC-123',
            verification_uri: 'https://example.com/verify',
            expires_in: 300,
            interval: 0, // Use 0 to avoid setTimeout delays
          }),
      });

      mockShowInformationMessage.mockResolvedValueOnce('Copy Code');

      // Mock token response for immediate success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'user-123', email: 'test@example.com' }),
      });

      const { loginCommand } = await import('../auth-commands');
      await loginCommand();

      expect(mockWriteText).toHaveBeenCalledWith('ABC-123');
    });
  });

  describe('logoutCommand', () => {
    it('should show not logged in message when not authenticated', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      const { logoutCommand } = await import('../auth-commands');
      await logoutCommand();

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Not logged in');
    });

    it('should clear credentials when confirmed', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      mockShowWarningMessage.mockResolvedValue('Log Out');

      const { logoutCommand } = await import('../auth-commands');
      await logoutCommand();

      expect(mockClearCredentials).toHaveBeenCalled();
      expect(mockExecuteCommand).toHaveBeenCalledWith('setContext', 'podex.isAuthenticated', false);
      expect(mockShowInformationMessage).toHaveBeenCalledWith('Logged out successfully');
    });

    it('should not clear credentials when cancelled', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      mockShowWarningMessage.mockResolvedValue(undefined);

      const { logoutCommand } = await import('../auth-commands');
      await logoutCommand();

      expect(mockClearCredentials).not.toHaveBeenCalled();
    });
  });

  describe('statusCommand', () => {
    it('should show logged in status with email', async () => {
      mockIsAuthenticated.mockReturnValue(true);
      mockGetCredentials.mockReturnValue({
        email: 'test@example.com',
        userId: 'user-123',
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes from now
      });

      const { statusCommand } = await import('../auth-commands');
      await statusCommand();

      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Logged in as test@example.com')
      );
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('expires in')
      );
    });

    it('should show expired session warning', async () => {
      mockIsAuthenticated.mockReturnValue(false);
      mockIsTokenExpired.mockReturnValue(true);

      const { statusCommand } = await import('../auth-commands');
      await statusCommand();

      expect(mockShowWarningMessage).toHaveBeenCalledWith('Session expired. Please log in again.');
    });

    it('should show not logged in message', async () => {
      mockIsAuthenticated.mockReturnValue(false);
      mockIsTokenExpired.mockReturnValue(false);

      const { statusCommand } = await import('../auth-commands');
      await statusCommand();

      expect(mockShowInformationMessage).toHaveBeenCalledWith('Not logged in');
    });
  });

  describe('registerAuthCommands', () => {
    it('should register all auth commands', async () => {
      const mockContext = {
        subscriptions: {
          push: vi.fn(),
        },
      };

      const { registerAuthCommands } = await import('../auth-commands');
      registerAuthCommands(mockContext as Parameters<typeof registerAuthCommands>[0]);

      expect(mockContext.subscriptions.push).toHaveBeenCalled();
    });
  });
});
