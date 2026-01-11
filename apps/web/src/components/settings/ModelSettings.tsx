'use client';

import { useState, useCallback } from 'react';
import {
  Settings,
  Cloud,
  Server,
  Check,
  X,
  RefreshCw,
  Eye,
  EyeOff,
  Zap,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio' | 'bedrock';

export interface ModelConfig {
  id: string;
  provider: ModelProvider;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number; // USD per 1M tokens
  outputPricePerMillion: number;
  capabilities: ModelCapability[];
  isLocal: boolean;
  isAvailable: boolean;
  endpoint?: string;
}

export type ModelCapability =
  | 'chat'
  | 'completion'
  | 'code'
  | 'reasoning'
  | 'vision'
  | 'function_calling'
  | 'streaming';

export interface ProviderConfig {
  id: ModelProvider;
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  models: ModelConfig[];
}

// ============================================================================
// Default Models
// ============================================================================

const defaultCloudModels: ModelConfig[] = [
  // Anthropic
  {
    id: 'claude-opus-4-5',
    provider: 'anthropic',
    name: 'claude-opus-4-5-20251101',
    displayName: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
    capabilities: [
      'chat',
      'completion',
      'code',
      'reasoning',
      'vision',
      'function_calling',
      'streaming',
    ],
    isLocal: false,
    isAvailable: true,
  },
  {
    id: 'claude-sonnet-4',
    provider: 'anthropic',
    name: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    capabilities: [
      'chat',
      'completion',
      'code',
      'reasoning',
      'vision',
      'function_calling',
      'streaming',
    ],
    isLocal: false,
    isAvailable: true,
  },
  {
    id: 'claude-haiku-3-5',
    provider: 'anthropic',
    name: 'claude-3-5-haiku-20241022',
    displayName: 'Claude Haiku 3.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputPricePerMillion: 1,
    outputPricePerMillion: 5,
    capabilities: ['chat', 'completion', 'code', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
  // OpenAI
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
    capabilities: ['chat', 'completion', 'code', 'vision', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
  {
    id: 'gpt-4-turbo',
    provider: 'openai',
    name: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutputTokens: 4096,
    inputPricePerMillion: 10,
    outputPricePerMillion: 30,
    capabilities: ['chat', 'completion', 'code', 'vision', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
  {
    id: 'gpt-3.5-turbo',
    provider: 'openai',
    name: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    contextWindow: 16385,
    maxOutputTokens: 4096,
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
    capabilities: ['chat', 'completion', 'code', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
  // Google
  {
    id: 'gemini-1.5-pro',
    provider: 'google',
    name: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    inputPricePerMillion: 3.5,
    outputPricePerMillion: 10.5,
    capabilities: ['chat', 'completion', 'code', 'vision', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
  {
    id: 'gemini-1.5-flash',
    provider: 'google',
    name: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
    capabilities: ['chat', 'completion', 'code', 'vision', 'function_calling', 'streaming'],
    isLocal: false,
    isAvailable: true,
  },
];

const defaultProviders: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    enabled: true,
    models: defaultCloudModels.filter((m) => m.provider === 'anthropic'),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    enabled: false,
    models: defaultCloudModels.filter((m) => m.provider === 'openai'),
  },
  {
    id: 'google',
    name: 'Google AI',
    enabled: false,
    models: defaultCloudModels.filter((m) => m.provider === 'google'),
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    enabled: false,
    baseUrl: 'http://localhost:11434',
    models: [],
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    enabled: false,
    baseUrl: 'http://localhost:1234',
    models: [],
  },
];

// ============================================================================
// Store
// ============================================================================

interface ModelSettingsState {
  providers: ProviderConfig[];
  defaultModel: string;
  agentModelOverrides: Record<string, string>;
  fallbackEnabled: boolean;
  fallbackOrder: string[];

  setProviders: (providers: ProviderConfig[]) => void;
  updateProvider: (id: ModelProvider, updates: Partial<ProviderConfig>) => void;
  setDefaultModel: (modelId: string) => void;
  setAgentModelOverride: (agentId: string, modelId: string | null) => void;
  setFallbackEnabled: (enabled: boolean) => void;
  setFallbackOrder: (order: string[]) => void;
  addLocalModel: (provider: 'ollama' | 'lmstudio', model: ModelConfig) => void;
  removeLocalModel: (provider: 'ollama' | 'lmstudio', modelId: string) => void;
  getAllAvailableModels: () => ModelConfig[];
  getModelById: (id: string) => ModelConfig | undefined;
}

export const useModelSettings = create<ModelSettingsState>()(
  persist(
    (set, get) => ({
      providers: defaultProviders,
      defaultModel: 'claude-sonnet-4',
      agentModelOverrides: {},
      fallbackEnabled: true,
      fallbackOrder: ['ollama', 'lmstudio', 'anthropic'],

      setProviders: (providers) => set({ providers }),

      updateProvider: (id, updates) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        })),

      setDefaultModel: (modelId) => set({ defaultModel: modelId }),

      setAgentModelOverride: (agentId, modelId) =>
        set((state) => {
          const overrides = { ...state.agentModelOverrides };
          if (modelId === null) {
            delete overrides[agentId];
          } else {
            overrides[agentId] = modelId;
          }
          return { agentModelOverrides: overrides };
        }),

      setFallbackEnabled: (enabled) => set({ fallbackEnabled: enabled }),

      setFallbackOrder: (order) => set({ fallbackOrder: order }),

      addLocalModel: (provider, model) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === provider ? { ...p, models: [...p.models, model] } : p
          ),
        })),

      removeLocalModel: (provider, modelId) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === provider ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p
          ),
        })),

      getAllAvailableModels: () => {
        const state = get();
        return state.providers
          .filter((p) => p.enabled)
          .flatMap((p) => p.models.filter((m) => m.isAvailable));
      },

      getModelById: (id) => {
        const state = get();
        for (const provider of state.providers) {
          const model = provider.models.find((m) => m.id === id);
          if (model) return model;
        }
        return undefined;
      },
    }),
    {
      name: 'podex-model-settings',
    }
  )
);

