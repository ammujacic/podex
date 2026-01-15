'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Edit, Save, X, Key, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

// Confirmation dialog component to replace native confirm()
function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

interface EnvProfile {
  id: string;
  name: string;
  agent_type_id?: string;
  env_vars: Record<string, string>;
}

interface TerminalAgentType {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
}

export function ExternalAgentSettings() {
  const [profiles, setProfiles] = useState<EnvProfile[]>([]);
  const [agentTypes, setAgentTypes] = useState<TerminalAgentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingProfile, setEditingProfile] = useState<EnvProfile | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    agent_type_id: '',
    env_vars: {} as Record<string, string>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; profileId: string | null }>(
    {
      isOpen: false,
      profileId: null,
    }
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Use authenticated API client instead of raw fetch
      const [profilesData, agentTypesData] = await Promise.all([
        api.get<EnvProfile[]>('/terminal-agents/env-profiles'),
        api.get<TerminalAgentType[]>('/terminal-agents/terminal-agent-types'),
      ]);

      setProfiles(profilesData);
      setAgentTypes(agentTypesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Profile name is required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api.post('/terminal-agents/env-profiles', {
        name: formData.name,
        agent_type_id: formData.agent_type_id || null,
        env_vars: formData.env_vars,
      });

      await loadData();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingProfile || !formData.name.trim()) return;

    setSaving(true);
    setError(null);

    try {
      await api.put(`/terminal-agents/env-profiles/${editingProfile.id}`, {
        name: formData.name,
        agent_type_id: formData.agent_type_id || null,
        env_vars: formData.env_vars,
      });

      await loadData();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (profileId: string) => {
    setDeleteConfirm({ isOpen: true, profileId });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.profileId) return;

    try {
      await api.delete(`/terminal-agents/env-profiles/${deleteConfirm.profileId}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDeleteConfirm({ isOpen: false, profileId: null });
    }
  };

  const startEdit = (profile: EnvProfile) => {
    setEditingProfile(profile);
    setFormData({
      name: profile.name,
      agent_type_id: profile.agent_type_id || '',
      env_vars: { ...profile.env_vars },
    });
  };

  const resetForm = () => {
    setEditingProfile(null);
    setFormData({
      name: '',
      agent_type_id: '',
      env_vars: {},
    });
    setShowCreateForm(false);
  };

  const addEnvVar = () => {
    const newKey = `VAR_${Object.keys(formData.env_vars).length + 1}`;
    setFormData({
      ...formData,
      env_vars: {
        ...formData.env_vars,
        [newKey]: '',
      },
    });
  };

  const updateEnvVar = (key: string, value: string) => {
    setFormData({
      ...formData,
      env_vars: {
        ...formData.env_vars,
        [key]: value,
      },
    });
  };

  const removeEnvVar = (key: string) => {
    const newEnvVars = { ...formData.env_vars };
    delete newEnvVars[key];
    setFormData({
      ...formData,
      env_vars: newEnvVars,
    });
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-elevated rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-elevated rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">External Agent Profiles</h2>
          <p className="text-sm text-text-muted mt-1">
            Manage environment variables for terminal-integrated agents
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Profile
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete Profile"
        message="Are you sure you want to delete this profile? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm({ isOpen: false, profileId: null })}
      />

      {/* Create/Edit Form */}
      {(showCreateForm || editingProfile) && (
        <div className="p-6 bg-surface rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary">
              {editingProfile ? 'Edit Profile' : 'Create New Profile'}
            </h3>
            <button onClick={resetForm} className="p-1 hover:bg-overlay/30 rounded">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Profile Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., My OpenCode Setup"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Agent Type (Optional)
              </label>
              <select
                value={formData.agent_type_id}
                onChange={(e) => setFormData({ ...formData, agent_type_id: e.target.value })}
                className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Any agent type</option>
                {agentTypes.map((agentType) => (
                  <option key={agentType.id} value={agentType.id}>
                    {agentType.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Environment Variables */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-text-primary">
                Environment Variables
              </label>
              <button onClick={addEnvVar} className="text-sm text-blue-600 hover:text-blue-700">
                + Add Variable
              </button>
            </div>

            <div className="space-y-2">
              {Object.entries(formData.env_vars).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => {
                      const newKey = e.target.value;
                      const newEnvVars = { ...formData.env_vars };
                      delete newEnvVars[key];
                      newEnvVars[newKey] = value;
                      setFormData({ ...formData, env_vars: newEnvVars });
                    }}
                    className="flex-1 px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="VARIABLE_NAME"
                  />
                  <input
                    type="password"
                    value={value}
                    onChange={(e) => updateEnvVar(key, e.target.value)}
                    className="flex-1 px-3 py-2 border border-border-subtle rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="value (hidden)"
                  />
                  <button
                    onClick={() => removeEnvVar(key)}
                    aria-label={`Remove ${key} environment variable`}
                    className="p-2 text-red-400 hover:bg-red-500/10 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={resetForm}
              className="px-4 py-2 text-text-secondary hover:bg-overlay/30 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={editingProfile ? handleUpdate : handleCreate}
              disabled={saving || !formData.name.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : editingProfile ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Profiles List */}
      <div className="space-y-4">
        {profiles.map((profile) => (
          <div key={profile.id} className="p-4 bg-surface rounded-lg border border-border-subtle">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Key className="h-5 w-5 text-text-muted" />
                <div>
                  <h3 className="font-semibold text-text-primary">{profile.name}</h3>
                  {profile.agent_type_id && (
                    <p className="text-sm text-text-muted">
                      For:{' '}
                      {agentTypes.find((at) => at.id === profile.agent_type_id)?.name ||
                        'Unknown Agent'}
                    </p>
                  )}
                  <p className="text-xs text-text-muted mt-1">
                    {Object.keys(profile.env_vars).length} environment variables
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEdit(profile)}
                  aria-label={`Edit ${profile.name}`}
                  className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                >
                  <Edit className="h-4 w-4" />
                </button>

                <button
                  onClick={() => handleDeleteClick(profile.id)}
                  aria-label={`Delete ${profile.name}`}
                  className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {profiles.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            <Key className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No environment profiles yet.</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="mt-4 text-blue-600 hover:text-blue-700"
            >
              Create your first profile
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
