import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal vscode mock (workspace + window for logger)
const mockGetConfiguration = vi.fn(() => ({
  get: vi.fn((_key: string, defaultValue: string) => defaultValue),
}));

const mockCreateOutputChannel = vi.fn(() => ({
  appendLine: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: mockGetConfiguration,
  },
  window: {
    createOutputChannel: mockCreateOutputChannel,
  },
}));

// Mock adapters used by api-client service
const mockCreateNodeHttpAdapter = vi.fn(() => ({
  request: vi.fn(),
}));

const mockGetAuthProvider = vi.fn(() => ({
  isAuthenticated: vi.fn(() => true),
}));

vi.mock('../../adapters', () => ({
  createNodeHttpAdapter: mockCreateNodeHttpAdapter,
  getAuthProvider: mockGetAuthProvider,
}));

const mockSetBaseUrl = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('@podex/api-client', () => ({
  BaseApiClient: vi.fn().mockImplementation((_config) => ({
    setBaseUrl: mockSetBaseUrl,
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  })),
}));

// Mock constants and logger
vi.mock('../utils/constants', () => ({
  DEFAULT_API_URL: 'https://api.podex.dev',
}));

const mockLogDebug = vi.fn();
vi.mock('../utils/logger', () => ({
  logDebug: mockLogDebug,
}));

describe('VSCode API client service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes API client with URL from config', async () => {
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, _defaultValue: string) => 'https://custom-api'),
    });

    const { initializeApiClient } = await import('../api-client');

    const client = initializeApiClient();

    expect(client).toBeDefined();
  });

  it('updateApiClientUrl updates existing client base URL', async () => {
    const { initializeApiClient, updateApiClientUrl } = await import('../api-client');

    // First initialize to create singleton
    initializeApiClient();
    expect(mockSetBaseUrl).not.toHaveBeenCalled();

    // Change configuration
    mockGetConfiguration.mockReturnValue({
      get: vi.fn((_key: string, _defaultValue: string) => 'https://updated-api'),
    });

    updateApiClientUrl();

    expect(mockSetBaseUrl).toHaveBeenCalledWith('https://updated-api');
  });

  it('sessionApi delegates to underlying client methods', async () => {
    const { sessionApi } = await import('../api-client');

    mockGet.mockResolvedValueOnce({ sessions: [], total: 0, page: 1, page_size: 20 });

    await sessionApi.listSessions(2, 10);
    expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions?page=2&page_size=10');

    mockGet.mockResolvedValueOnce({ id: 's1' });
    await sessionApi.getSession('s1');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions/s1');

    mockPost.mockResolvedValueOnce({ id: 's2' });
    await sessionApi.createSession({ name: 'New Session' });
    expect(mockPost).toHaveBeenCalledWith('/api/v1/sessions', { name: 'New Session' });

    mockDelete.mockResolvedValueOnce(undefined);
    await sessionApi.deleteSession('s3');
    expect(mockDelete).toHaveBeenCalledWith('/api/v1/sessions/s3');

    mockGet.mockResolvedValueOnce([]);
    await sessionApi.getAgents('s4');
    expect(mockGet).toHaveBeenCalledWith('/api/v1/sessions/s4/agents');
  });
});