// ============================================================================
// Provider Card Component
// ============================================================================

interface ProviderCardProps {
  provider: ProviderConfig;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (updates: Partial<ProviderConfig>) => void;
  onRefreshModels: () => void;
  refreshing: boolean;
}

function ProviderCard({
  provider,
  expanded,
  onToggle,
  onUpdate,
  onRefreshModels,
  refreshing,
}: ProviderCardProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const isLocal = provider.id === 'ollama' || provider.id === 'lmstudio';

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-colors',
        provider.enabled
          ? 'border-accent-primary/50 bg-accent-primary/5'
          : 'border-border-subtle hover:border-border-default'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggle}>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}

        {isLocal ? (
          <Server className="h-5 w-5 text-green-400" />
        ) : (
          <Cloud className="h-5 w-5 text-accent-primary" />
        )}

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{provider.name}</span>
            {isLocal && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
                Local
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted">{provider.models.length} models available</div>
        </div>

        <label
          className="relative inline-flex items-center cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-overlay rounded-full peer peer-checked:bg-accent-primary transition-colors">
            <div
              className={cn(
                'absolute w-4 h-4 bg-white rounded-full top-0.5 left-0.5 transition-transform',
                provider.enabled && 'translate-x-4'
              )}
            />
          </div>
        </label>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border-subtle bg-elevated">
          {/* API Key / Base URL */}
          <div className="px-4 py-3 space-y-3">
            {isLocal ? (
              <div>
                <label className="block text-xs text-text-muted mb-1">Server URL</label>
                <input
                  type="text"
                  value={provider.baseUrl || ''}
                  onChange={(e) => onUpdate({ baseUrl: e.target.value })}
                  placeholder={
                    provider.id === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-void border border-border-subtle text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs text-text-muted mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={provider.apiKey || ''}
                    onChange={(e) => onUpdate({ apiKey: e.target.value })}
                    placeholder="Enter API key..."
                    className="w-full px-3 py-2 pr-10 rounded-lg bg-void border border-border-subtle text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {isLocal && (
              <button
                onClick={onRefreshModels}
                disabled={refreshing}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-overlay hover:bg-surface text-text-secondary text-sm"
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                {refreshing ? 'Discovering models...' : 'Discover models'}
              </button>
            )}
          </div>

          {/* Models list */}
          {provider.models.length > 0 && (
            <div className="border-t border-border-subtle">
              <div className="px-4 py-2 text-xs text-text-muted font-medium">Available Models</div>
              <div className="max-h-64 overflow-y-auto">
                {provider.models.map((model) => (
                  <div
                    key={model.id}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-overlay/50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{model.displayName}</div>
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <span>{(model.contextWindow / 1000).toFixed(0)}K context</span>
                        {!model.isLocal && (
                          <>
                            <span>•</span>
                            <span className="text-green-400">
                              ${model.inputPricePerMillion}/M in
                            </span>
                            <span className="text-yellow-400">
                              ${model.outputPricePerMillion}/M out
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {model.capabilities.includes('vision') && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                          Vision
                        </span>
                      )}
                      {model.capabilities.includes('reasoning') && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                          Reasoning
                        </span>
                      )}
                    </div>

                    {model.isAvailable ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <X className="h-4 w-4 text-text-muted" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ModelSettingsProps {
  className?: string;
}

export function ModelSettings({ className }: ModelSettingsProps) {
  const {
    providers,
    defaultModel,
    fallbackEnabled,
    updateProvider,
    setDefaultModel,
    setFallbackEnabled,
    getAllAvailableModels,
  } = useModelSettings();

  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  // Toggle provider expansion
  const toggleProvider = useCallback((providerId: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }, []);

  // Refresh local models
  const refreshLocalModels = useCallback(
    async (providerId: 'ollama' | 'lmstudio') => {
      setRefreshingProvider(providerId);
      try {
        const provider = providers.find((p) => p.id === providerId);
        if (!provider?.baseUrl) return;

        // For Ollama, fetch from /api/tags
        // For LM Studio, fetch from /v1/models
        const endpoint =
          providerId === 'ollama'
            ? `${provider.baseUrl}/api/tags`
            : `${provider.baseUrl}/v1/models`;

        const response = await fetch(endpoint);
        if (!response.ok) throw new Error('Failed to fetch models');

        const data = await response.json();
        const models: ModelConfig[] = [];

        if (providerId === 'ollama' && data.models) {
          for (const m of data.models) {
            models.push({
              id: `ollama-${m.name}`,
              provider: 'ollama',
              name: m.name,
              displayName: m.name,
              contextWindow: 8192, // Default, Ollama doesn't always report this
              maxOutputTokens: 4096,
              inputPricePerMillion: 0,
              outputPricePerMillion: 0,
              capabilities: ['chat', 'completion', 'code', 'streaming'],
              isLocal: true,
              isAvailable: true,
              endpoint: provider.baseUrl,
            });
          }
        } else if (providerId === 'lmstudio' && data.data) {
          for (const m of data.data) {
            models.push({
              id: `lmstudio-${m.id}`,
              provider: 'lmstudio',
              name: m.id,
              displayName: m.id,
              contextWindow: 8192,
              maxOutputTokens: 4096,
              inputPricePerMillion: 0,
              outputPricePerMillion: 0,
              capabilities: ['chat', 'completion', 'code', 'streaming'],
              isLocal: true,
              isAvailable: true,
              endpoint: provider.baseUrl,
            });
          }
        }

        updateProvider(providerId, { models });
      } catch (error) {
        console.error(`Failed to refresh ${providerId} models:`, error);
      } finally {
        setRefreshingProvider(null);
      }
    },
    [providers, updateProvider]
  );

  const availableModels = getAllAvailableModels();
  const cloudProviders = providers.filter((p) => p.id !== 'ollama' && p.id !== 'lmstudio');
  const localProviders = providers.filter((p) => p.id === 'ollama' || p.id === 'lmstudio');

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
        <Settings className="h-5 w-5 text-accent-primary" />
        <h2 className="text-lg font-semibold text-text-primary">Model Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Default Model Selection */}
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-2">Default Model</h3>
          <select
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}{' '}
                {model.isLocal ? '(Local)' : `($${model.inputPricePerMillion}/M)`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            This model will be used for all agents unless overridden.
          </p>
        </div>

        {/* Fallback Settings */}
        <div className="p-3 rounded-lg bg-elevated border border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              <span className="text-sm font-medium text-text-primary">Smart Fallback</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={fallbackEnabled}
                onChange={(e) => setFallbackEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-overlay rounded-full peer peer-checked:bg-accent-primary transition-colors">
                <div
                  className={cn(
                    'absolute w-4 h-4 bg-white rounded-full top-0.5 left-0.5 transition-transform',
                    fallbackEnabled && 'translate-x-4'
                  )}
                />
              </div>
            </label>
          </div>
          <p className="text-xs text-text-muted">
            Try local models first, fall back to cloud when unavailable.
          </p>
        </div>

        {/* Local Providers */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Server className="h-4 w-4 text-green-400" />
            <h3 className="text-sm font-medium text-text-primary">Local Models</h3>
            <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
              Free & Private
            </span>
          </div>
          <div className="space-y-2">
            {localProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                expanded={expandedProviders.has(provider.id)}
                onToggle={() => toggleProvider(provider.id)}
                onUpdate={(updates) => updateProvider(provider.id, updates)}
                onRefreshModels={() => refreshLocalModels(provider.id as 'ollama' | 'lmstudio')}
                refreshing={refreshingProvider === provider.id}
              />
            ))}
          </div>
          <div className="mt-2 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="flex items-start gap-2">
              <ExternalLink className="h-4 w-4 text-green-400 mt-0.5" />
              <div className="text-xs text-text-muted">
                <p className="mb-1">
                  Local models run on your machine for free with complete privacy.
                </p>
                <div className="flex gap-3">
                  <a
                    href="https://ollama.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-400 hover:underline"
                  >
                    Get Ollama →
                  </a>
                  <a
                    href="https://lmstudio.ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-400 hover:underline"
                  >
                    Get LM Studio →
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cloud Providers */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Cloud className="h-4 w-4 text-accent-primary" />
            <h3 className="text-sm font-medium text-text-primary">Cloud Providers</h3>
          </div>
          <div className="space-y-2">
            {cloudProviders.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                expanded={expandedProviders.has(provider.id)}
                onToggle={() => toggleProvider(provider.id)}
                onUpdate={(updates) => updateProvider(provider.id, updates)}
                onRefreshModels={() => {}}
                refreshing={false}
              />
            ))}
          </div>
        </div>

        {/* Cost Comparison */}
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-3">Cost Comparison</h3>
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-elevated">
                  <th className="px-3 py-2 text-left text-text-muted font-medium">Model</th>
                  <th className="px-3 py-2 text-right text-text-muted font-medium">Input $/M</th>
                  <th className="px-3 py-2 text-right text-text-muted font-medium">Output $/M</th>
                  <th className="px-3 py-2 text-right text-text-muted font-medium">Context</th>
                </tr>
              </thead>
              <tbody>
                {availableModels.slice(0, 8).map((model) => (
                  <tr key={model.id} className="border-t border-border-subtle hover:bg-overlay/30">
                    <td className="px-3 py-2 text-text-secondary">{model.displayName}</td>
                    <td className="px-3 py-2 text-right text-green-400">
                      {model.isLocal ? 'Free' : `$${model.inputPricePerMillion}`}
                    </td>
                    <td className="px-3 py-2 text-right text-yellow-400">
                      {model.isLocal ? 'Free' : `$${model.outputPricePerMillion}`}
                    </td>
                    <td className="px-3 py-2 text-right text-text-muted">
                      {(model.contextWindow / 1000).toFixed(0)}K
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
