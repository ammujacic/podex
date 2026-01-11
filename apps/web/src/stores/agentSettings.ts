import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

  addApiKey: (key: Omit<APIKey, 'id'>) => void;
  removeApiKey: (id: string) => void;
  updateAgentConfig: (id: string, config: Partial<AgentConfig>) => void;
  setPreferredProvider: (provider: string) => void;
  setUseLocalFirst: (value: boolean) => void;
  setMaxConcurrentAgents: (value: number) => void;
  setAutoApproveChanges: (value: boolean) => void;
  setShowTokenUsage: (value: boolean) => void;
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

export const useAgentSettingsStore = create<AgentSettingsState>()(
  persist(
    (set) => ({
      apiKeys: [],
      agentConfigs: defaultAgentConfigs,
      preferredProvider: 'anthropic',
      useLocalFirst: false,
      maxConcurrentAgents: 3,
      autoApproveChanges: false,
      showTokenUsage: true,

      addApiKey: (key) =>
        set((state) => ({
          apiKeys: [...state.apiKeys, { ...key, id: crypto.randomUUID() }],
        })),

      removeApiKey: (id) =>
        set((state) => ({
          apiKeys: state.apiKeys.filter((k) => k.id !== id),
        })),

      updateAgentConfig: (id, config) =>
        set((state) => ({
          agentConfigs: state.agentConfigs.map((c) => (c.id === id ? { ...c, ...config } : c)),
        })),

      setPreferredProvider: (provider) => set({ preferredProvider: provider }),
      setUseLocalFirst: (value) => set({ useLocalFirst: value }),
      setMaxConcurrentAgents: (value) => set({ maxConcurrentAgents: value }),
      setAutoApproveChanges: (value) => set({ autoApproveChanges: value }),
      setShowTokenUsage: (value) => set({ showTokenUsage: value }),
    }),
    {
      name: 'podex-agent-settings',
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
