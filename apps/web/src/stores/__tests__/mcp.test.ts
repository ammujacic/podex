import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMCPStore } from '../mcp';
import type {
  MCPDefaultServer,
  MCPServer,
  EffectiveMCPServer,
  CreateMCPServerRequest,
  UpdateMCPServerRequest,
  MCPTestConnectionResponse,
} from '@/lib/api';
import * as api from '@/lib/api';

// =============================================================================
// FIXTURES
// =============================================================================

const mockDefaultServer: MCPDefaultServer = {
  slug: 'github',
  name: 'GitHub',
  description: 'Interact with GitHub repositories',
  category: 'version_control',
  icon: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  url: null,
  required_env: ['GITHUB_TOKEN'],
  is_builtin: true,
  is_enabled: false,
  has_required_env: false,
};

const mockDefaultServerEnabled: MCPDefaultServer = {
  ...mockDefaultServer,
  is_enabled: true,
  has_required_env: true,
};

const mockDefaultServerSlack: MCPDefaultServer = {
  slug: 'slack',
  name: 'Slack',
  description: 'Interact with Slack workspaces',
  category: 'communication',
  icon: 'slack',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-slack'],
  url: null,
  required_env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  is_builtin: true,
  is_enabled: false,
  has_required_env: false,
};

const mockDefaultServerPostgres: MCPDefaultServer = {
  slug: 'postgres',
  name: 'PostgreSQL',
  description: 'Connect to PostgreSQL databases',
  category: 'database',
  icon: 'database',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-postgres'],
  url: null,
  required_env: ['POSTGRES_CONNECTION_STRING'],
  is_builtin: true,
  is_enabled: false,
  has_required_env: false,
};

const mockUserServer: MCPServer = {
  id: 'server-1',
  user_id: 'user-1',
  name: 'GitHub',
  description: 'GitHub integration',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  url: null,
  env_vars: { GITHUB_TOKEN: 'ghp_xxx' },
  is_enabled: true,
  source_slug: 'github',
  category: 'version_control',
  is_default: true,
  config_source: 'ui',
  icon: 'github',
  discovered_tools: [
    {
      name: 'create_issue',
      description: 'Create a new GitHub issue',
      input_schema: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['repo', 'title'],
      },
    },
    {
      name: 'list_prs',
      description: 'List pull requests',
      input_schema: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          state: { type: 'string', enum: ['open', 'closed', 'all'] },
        },
        required: ['repo'],
      },
    },
  ],
  discovered_resources: null,
  last_connected_at: '2024-01-15T10:00:00Z',
  last_error: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
};

const mockUserServerCustom: MCPServer = {
  id: 'server-2',
  user_id: 'user-1',
  name: 'Custom API',
  description: 'Custom MCP server',
  transport: 'http',
  command: null,
  args: null,
  url: 'https://api.example.com/mcp',
  env_vars: { API_KEY: 'custom_key' },
  is_enabled: true,
  source_slug: null,
  category: null,
  is_default: false,
  config_source: 'api',
  icon: null,
  discovered_tools: [],
  discovered_resources: null,
  last_connected_at: null,
  last_error: 'Connection timeout',
  created_at: '2024-01-10T00:00:00Z',
  updated_at: '2024-01-10T00:00:00Z',
};

const mockEffectiveServer: EffectiveMCPServer = {
  id: 'server-1',
  name: 'GitHub',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  url: null,
  env_vars: { GITHUB_TOKEN: 'ghp_xxx' },
  source: 'database',
  source_slug: 'github',
};

const mockTestConnectionSuccess: MCPTestConnectionResponse = {
  success: true,
  message: 'Connection successful',
  tools_count: 5,
};

const mockTestConnectionFailure: MCPTestConnectionResponse = {
  success: false,
  message: 'Connection failed',
  error: 'Authentication failed',
};

// =============================================================================
// MOCKS
// =============================================================================

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api');
  return {
    ...actual,
    getMCPDefaults: vi.fn(),
    listMCPServers: vi.fn(),
    getEffectiveMCPConfig: vi.fn(),
    createMCPServer: vi.fn(),
    updateMCPServer: vi.fn(),
    deleteMCPServer: vi.fn(),
    enableMCPDefault: vi.fn(),
    disableMCPDefault: vi.fn(),
    testMCPServerConnection: vi.fn(),
    syncMCPServersFromEnv: vi.fn(),
  };
});

