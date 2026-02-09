'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Plus,
  RefreshCw,
  Check,
  X,
  Trash2,
  Edit,
  Play,
  AlertTriangle,
  Zap,
  MessageSquare,
  Image,
  Wrench,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getLLMProviders,
  createLLMProvider,
  updateLLMProvider,
  deleteLLMProvider,
  testLLMProvider,
} from '@/lib/api';

interface LLMProvider {
  id: string;
  user_id: string;
  name: string;
  provider_type: string;
  base_url: string;
  auth_header: string;
  auth_scheme: string;
  default_model: string;
  available_models: string[];
  context_window: number;
  max_output_tokens: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  request_timeout_seconds: number;
  extra_headers: Record<string, string> | null;
  extra_body_params: Record<string, unknown> | null;
  is_enabled: boolean;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
  has_api_key: boolean;
}

interface TestResult {
  success: boolean;
  response: string | null;
  error: string | null;
  latency_ms: number | null;
}

function ProviderTypeLabel({ type }: { type: string }) {
  const labels: Record<string, { label: string; color: string }> = {
    openai_compatible: { label: 'OpenAI Compatible', color: 'bg-green-500/20 text-green-400' },
    anthropic_compatible: {
      label: 'Anthropic Compatible',
      color: 'bg-purple-500/20 text-purple-400',
    },
    custom: { label: 'Custom', color: 'bg-gray-500/20 text-gray-400' },
  };
  const config = (labels[type] || labels.custom)!;
  return (
    <span className={cn('px-2 py-0.5 rounded text-xs font-medium', config.color)}>
      {config.label}
    </span>
  );
}

