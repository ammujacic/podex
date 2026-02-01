'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Bot,
  Share2,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listAgentTemplates,
  createAgentTemplate,
  updateAgentTemplate,
  deleteAgentTemplate,
  createShareLink,
  getLLMProviders,
  getAvailableAgentTools,
  type AgentTemplate,
  type CreateAgentTemplateRequest,
  type LLMProviderResponse,
  type ToolInfo,
} from '@/lib/api';

interface TemplateForm {
  name: string;
  slug: string;
  description: string;
  icon: string;
  system_prompt: string;
  allowed_tools: string[];
  model: string;
  temperature: number | null;
  max_tokens: number | null;
}

const defaultForm: TemplateForm = {
  name: '',
  slug: '',
  description: '',
  icon: '',
  system_prompt: '',
  allowed_tools: ['read_file', 'write_file', 'run_command'],
  model: '',
  temperature: null,
  max_tokens: null,
};

export default function AgentTemplatesPage() {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [providers, setProviders] = useState<LLMProviderResponse[]>([]);
  const [toolsByCategory, setToolsByCategory] = useState<Record<string, ToolInfo[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AgentTemplate | null>(null);
  const [formData, setFormData] = useState<TemplateForm>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState(false);

  // Share state
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Get sorted tool categories
  const toolCategories = useMemo(() => {
    return Object.keys(toolsByCategory).sort();
  }, [toolsByCategory]);

  // Get all available models from providers
  const availableModels = useMemo(() => {
    const models: { id: string; name: string; provider: string }[] = [];
    for (const provider of providers) {
      for (const modelId of provider.available_models) {
        models.push({
          id: modelId,
          name: modelId,
          provider: provider.name,
        });
      }
    }
    return models;
  }, [providers]);

  const loadData = useCallback(async () => {
    try {
      const [templatesData, providersData, toolsData] = await Promise.all([
        listAgentTemplates(),
        getLLMProviders(),
        getAvailableAgentTools(),
      ]);
      setTemplates(templatesData);
      setProviders(providersData);
      setToolsByCategory(toolsData.tools_by_category);

      // Set default model if not set
      if (!formData.model && providersData.length > 0) {
        const firstProvider = providersData[0];
        const defaultModel =
          firstProvider?.default_model || firstProvider?.available_models?.[0] || '';
        if (defaultModel) {
          setFormData((prev) => ({ ...prev, model: defaultModel }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      slug: editingTemplate ? formData.slug : generateSlug(name),
    });
  };

  const handleCreate = async () => {
    if (!formData.name || !formData.system_prompt || !formData.model) {
      setError('Name, system prompt, and model are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const data: CreateAgentTemplateRequest = {
        name: formData.name,
        slug: formData.slug || generateSlug(formData.name),
        description: formData.description || undefined,
        icon: formData.icon || undefined,
        system_prompt: formData.system_prompt,
        allowed_tools: formData.allowed_tools,
        model: formData.model,
        temperature: formData.temperature ?? undefined,
        max_tokens: formData.max_tokens ?? undefined,
      };
      await createAgentTemplate(data);
      await loadData();
      setShowCreateForm(false);
      setFormData({ ...defaultForm, model: formData.model });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create template');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingTemplate) return;

    setSaving(true);
    setError(null);

    try {
      await updateAgentTemplate(editingTemplate.id, {
        name: formData.name,
        description: formData.description || undefined,
        icon: formData.icon || undefined,
        system_prompt: formData.system_prompt,
        allowed_tools: formData.allowed_tools,
        model: formData.model,
        temperature: formData.temperature ?? undefined,
        max_tokens: formData.max_tokens ?? undefined,
      });
      await loadData();
      setEditingTemplate(null);
      setFormData({ ...defaultForm, model: formData.model });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this agent template?')) return;

    try {
      await deleteAgentTemplate(templateId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  const startEdit = (template: AgentTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      slug: template.slug,
      description: template.description || '',
      icon: template.icon || '',
      system_prompt: template.system_prompt,
      allowed_tools: template.allowed_tools,
      model: template.model,
      temperature: template.temperature,
      max_tokens: template.max_tokens,
    });
    setExpandedTools(true);
  };

  const cancelEdit = () => {
    setEditingTemplate(null);
    setShowCreateForm(false);
    setFormData({ ...defaultForm, model: formData.model });
    setError(null);
  };

  const toggleTool = (toolName: string) => {
    if (formData.allowed_tools.includes(toolName)) {
      setFormData({
        ...formData,
        allowed_tools: formData.allowed_tools.filter((t) => t !== toolName),
      });
    } else {
      setFormData({
        ...formData,
        allowed_tools: [...formData.allowed_tools, toolName],
      });
    }
  };

  const handleShare = async (template: AgentTemplate) => {
    if (sharingId === template.id) {
      setSharingId(null);
      setShareUrl(null);
      return;
    }

    setSharingId(template.id);
    setShareCopied(false);

    if (template.share_token) {
      setShareUrl(`${window.location.origin}/agents/shared/${template.share_token}`);
    } else {
      try {
        const result = await createShareLink(template.id);
        setShareUrl(`${window.location.origin}${result.share_url}`);
        await loadData();
      } catch (err) {
        console.error('Failed to generate share link:', err);
      }
    }
  };

  const copyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Custom Agent Templates</h1>
            <p className="text-text-muted mt-1">
              Create and manage your custom AI agents. These appear in the &quot;Add Agent&quot;
              menu.
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreateForm(true);
              setExpandedTools(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-accent-primary text-text-inverse rounded-lg hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Template
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Create/Edit Form */}
      {(showCreateForm || editingTemplate) && (
        <div className="mb-6 p-6 bg-surface rounded-xl border border-border-subtle">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-primary/10">
                <Sparkles className="h-5 w-5 text-accent-primary" />
              </div>
              <h2 className="text-lg font-semibold text-text-primary">
                {editingTemplate ? 'Edit Template' : 'Create New Agent Template'}
              </h2>
            </div>
            <button
              onClick={cancelEdit}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Name & Slug */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none"
                  placeholder="e.g., React Expert"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Slug</label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  disabled={!!editingTemplate}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-50"
                  placeholder="react-expert"
                />
              </div>
            </div>

            {/* Description & Icon */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none"
                  placeholder="Brief description of what this agent does"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Icon (emoji)
                </label>
                <input
                  type="text"
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none"
                  placeholder="e.g., "
                />
              </div>
            </div>

            {/* Model Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Model *
                </label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none"
                >
                  <option value="">Select a model</option>
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={formData.temperature ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      temperature: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:outline-none"
                  placeholder="0.7 (default)"
                />
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                System Prompt *
              </label>
              <textarea
                value={formData.system_prompt}
                onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary font-mono text-sm focus:border-accent-primary focus:outline-none resize-y"
                placeholder="You are an expert..."
              />
            </div>

            {/* Tools Selection */}
            <div>
              <button
                type="button"
                onClick={() => setExpandedTools(!expandedTools)}
                className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2 hover:text-text-primary"
              >
                {expandedTools ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                Tools ({formData.allowed_tools.length} selected)
              </button>

              {expandedTools && (
                <div className="space-y-4 p-4 bg-elevated rounded-lg border border-border-subtle">
                  {/* Permission badge legend */}
                  <div className="flex items-center gap-4 text-xs text-text-muted pb-3 border-b border-border-subtle">
                    <span>Permission badges:</span>
                    <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded font-mono">
                      R
                    </span>
                    <span>Read</span>
                    <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-mono">
                      W
                    </span>
                    <span>Write</span>
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded font-mono">
                      C
                    </span>
                    <span>Command</span>
                    <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-mono">
                      D
                    </span>
                    <span>Deploy</span>
                  </div>
                  {toolCategories.map((category) => {
                    const categoryTools = toolsByCategory[category] || [];
                    if (categoryTools.length === 0) return null;

                    return (
                      <div key={category}>
                        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                          {category}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                          {categoryTools.map((tool) => (
                            <button
                              key={tool.name}
                              type="button"
                              onClick={() => toggleTool(tool.name)}
                              title={tool.description}
                              className={cn(
                                'p-2 text-left rounded-lg border transition-colors text-sm',
                                formData.allowed_tools.includes(tool.name)
                                  ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                                  : 'border-border-subtle hover:border-border-default text-text-secondary'
                              )}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <div className="font-medium truncate">{tool.name}</div>
                                <div className="flex gap-0.5 flex-shrink-0">
                                  {tool.is_read_operation && (
                                    <span className="px-1 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded font-mono">
                                      R
                                    </span>
                                  )}
                                  {tool.is_write_operation && (
                                    <span className="px-1 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded font-mono">
                                      W
                                    </span>
                                  )}
                                  {tool.is_command_operation && (
                                    <span className="px-1 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded font-mono">
                                      C
                                    </span>
                                  )}
                                  {tool.is_deploy_operation && (
                                    <span className="px-1 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded font-mono">
                                      D
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-text-muted truncate">
                                {tool.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
              <button
                onClick={cancelEdit}
                className="px-4 py-2 text-text-secondary hover:bg-elevated rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editingTemplate ? handleUpdate : handleCreate}
                disabled={saving || !formData.name || !formData.system_prompt || !formData.model}
                className="flex items-center gap-2 px-4 py-2 bg-accent-primary text-text-inverse rounded-lg hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {editingTemplate ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Templates List */}
      {templates.length === 0 && !showCreateForm ? (
        <div className="text-center py-16 bg-surface rounded-xl border border-border-subtle">
          <Bot className="h-12 w-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">No Custom Agents Yet</h3>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            Create your own AI agents with custom system prompts, tools, and behaviors. They&apos;ll
            appear in the &quot;Add Agent&quot; menu.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-accent-primary text-text-inverse rounded-lg hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Your First Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="p-4 bg-surface rounded-xl border border-border-subtle hover:border-border-default transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-xl">
                  {template.icon || ''}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-text-primary truncate">{template.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-elevated text-text-muted">
                      {template.slug}
                    </span>
                  </div>
                  {template.description && (
                    <p className="text-sm text-text-secondary mt-1 line-clamp-1">
                      {template.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                    <span>{template.allowed_tools.length} tools</span>
                    <span>{template.model}</span>
                    <span>{template.usage_count} uses</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleShare(template)}
                    className={cn(
                      'p-2 rounded-lg transition-colors',
                      sharingId === template.id
                        ? 'bg-accent-primary/10 text-accent-primary'
                        : 'text-text-muted hover:bg-elevated hover:text-text-primary'
                    )}
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => startEdit(template)}
                    className="p-2 text-text-muted hover:bg-elevated hover:text-text-primary rounded-lg transition-colors"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="p-2 text-text-muted hover:bg-red-500/10 hover:text-red-400 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Share Panel */}
              {sharingId === template.id && shareUrl && (
                <div className="mt-4 p-4 bg-elevated rounded-lg border border-border-subtle">
                  <div className="flex items-center gap-2 mb-2">
                    <Share2 className="h-4 w-4 text-accent-primary" />
                    <span className="text-sm font-medium text-text-primary">Share Link</span>
                  </div>
                  <p className="text-xs text-text-muted mb-3">
                    Anyone with this link can preview and clone this agent.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      className="flex-1 px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-secondary"
                    />
                    <button
                      onClick={copyShareUrl}
                      className="px-3 py-2 bg-accent-primary text-text-inverse rounded-lg text-sm hover:bg-accent-primary/90 transition-colors flex items-center gap-1"
                    >
                      {shareCopied ? (
                        <>
                          <Check className="h-3 w-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs text-accent-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Preview share page
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tip */}
      <div className="mt-8 p-4 bg-surface rounded-xl border border-border-subtle">
        <div className="flex items-start gap-3">
          <Bot className="h-5 w-5 text-accent-primary flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-1">
              Pro Tip: Use the Agent Builder
            </h4>
            <p className="text-sm text-text-muted">
              You can also create agents conversationally using the <strong>Agent Builder</strong>{' '}
              in any session. Just add the Agent Builder agent and describe what kind of agent you
              want to create.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