// =============================================================================
// TESTS
// =============================================================================

describe('mcpStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useMCPStore.getState().reset();
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Initial State
  // ===========================================================================

  describe('Initial State', () => {
    it('has empty defaults array', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.defaults).toEqual([]);
    });

    it('has empty categories array', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.categories).toEqual([]);
    });

    it('has empty user servers array', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.userServers).toEqual([]);
    });

    it('has empty effective servers array', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.effectiveServers).toEqual([]);
    });

    it('has no loading states active', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isLoadingDefaults).toBe(false);
      expect(result.current.isLoadingUserServers).toBe(false);
      expect(result.current.isSyncing).toBe(false);
    });

    it('has empty test results map', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.testResults.size).toBe(0);
    });

    it('has no testing server', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.testingServerId).toBeNull();
    });

    it('has no error', () => {
      const { result } = renderHook(() => useMCPStore());
      expect(result.current.error).toBeNull();
    });
  });

  // ===========================================================================
  // Loading Actions
  // ===========================================================================

  describe('Loading Defaults', () => {
    it('loads defaults successfully', async () => {
      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer, mockDefaultServerSlack, mockDefaultServerPostgres],
        categories: ['version_control', 'communication', 'database'],
      });

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadDefaults();
      });

      expect(result.current.defaults).toHaveLength(3);
      expect(result.current.categories).toHaveLength(3);
      expect(result.current.isLoadingDefaults).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets loading state while loading defaults', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(api.getMCPDefaults).mockReturnValue(promise as any);

      const { result } = renderHook(() => useMCPStore());

      act(() => {
        result.current.loadDefaults();
      });

      expect(result.current.isLoadingDefaults).toBe(true);

      await act(async () => {
        resolvePromise!({
          servers: [mockDefaultServer],
          categories: ['version_control'],
        });
        await promise;
      });

      expect(result.current.isLoadingDefaults).toBe(false);
    });

    it('groups servers by category', async () => {
      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer, mockDefaultServerSlack, mockDefaultServerPostgres],
        categories: ['version_control', 'communication', 'database'],
      });

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadDefaults();
      });

      const versionControlCat = result.current.categories.find((c) => c.id === 'version_control');
      expect(versionControlCat?.servers).toHaveLength(1);
      expect(versionControlCat?.servers[0].slug).toBe('github');

      const communicationCat = result.current.categories.find((c) => c.id === 'communication');
      expect(communicationCat?.servers).toHaveLength(1);
      expect(communicationCat?.servers[0].slug).toBe('slack');
    });

    it('handles API error gracefully', async () => {
      vi.mocked(api.getMCPDefaults).mockRejectedValue(new Error('API error'));

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadDefaults();
      });

      expect(result.current.error).toBe('API error');
      expect(result.current.isLoadingDefaults).toBe(false);
    });

    it('handles service unavailable error', async () => {
      const error = new Error('Service unavailable') as Error & { status?: number };
      error.status = 503;
      vi.mocked(api.getMCPDefaults).mockRejectedValue(error);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadDefaults();
      });

      expect(result.current.error).toContain('API server unavailable');
    });

    it('applies category display names', async () => {
      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer],
        categories: ['version_control'],
      });

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadDefaults();
      });

      expect(result.current.categories[0].name).toBe('Version Control');
    });
  });

  describe('Loading User Servers', () => {
    it('loads user servers successfully', async () => {
      vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer, mockUserServerCustom]);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadUserServers();
      });

      expect(result.current.userServers).toHaveLength(2);
      expect(result.current.isLoadingUserServers).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets loading state while loading user servers', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(api.listMCPServers).mockReturnValue(promise as any);

      const { result } = renderHook(() => useMCPStore());

      act(() => {
        result.current.loadUserServers();
      });

      expect(result.current.isLoadingUserServers).toBe(true);

      await act(async () => {
        resolvePromise!([mockUserServer]);
        await promise;
      });

      expect(result.current.isLoadingUserServers).toBe(false);
    });

    it('handles API error gracefully', async () => {
      vi.mocked(api.listMCPServers).mockRejectedValue(new Error('Failed to load'));

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadUserServers();
      });

      expect(result.current.error).toBe('Failed to load');
      expect(result.current.isLoadingUserServers).toBe(false);
    });
  });

  describe('Loading Effective Config', () => {
    it('loads effective config successfully', async () => {
      vi.mocked(api.getEffectiveMCPConfig).mockResolvedValue({
        servers: [mockEffectiveServer],
        env_configured_count: 0,
        db_configured_count: 1,
        builtin_count: 0,
      });

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadEffectiveConfig();
      });

      expect(result.current.effectiveServers).toHaveLength(1);
      expect(result.current.isLoading).toBe(false);
    });

    it('throws error on failure', async () => {
      vi.mocked(api.getEffectiveMCPConfig).mockRejectedValue(new Error('Config load failed'));

      const { result } = renderHook(() => useMCPStore());

      try {
        await act(async () => {
          await result.current.loadEffectiveConfig();
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect((err as Error).message).toBe('Config load failed');
        expect(result.current.error).toBe('Config load failed');
      }
    });
  });

  describe('Loading All', () => {
    it('loads defaults and user servers concurrently', async () => {
      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer],
        categories: ['version_control'],
      });
      vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadAll();
      });

      expect(result.current.defaults).toHaveLength(1);
      expect(result.current.userServers).toHaveLength(1);
      expect(result.current.isLoading).toBe(false);
    });

    it('handles partial failures gracefully', async () => {
      vi.mocked(api.getMCPDefaults).mockRejectedValue(new Error('Defaults failed'));
      vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.loadAll();
      });

      // User servers should still load
      expect(result.current.userServers).toHaveLength(1);
      expect(result.current.isLoading).toBe(false);
    });
  });

  // ===========================================================================
  // Server Management
  // ===========================================================================

  describe('Server Management', () => {
    describe('createServer', () => {
      it('creates a new server', async () => {
        const newServerRequest: CreateMCPServerRequest = {
          name: 'Custom Server',
          transport: 'http',
          url: 'https://api.example.com',
          is_enabled: true,
        };

        const createdServer: MCPServer = {
          ...mockUserServerCustom,
          id: 'new-server-id',
          name: newServerRequest.name,
        };

        vi.mocked(api.createMCPServer).mockResolvedValue(createdServer);

        const { result } = renderHook(() => useMCPStore());

        let returnedServer: MCPServer;
        await act(async () => {
          returnedServer = await result.current.createServer(newServerRequest);
        });

        expect(returnedServer!).toEqual(createdServer);
        expect(result.current.userServers).toContainEqual(createdServer);
        expect(result.current.error).toBeNull();
      });

      it('handles creation error', async () => {
        const newServerRequest: CreateMCPServerRequest = {
          name: 'Invalid Server',
          transport: 'stdio',
        };

        vi.mocked(api.createMCPServer).mockRejectedValue(new Error('Invalid configuration'));

        const { result } = renderHook(() => useMCPStore());

        try {
          await act(async () => {
            await result.current.createServer(newServerRequest);
          });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect((err as Error).message).toBe('Invalid configuration');
          expect(result.current.error).toBe('Invalid configuration');
        }
      });
    });

    describe('updateServer', () => {
      it('updates an existing server', async () => {
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadUserServers();
        });

        const updateRequest: UpdateMCPServerRequest = {
          name: 'Updated GitHub',
          is_enabled: false,
        };

        const updatedServer: MCPServer = {
          ...mockUserServer,
          name: 'Updated GitHub',
          is_enabled: false,
        };

        vi.mocked(api.updateMCPServer).mockResolvedValue(updatedServer);

        await act(async () => {
          await result.current.updateServer(mockUserServer.id, updateRequest);
        });

        expect(result.current.userServers[0].name).toBe('Updated GitHub');
        expect(result.current.userServers[0].is_enabled).toBe(false);
        expect(result.current.error).toBeNull();
      });

      it('only updates the specified server', async () => {
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer, mockUserServerCustom]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadUserServers();
        });

        const updatedServer: MCPServer = {
          ...mockUserServer,
          name: 'Updated',
        };

        vi.mocked(api.updateMCPServer).mockResolvedValue(updatedServer);

        await act(async () => {
          await result.current.updateServer(mockUserServer.id, { name: 'Updated' });
        });

        expect(result.current.userServers[0].name).toBe('Updated');
        expect(result.current.userServers[1].name).toBe(mockUserServerCustom.name);
      });

      it('handles update error', async () => {
        vi.mocked(api.updateMCPServer).mockRejectedValue(new Error('Update failed'));

        const { result } = renderHook(() => useMCPStore());

        try {
          await act(async () => {
            await result.current.updateServer('server-1', { name: 'Test' });
          });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect((err as Error).message).toBe('Update failed');
          expect(result.current.error).toBe('Update failed');
        }
      });
    });

    describe('deleteServer', () => {
      it('removes server from store', async () => {
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer, mockUserServerCustom]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadUserServers();
        });

        vi.mocked(api.deleteMCPServer).mockResolvedValue(undefined);

        await act(async () => {
          await result.current.deleteServer(mockUserServer.id);
        });

        expect(result.current.userServers).toHaveLength(1);
        expect(result.current.userServers[0].id).toBe(mockUserServerCustom.id);
        expect(result.current.error).toBeNull();
      });

      it('removes test results for deleted server', async () => {
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadUserServers();
        });

        // Add a test result
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        await act(async () => {
          await result.current.testConnection(mockUserServer.id);
        });

        expect(result.current.testResults.has(mockUserServer.id)).toBe(true);

        // Delete the server
        vi.mocked(api.deleteMCPServer).mockResolvedValue(undefined);

        await act(async () => {
          await result.current.deleteServer(mockUserServer.id);
        });

        expect(result.current.testResults.has(mockUserServer.id)).toBe(false);
      });

      it('handles delete error', async () => {
        vi.mocked(api.deleteMCPServer).mockRejectedValue(new Error('Delete failed'));

        const { result } = renderHook(() => useMCPStore());

        try {
          await act(async () => {
            await result.current.deleteServer('server-1');
          });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect((err as Error).message).toBe('Delete failed');
          expect(result.current.error).toBe('Delete failed');
        }
      });
    });
  });

  // ===========================================================================
  // Default Server Management
  // ===========================================================================

  describe('Default Server Management', () => {
    describe('enableDefault', () => {
      it('enables a default server', async () => {
        vi.mocked(api.getMCPDefaults).mockResolvedValue({
          servers: [mockDefaultServer],
          categories: ['version_control'],
        });

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadDefaults();
        });

        vi.mocked(api.enableMCPDefault).mockResolvedValue(mockUserServer);

        await act(async () => {
          await result.current.enableDefault('github', { GITHUB_TOKEN: 'ghp_xxx' });
        });

        expect(result.current.userServers).toContainEqual(mockUserServer);
        expect(result.current.defaults[0].is_enabled).toBe(true);
        expect(result.current.error).toBeNull();
      });

      it('updates defaults and categories to show enabled state', async () => {
        vi.mocked(api.getMCPDefaults).mockResolvedValue({
          servers: [mockDefaultServer],
          categories: ['version_control'],
        });

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadDefaults();
        });

        vi.mocked(api.enableMCPDefault).mockResolvedValue(mockUserServer);

        await act(async () => {
          await result.current.enableDefault('github');
        });

        const defaultServer = result.current.defaults.find((d) => d.slug === 'github');
        expect(defaultServer?.is_enabled).toBe(true);

        const categoryServer = result.current.categories[0].servers.find(
          (s) => s.slug === 'github'
        );
        expect(categoryServer?.is_enabled).toBe(true);
      });

      it('handles enable error', async () => {
        vi.mocked(api.enableMCPDefault).mockRejectedValue(
          new Error('Missing environment variables')
        );

        const { result } = renderHook(() => useMCPStore());

        try {
          await act(async () => {
            await result.current.enableDefault('github');
          });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect((err as Error).message).toBe('Missing environment variables');
          expect(result.current.error).toBe('Missing environment variables');
        }
      });
    });

    describe('disableDefault', () => {
      it('disables a default server', async () => {
        vi.mocked(api.getMCPDefaults).mockResolvedValue({
          servers: [mockDefaultServerEnabled],
          categories: ['version_control'],
        });
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadDefaults();
          await result.current.loadUserServers();
        });

        vi.mocked(api.disableMCPDefault).mockResolvedValue({ message: 'Disabled' });

        await act(async () => {
          await result.current.disableDefault('github');
        });

        expect(result.current.defaults[0].is_enabled).toBe(false);
        expect(result.current.userServers).toHaveLength(0);
        expect(result.current.error).toBeNull();
      });

      it('removes server with matching source_slug from user servers', async () => {
        vi.mocked(api.getMCPDefaults).mockResolvedValue({
          servers: [mockDefaultServerEnabled],
          categories: ['version_control'],
        });
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer, mockUserServerCustom]);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadDefaults();
          await result.current.loadUserServers();
        });

        vi.mocked(api.disableMCPDefault).mockResolvedValue({ message: 'Disabled' });

        await act(async () => {
          await result.current.disableDefault('github');
        });

        // Custom server should remain, GitHub server should be removed
        expect(result.current.userServers).toHaveLength(1);
        expect(result.current.userServers[0].id).toBe(mockUserServerCustom.id);
      });

      it('handles disable error', async () => {
        vi.mocked(api.disableMCPDefault).mockRejectedValue(new Error('Disable failed'));

        const { result } = renderHook(() => useMCPStore());

        try {
          await act(async () => {
            await result.current.disableDefault('github');
          });
          expect.fail('Should have thrown an error');
        } catch (err) {
          expect((err as Error).message).toBe('Disable failed');
          expect(result.current.error).toBe('Disable failed');
        }
      });
    });
  });

  // ===========================================================================
  // Connection Testing
  // ===========================================================================

  describe('Connection Testing', () => {
    describe('testConnection', () => {
      it('stores successful test result', async () => {
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.testConnection('server-1');
        });

        const testResult = result.current.testResults.get('server-1');
        expect(testResult?.success).toBe(true);
        expect(testResult?.message).toBe('Connection successful');
        expect(testResult?.toolsCount).toBe(5);
        expect(testResult?.serverId).toBe('server-1');
        expect(result.current.testingServerId).toBeNull();
        expect(result.current.error).toBeNull();
      });

      it('stores failed test result', async () => {
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionFailure);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.testConnection('server-1');
        });

        const testResult = result.current.testResults.get('server-1');
        expect(testResult?.success).toBe(false);
        expect(testResult?.message).toBe('Connection failed');
        expect(result.current.testingServerId).toBeNull();
      });

      it('sets testing state during test', async () => {
        let resolvePromise: (value: unknown) => void;
        const promise = new Promise((resolve) => {
          resolvePromise = resolve;
        });

        vi.mocked(api.testMCPServerConnection).mockReturnValue(promise as any);

        const { result } = renderHook(() => useMCPStore());

        act(() => {
          result.current.testConnection('server-1');
        });

        expect(result.current.testingServerId).toBe('server-1');

        await act(async () => {
          resolvePromise!(mockTestConnectionSuccess);
          await promise;
        });

        expect(result.current.testingServerId).toBeNull();
      });

      it('handles connection test exception', async () => {
        vi.mocked(api.testMCPServerConnection).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.testConnection('server-1');
        });

        const testResult = result.current.testResults.get('server-1');
        expect(testResult?.success).toBe(false);
        expect(testResult?.message).toBe('Network error');
        expect(result.current.error).toBe('Network error');
      });

      it('stores timestamp for test result', async () => {
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        const { result } = renderHook(() => useMCPStore());
        const beforeTest = new Date();

        await act(async () => {
          await result.current.testConnection('server-1');
        });

        const afterTest = new Date();
        const testResult = result.current.testResults.get('server-1');

        expect(testResult?.testedAt).toBeInstanceOf(Date);
        expect(testResult?.testedAt.getTime()).toBeGreaterThanOrEqual(beforeTest.getTime());
        expect(testResult?.testedAt.getTime()).toBeLessThanOrEqual(afterTest.getTime());
      });
    });

    describe('clearTestResult', () => {
      it('removes test result for server', async () => {
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.testConnection('server-1');
        });

        expect(result.current.testResults.has('server-1')).toBe(true);

        act(() => {
          result.current.clearTestResult('server-1');
        });

        expect(result.current.testResults.has('server-1')).toBe(false);
      });

      it('does not affect other test results', async () => {
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.testConnection('server-1');
          await result.current.testConnection('server-2');
        });

        act(() => {
          result.current.clearTestResult('server-1');
        });

        expect(result.current.testResults.has('server-1')).toBe(false);
        expect(result.current.testResults.has('server-2')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Sync from Environment
  // ===========================================================================

  describe('Sync from Environment', () => {
    it('syncs servers from environment', async () => {
      vi.mocked(api.syncMCPServersFromEnv).mockResolvedValue({
        synced_servers: ['github', 'slack'],
        count: 2,
      });
      vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

      const { result } = renderHook(() => useMCPStore());

      let syncedServers: string[];
      await act(async () => {
        syncedServers = await result.current.syncFromEnv();
      });

      expect(syncedServers!).toEqual(['github', 'slack']);
      expect(result.current.userServers).toHaveLength(1);
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets syncing state during sync', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(api.syncMCPServersFromEnv).mockReturnValue(promise as any);
      vi.mocked(api.listMCPServers).mockResolvedValue([]);

      const { result } = renderHook(() => useMCPStore());

      act(() => {
        result.current.syncFromEnv();
      });

      expect(result.current.isSyncing).toBe(true);

      await act(async () => {
        resolvePromise!({ synced_servers: [], count: 0 });
        await promise;
      });

      expect(result.current.isSyncing).toBe(false);
    });

    it('reloads user servers after sync', async () => {
      vi.mocked(api.syncMCPServersFromEnv).mockResolvedValue({
        synced_servers: ['github'],
        count: 1,
      });
      vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.syncFromEnv();
      });

      expect(api.listMCPServers).toHaveBeenCalled();
      expect(result.current.userServers).toHaveLength(1);
    });

    it('handles sync error', async () => {
      vi.mocked(api.syncMCPServersFromEnv).mockRejectedValue(new Error('Sync failed'));

      const { result } = renderHook(() => useMCPStore());

      try {
        await act(async () => {
          await result.current.syncFromEnv();
        });
        expect.fail('Should have thrown an error');
      } catch (err) {
        expect((err as Error).message).toBe('Sync failed');
        expect(result.current.error).toBe('Sync failed');
        expect(result.current.isSyncing).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Utilities
  // ===========================================================================

  describe('Utilities', () => {
    describe('setError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useMCPStore());

        act(() => {
          result.current.setError('Test error');
        });

        expect(result.current.error).toBe('Test error');
      });

      it('clears error when set to null', () => {
        const { result } = renderHook(() => useMCPStore());

        act(() => {
          result.current.setError('Error');
          result.current.setError(null);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('reset', () => {
      it('resets store to initial state', async () => {
        vi.mocked(api.getMCPDefaults).mockResolvedValue({
          servers: [mockDefaultServer],
          categories: ['version_control'],
        });
        vi.mocked(api.listMCPServers).mockResolvedValue([mockUserServer]);
        vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

        const { result } = renderHook(() => useMCPStore());

        await act(async () => {
          await result.current.loadDefaults();
          await result.current.loadUserServers();
          await result.current.testConnection('server-1');
          result.current.setError('Some error');
        });

        expect(result.current.defaults).toHaveLength(1);
        expect(result.current.userServers).toHaveLength(1);
        expect(result.current.testResults.size).toBe(1);
        expect(result.current.error).toBe('Some error');

        act(() => {
          result.current.reset();
        });

        expect(result.current.defaults).toEqual([]);
        expect(result.current.categories).toEqual([]);
        expect(result.current.userServers).toEqual([]);
        expect(result.current.effectiveServers).toEqual([]);
        expect(result.current.testResults.size).toBe(0);
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.testingServerId).toBeNull();
      });
    });
  });

  // ===========================================================================
  // Selectors
  // ===========================================================================

  describe('Selectors', () => {
    beforeEach(async () => {
      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer, mockDefaultServerSlack],
        categories: ['version_control', 'communication'],
      });
      vi.mocked(api.listMCPServers).mockResolvedValue([
        mockUserServer,
        { ...mockUserServerCustom, is_enabled: false },
      ]);

      const { result } = renderHook(() => useMCPStore());
      await act(async () => {
        await result.current.loadAll();
      });
    });

    it('selectEnabledServers returns only enabled servers', async () => {
      const { result } = renderHook(() => useMCPStore());
      const { selectEnabledServers } = await import('../mcp');

      const enabledServers = selectEnabledServers(result.current);
      expect(enabledServers).toHaveLength(1);
      expect(enabledServers[0].id).toBe(mockUserServer.id);
    });

    it('selectDefaultsByCategory returns servers for category', async () => {
      const { result } = renderHook(() => useMCPStore());
      const { selectDefaultsByCategory } = await import('../mcp');

      const vcServers = selectDefaultsByCategory(result.current, 'version_control');
      expect(vcServers).toHaveLength(1);
      expect(vcServers[0].slug).toBe('github');

      const commServers = selectDefaultsByCategory(result.current, 'communication');
      expect(commServers).toHaveLength(1);
      expect(commServers[0].slug).toBe('slack');
    });

    it('selectDefaultsByCategory returns empty array for non-existent category', async () => {
      const { result } = renderHook(() => useMCPStore());
      const { selectDefaultsByCategory } = await import('../mcp');

      const servers = selectDefaultsByCategory(result.current, 'non_existent');
      expect(servers).toEqual([]);
    });

    it('selectBuiltinDefaults returns only builtin servers', async () => {
      const nonBuiltinServer: MCPDefaultServer = {
        ...mockDefaultServer,
        slug: 'custom',
        is_builtin: false,
      };

      vi.mocked(api.getMCPDefaults).mockResolvedValue({
        servers: [mockDefaultServer, nonBuiltinServer],
        categories: ['version_control'],
      });

      const { result } = renderHook(() => useMCPStore());
      await act(async () => {
        await result.current.loadDefaults();
      });

      const { selectBuiltinDefaults } = await import('../mcp');
      const builtinServers = selectBuiltinDefaults(result.current);

      expect(builtinServers).toHaveLength(1);
      expect(builtinServers[0].is_builtin).toBe(true);
    });

    it('selectCustomServers returns only non-default servers', async () => {
      const { result } = renderHook(() => useMCPStore());
      const { selectCustomServers } = await import('../mcp');

      const customServers = selectCustomServers(result.current);
      expect(customServers).toHaveLength(1);
      expect(customServers[0].id).toBe(mockUserServerCustom.id);
      expect(customServers[0].is_default).toBe(false);
    });

    it('selectIsServerTesting returns true for testing server', async () => {
      const { selectIsServerTesting } = await import('../mcp');
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(api.testMCPServerConnection).mockReturnValue(promise as any);

      const { result } = renderHook(() => useMCPStore());

      act(() => {
        result.current.testConnection('server-1');
      });

      expect(selectIsServerTesting(result.current, 'server-1')).toBe(true);
      expect(selectIsServerTesting(result.current, 'server-2')).toBe(false);

      await act(async () => {
        resolvePromise!(mockTestConnectionSuccess);
        await promise;
      });

      expect(selectIsServerTesting(result.current, 'server-1')).toBe(false);
    });

    it('selectTestResult returns test result for server', async () => {
      const { selectTestResult } = await import('../mcp');
      vi.mocked(api.testMCPServerConnection).mockResolvedValue(mockTestConnectionSuccess);

      const { result } = renderHook(() => useMCPStore());

      await act(async () => {
        await result.current.testConnection('server-1');
      });

      const testResult = selectTestResult(result.current, 'server-1');
      expect(testResult?.success).toBe(true);
      expect(testResult?.message).toBe('Connection successful');

      const noResult = selectTestResult(result.current, 'non-existent');
      expect(noResult).toBeUndefined();
    });
  });
});
