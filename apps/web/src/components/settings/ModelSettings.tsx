'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Settings,
  Cloud,
  Server,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Zap,
  ExternalLink,
  Brain,
  ImageIcon,
  Sparkles,
  Clock,
  Key,
  Trash2,
  Loader2,
  Globe,
  Cpu,
  DollarSign,
  // Role-specific icons
  Wrench,
  Code,
  TestTube,
  MessageCircle,
  Shield,
  FileText,
  Workflow,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelInfo } from '@podex/shared';
import {
  getLLMApiKeys,
  setLLMApiKey as setLLMApiKeyApi,
  removeLLMApiKey as removeLLMApiKeyApi,
  getUserAgentPreferences,
  updateUserModelDefault,
  getAvailableModels,
  getUserProviderModels,
  type AgentTypeDefaults,
  type PublicModel,
  type UserProviderModel,
} from '@/lib/api';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';

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
  inputPricePerMillion: number;
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
// Provider Metadata
// ============================================================================

const PROVIDER_INFO: Record<
  string,
  {
    name: string;
    description: string;
    isLocal: boolean;
    defaultUrl?: string;
    docsUrl?: string;
    models: { id: string; name: string; contextK: number }[];
  }
> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models - Opus, Sonnet, Haiku',
    isLocal: false,
    docsUrl: 'https://console.anthropic.com/',
    models: [
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', contextK: 200 },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextK: 200 },
      { id: 'claude-haiku-3-5', name: 'Claude Haiku 3.5', contextK: 200 },
    ],
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4 Turbo, GPT-3.5',
    isLocal: false,
    docsUrl: 'https://platform.openai.com/',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextK: 128 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextK: 128 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextK: 16 },
    ],
  },
  google: {
    name: 'Google AI',
    description: 'Gemini 1.5 Pro & Flash',
    isLocal: false,
    docsUrl: 'https://aistudio.google.com/',
    models: [
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextK: 1000 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextK: 1000 },
    ],
  },
  ollama: {
    name: 'Ollama',
    description: 'Run open-source models locally',
    isLocal: true,
    defaultUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.ai',
    models: [],
  },
  lmstudio: {
    name: 'LM Studio',
    description: 'Local model inference',
    isLocal: true,
    defaultUrl: 'http://localhost:1234',
    docsUrl: 'https://lmstudio.ai',
    models: [],
  },
};

// ============================================================================
// Role Icons and Colors
// ============================================================================

const ROLE_ICONS: Record<string, React.ElementType> = {
  architect: Wrench,
  coder: Code,
  reviewer: Eye,
  tester: TestTube,
  chat: MessageCircle,
  security: Shield,
  devops: Server,
  documentator: FileText,
  orchestrator: Workflow,
  agent_builder: Sparkles,
  custom: Bot,
};

const ROLE_COLORS: Record<string, string> = {
  architect: 'text-purple-400',
  coder: 'text-green-400',
  reviewer: 'text-amber-400',
  tester: 'text-cyan-400',
  chat: 'text-violet-400',
  security: 'text-red-400',
  devops: 'text-emerald-400',
  documentator: 'text-amber-400',
  orchestrator: 'text-cyan-400',
  agent_builder: 'text-pink-400',
  custom: 'text-indigo-400',
};

// All agent roles
const ALL_AGENT_ROLES = [
  'architect',
  'coder',
  'reviewer',
  'tester',
  'chat',
  'security',
  'devops',
  'documentator',
  'orchestrator',
  'agent_builder',
  'custom',
] as const;

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
  roleDefaults: Record<string, AgentTypeDefaults>;
  configuredApiKeyProviders: string[];

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
  setRoleDefaults: (defaults: Record<string, AgentTypeDefaults>) => void;
  updateRoleDefault: (role: string, modelId: string) => void;
  setConfiguredApiKeyProviders: (providers: string[]) => void;
}

