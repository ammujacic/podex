'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Eye, EyeOff, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface TerminalAgentType {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
  is_enabled: boolean;
  check_installed_command?: string[];
  version_command?: string[];
  install_command?: string[];
  update_command?: string[];
  run_command: string[];
  default_env_template?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

interface CreateAgentTypeForm {
  name: string;
  slug: string;
  logo_url: string;
  description: string;
  check_installed_command: string[];
  version_command: string[];
  install_command: string[];
  update_command: string[];
  run_command: string[];
  default_env_template: Record<string, string>;
}

const defaultForm: CreateAgentTypeForm = {
  name: '',
  slug: '',
  logo_url: '',
  description: '',
  check_installed_command: [],
  version_command: [],
  install_command: [],
  update_command: [],
  run_command: [],
  default_env_template: {},
};

export default function TerminalAgentsAdminPage() {
  const [agentTypes, setAgentTypes] = useState<TerminalAgentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<TerminalAgentType | null>(null);
  const [formData, setFormData] = useState<CreateAgentTypeForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAgentTypes();
  }, []);

  const loadAgentTypes = async () => {
    try {
      const data = await api.get<TerminalAgentType[]>(
        '/api/terminal-agents/admin/terminal-agent-types'
      );
      setAgentTypes(data);
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
      await api.post('/api/terminal-agents/admin/terminal-agent-types', formData);
      await loadAgentTypes();
      setShowCreateForm(false);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (agentId: string) => {
    if (!editingAgent) return;

    setSaving(true);
    setError(null);

    try {
      await api.put(`/api/terminal-agents/admin/terminal-agent-types/${agentId}`, formData);
      await loadAgentTypes();
      setEditingAgent(null);
      setFormData(defaultForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agentId: string) => {
    if (!confirm('Are you sure you want to delete this agent type?')) return;

    try {
      await api.delete(`/api/terminal-agents/admin/terminal-agent-types/${agentId}`);
      await loadAgentTypes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const toggleEnabled = async (agent: TerminalAgentType) => {
    try {
      await api.put(`/api/terminal-agents/admin/terminal-agent-types/${agent.id}`, {
        is_enabled: !agent.is_enabled,
      });
      await loadAgentTypes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const startEdit = (agent: TerminalAgentType) => {
    setEditingAgent(agent);
    setFormData({
      name: agent.name,
      slug: agent.slug,
      logo_url: agent.logo_url || '',
      description: agent.description || '',
      check_installed_command: agent.check_installed_command || [],
      version_command: agent.version_command || [],
      install_command: agent.install_command || [],
      update_command: agent.update_command || [],
      run_command: agent.run_command || [],
      default_env_template: agent.default_env_template || {},
    });
  };

  const cancelEdit = () => {
    setEditingAgent(null);
    setFormData(defaultForm);
  };

  const updateCommandArray = (field: keyof CreateAgentTypeForm, value: string, index: number) => {
    if (!Array.isArray(formData[field])) return;

    const newArray = [...(formData[field] as string[])];
    newArray[index] = value;
    setFormData({ ...formData, [field]: newArray });
  };

  const addCommandItem = (field: keyof CreateAgentTypeForm) => {
    if (!Array.isArray(formData[field])) return;

    setFormData({
      ...formData,
      [field]: [...(formData[field] as string[]), ''],
    });
  };

  const removeCommandItem = (field: keyof CreateAgentTypeForm, index: number) => {
    if (!Array.isArray(formData[field])) return;

    const newArray = [...(formData[field] as string[])];
    newArray.splice(index, 1);
    setFormData({ ...formData, [field]: newArray });
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Terminal-Integrated Agents</h1>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Agent Type
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingAgent) && (
        <div className="mb-6 p-6 bg-surface rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">
              {editingAgent ? 'Edit Agent Type' : 'Create New Agent Type'}
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
              <label className="block text-sm font-medium text-text-primary mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., OpenCode"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Slug *</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., opencode"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text-primary mb-1">Logo URL</label>
              <input
                type="url"
                value={formData.logo_url}
                onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://example.com/logo.png"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-text-primary mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Brief description of the agent"
              />
            </div>
          </div>

          {/* Commands Section */}
          <div className="space-y-4">
            <h3 className="text-md font-semibold text-text-primary">Commands</h3>

            {/* Run Command */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Run Command *
              </label>
              {(formData.run_command || []).map((cmd, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={cmd}
                    onChange={(e) => updateCommandArray('run_command', e.target.value, index)}
                    className="flex-1 px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Command argument"
                  />
                  <button
                    onClick={() => removeCommandItem('run_command', index)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addCommandItem('run_command')}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                + Add command argument
              </button>
            </div>

            {/* Check Installed Command */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Check Installed Command
              </label>
              {(formData.check_installed_command || []).map((cmd, index) => (
                <div key={index} className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={cmd}
                    onChange={(e) =>
                      updateCommandArray('check_installed_command', e.target.value, index)
                    }
                    className="flex-1 px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Command argument"
                  />
                  <button
                    onClick={() => removeCommandItem('check_installed_command', index)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addCommandItem('check_installed_command')}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                + Add command argument
              </button>
            </div>

            {/* Other commands would follow the same pattern */}
          </div>

          <div className="flex justify-end gap-3 mt-6">
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
              onClick={editingAgent ? () => handleUpdate(editingAgent.id) : handleCreate}
              disabled={
                saving || !formData.name || !formData.slug || formData.run_command.length === 0
              }
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : editingAgent ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Agent Types List */}
      <div className="space-y-4">
        {agentTypes.map((agent) => (
          <div key={agent.id} className="p-4 bg-surface rounded-lg border border-border-subtle">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {agent.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- Dynamic external URL
                  <img src={agent.logo_url} alt={agent.name} className="w-8 h-8 rounded" />
                )}
                <div>
                  <h3 className="font-semibold text-text-primary">{agent.name}</h3>
                  <p className="text-sm text-text-muted">Slug: {agent.slug}</p>
                  {agent.description && (
                    <p className="text-sm text-text-secondary mt-1">{agent.description}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleEnabled(agent)}
                  className={cn(
                    'p-2 rounded-lg transition-colors',
                    agent.is_enabled
                      ? 'text-green-600 hover:bg-green-50'
                      : 'text-gray-400 hover:bg-gray-50'
                  )}
                >
                  {agent.is_enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>

                <button
                  onClick={() => startEdit(agent)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Edit className="h-4 w-4" />
                </button>

                <button
                  onClick={() => handleDelete(agent.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 text-xs text-text-muted">
              Created: {new Date(agent.created_at).toLocaleDateString()} | Updated:{' '}
              {new Date(agent.updated_at).toLocaleDateString()}
            </div>
          </div>
        ))}

        {agentTypes.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            <p>No terminal agent types configured yet.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 text-blue-600 hover:text-blue-700"
            >
              Create your first agent type
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
