'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Save,
  X,
  Wrench,
  FileText,
  Terminal,
  GitBranch,
  Shield,
  Rocket,
  Search,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface AgentTool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: string;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  is_read_operation: boolean;
  is_write_operation: boolean;
  is_command_operation: boolean;
  is_deploy_operation: boolean;
  created_at: string;
  updated_at: string;
}

interface CreateToolForm {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: string;
  sort_order: number;
  is_read_operation: boolean;
  is_write_operation: boolean;
  is_command_operation: boolean;
  is_deploy_operation: boolean;
}

const defaultForm: CreateToolForm = {
  name: '',
  description: '',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'custom',
  sort_order: 500,
  is_read_operation: true,
  is_write_operation: false,
  is_command_operation: false,
  is_deploy_operation: false,
};

const categoryIcons: Record<string, typeof Wrench> = {
  file: FileText,
  git: GitBranch,
  command: Terminal,
  search: Search,
  deploy: Rocket,
  default: Wrench,
};

const categoryColors: Record<string, string> = {
  file: 'bg-blue-500',
  git: 'bg-orange-500',
  command: 'bg-yellow-500',
  search: 'bg-purple-500',
  deploy: 'bg-red-500',
  delegation: 'bg-cyan-500',
  orchestration: 'bg-indigo-500',
  agent_builder: 'bg-pink-500',
  review: 'bg-green-500',
  testing: 'bg-emerald-500',
  web: 'bg-violet-500',
  memory: 'bg-amber-500',
  custom: 'bg-gray-500',
};

function getCategoryIcon(category: string): typeof Wrench {
  return categoryIcons[category] ?? categoryIcons.default ?? Wrench;
}

function getCategoryColor(category: string): string {
  return categoryColors[category] ?? categoryColors.custom ?? 'bg-gray-500';
}

function PermissionBadge({
  label,
  active,
  color,
}: {
  label: string;
  active: boolean;
  color: string;
}) {
  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded-full text-xs font-medium',
        active ? `${color} text-white` : 'bg-gray-100 text-gray-400'
      )}
    >
      {label}
    </span>
  );
}