export const useModelSettings = create<ModelSettingsState>()(
  persist(
    (set, get) => ({
      providers: defaultProviders,
      defaultModel: 'claude-sonnet-4',
      agentModelOverrides: {},
      fallbackEnabled: true,
      fallbackOrder: ['ollama', 'lmstudio', 'anthropic'],
      roleDefaults: {},
      configuredApiKeyProviders: [],

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

      setRoleDefaults: (defaults) => set({ roleDefaults: defaults }),

      updateRoleDefault: (role, modelId) =>
        set((state) => ({
          roleDefaults: {
            ...state.roleDefaults,
            [role]: {
              model_id: modelId,
              temperature: state.roleDefaults[role]?.temperature ?? 0.7,
              max_tokens: state.roleDefaults[role]?.max_tokens ?? 8192,
            },
          },
        })),

      setConfiguredApiKeyProviders: (providers) => set({ configuredApiKeyProviders: providers }),
    }),
    {
      name: 'podex-model-settings',
    }
  )
);

// ============================================================================
// Section Header Component
// ============================================================================

function SectionHeader({
  icon: Icon,
  title,
  badge,
  badgeColor = 'accent',
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  badgeColor?: 'accent' | 'green' | 'amber' | 'blue';
}) {
  const badgeColors = {
    accent: 'bg-accent-primary/20 text-accent-primary',
    green: 'bg-green-500/20 text-green-400',
    amber: 'bg-amber-500/20 text-amber-400',
    blue: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon
        className={cn(
          'h-5 w-5',
          badgeColor === 'green'
            ? 'text-green-400'
            : badgeColor === 'amber'
              ? 'text-amber-400'
              : badgeColor === 'blue'
                ? 'text-blue-400'
                : 'text-accent-primary'
        )}
      />
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {badge && (
        <span
          className={cn('px-2 py-0.5 rounded-full text-xs font-medium', badgeColors[badgeColor])}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Provider Card Component (Redesigned)
// ============================================================================

interface ProviderCardProps {
  providerId: string;
  isConfigured: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function ProviderCard({ providerId, isConfigured, isSelected, onSelect }: ProviderCardProps) {
  const info = PROVIDER_INFO[providerId];
  if (!info) return null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative w-full p-4 rounded-xl border-2 text-left transition-all',
        'hover:border-accent-primary/50 hover:bg-accent-primary/5',
        isSelected
          ? 'border-accent-primary bg-accent-primary/10'
          : isConfigured
            ? 'border-green-500/30 bg-green-500/5'
            : 'border-border-subtle bg-surface'
      )}
    >
      {/* Status indicator */}
      {isConfigured && (
        <div className="absolute top-3 right-3">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/20">
            <Check className="h-3 w-3 text-green-400" />
            <span className="text-xs text-green-400">Active</span>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            'flex items-center justify-center w-10 h-10 rounded-lg',
            info.isLocal ? 'bg-green-500/20' : 'bg-accent-primary/20'
          )}
        >
          {info.isLocal ? (
            <Server className="h-5 w-5 text-green-400" />
          ) : (
            <Globe className="h-5 w-5 text-accent-primary" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">{info.name}</span>
            {info.isLocal && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/20 text-green-400">
                Local
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mt-0.5">{info.description}</p>
          <p className="text-xs text-text-muted mt-1">
            {info.isLocal ? 'Auto-discover models' : `${info.models.length} models`}
          </p>
        </div>
      </div>
    </button>
  );
}

// ============================================================================
// Provider Configuration Panel
// ============================================================================

interface ProviderConfigPanelProps {
  providerId: string;
  isConfigured: boolean;
  onConfigured: () => void;
  onRemove: () => void;
}

function ProviderConfigPanel({
  providerId,
  isConfigured,
  onConfigured,
  onRemove,
}: ProviderConfigPanelProps) {
  const info = PROVIDER_INFO[providerId];
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(info?.defaultUrl || '');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  if (!info) return null;

  const handleSave = async () => {
    if (!apiKey) {
      toast.error('Please enter an API key');
      return;
    }

    setIsSaving(true);
    try {
      await setLLMApiKeyApi(providerId, apiKey);
      toast.success(`${info.name} API key saved`);
      setApiKey('');
      onConfigured();
    } catch {
      toast.error('Failed to save API key');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await removeLLMApiKeyApi(providerId);
      toast.success(`${info.name} API key removed`);
      onRemove();
    } catch {
      toast.error('Failed to remove API key');
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="p-5 rounded-xl border border-border-subtle bg-elevated">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-lg',
              info.isLocal ? 'bg-green-500/20' : 'bg-accent-primary/20'
            )}
          >
            {info.isLocal ? (
              <Server className="h-4 w-4 text-green-400" />
            ) : (
              <Globe className="h-4 w-4 text-accent-primary" />
            )}
          </div>
          <div>
            <h4 className="font-semibold text-text-primary">Configure {info.name}</h4>
            <p className="text-xs text-text-muted">{info.description}</p>
          </div>
        </div>
        {info.docsUrl && (
          <a
            href={info.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-accent-primary hover:underline"
          >
            Get API Key <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {isConfigured ? (
        // Already configured state
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <Check className="h-5 w-5 text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-400">API Key Configured</p>
              <p className="text-xs text-text-muted">Your key is securely stored and encrypted</p>
            </div>
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors text-sm"
            >
              {isRemoving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove
            </button>
          </div>

          {/* Show available models */}
          <div>
            <p className="text-xs text-text-muted mb-2">Available models:</p>
            <div className="flex flex-wrap gap-2">
              {info.models.map((model) => (
                <span
                  key={model.id}
                  className="px-2 py-1 rounded-lg bg-overlay text-xs text-text-secondary"
                >
                  {model.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : info.isLocal ? (
        // Local provider configuration
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Server URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={info.defaultUrl}
              className="w-full px-3 py-2.5 rounded-lg bg-void border border-border-subtle text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
            />
          </div>
          <button className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors">
            <RefreshCw className="h-4 w-4" />
            Discover Models
          </button>
        </div>
      ) : (
        // Cloud provider API key configuration
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              <Key className="inline h-3.5 w-3.5 mr-1" />
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter ${info.name} API key...`}
                className="w-full px-3 py-2.5 pr-10 rounded-lg bg-void border border-border-subtle text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-primary rounded"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!apiKey || isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Key'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Podex Model Row Component
// ============================================================================

interface PodexModelRowProps {
  model: ModelInfo;
}

function PodexModelRow({ model }: PodexModelRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-elevated hover:bg-overlay/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{model.displayName}</span>
          {model.tier === 'flagship' && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400">
              Best
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {(model.contextWindow / 1000).toFixed(0)}K context
          </span>
          {/* Token Pricing */}
          {(model.inputPricePerMillion !== undefined ||
            model.outputPricePerMillion !== undefined) && (
            <span
              className="flex items-center gap-1"
              title={`Input: $${model.inputPricePerMillion?.toFixed(2) ?? '?'}/M tokens, Output: $${model.outputPricePerMillion?.toFixed(2) ?? '?'}/M tokens`}
            >
              <DollarSign className="h-3 w-3" />
              <span className="text-green-400">
                ${model.inputPricePerMillion?.toFixed(2) ?? '?'}
              </span>
              <span>/</span>
              <span className="text-amber-400">
                ${model.outputPricePerMillion?.toFixed(2) ?? '?'}
              </span>
              <span className="text-text-muted/60">/M</span>
            </span>
          )}
        </div>
      </div>

      {/* Capability Badges */}
      <div className="flex items-center gap-1">
        {model.supportsVision ? (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400"
            title="Supports image/vision input"
          >
            <ImageIcon className="h-2.5 w-2.5" />
            Vision
          </span>
        ) : (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-500/20 text-gray-500"
            title="No vision support"
          >
            <EyeOff className="h-2.5 w-2.5" />
          </span>
        )}

        {model.supportsThinking ? (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400"
            title="Extended thinking available"
          >
            <Brain className="h-2.5 w-2.5" />
            Thinking
          </span>
        ) : model.thinkingStatus === 'coming_soon' ? (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/20 text-yellow-500"
            title="Extended thinking coming soon"
          >
            <Brain className="h-2.5 w-2.5" />
            Soon
          </span>
        ) : null}
      </div>

      {/* Good For Tags */}
      <div className="hidden lg:flex items-center gap-1">
        {model.goodFor.slice(0, 2).map((tag) => (
          <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-overlay text-text-muted">
            {tag}
          </span>
        ))}
      </div>

      <Check className="h-4 w-4 text-green-400" />
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
    fallbackEnabled,
    setFallbackEnabled,
    configuredApiKeyProviders,
    setConfiguredApiKeyProviders,
  } = useModelSettings();

  const user = useAuthStore((state) => state.user);
  const isAuthenticated = !!user;
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [userModelDefaults, setUserModelDefaults] = useState<Record<string, string>>({});
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);
  const [isSaving, setIsSaving] = useState<string | null>(null);

  // Platform models from API (Podex Native)
  const [platformModels, setPlatformModels] = useState<PublicModel[]>([]);
  const [userProviderModels, setUserProviderModels] = useState<UserProviderModel[]>([]);
  const [_isLoadingModels, setIsLoadingModels] = useState(true);

  // Convert API model to ModelInfo format for display
  const apiModelToModelInfo = useCallback(
    (m: PublicModel): ModelInfo => ({
      id: m.model_id,
      provider: 'podex',
      displayName: m.display_name,
      shortName: m.display_name.replace('Claude ', '').replace('Llama ', ''),
      tier:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'flagship'
          : m.cost_tier === 'medium'
            ? 'balanced'
            : 'fast',
      contextWindow: m.context_window,
      maxOutputTokens: m.max_output_tokens,
      supportsVision: m.capabilities.vision,
      supportsThinking: m.capabilities.thinking,
      thinkingStatus: m.capabilities.thinking
        ? 'available'
        : m.capabilities.thinking_coming_soon
          ? 'coming_soon'
          : 'not_supported',
      capabilities: [
        'chat' as const,
        'code' as const,
        ...(m.capabilities.vision ? (['vision'] as const) : []),
        ...(m.capabilities.tool_use ? (['function_calling'] as const) : []),
      ],
      goodFor: m.good_for || [],
      description: m.description || '',
      reasoningEffort:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'high'
          : m.cost_tier === 'medium'
            ? 'medium'
            : 'low',
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  // Group platform models by tier (backend data only)
  const modelsByTier = useCallback(
    (tier: 'flagship' | 'balanced' | 'fast'): ModelInfo[] => {
      if (platformModels.length === 0) {
        return []; // Return empty array if API models not loaded yet
      }
      return platformModels
        .filter((m) => {
          const modelTier =
            m.cost_tier === 'premium' || m.cost_tier === 'high'
              ? 'flagship'
              : m.cost_tier === 'medium'
                ? 'balanced'
                : 'fast';
          return modelTier === tier;
        })
        .map(apiModelToModelInfo);
    },
    [platformModels, apiModelToModelInfo]
  );

  // Fetch platform models from API
  useEffect(() => {
    async function loadModels() {
      try {
        const [available, userModels] = await Promise.all([
          getAvailableModels(),
          getUserProviderModels().catch(() => []), // Ignore errors for user models
        ]);
        setPlatformModels(available);
        setUserProviderModels(userModels);
      } catch (error) {
        console.error('Failed to load platform models:', error);
        // Fall back to constants silently
      } finally {
        setIsLoadingModels(false);
      }
    }
    loadModels();
  }, []);

  // Load user preferences from backend
  useEffect(() => {
    async function loadPreferences() {
      if (!isAuthenticated) {
        setIsLoadingPrefs(false);
        return;
      }

      try {
        const [prefs, apiKeys] = await Promise.all([getUserAgentPreferences(), getLLMApiKeys()]);
        setUserModelDefaults(prefs.model_defaults || {});
        setConfiguredApiKeyProviders(apiKeys.providers);
      } catch (error) {
        console.error('Failed to load user preferences:', error);
        toast.error('Failed to load model preferences');
      } finally {
        setIsLoadingPrefs(false);
      }
    }

    loadPreferences();
  }, [isAuthenticated, setConfiguredApiKeyProviders]);

  // Handle role default change
  const handleRoleDefaultChange = useCallback(
    async (role: string, modelId: string) => {
      if (!isAuthenticated) {
        toast.error('Please sign in to save preferences');
        return;
      }

      setIsSaving(role);
      try {
        await updateUserModelDefault(role, modelId);
        setUserModelDefaults((prev) => ({ ...prev, [role]: modelId }));
        toast.success(`Default model for ${role} updated`);
      } catch (error) {
        console.error('Failed to save role default:', error);
        toast.error('Failed to save model preference');
      } finally {
        setIsSaving(null);
      }
    },
    [isAuthenticated]
  );

  const cloudProviderIds = ['anthropic', 'openai', 'google'];
  const localProviderIds = ['ollama', 'lmstudio'];

  const refreshApiKeys = useCallback(async () => {
    try {
      const apiKeys = await getLLMApiKeys();
      setConfiguredApiKeyProviders(apiKeys.providers);
    } catch (error) {
      console.error('Failed to refresh API keys:', error);
    }
  }, [setConfiguredApiKeyProviders]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle">
        <Settings className="h-5 w-5 text-accent-primary" />
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Agents & AI Settings</h2>
          <p className="text-sm text-text-muted">
            Configure AI providers and customize agent behavior
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* ================================================================
            Section 1: Podex Native Models
            ================================================================ */}
        <section>
          <SectionHeader icon={Sparkles} title="Podex Native" badge="Default" badgeColor="amber" />

          <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 mb-4">
            <div className="flex items-start gap-3">
              <Check className="h-5 w-5 text-amber-400 mt-0.5" />
              <div>
                <p className="text-sm text-text-primary font-medium">
                  Works out of the box - No API key required
                </p>
                <p className="text-xs text-text-muted mt-1">
                  AWS Bedrock models included with your Podex subscription
                </p>
              </div>
            </div>
          </div>

          {/* Model Tiers */}
          <div className="space-y-4">
            {/* Flagship */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-amber-400">FLAGSHIP</span>
                <span className="text-xs text-text-muted">Best performance</span>
              </div>
              <div className="space-y-1">
                {modelsByTier('flagship').map((model) => (
                  <PodexModelRow key={model.id} model={model} />
                ))}
              </div>
            </div>

            {/* Balanced */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-blue-400">BALANCED</span>
                <span className="text-xs text-text-muted">Speed + quality</span>
              </div>
              <div className="space-y-1">
                {modelsByTier('balanced').map((model) => (
                  <PodexModelRow key={model.id} model={model} />
                ))}
              </div>
            </div>

            {/* Fast */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-green-400">FAST</span>
                <span className="text-xs text-text-muted">Quick responses</span>
              </div>
              <div className="space-y-1">
                {modelsByTier('fast').map((model) => (
                  <PodexModelRow key={model.id} model={model} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-border-subtle" />

        {/* ================================================================
            Section 2: Cloud Providers (API Keys)
            ================================================================ */}
        <section>
          <SectionHeader icon={Cloud} title="Model Providers" />

          <p className="text-sm text-text-muted mb-4">
            Add your own API keys to use additional models from external providers
          </p>

          {/* Provider Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {cloudProviderIds.map((providerId) => (
              <ProviderCard
                key={providerId}
                providerId={providerId}
                isConfigured={configuredApiKeyProviders.includes(providerId)}
                isSelected={selectedProvider === providerId}
                onSelect={() =>
                  setSelectedProvider(selectedProvider === providerId ? null : providerId)
                }
              />
            ))}
          </div>

          {/* Configuration Panel */}
          {selectedProvider && cloudProviderIds.includes(selectedProvider) && (
            <ProviderConfigPanel
              providerId={selectedProvider}
              isConfigured={configuredApiKeyProviders.includes(selectedProvider)}
              onConfigured={refreshApiKeys}
              onRemove={refreshApiKeys}
            />
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-border-subtle" />

        {/* ================================================================
            Section 3: Local Models
            ================================================================ */}
        <section>
          <SectionHeader
            icon={Server}
            title="Local Models"
            badge="Free & Private"
            badgeColor="green"
          />

          <p className="text-sm text-text-muted mb-4">
            Run open-source models on your machine with complete privacy
          </p>

          {/* Local Provider Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {localProviderIds.map((providerId) => (
              <ProviderCard
                key={providerId}
                providerId={providerId}
                isConfigured={false}
                isSelected={selectedProvider === providerId}
                onSelect={() =>
                  setSelectedProvider(selectedProvider === providerId ? null : providerId)
                }
              />
            ))}
          </div>

          {/* Configuration Panel */}
          {selectedProvider && localProviderIds.includes(selectedProvider) && (
            <ProviderConfigPanel
              providerId={selectedProvider}
              isConfigured={false}
              onConfigured={() => {}}
              onRemove={() => {}}
            />
          )}

          {/* Help links */}
          <div className="flex gap-4 mt-3">
            <a
              href="https://ollama.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-green-400 hover:underline"
            >
              Get Ollama <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href="https://lmstudio.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-green-400 hover:underline"
            >
              Get LM Studio <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </section>

        {/* Divider */}
        <div className="border-t border-border-subtle" />

        {/* ================================================================
            Section 4: Default Models by Role
            ================================================================ */}
        <section>
          <SectionHeader icon={Cpu} title="Default Models by Role" badgeColor="blue" />

          <p className="text-sm text-text-muted mb-4">
            Configure which model to use for each agent role. New agents will use these defaults.
          </p>

          {isLoadingPrefs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              <span className="ml-2 text-sm text-text-muted">Loading preferences...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {ALL_AGENT_ROLES.map((role) => {
                const Icon = ROLE_ICONS[role] || Bot;
                const colorClass = ROLE_COLORS[role] || 'text-text-muted';
                const displayName = role === 'agent_builder' ? 'Agent Builder' : role;
                return (
                  <div
                    key={role}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-elevated"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn('h-4 w-4', colorClass)} />
                      <span className="text-sm text-text-secondary capitalize font-medium">
                        {displayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSaving === role && (
                        <Loader2 className="h-3 w-3 animate-spin text-accent-primary" />
                      )}
                      <select
                        value={userModelDefaults[role] || platformModels[0]?.model_id || ''}
                        onChange={(e) => handleRoleDefaultChange(role, e.target.value)}
                        disabled={isSaving === role || platformModels.length === 0}
                        className="px-2 py-1 rounded-lg bg-overlay border border-border-subtle text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50"
                      >
                        <optgroup label="Podex Native">
                          {platformModels.map((m) => (
                            <option key={m.model_id} value={m.model_id}>
                              {m.display_name.replace('Claude ', '').replace('Llama ', '')}
                            </option>
                          ))}
                        </optgroup>
                        {userProviderModels.length > 0 && (
                          <optgroup label="Your API Keys">
                            {userProviderModels.map((model) => (
                              <option key={model.model_id} value={model.model_id}>
                                {model.display_name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="border-t border-border-subtle" />

        {/* ================================================================
            Section 5: Advanced Settings
            ================================================================ */}
        <section>
          <SectionHeader icon={Zap} title="Advanced Settings" />

          {/* Smart Fallback */}
          <div className="p-4 rounded-xl bg-elevated border border-border-subtle">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-yellow-500/20">
                  <Zap className="h-4 w-4 text-yellow-400" />
                </div>
                <div>
                  <span className="text-sm font-medium text-text-primary">Smart Fallback</span>
                  <p className="text-xs text-text-muted">
                    Try local models first, fall back to cloud when unavailable
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(e) => setFallbackEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-overlay rounded-full peer peer-checked:bg-accent-primary transition-colors">
                  <div
                    className={cn(
                      'absolute w-5 h-5 bg-white rounded-full top-0.5 left-0.5 transition-transform shadow',
                      fallbackEnabled && 'translate-x-5'
                    )}
                  />
                </div>
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