function StatusIndicator({ provider }: { provider: LLMProvider }) {
  if (!provider.last_tested_at) {
    return <span className="text-text-muted text-xs">Not tested</span>;
  }

  if (provider.last_test_status === 'success') {
    return (
      <span className="flex items-center gap-1 text-green-500 text-xs">
        <Check className="h-3 w-3" />
        Connected
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-red-500 text-xs">
      <X className="h-3 w-3" />
      Failed
    </span>
  );
}

interface ProviderModalProps {
  provider?: LLMProvider;
  onClose: () => void;
  onSave: (data: Partial<LLMProvider> & { api_key?: string }) => void;
}

function ProviderModal({ provider, onClose, onSave }: ProviderModalProps) {
  const [formData, setFormData] = useState({
    name: provider?.name || '',
    provider_type: provider?.provider_type || 'openai_compatible',
    base_url: provider?.base_url || '',
    api_key: '',
    auth_header: provider?.auth_header || 'Authorization',
    auth_scheme: provider?.auth_scheme || 'Bearer',
    default_model: provider?.default_model || '',
    available_models: provider?.available_models?.join(', ') || '',
    context_window: provider?.context_window || 4096,
    max_output_tokens: provider?.max_output_tokens || 2048,
    supports_streaming: provider?.supports_streaming ?? true,
    supports_tools: provider?.supports_tools ?? false,
    supports_vision: provider?.supports_vision ?? false,
    request_timeout_seconds: provider?.request_timeout_seconds || 120,
    is_enabled: provider?.is_enabled ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const models = formData.available_models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    onSave({
      name: formData.name,
      provider_type: formData.provider_type,
      base_url: formData.base_url,
      ...(formData.api_key ? { api_key: formData.api_key } : {}),
      auth_header: formData.auth_header,
      auth_scheme: formData.auth_scheme,
      default_model: formData.default_model,
      available_models: models,
      context_window: formData.context_window,
      max_output_tokens: formData.max_output_tokens,
      supports_streaming: formData.supports_streaming,
      supports_tools: formData.supports_tools,
      supports_vision: formData.supports_vision,
      request_timeout_seconds: formData.request_timeout_seconds,
      is_enabled: formData.is_enabled,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-2xl w-full max-h-[85vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            {provider ? 'Edit Provider' : 'Add Custom LLM Provider'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto max-h-[65vh]">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Provider Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My vLLM Server"
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Provider Type</label>
              <select
                value={formData.provider_type}
                onChange={(e) => setFormData({ ...formData, provider_type: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              >
                <option value="openai_compatible">OpenAI Compatible (vLLM, LocalAI, etc.)</option>
                <option value="anthropic_compatible">Anthropic Compatible</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {/* Connection */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Base URL</label>
            <input
              type="url"
              value={formData.base_url}
              onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
              placeholder="https://api.example.com/v1"
              required
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted"
            />
            <p className="text-text-muted text-xs mt-1">The base URL of your LLM API endpoint</p>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">
              API Key{' '}
              {provider?.has_api_key && (
                <span className="text-text-muted">(leave blank to keep existing)</span>
              )}
            </label>
            <input
              type="password"
              value={formData.api_key}
              onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
              placeholder={provider?.has_api_key ? '••••••••' : 'sk-...'}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Auth Header</label>
              <input
                type="text"
                value={formData.auth_header}
                onChange={(e) => setFormData({ ...formData, auth_header: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Auth Scheme</label>
              <input
                type="text"
                value={formData.auth_scheme}
                onChange={(e) => setFormData({ ...formData, auth_scheme: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
          </div>

          {/* Model Config */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Default Model</label>
            <input
              type="text"
              value={formData.default_model}
              onChange={(e) => setFormData({ ...formData, default_model: e.target.value })}
              placeholder="llama-3-70b"
              required
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted"
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Available Models (comma-separated)
            </label>
            <input
              type="text"
              value={formData.available_models}
              onChange={(e) => setFormData({ ...formData, available_models: e.target.value })}
              placeholder="llama-3-70b, llama-3-8b, mixtral-8x7b"
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Context Window</label>
              <input
                type="number"
                value={formData.context_window}
                onChange={(e) =>
                  setFormData({ ...formData, context_window: parseInt(e.target.value) })
                }
                min={1}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Max Output Tokens</label>
              <input
                type="number"
                value={formData.max_output_tokens}
                onChange={(e) =>
                  setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) })
                }
                min={1}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Timeout (seconds)</label>
              <input
                type="number"
                value={formData.request_timeout_seconds}
                onChange={(e) =>
                  setFormData({ ...formData, request_timeout_seconds: parseInt(e.target.value) })
                }
                min={1}
                max={600}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-sm text-text-secondary mb-2">Capabilities</label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.supports_streaming}
                  onChange={(e) =>
                    setFormData({ ...formData, supports_streaming: e.target.checked })
                  }
                  className="rounded"
                />
                <Zap className="h-4 w-4 text-text-muted" />
                <span className="text-sm text-text-secondary">Streaming</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.supports_tools}
                  onChange={(e) => setFormData({ ...formData, supports_tools: e.target.checked })}
                  className="rounded"
                />
                <Wrench className="h-4 w-4 text-text-muted" />
                <span className="text-sm text-text-secondary">Tool Use</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.supports_vision}
                  onChange={(e) => setFormData({ ...formData, supports_vision: e.target.checked })}
                  className="rounded"
                />
                <Image className="h-4 w-4 text-text-muted" />
                <span className="text-sm text-text-secondary">Vision</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_enabled"
              checked={formData.is_enabled}
              onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="is_enabled" className="text-sm text-text-secondary">
              Provider is enabled
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              {provider ? 'Save Changes' : 'Add Provider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TestModalProps {
  provider: LLMProvider;
  onClose: () => void;
}

function TestModal({ provider, onClose }: TestModalProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const data = await testLLMProvider(
        provider.id,
        "Say 'Hello from Podex!' in exactly those words."
      );
      setResult({
        success: data.success,
        response: data.success ? data.message : null,
        error: data.success ? null : data.message,
        latency_ms: data.latency_ms || null,
      });
    } catch (err) {
      setResult({
        success: false,
        response: null,
        error: err instanceof Error ? err.message : 'Unknown error',
        latency_ms: null,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Test Connection</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-elevated rounded-lg p-3">
            <p className="text-text-secondary text-sm">
              <strong>Provider:</strong> {provider.name}
            </p>
            <p className="text-text-muted text-xs">{provider.base_url}</p>
            <p className="text-text-muted text-xs">Model: {provider.default_model}</p>
          </div>

          {result && (
            <div
              className={cn(
                'rounded-lg p-4',
                result.success
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-red-500/10 border border-red-500/30'
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                {result.success ? (
                  <Check className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                )}
                <span className={result.success ? 'text-green-500' : 'text-red-500'}>
                  {result.success ? 'Connection Successful' : 'Connection Failed'}
                </span>
                {result.latency_ms && (
                  <span className="text-text-muted text-xs ml-auto">{result.latency_ms}ms</span>
                )}
              </div>
              {result.response && (
                <div className="bg-surface rounded p-2 text-text-secondary text-sm">
                  {result.response}
                </div>
              )}
              {result.error && <p className="text-red-400 text-sm">{result.error}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-elevated"
            >
              Close
            </button>
            <button
              onClick={runTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Test
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LLMProvidersPage() {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<LLMProvider | undefined>();
  const [testingProvider, setTestingProvider] = useState<LLMProvider | null>(null);

  const fetchProviders = useCallback(async () => {
    try {
      const providersResponse = await getLLMProviders();
      const providers: LLMProvider[] = providersResponse.map((provider) => ({
        ...provider,
        extra_body_params: provider.extra_body_params as Record<string, unknown> | null,
        is_enabled: true, // Default to enabled
        last_tested_at: null,
        last_test_status: null,
        last_test_error: null,
        created_at: new Date().toISOString(), // This should come from API ideally
        updated_at: new Date().toISOString(), // This should come from API ideally
        has_api_key: false, // Default to false
      }));
      setProviders(providers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleSave = async (data: Partial<LLMProvider> & { api_key?: string }) => {
    try {
      if (editingProvider) {
        await updateLLMProvider(editingProvider.id, data);
      } else {
        await createLLMProvider({
          name: data.name!,
          type: data.provider_type!,
          api_key: data.api_key,
          base_url: data.base_url,
          is_enabled: data.is_enabled,
          config: {
            auth_header: data.auth_header,
            auth_scheme: data.auth_scheme,
            default_model: data.default_model,
            available_models: data.available_models,
            context_window: data.context_window,
            max_output_tokens: data.max_output_tokens,
            supports_streaming: data.supports_streaming,
            supports_tools: data.supports_tools,
            supports_vision: data.supports_vision,
            request_timeout_seconds: data.request_timeout_seconds,
            extra_headers: data.extra_headers,
            extra_body_params: data.extra_body_params,
          },
        });
      }

      setShowModal(false);
      setEditingProvider(undefined);
      fetchProviders();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save provider');
    }
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this provider?')) return;

    try {
      await deleteLLMProvider(providerId);
      fetchProviders();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete provider');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-3">
          <Server className="h-7 w-7 text-accent-primary" />
          Custom LLM Providers
        </h1>
        <p className="text-text-muted mt-1">
          Connect your own LLM endpoints (vLLM, text-generation-inference, LocalAI, or any
          OpenAI-compatible API)
        </p>
      </div>

      {error && <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">{error}</div>}

      {/* Info box */}
      <div className="bg-elevated rounded-xl border border-border-subtle p-4 mb-6">
        <h3 className="font-medium text-text-primary mb-2">Supported Provider Types</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-accent-primary font-medium">OpenAI Compatible</p>
            <p className="text-text-muted">
              vLLM, LocalAI, Ollama, text-generation-inference, LM Studio
            </p>
          </div>
          <div>
            <p className="text-purple-400 font-medium">Anthropic Compatible</p>
            <p className="text-text-muted">Self-hosted Anthropic API proxies</p>
          </div>
          <div>
            <p className="text-gray-400 font-medium">Custom</p>
            <p className="text-text-muted">Any REST API with custom configuration</p>
          </div>
        </div>
      </div>

      {/* Add button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            setEditingProvider(undefined);
            setShowModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </button>
      </div>

      {/* Provider list */}
      {providers.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border-subtle p-8 text-center">
          <Server className="h-12 w-12 mx-auto text-text-muted opacity-50 mb-4" />
          <h3 className="text-text-primary font-medium mb-2">No Custom Providers</h3>
          <p className="text-text-muted text-sm mb-4">
            Connect your own LLM servers to use them in your AI agents.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
          >
            <Plus className="h-4 w-4" />
            Add Your First Provider
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                'bg-surface rounded-xl border border-border-subtle p-4',
                !provider.is_enabled && 'opacity-60'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-text-primary">{provider.name}</h3>
                    <ProviderTypeLabel type={provider.provider_type} />
                    {!provider.is_enabled && (
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-sm font-mono">{provider.base_url}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {provider.default_model}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {provider.context_window.toLocaleString()} ctx
                    </span>
                    {provider.supports_streaming && (
                      <span className="flex items-center gap-1">
                        <Zap className="h-3 w-3" />
                        Streaming
                      </span>
                    )}
                    {provider.supports_tools && (
                      <span className="flex items-center gap-1">
                        <Wrench className="h-3 w-3" />
                        Tools
                      </span>
                    )}
                    {provider.supports_vision && (
                      <span className="flex items-center gap-1">
                        <Image className="h-3 w-3" />
                        Vision
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusIndicator provider={provider} />
                  <button
                    onClick={() => setTestingProvider(provider)}
                    className="p-2 rounded hover:bg-elevated text-text-muted hover:text-accent-primary"
                    title="Test connection"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingProvider(provider);
                      setShowModal(true);
                    }}
                    className="p-2 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
                    title="Edit"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(provider.id)}
                    className="p-2 rounded hover:bg-elevated text-text-muted hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {provider.last_test_error && (
                <div className="mt-2 p-2 bg-red-500/10 rounded text-red-400 text-xs">
                  Last error: {provider.last_test_error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <ProviderModal
          provider={editingProvider}
          onClose={() => {
            setShowModal(false);
            setEditingProvider(undefined);
          }}
          onSave={handleSave}
        />
      )}

      {testingProvider && (
        <TestModal provider={testingProvider} onClose={() => setTestingProvider(null)} />
      )}

      {/* Documentation link */}
      <div className="mt-8 p-4 bg-elevated rounded-lg">
        <h3 className="font-medium text-text-primary mb-2">Need help?</h3>
        <p className="text-text-muted text-sm mb-3">
          Learn how to set up popular self-hosted LLM servers and connect them to Podex.
        </p>
        <a
          href="https://docs.podex.ai/custom-llm"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-accent-primary text-sm hover:underline"
        >
          View Documentation <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