export default function ToolsAdminPage() {
  useDocumentTitle('Agent Tools');
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTool, setEditingTool] = useState<AgentTool | null>(null);
  const [formData, setFormData] = useState<CreateToolForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await api.get<{ tools: AgentTool[]; total: number }>('/api/admin/tools');
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);

    try {
      await api.post('/api/admin/tools', formData);
      await loadData();
      setShowCreateForm(false);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (toolId: string) => {
    if (!editingTool) return;

    setSaving(true);
    setError(null);

    try {
      await api.put(`/api/admin/tools/${toolId}`, formData);
      await loadData();
      setEditingTool(null);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (toolId: string) => {
    if (!confirm('Are you sure you want to delete this tool?')) return;

    try {
      await api.delete(`/api/admin/tools/${toolId}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const toggleEnabled = async (tool: AgentTool) => {
    try {
      await api.put(`/api/admin/tools/${tool.id}`, {
        is_enabled: !tool.is_enabled,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const startEdit = (tool: AgentTool) => {
    setEditingTool(tool);
    setFormData({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      category: tool.category,
      sort_order: tool.sort_order,
      is_read_operation: tool.is_read_operation,
      is_write_operation: tool.is_write_operation,
      is_command_operation: tool.is_command_operation,
      is_deploy_operation: tool.is_deploy_operation,
    });
  };

  const cancelEdit = () => {
    setEditingTool(null);
    setFormData(defaultForm);
  };

  // Get unique categories for filter
  const categories = Array.from(new Set(tools.map((t) => t.category))).sort();

  // Filter tools
  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || tool.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Group by category
  const toolsByCategory = filteredTools.reduce<Record<string, AgentTool[]>>((acc, tool) => {
    const category = tool.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category]!.push(tool);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Agent Tools</h1>
        <p className="text-text-muted">
          Manage tools available to agents. Permission flags control behavior in different agent
          modes.
        </p>
      </div>

      {/* Header Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
        {/* Search and Filter */}
        <div className="flex items-center gap-3 flex-1 w-full md:w-auto">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-surface"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-surface appearance-none cursor-pointer"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl hover:from-blue-700 hover:to-blue-600 transition-all shadow-md hover:shadow-lg"
        >
          <Plus className="h-4 w-4" />
          Add Tool
        </button>
      </div>

      {/* Permission Legend */}
      <div className="mb-6 p-4 bg-surface rounded-xl border border-border-subtle">
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Permission Flags (Agent Mode Enforcement)
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-500 text-white">
              Read
            </span>
            <span className="text-text-muted">Allowed in Plan mode</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500 text-white">
              Write
            </span>
            <span className="text-text-muted">Approval in Ask, auto in Auto</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500 text-white">
              Command
            </span>
            <span className="text-text-muted">Allowlist or approval in Auto</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500 text-white">
              Deploy
            </span>
            <span className="text-text-muted">Always requires approval</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingTool) && (
        <div className="mb-6 p-6 bg-surface rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">
              {editingTool ? 'Edit Tool' : 'Create New Tool'}
            </h2>
            <button
              onClick={() => {
                setShowCreateForm(false);
                cancelEdit();
              }}
              className="p-1 hover:bg-overlay/30 rounded"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Tool Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!!editingTool}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="e.g., my_custom_tool"
              />
              <p className="text-xs text-text-muted mt-1">Lowercase, numbers, underscores only</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Category</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="custom">custom</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Description *
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="What does this tool do?"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Sort Order</label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) =>
                  setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Permission Flags */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-3">
              Permission Flags
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label
                className={cn(
                  'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                  formData.is_read_operation
                    ? 'border-green-500 bg-green-50'
                    : 'border-border-subtle hover:border-gray-300'
                )}
              >
                <input
                  type="checkbox"
                  checked={formData.is_read_operation}
                  onChange={(e) =>
                    setFormData({ ...formData, is_read_operation: e.target.checked })
                  }
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <div>
                  <div className="font-medium text-sm">Read</div>
                  <div className="text-xs text-text-muted">Plan mode</div>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                  formData.is_write_operation
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-border-subtle hover:border-gray-300'
                )}
              >
                <input
                  type="checkbox"
                  checked={formData.is_write_operation}
                  onChange={(e) =>
                    setFormData({ ...formData, is_write_operation: e.target.checked })
                  }
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <div className="font-medium text-sm">Write</div>
                  <div className="text-xs text-text-muted">File edits</div>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                  formData.is_command_operation
                    ? 'border-yellow-500 bg-yellow-50'
                    : 'border-border-subtle hover:border-gray-300'
                )}
              >
                <input
                  type="checkbox"
                  checked={formData.is_command_operation}
                  onChange={(e) =>
                    setFormData({ ...formData, is_command_operation: e.target.checked })
                  }
                  className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                />
                <div>
                  <div className="font-medium text-sm">Command</div>
                  <div className="text-xs text-text-muted">Shell exec</div>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors',
                  formData.is_deploy_operation
                    ? 'border-red-500 bg-red-50'
                    : 'border-border-subtle hover:border-gray-300'
                )}
              >
                <input
                  type="checkbox"
                  checked={formData.is_deploy_operation}
                  onChange={(e) =>
                    setFormData({ ...formData, is_deploy_operation: e.target.checked })
                  }
                  className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <div>
                  <div className="font-medium text-sm">Deploy</div>
                  <div className="text-xs text-text-muted">Always approval</div>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setShowCreateForm(false);
                cancelEdit();
              }}
              className="px-4 py-2 text-text-secondary hover:bg-overlay/30 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={editingTool ? () => handleUpdate(editingTool.id) : handleCreate}
              disabled={saving || !formData.name || !formData.description}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : editingTool ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Tools List by Category */}
      <div className="space-y-6">
        {Object.entries(toolsByCategory)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, categoryTools]) => {
            const Icon = getCategoryIcon(category);
            return (
              <div
                key={category}
                className="bg-surface rounded-xl border border-border-subtle overflow-hidden"
              >
                <div className="px-4 py-3 bg-elevated border-b border-border-subtle flex items-center gap-3">
                  <div className={cn('p-2 rounded-lg', getCategoryColor(category))}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <h2 className="font-semibold text-text-primary capitalize">{category}</h2>
                  <span className="text-sm text-text-muted">
                    {categoryTools.length} tool{categoryTools.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="divide-y divide-border-subtle">
                  {categoryTools
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((tool) => (
                      <div
                        key={tool.id}
                        className={cn(
                          'px-4 py-3 flex items-center gap-4 hover:bg-elevated/50 transition-colors',
                          !tool.is_enabled && 'opacity-50'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-medium text-text-primary">
                              {tool.name}
                            </span>
                            {tool.is_system && (
                              <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                                system
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-text-muted truncate">{tool.description}</p>
                        </div>

                        {/* Permission Badges */}
                        <div className="flex items-center gap-1.5">
                          <PermissionBadge
                            label="R"
                            active={tool.is_read_operation}
                            color="bg-green-500"
                          />
                          <PermissionBadge
                            label="W"
                            active={tool.is_write_operation}
                            color="bg-blue-500"
                          />
                          <PermissionBadge
                            label="C"
                            active={tool.is_command_operation}
                            color="bg-yellow-500"
                          />
                          <PermissionBadge
                            label="D"
                            active={tool.is_deploy_operation}
                            color="bg-red-500"
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => toggleEnabled(tool)}
                            className={cn(
                              'p-1.5 rounded-lg transition-colors',
                              tool.is_enabled
                                ? 'text-green-400 hover:bg-green-500/10'
                                : 'text-text-muted hover:bg-elevated'
                            )}
                            title={tool.is_enabled ? 'Disable tool' : 'Enable tool'}
                          >
                            {tool.is_enabled ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => startEdit(tool)}
                            className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                            title="Edit tool"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {!tool.is_system && (
                            <button
                              onClick={() => handleDelete(tool.id)}
                              className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete tool"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
      </div>

      {filteredTools.length === 0 && (
        <div className="text-center py-16 bg-surface rounded-2xl border border-border-subtle">
          <Wrench className="h-12 w-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-muted">
            {searchQuery || categoryFilter !== 'all'
              ? 'No tools match your filters.'
              : 'No agent tools configured yet.'}
          </p>
          {!searchQuery && categoryFilter === 'all' && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 text-blue-400 hover:text-blue-300"
            >
              Create your first tool
            </button>
          )}
        </div>
      )}
    </div>
  );
}
