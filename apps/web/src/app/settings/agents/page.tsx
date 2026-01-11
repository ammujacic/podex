'use client';

import { useState } from 'react';
import {
  Bot,
  Cpu,
  Zap,
  Settings,
  Key,
  Globe,
  Server,
  ChevronRight,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  TestTube,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useAgentSettingsStore,
  providers,
  type APIKey,
  type AgentConfig,
  type ModelProvider,
} from '@/stores/agentSettings';

// ============================================================================
// Components
// ============================================================================

interface ProviderCardProps {
  provider: ModelProvider;
  hasApiKey: boolean;
  onConfigure: () => void;
}

function ProviderCard({ provider, hasApiKey, onConfigure }: ProviderCardProps) {
  return (
    <div className="p-4 rounded-lg border border-border-subtle bg-elevated hover:border-border-default transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              provider.type === 'cloud' ? 'bg-blue-500/20' : 'bg-green-500/20'
            )}
          >
            {provider.type === 'cloud' ? (
              <Globe className="h-5 w-5 text-blue-400" />
            ) : (
              <Server className="h-5 w-5 text-green-400" />
            )}
          </div>
          <div>
            <h4 className="text-sm font-medium text-text-primary">{provider.name}</h4>
            <p className="text-xs text-text-muted">
              {provider.type === 'cloud' ? 'Cloud API' : 'Local'}
              {provider.models.length > 0 && ` · ${provider.models.length} models`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasApiKey && (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" />
              Configured
            </span>
          )}
          <button
            onClick={onConfigure}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface APIKeyInputProps {
  provider: string;
  existingKey?: APIKey;
  onSave: (key: string) => void;
  onRemove: () => void;
}

