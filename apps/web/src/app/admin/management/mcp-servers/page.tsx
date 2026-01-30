'use client';

import { useEffect, useState, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  Plus,
  Edit2,
  Check,
  X,
  Plug,
  Trash2,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Terminal,
  Globe,
  Key,
  Shield,
  GitBranch,
  Brain,
  Sparkles,
  Chrome,
  Bug,
  Database,
  MessageSquare,
  Container,
  Zap,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';
import { useUser } from '@/stores/auth';
import { toast } from 'sonner';
import type {
  AdminDefaultMCPServer,
  CreateAdminMCPServerRequest,
  UpdateAdminMCPServerRequest,
} from '@/lib/api';

// Valid categories and transports
const CATEGORIES = [
  { value: 'version_control', label: 'Version Control' },
  { value: 'web', label: 'Web' },
  { value: 'memory', label: 'Memory' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'database', label: 'Database' },
  { value: 'communication', label: 'Communication' },
  { value: 'containers', label: 'Containers' },
];

const TRANSPORTS = [
  { value: 'stdio', label: 'stdio', description: 'Command-line process' },
  { value: 'sse', label: 'SSE', description: 'Server-Sent Events' },
  { value: 'http', label: 'HTTP', description: 'HTTP API' },
];

// Icon mapping for MCP servers
const ICON_MAP: Record<string, LucideIcon> = {
  github: GitBranch,
  brain: Brain,
  memory: Brain,
  sparkles: Sparkles,
  chrome: Chrome,
  puppeteer: Chrome,
  sentry: Bug,
  globe: Globe,
  fetch: Globe,
  'brave-search': Search,
  database: Database,
  postgres: Database,
  sqlite: Database,
  slack: MessageSquare,
  docker: Container,
  kubernetes: Container,
  'podex-skills': Zap,
  zap: Zap,
  plug: Plug,
  terminal: Terminal,
};

function getServerIcon(server: { icon?: string | null; slug: string }) {
  // First try the icon field
  if (server.icon) {
    // Check if it's an emoji (starts with emoji character)
    if (/^\p{Emoji}/u.test(server.icon)) {
      return null; // Return null to use emoji rendering
    }
    // Check if it's a known icon name
    const IconComponent = ICON_MAP[server.icon.toLowerCase()];
    if (IconComponent) {
      return IconComponent;
    }
  }
  // Fallback to slug-based icon
  const IconComponent = ICON_MAP[server.slug.toLowerCase()];
  return IconComponent || Plug;
}

// ============================================================================
// MCP Server Card Component
// ============================================================================

interface MCPServerCardProps {
  server: AdminDefaultMCPServer;
  isSuperAdmin: boolean;
  onEdit: (server: AdminDefaultMCPServer) => void;
  onToggleEnabled: (id: string) => void;
  onDelete: (id: string) => void;
}

function MCPServerCard({
  server,
  isSuperAdmin,
  onEdit,
  onToggleEnabled,
  onDelete,
}: MCPServerCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (server.is_system) {
      toast.error('System servers cannot be deleted. Disable them instead.');
      return;
    }
    if (!confirm(`Are you sure you want to delete "${server.name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete(server.id);
      toast.success(`Server "${server.name}" deleted`);
    } catch {
      toast.error('Failed to delete server');
    } finally {
      setIsDeleting(false);
    }
  };

  const getCategoryLabel = (category: string) => {
    const found = CATEGORIES.find((c) => c.value === category);
    return found ? found.label : category;
  };

  const getTransportIcon = () => {
    switch (server.transport) {
      case 'stdio':
        return <Terminal className="h-3 w-3" />;
      case 'sse':
      case 'http':
        return <Globe className="h-3 w-3" />;
      default:
        return <Plug className="h-3 w-3" />;
    }
  };

  const IconComponent = getServerIcon(server);
  const isEmoji = server.icon && /^\p{Emoji}/u.test(server.icon);

  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        server.is_enabled ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-accent-primary/10">
            {isEmoji ? (
              <span className="text-xl">{server.icon}</span>
            ) : IconComponent ? (
              <IconComponent className="w-5 h-5 text-accent-primary" />
            ) : (
              <Plug className="w-5 h-5 text-accent-primary" />
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{server.name}</h3>
            <p className="text-text-muted text-sm font-mono">{server.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(server)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Edit server"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleEnabled(server.id)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              server.is_enabled
                ? 'hover:bg-elevated text-green-500'
                : 'hover:bg-elevated text-red-500'
            )}
            title={server.is_enabled ? 'Disable server' : 'Enable server'}
          >
            {server.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          {isSuperAdmin && (
            <button
              onClick={handleDelete}
              disabled={isDeleting || server.is_system}
              className={cn(
                'p-2 rounded-lg transition-colors',
                server.is_system
                  ? 'opacity-30 cursor-not-allowed'
                  : 'hover:bg-red-500/10 text-text-muted hover:text-red-500'
              )}
              title={server.is_system ? 'System servers cannot be deleted' : 'Delete server'}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {server.description && (
        <p className="text-text-secondary text-sm mb-4">{server.description}</p>
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded-full flex items-center gap-1">
          {getTransportIcon()}
          {server.transport.toUpperCase()}
        </span>
        <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded-full">
          {getCategoryLabel(server.category)}
        </span>
        {server.is_builtin && (
          <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-full">
            Built-in
          </span>
        )}
        {server.is_system && (
          <span className="px-2 py-1 bg-slate-500/10 text-slate-400 text-xs rounded-full flex items-center gap-1">
            <Shield className="h-3 w-3" />
            System
          </span>
        )}
      </div>

      {/* Required Environment Variables */}
      {server.required_env && server.required_env.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Key className="h-3 w-3" />
            Required Environment Variables:
          </p>
          <div className="flex flex-wrap gap-1">
            {server.required_env.map((env) => (
              <span
                key={env}
                className="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded font-mono"
              >
                {env}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-4 text-sm">
        {server.docs_url && (
          <a
            href={server.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Docs
          </a>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
        <span>Sort order: {server.sort_order}</span>
        <span>Updated: {new Date(server.updated_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Array Input Component
// ============================================================================

interface ArrayInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

function ArrayInput({ label, values, onChange, placeholder }: ArrayInputProps) {
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim() && !values.includes(inputValue.trim())) {
      onChange([...values, inputValue.trim()]);
      setInputValue('');
    }
  };

  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-2">{label}</label>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-2 bg-accent-primary/10 text-accent-primary rounded-lg hover:bg-accent-primary/20 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((value, index) => (
            <span
              key={index}
              className="inline-flex items-center gap-1 px-2 py-1 bg-elevated rounded text-sm text-text-secondary"
            >
              <span className="font-mono">{value}</span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-text-muted hover:text-red-500 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MCP Server Form Modal
// ============================================================================

interface MCPServerFormModalProps {
  server: AdminDefaultMCPServer | null;
  onClose: () => void;
  onSave: (
    data: CreateAdminMCPServerRequest | UpdateAdminMCPServerRequest,
    isNew: boolean
  ) => Promise<void>;
}

function MCPServerFormModal({ server, onClose, onSave }: MCPServerFormModalProps) {
  const isNew = !server;
  const [formData, setFormData] = useState<CreateAdminMCPServerRequest>({
    slug: server?.slug || '',
    name: server?.name || '',
    description: server?.description || '',
    category: server?.category || 'productivity',
    transport: server?.transport || 'stdio',
    command: server?.command || '',
    args: server?.args || [],
    url: server?.url || '',
    env_vars: server?.env_vars || {},
    required_env: server?.required_env || [],
    optional_env: server?.optional_env || [],
    icon: server?.icon || '',
    is_builtin: server?.is_builtin || false,
    docs_url: server?.docs_url || '',
    sort_order: server?.sort_order || 100,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) {
        await onSave(formData, true);
      } else {
        // For updates, only send changed fields
        const updateData: UpdateAdminMCPServerRequest = {};
        if (formData.name !== server.name) updateData.name = formData.name;
        if (formData.description !== server.description)
          updateData.description = formData.description;
        if (formData.category !== server.category) updateData.category = formData.category;
        if (formData.transport !== server.transport) updateData.transport = formData.transport;
        if (formData.command !== server.command) updateData.command = formData.command;
        if (JSON.stringify(formData.args) !== JSON.stringify(server.args))
          updateData.args = formData.args;
        if (formData.url !== server.url) updateData.url = formData.url;
        if (JSON.stringify(formData.env_vars) !== JSON.stringify(server.env_vars))
          updateData.env_vars = formData.env_vars;
        if (JSON.stringify(formData.required_env) !== JSON.stringify(server.required_env))
          updateData.required_env = formData.required_env;
        if (JSON.stringify(formData.optional_env) !== JSON.stringify(server.optional_env))
          updateData.optional_env = formData.optional_env;
        if (formData.icon !== server.icon) updateData.icon = formData.icon;
        if (formData.is_builtin !== server.is_builtin) updateData.is_builtin = formData.is_builtin;
        if (formData.docs_url !== server.docs_url) updateData.docs_url = formData.docs_url;
        if (formData.sort_order !== server.sort_order) updateData.sort_order = formData.sort_order;

        await onSave(updateData, false);
      }
      onClose();
      toast.success(isNew ? 'MCP server created' : 'MCP server updated');
    } catch {
      toast.error('Failed to save MCP server');
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
            {isNew ? 'Add New MCP Server' : `Edit ${server.name}`}
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
                pattern="^[a-z0-9-]+$"
                placeholder="github-mcp"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary disabled:opacity-50"
              />
              <p className="text-xs text-text-muted mt-1">Lowercase letters, numbers, hyphens</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="GitHub"
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
              placeholder="GitHub integration for repository management"
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Category *
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Transport *
              </label>
              <select
                value={formData.transport}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    transport: e.target.value as 'stdio' | 'sse' | 'http',
                  })
                }
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              >
                {TRANSPORTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} - {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) })}
                min="0"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>

          {/* Transport-specific fields */}
          {formData.transport === 'stdio' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Command
                </label>
                <input
                  type="text"
                  value={formData.command || ''}
                  onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                  placeholder="npx"
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary font-mono"
                />
              </div>
              <ArrayInput
                label="Arguments"
                values={formData.args || []}
                onChange={(args) => setFormData({ ...formData, args })}
                placeholder="-y @modelcontextprotocol/server-github"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">URL</label>
              <input
                type="url"
                value={formData.url || ''}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="http://localhost:3002/mcp/sse"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary font-mono"
              />
            </div>
          )}

          {/* Environment Variables */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary">Environment Variables</h3>
            <ArrayInput
              label="Required Environment Variables"
              values={formData.required_env || []}
              onChange={(required_env) => setFormData({ ...formData, required_env })}
              placeholder="GITHUB_TOKEN"
            />
            <ArrayInput
              label="Optional Environment Variables"
              values={formData.optional_env || []}
              onChange={(optional_env) => setFormData({ ...formData, optional_env })}
              placeholder="GITHUB_ORG"
            />
          </div>

          {/* Additional Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Icon (emoji)
              </label>
              <input
                type="text"
                value={formData.icon || ''}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                placeholder="🔌"
                maxLength={4}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Documentation URL
              </label>
              <input
                type="url"
                value={formData.docs_url || ''}
                onChange={(e) => setFormData({ ...formData, docs_url: e.target.value })}
                placeholder="https://docs.example.com"
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              />
            </div>
          </div>

          {/* Flags */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_builtin}
                onChange={(e) => setFormData({ ...formData, is_builtin: e.target.checked })}
                className="w-4 h-4 rounded border-border-subtle bg-elevated text-accent-primary focus:ring-accent-primary"
              />
              <span className="text-sm text-text-secondary">
                Built-in (pre-installed on containers)
              </span>
            </label>
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
                  {isNew ? 'Create Server' : 'Save Changes'}
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

export default function MCPServersManagement() {
  useDocumentTitle('MCP Servers');
  const currentUser = useUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';
  const {
    mcpServers,
    mcpServersLoading,
    fetchMCPServers,
    createMCPServer,
    updateMCPServer,
    deleteMCPServer,
    toggleMCPServer,
    error,
  } = useAdminStore();

  const [editingServer, setEditingServer] = useState<AdminDefaultMCPServer | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  useEffect(() => {
    fetchMCPServers();
  }, [fetchMCPServers]);

  const handleToggleEnabled = useCallback(
    async (id: string) => {
      try {
        await toggleMCPServer(id);
        toast.success('Server status updated');
      } catch {
        toast.error('Failed to update server');
      }
    },
    [toggleMCPServer]
  );

  const handleSave = useCallback(
    async (data: CreateAdminMCPServerRequest | UpdateAdminMCPServerRequest, isNew: boolean) => {
      if (isNew) {
        await createMCPServer(data as CreateAdminMCPServerRequest);
      } else if (editingServer) {
        await updateMCPServer(editingServer.id, data as UpdateAdminMCPServerRequest);
      }
    },
    [editingServer, createMCPServer, updateMCPServer]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteMCPServer(id);
    },
    [deleteMCPServer]
  );

  const filteredServers = categoryFilter
    ? mcpServers.filter((s) => s.category === categoryFilter)
    : mcpServers;

  const uniqueCategories = [...new Set(mcpServers.map((s) => s.category))];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">MCP Server Catalog</h1>
          <p className="text-text-muted mt-1">
            Manage default MCP server configurations available to users
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchMCPServers()}
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
            Add Server
          </button>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setCategoryFilter(null)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-colors',
            categoryFilter === null
              ? 'bg-accent-primary text-white'
              : 'bg-elevated text-text-secondary hover:text-text-primary'
          )}
        >
          All ({mcpServers.length})
        </button>
        {uniqueCategories.map((cat) => {
          const count = mcpServers.filter((s) => s.category === cat).length;
          const label = CATEGORIES.find((c) => c.value === cat)?.label || cat;
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors',
                categoryFilter === cat
                  ? 'bg-accent-primary text-white'
                  : 'bg-elevated text-text-secondary hover:text-text-primary'
              )}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {mcpServersLoading ? (
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
      ) : filteredServers.length === 0 ? (
        <div className="text-center py-12">
          <Plug className="h-12 w-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-muted">No MCP servers found.</p>
          <p className="text-text-muted text-sm mt-1">
            Add an MCP server to make it available to users.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredServers.map((server) => (
            <MCPServerCard
              key={server.id}
              server={server}
              isSuperAdmin={isSuperAdmin}
              onEdit={setEditingServer}
              onToggleEnabled={handleToggleEnabled}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingServer && (
        <MCPServerFormModal
          server={editingServer}
          onClose={() => setEditingServer(null)}
          onSave={handleSave}
        />
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <MCPServerFormModal
          server={null}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
