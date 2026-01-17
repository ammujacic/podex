'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Check,
  X,
  Brain,
  ImageIcon,
  Sparkles,
  Trash2,
  Loader2,
  Layers,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  adminListModels,
  adminCreateModel,
  adminUpdateModel,
  adminDeleteModel,
  adminGetAgentDefaults,
  adminUpdateAgentDefaults,
  adminSeedModels,
  type AdminModel,
  type CreateModelRequest,
  type UpdateModelRequest,
  type AgentDefaultsResponse,
} from '@/lib/api';
import { toast } from 'sonner';

// Cost tier badge colors
const costTierColors: Record<string, string> = {
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-yellow-500/20 text-yellow-400',
  premium: 'bg-purple-500/20 text-purple-400',
};

interface ModelCardProps {
  model: AdminModel;
  onEdit: (model: AdminModel) => void;
  onToggleEnabled: (modelId: string, isEnabled: boolean) => void;
  onDelete: (modelId: string) => void;
}

function ModelCard({ model, onEdit, onToggleEnabled, onDelete }: ModelCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${model.display_name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete(model.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        model.is_enabled ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-text-primary">{model.display_name}</h3>
            {model.is_default && (
              <span className="px-2 py-0.5 bg-accent-primary/20 text-accent-primary text-xs rounded-full">
                Default
              </span>
            )}
          </div>
          <p className="text-text-muted text-sm mt-1 font-mono">{model.model_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(model)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Edit model"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleEnabled(model.id, !model.is_enabled)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              model.is_enabled
                ? 'hover:bg-red-500/10 text-red-500'
                : 'hover:bg-green-500/10 text-green-500'
            )}
            title={model.is_enabled ? 'Disable model' : 'Enable model'}
          >
            {model.is_enabled ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors disabled:opacity-50"
            title="Delete model"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Provider & Family */}
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary capitalize">
            {model.provider}
          </span>
          <span className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary capitalize">
            {model.family}
          </span>
          <span
            className={cn(
              'px-2 py-1 rounded text-xs capitalize',
              costTierColors[model.cost_tier] || 'bg-gray-500/20 text-gray-400'
            )}
          >
            {model.cost_tier}
          </span>
        </div>

        {/* Capabilities */}
        <div className="flex flex-wrap gap-1">
          {model.capabilities?.vision && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
              <ImageIcon className="h-3 w-3" />
              Vision
            </span>
          )}
          {model.capabilities?.thinking && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
              <Brain className="h-3 w-3" />
              Thinking
            </span>
          )}
          {model.capabilities?.tool_use && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded">
              <Sparkles className="h-3 w-3" />
              Tools
            </span>
          )}
          {model.capabilities?.streaming && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 text-cyan-400 text-xs rounded">
              Streaming
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="space-y-2 text-sm border-t border-border-subtle pt-4">
          <div className="flex justify-between">
            <span className="text-text-muted">Context Window</span>
            <span className="text-text-secondary">
              {(model.context_window / 1000).toFixed(0)}K tokens
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Max Output</span>
            <span className="text-text-secondary">
              {(model.max_output_tokens / 1000).toFixed(0)}K tokens
            </span>
          </div>
        </div>

        {/* Pricing */}
        <div className="space-y-2 text-sm border-t border-border-subtle pt-4">
          <div className="flex justify-between">
            <span className="text-text-muted">Input Cost</span>
            <span className="text-green-400">
              ${model.input_cost_per_million?.toFixed(2) || '0.00'}/M
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Output Cost</span>
            <span className="text-yellow-400">
              ${model.output_cost_per_million?.toFixed(2) || '0.00'}/M
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditModelModalProps {
  model: AdminModel | null;
  onClose: () => void;
  onSave: (data: CreateModelRequest | UpdateModelRequest) => Promise<void>;
}

function EditModelModal({ model, onClose, onSave }: EditModelModalProps) {
  const [formData, setFormData] = useState({
    model_id: model?.model_id || '',
    display_name: model?.display_name || '',
    provider: model?.provider || 'bedrock',
    family: model?.family || 'anthropic',
    cost_tier: model?.cost_tier || 'medium',
    context_window: model?.context_window || 200000,
    max_output_tokens: model?.max_output_tokens || 8192,
    input_cost_per_million: model?.input_cost_per_million || 0,
    output_cost_per_million: model?.output_cost_per_million || 0,
    is_enabled: model?.is_enabled ?? true,
    is_default: model?.is_default ?? false,
    sort_order: model?.sort_order || 100,
    capabilities: model?.capabilities || {
      vision: false,
      thinking: false,
      tool_use: true,
      streaming: true,
      json_mode: false,
    },
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      console.error('Failed to save model:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-6">
          {model ? 'Edit Model' : 'Add Model'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Model ID</label>
              <input
                type="text"
                value={formData.model_id}
                onChange={(e) => setFormData({ ...formData, model_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary font-mono text-sm"
                placeholder="anthropic.claude-3-sonnet-20240229-v1:0"
                required
                disabled={!!model}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Display Name</label>
              <input
                type="text"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                placeholder="Claude 3 Sonnet"
                required
              />
            </div>
          </div>

          {/* Provider & Family */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Provider</label>
              <select
                value={formData.provider}
                onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              >
                <option value="vertex">Vertex AI</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Family</label>
              <select
                value={formData.family}
                onChange={(e) => setFormData({ ...formData, family: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              >
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="meta">Meta</option>
                <option value="mistral">Mistral</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Cost Tier</label>
              <select
                value={formData.cost_tier}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    cost_tier: e.target.value as 'low' | 'medium' | 'high' | 'premium',
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="premium">Premium</option>
              </select>
            </div>
          </div>

          {/* Token Limits */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Context Window (tokens)</label>
              <input
                type="number"
                value={formData.context_window}
                onChange={(e) =>
                  setFormData({ ...formData, context_window: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={1000}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Max Output Tokens</label>
              <input
                type="number"
                value={formData.max_output_tokens}
                onChange={(e) =>
                  setFormData({ ...formData, max_output_tokens: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={100}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Input Cost ($/M tokens)</label>
              <input
                type="number"
                value={formData.input_cost_per_million}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    input_cost_per_million: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
                step={0.01}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Output Cost ($/M tokens)</label>
              <input
                type="number"
                value={formData.output_cost_per_million}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    output_cost_per_million: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
                step={0.01}
              />
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-sm text-text-muted mb-2">Capabilities</label>
            <div className="flex flex-wrap gap-4">
              {['vision', 'thinking', 'tool_use', 'streaming', 'json_mode'].map((cap) => (
                <label key={cap} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={
                      formData.capabilities[cap as keyof typeof formData.capabilities] || false
                    }
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        capabilities: { ...formData.capabilities, [cap]: e.target.checked },
                      })
                    }
                    className="rounded border-border-subtle"
                  />
                  <span className="text-sm text-text-secondary capitalize">
                    {cap.replace('_', ' ')}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Flags */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Sort Order</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) =>
                  setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={formData.is_enabled}
                  onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
                  className="rounded border-border-subtle"
                />
                <span className="text-sm text-text-secondary">Enabled</span>
              </label>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="rounded border-border-subtle"
                />
                <span className="text-sm text-text-secondary">Default</span>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface AgentDefaultsModalProps {
  defaults: AgentDefaultsResponse | null;
  models: AdminModel[];
  onClose: () => void;
  onSave: (agentType: string, modelId: string) => Promise<void>;
}

function AgentDefaultsModal({ defaults, models, onClose, onSave }: AgentDefaultsModalProps) {
  const [localDefaults, setLocalDefaults] = useState<Record<string, string>>(() => {
    if (!defaults?.defaults) return {};
    return Object.fromEntries(
      Object.entries(defaults.defaults).map(([key, val]) => [key, val.model_id])
    );
  });
  const [saving, setSaving] = useState<string | null>(null);

  const agentTypes = [
    'architect',
    'coder',
    'reviewer',
    'tester',
    'chat',
    'security',
    'devops',
    'documentator',
    'agent_builder',
    'orchestrator',
  ];

  const handleSave = async (agentType: string, modelId: string) => {
    setSaving(agentType);
    try {
      await onSave(agentType, modelId);
      setLocalDefaults((prev) => ({ ...prev, [agentType]: modelId }));
      toast.success(`Default for ${agentType} updated`);
    } catch (error) {
      console.error('Failed to save default:', error);
      toast.error('Failed to save default');
    } finally {
      setSaving(null);
    }
  };

  const enabledModels = models.filter((m) => m.is_enabled);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-6">Agent Type Defaults</h2>

        <p className="text-sm text-text-muted mb-4">
          Configure which model should be used by default for each agent type.
        </p>

        <div className="space-y-3">
          {agentTypes.map((agentType) => (
            <div
              key={agentType}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-elevated"
            >
              <span className="text-sm text-text-secondary capitalize">
                {agentType.replace('_', ' ')}
              </span>
              <div className="flex items-center gap-2">
                {saving === agentType && (
                  <Loader2 className="h-3 w-3 animate-spin text-accent-primary" />
                )}
                <select
                  value={localDefaults[agentType] || ''}
                  onChange={(e) => handleSave(agentType, e.target.value)}
                  disabled={saving === agentType}
                  className="px-2 py-1 rounded bg-overlay border border-border-subtle text-text-primary text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50"
                >
                  <option value="">Use system default</option>
                  {enabledModels.map((model) => (
                    <option key={model.id} value={model.model_id}>
                      {model.display_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ModelsManagement() {
  const [models, setModels] = useState<AdminModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingModel, setEditingModel] = useState<AdminModel | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [defaults, setDefaults] = useState<AgentDefaultsResponse | null>(null);
  const [seeding, setSeeding] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const data = await adminListModels();
      setModels(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch models:', err);
      setError('Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDefaults = useCallback(async () => {
    try {
      const data = await adminGetAgentDefaults();
      setDefaults(data);
    } catch (err) {
      console.error('Failed to fetch defaults:', err);
    }
  }, []);

  useEffect(() => {
    fetchModels();
    fetchDefaults();
  }, [fetchModels, fetchDefaults]);

  const handleToggleEnabled = async (modelId: string, isEnabled: boolean) => {
    try {
      await adminUpdateModel(modelId, { is_enabled: isEnabled });
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, is_enabled: isEnabled } : m))
      );
      toast.success(isEnabled ? 'Model enabled' : 'Model disabled');
    } catch (err) {
      console.error('Failed to toggle model:', err);
      toast.error('Failed to update model');
    }
  };

  const handleSaveModel = async (data: CreateModelRequest | UpdateModelRequest) => {
    try {
      if (editingModel) {
        const updated = await adminUpdateModel(editingModel.id, data);
        setModels((prev) => prev.map((m) => (m.id === editingModel.id ? updated : m)));
        toast.success('Model updated');
      } else {
        const created = await adminCreateModel(data as CreateModelRequest);
        setModels((prev) => [...prev, created]);
        toast.success('Model created');
      }
    } catch (err) {
      console.error('Failed to save model:', err);
      toast.error('Failed to save model');
      throw err;
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await adminDeleteModel(modelId);
      setModels((prev) => prev.filter((m) => m.id !== modelId));
      toast.success('Model deleted');
    } catch (err) {
      console.error('Failed to delete model:', err);
      toast.error('Failed to delete model');
    }
  };

  const handleSaveDefault = async (agentType: string, modelId: string) => {
    await adminUpdateAgentDefaults(agentType, { model_id: modelId });
  };

  const handleSeedModels = async () => {
    setSeeding(true);
    try {
      const result = await adminSeedModels();
      toast.success(`Seeded ${result.created} new models, updated ${result.updated} existing`);
      await fetchModels();
    } catch (err) {
      console.error('Failed to seed models:', err);
      toast.error('Failed to seed models');
    } finally {
      setSeeding(false);
    }
  };

  // Group models by family
  const modelsByFamily = models.reduce(
    (acc, model) => {
      const family = model.family || 'other';
      if (!acc[family]) acc[family] = [];
      acc[family].push(model);
      return acc;
    },
    {} as Record<string, AdminModel[]>
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">LLM Models</h1>
          <p className="text-text-muted mt-1">Manage available models and their settings</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSeedModels}
            disabled={seeding}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary transition-colors disabled:opacity-50"
            title="Seed default models"
          >
            {seeding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Seed Defaults
          </button>
          <button
            onClick={() => setShowDefaultsModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary transition-colors"
          >
            <Layers className="h-4 w-4" />
            Agent Defaults
          </button>
          <button
            onClick={() => {
              setEditingModel(null);
              setShowEditModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Model
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl border border-border-subtle p-6 animate-pulse"
            >
              <div className="h-6 bg-elevated rounded w-32 mb-2" />
              <div className="h-4 bg-elevated rounded w-48 mb-4" />
              <div className="space-y-2">
                <div className="h-4 bg-elevated rounded w-full" />
                <div className="h-4 bg-elevated rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(modelsByFamily)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([family, familyModels]) => (
              <div key={family}>
                <h2 className="text-lg font-medium text-text-primary mb-4 capitalize">
                  {family} Models
                  <span className="ml-2 text-sm text-text-muted">({familyModels.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {familyModels
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        onEdit={(m) => {
                          setEditingModel(m);
                          setShowEditModal(true);
                        }}
                        onToggleEnabled={handleToggleEnabled}
                        onDelete={handleDeleteModel}
                      />
                    ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {showEditModal && (
        <EditModelModal
          model={editingModel}
          onClose={() => {
            setShowEditModal(false);
            setEditingModel(null);
          }}
          onSave={handleSaveModel}
        />
      )}

      {showDefaultsModal && (
        <AgentDefaultsModal
          defaults={defaults}
          models={models}
          onClose={() => setShowDefaultsModal(false)}
          onSave={handleSaveDefault}
        />
      )}
    </div>
  );
}
