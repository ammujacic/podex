/**
 * MCP (Model Context Protocol) Server Store
 *
 * Manages state for MCP server configuration including:
 * - Default MCP servers from the registry
 * - User's custom MCP servers
 * - Server enable/disable state
 * - Connection testing
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type {
  MCPDefaultServer,
  MCPServer,
  EffectiveMCPServer,
  CreateMCPServerRequest,
  UpdateMCPServerRequest,
} from '@/lib/api';
import {
  getMCPDefaults,
  listMCPServers,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  enableMCPDefault,
  disableMCPDefault,
  testMCPServerConnection,
  getEffectiveMCPConfig,
  syncMCPServersFromEnv,
} from '@/lib/api';

// =============================================================================
// TYPES
// =============================================================================

export interface MCPCategory {
  id: string;
  name: string;
  servers: MCPDefaultServer[];
}

export interface MCPTestResult {
  serverId: string;
  success: boolean;
  message: string;
  toolsCount?: number;
  testedAt: Date;
}

interface MCPState {
  // Data
  defaults: MCPDefaultServer[];
  categories: MCPCategory[];
  userServers: MCPServer[];
  effectiveServers: EffectiveMCPServer[];

  // Loading states
  isLoading: boolean;
  isLoadingDefaults: boolean;
  isLoadingUserServers: boolean;
  isSyncing: boolean;

  // Test results
  testResults: Map<string, MCPTestResult>;
  testingServerId: string | null;

  // Error state
  error: string | null;

  // Actions
  loadDefaults: () => Promise<void>;
  loadUserServers: () => Promise<void>;
  loadEffectiveConfig: () => Promise<void>;
  loadAll: () => Promise<void>;

  // Server management
  createServer: (data: CreateMCPServerRequest) => Promise<MCPServer>;
  updateServer: (serverId: string, data: UpdateMCPServerRequest) => Promise<MCPServer>;
  deleteServer: (serverId: string) => Promise<void>;

  // Default server management
  enableDefault: (slug: string, envVars?: Record<string, string>) => Promise<MCPServer>;
  disableDefault: (slug: string) => Promise<void>;

  // Testing
  testConnection: (serverId: string) => Promise<MCPTestResult>;
  clearTestResult: (serverId: string) => void;

  // Sync
  syncFromEnv: () => Promise<string[]>;

  // Utilities
  setError: (error: string | null) => void;
  reset: () => void;
}

// =============================================================================
// CATEGORY DISPLAY NAMES
// =============================================================================

const CATEGORY_NAMES: Record<string, string> = {
  filesystem: 'File System',
  version_control: 'Version Control',
  database: 'Database',
  web: 'Web & Browser',
  communication: 'Communication',
  containers: 'Containers & DevOps',
  memory: 'Memory & Context',
  monitoring: 'Monitoring & Observability',
};

// =============================================================================
// STORE
// =============================================================================

const initialState = {
  defaults: [],
  categories: [],
  userServers: [],
  effectiveServers: [],
  isLoading: false,
  isLoadingDefaults: false,
  isLoadingUserServers: false,
  isSyncing: false,
  testResults: new Map<string, MCPTestResult>(),
  testingServerId: null,
  error: null,
};

export const useMCPStore = create<MCPState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // =========================================================================
      // LOAD ACTIONS
      // =========================================================================

      loadDefaults: async () => {
        set({ isLoadingDefaults: true, error: null });
        try {
          const response = await getMCPDefaults();

          // Group servers by category
          const categoryMap = new Map<string, MCPDefaultServer[]>();
          for (const server of response.servers) {
            const catId = server.category || 'other';
            if (!categoryMap.has(catId)) {
              categoryMap.set(catId, []);
            }
            categoryMap.get(catId)!.push(server);
          }

          // Convert to array, sorted by category order from backend
          const categoryOrder = response.categories;
          const categories: MCPCategory[] = categoryOrder
            .filter((id) => categoryMap.has(id))
            .map((id) => ({
              id,
              name: CATEGORY_NAMES[id] || id,
              servers: categoryMap.get(id)!,
            }));

          set({
            defaults: response.servers,
            categories,
            isLoadingDefaults: false,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load MCP defaults';
          set({ error: message, isLoadingDefaults: false });
          throw err;
        }
      },

      loadUserServers: async () => {
        set({ isLoadingUserServers: true, error: null });
        try {
          const servers = await listMCPServers();
          set({ userServers: servers, isLoadingUserServers: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load MCP servers';
          set({ error: message, isLoadingUserServers: false });
          throw err;
        }
      },

      loadEffectiveConfig: async () => {
        set({ isLoading: true, error: null });
        try {
          const config = await getEffectiveMCPConfig();
          set({ effectiveServers: config.servers, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load effective config';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      loadAll: async () => {
        set({ isLoading: true, error: null });
        try {
          await Promise.all([get().loadDefaults(), get().loadUserServers()]);
          set({ isLoading: false });
        } catch (err) {
          set({ isLoading: false });
          // Error already set by individual loaders
          throw err;
        }
      },

      // =========================================================================
      // SERVER MANAGEMENT
      // =========================================================================

      createServer: async (data: CreateMCPServerRequest) => {
        set({ error: null });
        try {
          const server = await createMCPServer(data);
          set((state) => ({
            userServers: [...state.userServers, server],
          }));
          return server;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create MCP server';
          set({ error: message });
          throw err;
        }
      },

      updateServer: async (serverId: string, data: UpdateMCPServerRequest) => {
        set({ error: null });
        try {
          const server = await updateMCPServer(serverId, data);
          set((state) => ({
            userServers: state.userServers.map((s) => (s.id === serverId ? server : s)),
          }));
          return server;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to update MCP server';
          set({ error: message });
          throw err;
        }
      },

      deleteServer: async (serverId: string) => {
        set({ error: null });
        try {
          await deleteMCPServer(serverId);
          set((state) => ({
            userServers: state.userServers.filter((s) => s.id !== serverId),
            testResults: (() => {
              const newResults = new Map(state.testResults);
              newResults.delete(serverId);
              return newResults;
            })(),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to delete MCP server';
          set({ error: message });
          throw err;
        }
      },

      // =========================================================================
      // DEFAULT SERVER MANAGEMENT
      // =========================================================================

      enableDefault: async (slug: string, envVars?: Record<string, string>) => {
        set({ error: null });
        try {
          const server = await enableMCPDefault(slug, envVars);

          // Update defaults to show as enabled
          set((state) => ({
            defaults: state.defaults.map((d) => (d.slug === slug ? { ...d, is_enabled: true } : d)),
            categories: state.categories.map((cat) => ({
              ...cat,
              servers: cat.servers.map((s) => (s.slug === slug ? { ...s, is_enabled: true } : s)),
            })),
            userServers: [...state.userServers, server],
          }));

          return server;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to enable MCP server';
          set({ error: message });
          throw err;
        }
      },

      disableDefault: async (slug: string) => {
        set({ error: null });
        try {
          await disableMCPDefault(slug);

          // Update defaults to show as disabled and remove from user servers
          set((state) => ({
            defaults: state.defaults.map((d) =>
              d.slug === slug ? { ...d, is_enabled: false } : d
            ),
            categories: state.categories.map((cat) => ({
              ...cat,
              servers: cat.servers.map((s) => (s.slug === slug ? { ...s, is_enabled: false } : s)),
            })),
            userServers: state.userServers.filter((s) => s.source_slug !== slug),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to disable MCP server';
          set({ error: message });
          throw err;
        }
      },

      // =========================================================================
      // TESTING
      // =========================================================================

      testConnection: async (serverId: string) => {
        set({ testingServerId: serverId, error: null });
        try {
          const response = await testMCPServerConnection(serverId);
          const result: MCPTestResult = {
            serverId,
            success: response.success,
            message: response.message,
            toolsCount: response.tools_count,
            testedAt: new Date(),
          };

          set((state) => ({
            testResults: new Map(state.testResults).set(serverId, result),
            testingServerId: null,
          }));

          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Connection test failed';
          const result: MCPTestResult = {
            serverId,
            success: false,
            message,
            testedAt: new Date(),
          };

          set((state) => ({
            testResults: new Map(state.testResults).set(serverId, result),
            testingServerId: null,
            error: message,
          }));

          return result;
        }
      },

      clearTestResult: (serverId: string) => {
        set((state) => {
          const newResults = new Map(state.testResults);
          newResults.delete(serverId);
          return { testResults: newResults };
        });
      },

      // =========================================================================
      // SYNC
      // =========================================================================

      syncFromEnv: async () => {
        set({ isSyncing: true, error: null });
        try {
          const response = await syncMCPServersFromEnv();
          // Reload user servers to get updated list
          await get().loadUserServers();
          set({ isSyncing: false });
          return response.synced_servers;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to sync from environment';
          set({ error: message, isSyncing: false });
          throw err;
        }
      },

      // =========================================================================
      // UTILITIES
      // =========================================================================

      setError: (error: string | null) => set({ error }),

      reset: () => set(initialState),
    }),
    { name: 'mcp-store' }
  )
);

// =============================================================================
// SELECTORS
// =============================================================================

export const selectEnabledServers = (state: MCPState): MCPServer[] =>
  state.userServers.filter((s) => s.is_enabled);

export const selectDefaultsByCategory = (state: MCPState, category: string): MCPDefaultServer[] =>
  state.categories.find((c) => c.id === category)?.servers ?? [];

export const selectBuiltinDefaults = (state: MCPState): MCPDefaultServer[] =>
  state.defaults.filter((d) => d.is_builtin);

export const selectCustomServers = (state: MCPState): MCPServer[] =>
  state.userServers.filter((s) => !s.is_default);

export const selectIsServerTesting = (state: MCPState, serverId: string): boolean =>
  state.testingServerId === serverId;

export const selectTestResult = (state: MCPState, serverId: string): MCPTestResult | undefined =>
  state.testResults.get(serverId);
