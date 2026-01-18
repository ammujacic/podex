'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Check,
  X,
  Cloud,
  Trash2,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Zap,
  ImageIcon,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminLLMProvider } from '@/stores/admin';
import { toast } from 'sonner';

// ============================================================================
// Provider Card Component
// ============================================================================

interface ProviderCardProps {
  provider: AdminLLMProvider;
  onEdit: (provider: AdminLLMProvider) => void;
  onToggleEnabled: (slug: string, isEnabled: boolean) => void;
  onDelete: (slug: string) => void;
}

function ProviderCard({ provider, onEdit, onToggleEnabled, onDelete }: ProviderCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${provider.name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete(provider.slug);
      toast.success(`Provider "${provider.name}" deleted`);
    } catch {
      toast.error('Failed to delete provider');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        provider.is_enabled ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${provider.color}20` }}
          >
            {provider.logo_url ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={provider.logo_url} alt="" className="w-6 h-6" />
            ) : (
              <Cloud className="w-5 h-5" style={{ color: provider.color }} />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{provider.name}</h3>
            <p className="text-text-muted text-sm font-mono">{provider.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(provider)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Edit provider"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleEnabled(provider.slug, !provider.is_enabled)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              provider.is_enabled
                ? 'hover:bg-elevated text-green-500'
                : 'hover:bg-elevated text-red-500'
            )}
            title={provider.is_enabled ? 'Disable provider' : 'Enable provider'}
          >
            {provider.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 hover:bg-red-500/10 rounded-lg transition-colors text-text-muted hover:text-red-500"
            title="Delete provider"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {provider.description && (
        <p className="text-text-secondary text-sm mb-4">{provider.description}</p>
      )}

      {/* Capabilities */}
      <div className="flex flex-wrap gap-2 mb-4">
        {provider.supports_streaming && (
          <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded-full flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Streaming
          </span>
        )}
        {provider.supports_tools && (
          <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded-full flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            Tools
          </span>
        )}
        {provider.supports_vision && (
          <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded-full flex items-center gap-1">
            <ImageIcon className="h-3 w-3" />
            Vision
          </span>
        )}
        {provider.is_local && (
          <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-full">
            Local
          </span>
        )}
        {provider.requires_api_key && (
          <span className="px-2 py-1 bg-red-500/10 text-red-400 text-xs rounded-full">
            API Key Required
          </span>
        )}
      </div>

      {/* Links */}
      <div className="flex gap-4 text-sm">
        {provider.docs_url && (
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Docs
          </a>
        )}
        {provider.setup_guide_url && (
          <a
            href={provider.setup_guide_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Setup Guide
          </a>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
        <span>Sort order: {provider.sort_order}</span>
        <span>Updated: {new Date(provider.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Provider Form Modal
// ============================================================================

interface ProviderFormModalProps {
  provider: AdminLLMProvider | null;
  onClose: () => void;
  onSave: (data: Partial<AdminLLMProvider>) => Promise<void>;
}

function ProviderFormModal({ provider, onClose, onSave }: ProviderFormModalProps) {
  const isNew = !provider;
  const [formData, setFormData] = useState<Partial<AdminLLMProvider>>({
    slug: provider?.slug || '',
    name: provider?.name || '',
    description: provider?.description || '',
    icon: provider?.icon || '',
    color: provider?.color || '#6366f1',
    is_local: provider?.is_local || false,
    default_url: provider?.default_url || '',
    docs_url: provider?.docs_url || '',
    setup_guide_url: provider?.setup_guide_url || '',
    requires_api_key: provider?.requires_api_key ?? true,
    supports_streaming: provider?.supports_streaming ?? true,
    supports_tools: provider?.supports_tools ?? true,
    supports_vision: provider?.supports_vision ?? false,
    is_enabled: provider?.is_enabled ?? true,
    sort_order: provider?.sort_order || 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      onClose();
      toast.success(isNew ? 'Provider created' : 'Provider updated');
    } catch {
      toast.error('Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface rounded-xl border border-border-default shadow-xl">
        <div className="sticky top-0 bg-surface border-b border-border-subtle px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {isNew ? 'Add New Provider' : `Edit ${provider.name}`}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-elevated rounded-lg transition-colors">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Slug *</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                disabled={!isNew}
                required
                placeholder="anthropic"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Anthropic"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Description
            </label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              placeholder="Claude models - Opus, Sonnet, Haiku"
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-10 h-10 rounded-lg cursor-pointer"
                />
                <input
                  type="text"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary font-mono text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Icon (Lucide name)
              </label>
              <input
                type="text"
                value={formData.icon || ''}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="cloud"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>

          {/* URLs */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary">URLs</h3>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Default API URL</label>
                <input
                  type="url"
                  value={formData.default_url || ''}
                  onChange={(e) => setFormData({ ...formData, default_url: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Documentation URL</label>
                <input
                  type="url"
                  value={formData.docs_url || ''}
                  onChange={(e) => setFormData({ ...formData, docs_url: e.target.value })}
                  placeholder="https://docs.example.com"
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Setup Guide URL</label>
                <input
                  type="url"
                  value={formData.setup_guide_url || ''}
                  onChange={(e) => setFormData({ ...formData, setup_guide_url: e.target.value })}
                  placeholder="https://example.com/setup"
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary">Capabilities</h3>
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: 'is_local', label: 'Local Provider' },
                { key: 'requires_api_key', label: 'Requires API Key' },
                { key: 'supports_streaming', label: 'Supports Streaming' },
                { key: 'supports_tools', label: 'Supports Tools' },
                { key: 'supports_vision', label: 'Supports Vision' },
                { key: 'is_enabled', label: 'Enabled' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData[key as keyof typeof formData] as boolean}
                    onChange={(e) => setFormData({ ...formData, [key]: e.target.checked })}
                    className="w-4 h-4 rounded border-border-subtle bg-elevated text-accent-primary focus:ring-accent-primary"
                  />
                  <span className="text-sm text-text-secondary">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-elevated rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {isNew ? 'Create Provider' : 'Save Changes'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function ProvidersManagement() {
  const {
    providers,
    providersLoading,
    fetchProviders,
    updateProvider,
    createProvider,
    deleteProvider,
    error,
  } = useAdminStore();

  const [editingProvider, setEditingProvider] = useState<AdminLLMProvider | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleToggleEnabled = useCallback(
    async (slug: string, isEnabled: boolean) => {
      try {
        await updateProvider(slug, { is_enabled: isEnabled });
        toast.success(`Provider ${isEnabled ? 'enabled' : 'disabled'}`);
      } catch {
        toast.error('Failed to update provider');
      }
    },
    [updateProvider]
  );

  const handleSave = useCallback(
    async (data: Partial<AdminLLMProvider>) => {
      if (editingProvider) {
        await updateProvider(editingProvider.slug, data);
      } else {
        await createProvider(data as AdminLLMProvider);
      }
    },
    [editingProvider, updateProvider, createProvider]
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">LLM Providers</h1>
          <p className="text-text-muted mt-1">
            Manage LLM provider configurations and capabilities
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchProviders()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Provider
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {providersLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl border border-border-subtle p-6 animate-pulse"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-elevated rounded-lg" />
                <div>
                  <div className="h-5 bg-elevated rounded w-24 mb-2" />
                  <div className="h-4 bg-elevated rounded w-16" />
                </div>
              </div>
              <div className="h-4 bg-elevated rounded w-full mb-4" />
              <div className="flex gap-2">
                <div className="h-6 bg-elevated rounded-full w-20" />
                <div className="h-6 bg-elevated rounded-full w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : providers.length === 0 ? (
        <div className="text-center py-12">
          <Cloud className="h-12 w-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-muted">No LLM providers configured yet.</p>
          <p className="text-text-muted text-sm mt-1">
            Add a provider to get started with LLM integrations.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.slug}
              provider={provider}
              onEdit={setEditingProvider}
              onToggleEnabled={handleToggleEnabled}
              onDelete={deleteProvider}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal
          provider={editingProvider}
          onClose={() => setEditingProvider(null)}
          onSave={handleSave}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <ProviderFormModal
          provider={null}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
