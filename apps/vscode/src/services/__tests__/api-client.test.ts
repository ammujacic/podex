/**
 * API client service tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: string) => defaultValue),
    })),
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

// Mock adapters
vi.mock('../../adapters', () => ({
  createNodeHttpAdapter: vi.fn(() => ({
    request: vi.fn(),
  })),
  getAuthProvider: vi.fn(() => ({
    getAccessToken: vi.fn(() => 'test-token'),
    isAuthenticated: vi.fn(() => true),
  })),
}));

// Mock @podex/api-client
vi.mock('@podex/api-client', () => ({
  BaseApiClient: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    setBaseUrl: vi.fn(),
  })),
}));

describe('API Client Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize API client with default URL', async () => {
    const { initializeApiClient, getApiClient } = await import('../api-client');

    const client = initializeApiClient();
    expect(client).toBeDefined();

    // Should return same instance
    const sameClient = getApiClient();
    expect(sameClient).toBe(client);
  });

  it('should have session API methods', async () => {
    const { sessionApi } = await import('../api-client');

    expect(sessionApi.listSessions).toBeDefined();
    expect(sessionApi.getSession).toBeDefined();
    expect(sessionApi.createSession).toBeDefined();
    expect(sessionApi.deleteSession).toBeDefined();
    expect(sessionApi.getAgents).toBeDefined();
  });
});
