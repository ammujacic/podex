import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';

// ============================================================================
// Types
// ============================================================================

export interface APIKey {
  id: string;
  provider: string;
  key: string;
  lastUsed?: Date;
  isValid?: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: 'cloud' | 'local';
  isConfigured: boolean;
  models: string[];
}

// ============================================================================
// Store
// ============================================================================

interface AgentSettingsState {
  apiKeys: APIKey[];
  agentConfigs: AgentConfig[];
  preferredProvider: string;
  useLocalFirst: boolean;
  maxConcurrentAgents: number;
  autoApproveChanges: boolean;
  showTokenUsage: boolean;
  isLoading: boolean;
  lastSyncedAt: number | null;

  addApiKey: (key: Omit<APIKey, 'id'>) => void;
  removeApiKey: (id: string) => void;
  updateAgentConfig: (id: string, config: Partial<AgentConfig>) => void;
  setPreferredProvider: (provider: string) => void;
  setUseLocalFirst: (value: boolean) => void;
  setMaxConcurrentAgents: (value: number) => void;
  setAutoApproveChanges: (value: boolean) => void;
  setShowTokenUsage: (value: boolean) => void;
  loadFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

const defaultAgentConfigs: AgentConfig[] = [
  {
    id: 'architect',
    name: 'Architect',
    defaultModel: 'claude-3-opus',
    temperature: 0.7,
    maxTokens: 8192,
  },
  {
    id: 'coder',
    name: 'Coder',
    defaultModel: 'claude-3-sonnet',
    temperature: 0.3,
    maxTokens: 4096,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    defaultModel: 'claude-3-sonnet',
    temperature: 0.5,
    maxTokens: 4096,
  },
  {
    id: 'tester',
    name: 'Tester',
    defaultModel: 'claude-3-haiku',
    temperature: 0.3,
    maxTokens: 2048,
  },
];

// Debounce helper
let agentSyncTimeout: NodeJS.Timeout | null = null;

export const useAgentSettingsStore = create<AgentSettingsState>()(
  persist(
    (set, get) => ({
      apiKeys: [],
      agentConfigs: defaultAgentConfigs,
      preferredProvider: 'anthropic',
      useLocalFirst: false,
      maxConcurrentAgents: 3,
      autoApproveChanges: false,
      showTokenUsage: true,
      isLoading: false,
      lastSyncedAt: null,

      addApiKey: (key) =>
        set((state) => ({
          apiKeys: [...state.apiKeys, { ...key, id: crypto.randomUUID() }],
        })),

      removeApiKey: (id) =>
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
        })),

      updateAgentConfig: (id, config) => {
        set((state) => ({
          agentConfigs: state.agentConfigs.map((c) => (c.id === id ? { ...c, ...config } : c)),
        }));

        // Sync to server
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      setPreferredProvider: (provider) => {
        set({ preferredProvider: provider });
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      setUseLocalFirst: (value) => {
        set({ useLocalFirst: value });
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      setMaxConcurrentAgents: (value) => {
        set({ maxConcurrentAgents: value });
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      setAutoApproveChanges: (value) => {
        set({ autoApproveChanges: value });
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      setShowTokenUsage: (value) => {
        set({ showTokenUsage: value });
        if (agentSyncTimeout) clearTimeout(agentSyncTimeout);
        agentSyncTimeout = setTimeout(() => {
          get().syncToServer().catch(console.error);
        }, 500);
      },

      loadFromServer: async () => {
        set({ isLoading: true });
        try {
          const config = await getUserConfig();

          // If null (not authenticated), silently use localStorage defaults
          if (!config) {
            set({ isLoading: false });
            return;
          }

          const serverPrefs = config.agent_preferences || {};

          // Merge server preferences (excluding API keys for security)
          set({
            agentConfigs: serverPrefs.agentConfigs || defaultAgentConfigs,
            preferredProvider: serverPrefs.preferredProvider || 'anthropic',
            useLocalFirst: serverPrefs.useLocalFirst ?? false,
            maxConcurrentAgents: serverPrefs.maxConcurrentAgents ?? 3,
            autoApproveChanges: serverPrefs.autoApproveChanges ?? false,
            showTokenUsage: serverPrefs.showTokenUsage ?? true,
            lastSyncedAt: Date.now(),
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load agent settings from server:', error);
          set({ isLoading: false });
        }
      },

      syncToServer: async () => {
        const state = get();

        // Only sync preferences, NOT API keys (security)
        const prefsToSync = {
          agentConfigs: state.agentConfigs,
          preferredProvider: state.preferredProvider,
          useLocalFirst: state.useLocalFirst,
          maxConcurrentAgents: state.maxConcurrentAgents,
          autoApproveChanges: state.autoApproveChanges,
          showTokenUsage: state.showTokenUsage,
        };

        try {
          const result = await updateUserConfig({ agent_preferences: prefsToSync });
          // If null, user is not authenticated - silently skip
          if (result !== null) {
            set({ lastSyncedAt: Date.now() });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          // Silently ignore auth errors (401/403) and network errors (503)
          if (error?.status === 401 || error?.status === 403 || error?.status === 503) {
            console.warn('Skipping agent settings sync - user not authenticated or network error');
            return;
          }
          console.error('Failed to sync agent settings to server:', error);
        }
      },
    }),
    {
      name: 'podex-agent-settings',
      partialize: (state) => ({
        // API keys stay in localStorage only (not synced to server for security)
        apiKeys: state.apiKeys,
        // Other settings are synced to server but also cached locally
        agentConfigs: state.agentConfigs,
        preferredProvider: state.preferredProvider,
        useLocalFirst: state.useLocalFirst,
        maxConcurrentAgents: state.maxConcurrentAgents,
        autoApproveChanges: state.autoApproveChanges,
        showTokenUsage: state.showTokenUsage,
      }),
    }
  )
);

// Provider definitions
export const providers: ModelProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'cloud',
    isConfigured: false,
    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'cloud',
    isConfigured: false,
    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'google',
    name: 'Google AI',
    type: 'cloud',
    isConfigured: false,
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    type: 'local',
    isConfigured: false,
    models: ['llama3', 'codellama', 'mistral'],
  },
  { id: 'lmstudio', name: 'LM Studio', type: 'local', isConfigured: false, models: [] },
];
