import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reuse the fs mocking pattern from vscode-storage-adapter tests
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockWatch = vi.fn();

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  watch: (...args: any[]) => mockWatch(...args),
}));

const mockCreateOutputChannel = vi.fn(() => ({
  appendLine: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
}));

const mockThemeColor = vi.fn();

// Minimal vscode surface needed for the auth provider
vi.mock('vscode', () => ({
  EventEmitter: class MockEventEmitter<T> {
    private handlers: ((value: T) => void)[] = [];
    event = (handler: (value: T) => void) => {
      this.handlers.push(handler);
      return { dispose: vi.fn() };
    };
    fire(value: T) {
      this.handlers.forEach((h) => h(value));
    }
    dispose() {}
  },
  ThemeColor: mockThemeColor,
  window: {
    createOutputChannel: mockCreateOutputChannel,
    setStatusBarMessage: vi.fn(),
  },
}));

// Mock storage adapter helpers
const mockReadConfigFile = vi.fn();
const mockWriteConfigFile = vi.fn();
const mockDeleteConfigFile = vi.fn();

vi.mock('../vscode-storage-adapter', () => ({
  PODEX_CONFIG_DIR: '/tmp/podex-config',
  readConfigFile: mockReadConfigFile,
  writeConfigFile: mockWriteConfigFile,
  deleteConfigFile: mockDeleteConfigFile,
}));

// Mock logger
const mockLogInfo = vi.fn();
const mockLogDebug = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../utils/logger', () => ({
  logInfo: mockLogInfo,
  logDebug: mockLogDebug,
  logError: mockLogError,
}));

describe('VSCodeAuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createProvider(options: { withWatcher?: boolean } = {}) {
    const vscode = await import('vscode');
    const { createVSCodeAuthProvider } = await import('../vscode-auth-provider');
    const context = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;
    const provider = createVSCodeAuthProvider(context);

    // If caller wants to control watcher callbacks, patch mockWatch implementation here
    if (options.withWatcher) {
      const original = mockWatch.mock.calls[0]?.[1];
      if (typeof original === 'function') {
        // Keep reference to original callback
        mockWatch.mockImplementation((path: string, cb: (event: string, file: string) => void) => {
          return (original as any)(path, cb);
        });
      }
    }

    return { provider, vscode };
  }

  it('loads credentials lazily and caches them', async () => {
    const creds = {
      accessToken: 'token',
      refreshToken: 'refresh',
      email: 'user@example.com',
      userId: 'user-1',
      expiresAt: Date.now() + 60_000,
    };
    mockReadConfigFile.mockReturnValueOnce(creds);

    const { provider } = await createProvider();

    // First call loads from file
    expect(provider.isAuthenticated()).toBe(true);
    expect(mockReadConfigFile).toHaveBeenCalledTimes(1);

    // Subsequent call uses cache
    expect(provider.getCredentials()).toEqual(creds);
    expect(mockReadConfigFile).toHaveBeenCalledTimes(1);
  });

  it('clears credentials and deletes file on onUnauthorized', async () => {
    const creds = {
      accessToken: 'token',
      refreshToken: 'refresh',
      email: 'user@example.com',
      userId: 'user-1',
      expiresAt: Date.now() + 60_000,
    };
    mockReadConfigFile.mockReturnValueOnce(creds);

    const { provider } = await createProvider();

    expect(provider.isAuthenticated()).toBe(true);

    provider.onUnauthorized();

    expect(mockDeleteConfigFile).toHaveBeenCalled();
    expect(provider.isAuthenticated()).toBe(false);
  });

  it('setCredentials writes to disk and updates cache', async () => {
    const { provider } = await createProvider();
    const creds = {
      accessToken: 'token',
      refreshToken: 'refresh',
      email: 'user@example.com',
      userId: 'user-1',
      expiresAt: Date.now() + 60_000,
    };

    provider.setCredentials(creds);

    expect(mockWriteConfigFile).toHaveBeenCalledWith('credentials.json', creds);
    expect(provider.getCredentials()).toEqual(creds);
    expect(provider.isAuthenticated()).toBe(true);
  });

  it('isTokenExpired returns true when no credentials or expired', async () => {
    mockReadConfigFile.mockReturnValueOnce(null);

    const { provider } = await createProvider();
    expect(provider.isTokenExpired()).toBe(true);

    const expiredCreds = {
      accessToken: 'token',
      refreshToken: 'refresh',
      email: 'user@example.com',
      userId: 'user-1',
      expiresAt: Date.now() - 1,
    };
    mockReadConfigFile.mockReturnValueOnce(expiredCreds);

    const { provider: provider2 } = await createProvider();
    expect(provider2.isTokenExpired()).toBe(true);
  });

  it('file watcher reloads credentials and notifies listeners on change', async () => {
    const handlers: Record<string, (eventType: string, filename: string) => void> = {};
    mockWatch.mockImplementation((_path: string, cb: (event: string, file: string) => void) => {
      handlers['change'] = cb;
      return {
        on: vi.fn(),
        close: vi.fn(),
      };
    });

    const { provider } = await createProvider();

    // Trigger watcher callback
    const updatedCreds = {
      accessToken: 'new-token',
      refreshToken: 'refresh',
      email: 'user@example.com',
      userId: 'user-1',
      expiresAt: Date.now() + 60_000,
    };
    mockReadConfigFile.mockReturnValue(updatedCreds);

    const listener = vi.fn();
    provider.onCredentialsChange(listener);

    // Trigger watcher callback
    handlers['change']?.('change', 'credentials.json');

    expect(listener).toHaveBeenCalledWith(updatedCreds);
  });
});