function APIKeyInput({ provider, existingKey, onSave, onRemove }: APIKeyInputProps) {
  const [showKey, setShowKey] = useState(false);
  const [keyValue, setKeyValue] = useState(existingKey?.key || '');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const handleTest = async () => {
    setIsTesting(true);
    // Simulate API test
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setTestResult(keyValue.length > 10 ? 'success' : 'error');
    setIsTesting(false);
  };

  const maskedKey = existingKey?.key
    ? `${existingKey.key.slice(0, 8)}${'•'.repeat(20)}${existingKey.key.slice(-4)}`
    : '';

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type={showKey ? 'text' : 'password'}
            value={existingKey && !showKey ? maskedKey : keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={`Enter ${provider} API key...`}
            className="w-full pl-10 pr-10 py-2 rounded-lg bg-surface border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <button
          onClick={handleTest}
          disabled={!keyValue || isTesting}
          className="px-3 py-2 rounded-lg bg-elevated border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-50 flex items-center gap-2"
        >
          {isTesting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <TestTube className="h-4 w-4" />
          )}
          Test
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            'flex items-center gap-2 text-sm',
            testResult === 'success' ? 'text-green-400' : 'text-red-400'
          )}
        >
          {testResult === 'success' ? (
            <>
              <Check className="h-4 w-4" /> API key is valid
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" /> Invalid API key
            </>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onSave(keyValue)}
          disabled={!keyValue}
          className="px-4 py-2 rounded-lg bg-accent-primary text-void disabled:opacity-50"
        >
          Save Key
        </button>
        {existingKey && (
          <button
            onClick={onRemove}
            className="px-4 py-2 rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

interface AgentConfigCardProps {
  config: AgentConfig;
  onUpdate: (updates: Partial<AgentConfig>) => void;
  allModels: string[];
}

function AgentConfigCard({ config, onUpdate, allModels }: AgentConfigCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-border-subtle rounded-lg bg-elevated overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-overlay transition-colors"
      >
        <div className="flex items-center gap-3">
          <Bot className="h-5 w-5 text-accent-primary" />
          <span className="font-medium text-text-primary">{config.name}</span>
          <span className="text-xs text-text-muted px-2 py-0.5 rounded bg-overlay">
            {config.defaultModel}
          </span>
        </div>
        <ChevronRight
          className={cn('h-5 w-5 text-text-muted transition-transform', isExpanded && 'rotate-90')}
        />
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-border-subtle space-y-4">
          <div>
            <label className="text-sm text-text-secondary mb-1 block">Default Model</label>
            <select
              value={config.defaultModel}
              onChange={(e) => onUpdate({ defaultModel: e.target.value })}
              className="w-full px-3 py-2 rounded bg-surface border border-border-default text-text-primary"
            >
              {allModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm text-text-secondary mb-1 block">
              Temperature: {config.temperature}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.temperature}
              onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-accent-primary"
            />
            <div className="flex justify-between text-xs text-text-muted mt-1">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>

          <div>
            <label className="text-sm text-text-secondary mb-1 block">Max Tokens</label>
            <input
              type="number"
              value={config.maxTokens}
              onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value) })}
              className="w-full px-3 py-2 rounded bg-surface border border-border-default text-text-primary"
              min={256}
              max={32768}
              step={256}
            />
          </div>

          <div>
            <label className="text-sm text-text-secondary mb-1 block">
              System Prompt (Optional)
            </label>
            <textarea
              value={config.systemPrompt || ''}
              onChange={(e) => onUpdate({ systemPrompt: e.target.value || undefined })}
              placeholder="Custom instructions for this agent..."
              rows={3}
              className="w-full px-3 py-2 rounded bg-surface border border-border-default text-text-primary placeholder:text-text-muted resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function AgentsSettingsPage() {
  const {
    apiKeys,
    agentConfigs,
    preferredProvider,
    useLocalFirst,
    maxConcurrentAgents,
    autoApproveChanges,
    showTokenUsage,
    addApiKey,
    removeApiKey,
    updateAgentConfig,
    setPreferredProvider,
    setUseLocalFirst,
    setMaxConcurrentAgents,
    setAutoApproveChanges,
    setShowTokenUsage,
  } = useAgentSettingsStore();

  const [configuringProvider, setConfiguringProvider] = useState<string | null>(null);

  const allModels = providers.flatMap((p) => p.models);

  const getApiKeyForProvider = (providerId: string) =>
    apiKeys.find((k) => k.provider === providerId);

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Bot className="h-6 w-6" />
          Agents & AI Settings
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Configure AI providers and customize agent behavior
        </p>
      </div>

      {/* Providers */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent-primary" />
          Model Providers
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              hasApiKey={!!getApiKeyForProvider(provider.id)}
              onConfigure={() => setConfiguringProvider(provider.id)}
            />
          ))}
        </div>

        {configuringProvider && (
          <div className="mt-4 p-4 rounded-lg border border-border-subtle bg-surface">
            <h3 className="text-sm font-medium text-text-primary mb-3">
              Configure {providers.find((p) => p.id === configuringProvider)?.name}
            </h3>
            <APIKeyInput
              provider={configuringProvider}
              existingKey={getApiKeyForProvider(configuringProvider)}
              onSave={(key) => {
                const existing = getApiKeyForProvider(configuringProvider);
                if (existing) removeApiKey(existing.id);
                addApiKey({ provider: configuringProvider, key });
                setConfiguringProvider(null);
              }}
              onRemove={() => {
                const existing = getApiKeyForProvider(configuringProvider);
                if (existing) removeApiKey(existing.id);
                setConfiguringProvider(null);
              }}
            />
          </div>
        )}
      </section>

      {/* General Settings */}
      <section className="mb-8">
        <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4 text-accent-primary" />
          General Settings
        </h2>
        <div className="space-y-4 p-4 rounded-lg border border-border-subtle bg-elevated">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Preferred Provider</div>
              <div className="text-xs text-text-muted">Default provider for new sessions</div>
            </div>
            <select
              value={preferredProvider}
              onChange={(e) => setPreferredProvider(e.target.value)}
              className="px-3 py-1.5 rounded bg-surface border border-border-default text-sm text-text-primary"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Prefer Local Models</div>
              <div className="text-xs text-text-muted">Try local models first when available</div>
            </div>
            <button
              onClick={() => setUseLocalFirst(!useLocalFirst)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                useLocalFirst ? 'bg-accent-primary' : 'bg-overlay'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
                  useLocalFirst ? 'left-6' : 'left-1'
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Max Concurrent Agents</div>
              <div className="text-xs text-text-muted">Limit parallel agent execution</div>
            </div>
            <input
              type="number"
              value={maxConcurrentAgents}
              onChange={(e) => setMaxConcurrentAgents(parseInt(e.target.value))}
              min={1}
              max={10}
              className="w-20 px-3 py-1.5 rounded bg-surface border border-border-default text-sm text-text-primary text-right"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Auto-Approve Changes</div>
              <div className="text-xs text-text-muted">
                Apply agent changes without confirmation
              </div>
            </div>
            <button
              onClick={() => setAutoApproveChanges(!autoApproveChanges)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                autoApproveChanges ? 'bg-accent-primary' : 'bg-overlay'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
                  autoApproveChanges ? 'left-6' : 'left-1'
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Show Token Usage</div>
              <div className="text-xs text-text-muted">Display token counts in agent UI</div>
            </div>
            <button
              onClick={() => setShowTokenUsage(!showTokenUsage)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                showTokenUsage ? 'bg-accent-primary' : 'bg-overlay'
              )}
            >
              <span
                className={cn(
                  'absolute top-1 w-4 h-4 bg-white rounded-full transition-transform',
                  showTokenUsage ? 'left-6' : 'left-1'
                )}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Agent Configurations */}
      <section>
        <h2 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent-primary" />
          Agent Configurations
        </h2>
        <div className="space-y-3">
          {agentConfigs.map((config) => (
            <AgentConfigCard
              key={config.id}
              config={config}
              onUpdate={(updates) => updateAgentConfig(config.id, updates)}
              allModels={allModels}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
