'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wand2,
  Plus,
  Trash2,
  Search,
  RefreshCw,
  Tag,
  Loader2,
  AlertTriangle,
  X,
  Play,
  Edit3,
  Download,
  Upload,
  Sparkles,
  Zap,
  Code,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface SkillStep {
  action: string;
  description: string;
  tool?: string;
  parameters?: Record<string, unknown>;
}

interface Skill {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  triggers: string[];
  tags: string[];
  required_tools: string[];
  steps: SkillStep[];
  system_prompt: string | null;
  generated_by_agent: boolean;
  source_conversation_id: string | null;
  is_public: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface SkillStats {
  total_skills: number;
  total_executions: number;
  agent_generated: number;
  user_created: number;
  public_skills: number;
  by_tag: Record<string, number>;
  most_used: { name: string; slug: string; usage_count: number }[];
}

// ============================================================================
// Skill Card
// ============================================================================

function SkillCard({
  skill,
  onDelete,
  onEdit,
  onExport,
  isDeleting,
}: {
  skill: Skill;
  onDelete: (id: string) => void;
  onEdit: (skill: Skill) => void;
  onExport: (id: string) => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyTrigger = async () => {
    const firstTrigger = skill.triggers[0];
    if (firstTrigger) {
      await navigator.clipboard.writeText(firstTrigger);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-surface border border-border-default rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-medium text-text-primary">{skill.name}</h3>
            <span className="text-xs text-text-muted">v{skill.version}</span>
            {skill.generated_by_agent && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-purple-500/20 text-purple-400">
                <Sparkles className="w-3 h-3" />
                Agent Generated
              </span>
            )}
            {skill.is_public && (
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-500/20 text-green-400">
                Public
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted mb-3">{skill.description}</p>

          {/* Tags */}
          {skill.tags.length > 0 && (
            <div className="flex items-center gap-1 mb-3">
              <Tag className="w-3 h-3 text-text-muted" />
              <div className="flex flex-wrap gap-1">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 text-xs rounded bg-surface-hover text-text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Triggers */}
          {skill.triggers.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3 h-3 text-yellow-400" />
              <code className="text-xs bg-surface-hover px-2 py-0.5 rounded text-text-primary">
                {skill.triggers[0]}
              </code>
              {skill.triggers.length > 1 && (
                <span className="text-xs text-text-muted">+{skill.triggers.length - 1} more</span>
              )}
              <button
                onClick={copyTrigger}
                className="p-1 hover:bg-surface-hover rounded"
                title="Copy trigger"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3 text-text-muted" />
                )}
              </button>
            </div>
          )}

          {/* Usage Stats */}
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Play className="w-3 h-3" />
              {skill.usage_count} executions
            </span>
            <span>{skill.steps.length} steps</span>
            {skill.required_tools.length > 0 && (
              <span className="flex items-center gap-1">
                <Code className="w-3 h-3" />
                {skill.required_tools.length} tools
              </span>
            )}
          </div>

          {/* Expanded Details */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-3 text-xs text-accent-primary hover:text-accent-primary/80"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> Hide steps
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show steps
              </>
            )}
          </button>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-border-subtle">
              <h4 className="text-xs font-medium text-text-muted mb-2">Steps:</h4>
              <ol className="space-y-2">
                {skill.steps.map((step, idx) => (
                  <li key={idx} className="flex gap-2 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-surface-hover text-xs text-text-muted">
                      {idx + 1}
                    </span>
                    <div>
                      <span className="text-text-primary">{step.action}</span>
                      {step.tool && (
                        <span className="ml-2 text-xs text-accent-primary">using {step.tool}</span>
                      )}
                      {step.description && (
                        <p className="text-xs text-text-muted mt-0.5">{step.description}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              {skill.system_prompt && (
                <div className="mt-3">
                  <h4 className="text-xs font-medium text-text-muted mb-1">System Prompt:</h4>
                  <pre className="text-xs bg-surface-hover p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {skill.system_prompt}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onExport(skill.id)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Export skill"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => onEdit(skill)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Edit skill"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(skill.id)}
            disabled={isDeleting}
            className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors disabled:opacity-50"
            title="Delete skill"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stats Card
// ============================================================================

function StatsCard({ stats }: { stats: SkillStats | null }) {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Wand2 className="w-4 h-4" />
          <span className="text-xs">Total Skills</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">{stats.total_skills}</p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Play className="w-4 h-4" />
          <span className="text-xs">Total Executions</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">{stats.total_executions}</p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs">Agent Generated</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">{stats.agent_generated}</p>
      </div>
      <div className="bg-surface border border-border-default rounded-lg p-4">
        <div className="flex items-center gap-2 text-text-muted mb-1">
          <Code className="w-4 h-4" />
          <span className="text-xs">User Created</span>
        </div>
        <p className="text-2xl font-semibold text-text-primary">{stats.user_created}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Create/Edit Skill Modal
// ============================================================================

function SkillEditor({
  skill,
  onSave,
  onClose,
  isSaving,
}: {
  skill: Skill | null;
  onSave: (data: Partial<Skill>) => Promise<void>;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(skill?.name || '');
  const [slug, setSlug] = useState(skill?.slug || '');
  const [description, setDescription] = useState(skill?.description || '');
  const [triggers, setTriggers] = useState(skill?.triggers.join(', ') || '');
  const [tags, setTags] = useState(skill?.tags.join(', ') || '');
  const [stepsJson, setStepsJson] = useState(
    skill?.steps ? JSON.stringify(skill.steps, null, 2) : '[]'
  );
  const [systemPrompt, setSystemPrompt] = useState(skill?.system_prompt || '');
  const [isPublic, setIsPublic] = useState(skill?.is_public || false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let steps: SkillStep[];
    try {
      steps = JSON.parse(stepsJson);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON for steps');
      return;
    }

    await onSave({
      name,
      slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
      description,
      triggers: triggers
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      steps,
      system_prompt: systemPrompt || null,
      is_public: isPublic,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border-default rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-text-primary">
            {skill ? 'Edit Skill' : 'Create Skill'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto max-h-[calc(90vh-8rem)]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  placeholder="Code Review"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  placeholder="code-review"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">
                Description *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                rows={2}
                className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary resize-none"
                placeholder="Performs a comprehensive code review..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">
                  Triggers (comma-separated)
                </label>
                <input
                  type="text"
                  value={triggers}
                  onChange={(e) => setTriggers(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  placeholder="review this, check my code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  placeholder="code-quality, review"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">
                Steps (JSON) *
              </label>
              <textarea
                value={stepsJson}
                onChange={(e) => setStepsJson(e.target.value)}
                rows={8}
                className={cn(
                  'w-full px-3 py-2 bg-surface border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 resize-none',
                  jsonError
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-border-default focus:ring-accent-primary'
                )}
                placeholder='[{"action": "Read file", "description": "...", "tool": "read_file"}]'
              />
              {jsonError && <p className="text-xs text-red-400 mt-1">{jsonError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">
                System Prompt (optional)
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary resize-none"
                placeholder="You are a code review expert..."
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_public"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="rounded border-border-default"
              />
              <label htmlFor="is_public" className="text-sm text-text-muted">
                Make this skill public (visible to all users)
              </label>
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-default">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Plus className="w-4 h-4 mr-1" />
            )}
            {skill ? 'Save Changes' : 'Create Skill'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Import Modal
// ============================================================================

function ImportModal({
  onImport,
  onClose,
  isImporting,
}: {
  onImport: (data: string) => Promise<void>;
  onClose: () => void;
  isImporting: boolean;
}) {
  const [importData, setImportData] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    try {
      JSON.parse(importData); // Validate JSON
      setError(null);
      await onImport(importData);
    } catch {
      setError('Invalid JSON format');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border-default rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-text-primary">Import Skill</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4">
          <label className="block text-sm font-medium text-text-muted mb-1">
            Paste skill JSON or YAML
          </label>
          <textarea
            value={importData}
            onChange={(e) => setImportData(e.target.value)}
            rows={12}
            className={cn(
              'w-full px-3 py-2 bg-surface border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 resize-none',
              error
                ? 'border-red-500 focus:ring-red-500'
                : 'border-border-default focus:ring-accent-primary'
            )}
            placeholder='{"name": "My Skill", "slug": "my-skill", ...}'
          />
          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-default">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isImporting || !importData}>
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Upload className="w-4 h-4 mr-1" />
            )}
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showEditor, setShowEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const fetchSkills = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '20',
      });
      if (searchQuery) params.set('search', searchQuery);
      if (selectedTag) params.set('tag', selectedTag);

      const response = await fetch(`/api/v1/skills?${params}`);
      if (!response.ok) throw new Error('Failed to fetch skills');
      const data = await response.json();
      setSkills(data.skills);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    }
  }, [page, searchQuery, selectedTag]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/skills/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      const data = await response.json();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      await Promise.all([fetchSkills(), fetchStats()]);
      setIsLoading(false);
    };
    load();
  }, [fetchSkills, fetchStats]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/v1/skills/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete skill');
      setSkills((prev) => prev.filter((s) => s.id !== id));
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setShowEditor(true);
  };

  const handleExport = async (id: string) => {
    try {
      const response = await fetch(`/api/v1/skills/${id}/export`);
      if (!response.ok) throw new Error('Failed to export skill');
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.slug}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export skill');
    }
  };

  const handleSave = async (data: Partial<Skill>) => {
    setIsSaving(true);
    try {
      const url = editingSkill ? `/api/v1/skills/${editingSkill.id}` : '/api/v1/skills';
      const method = editingSkill ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save skill');
      }

      setShowEditor(false);
      setEditingSkill(null);
      fetchSkills();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async (jsonData: string) => {
    setIsImporting(true);
    try {
      const data = JSON.parse(jsonData);
      const response = await fetch('/api/v1/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to import skill');
      }

      setShowImport(false);
      fetchSkills();
      fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import skill');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchSkills();
  };

  const allTags = stats ? Object.keys(stats.by_tag) : [];

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Wand2 className="w-6 h-6" />
          Agent Skills
        </h1>
        <p className="text-text-muted mt-1">Create and manage reusable skills for your AI agents</p>
      </div>

      {/* Stats */}
      <StatsCard stats={stats} />

      {/* Actions Bar */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
          />
        </form>

        {allTags.length > 0 && (
          <select
            value={selectedTag || ''}
            onChange={(e) => {
              setSelectedTag(e.target.value || null);
              setPage(1);
            }}
            className="px-3 py-2 bg-surface border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
          >
            <option value="">All Tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag} ({stats?.by_tag[tag]})
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              fetchSkills();
              fetchStats();
            }}
            variant="outline"
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => setShowImport(true)} variant="outline" className="gap-2">
            <Upload className="w-4 h-4" />
            Import
          </Button>
          <Button
            onClick={() => {
              setEditingSkill(null);
              setShowEditor(true);
            }}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Create
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Skills List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          <span className="ml-2 text-text-muted">Loading skills...</span>
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-12">
          <Wand2 className="w-12 h-12 mx-auto text-text-muted opacity-30 mb-4" />
          <p className="text-text-muted">No skills found</p>
          <p className="text-sm text-text-muted mt-1">
            Create a skill or let agents generate them from successful tasks
          </p>
          <Button
            onClick={() => {
              setEditingSkill(null);
              setShowEditor(true);
            }}
            className="mt-4"
          >
            <Plus className="w-4 h-4 mr-1" />
            Create Your First Skill
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onDelete={handleDelete}
              onEdit={handleEdit}
              onExport={handleExport}
              isDeleting={deletingId === skill.id}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <SkillEditor
          skill={editingSkill}
          onSave={handleSave}
          onClose={() => {
            setShowEditor(false);
            setEditingSkill(null);
          }}
          isSaving={isSaving}
        />
      )}

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          isImporting={isImporting}
        />
      )}
    </div>
  );
}
