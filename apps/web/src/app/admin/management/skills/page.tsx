'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Check,
  X,
  Zap,
  Trash2,
  Loader2,
  BarChart3,
  Clock,
  CheckCircle2,
  Tag,
  Download,
  Copy,
  GitBranch,
  Layers,
  GitFork,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUser } from '@/stores/auth';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Types matching the API
interface SkillStep {
  name: string;
  description: string;
  tool?: string;
  skill?: string;
  parameters: Record<string, unknown>;
  condition?: string;
  on_success?: string;
  on_failure?: string;
  parallel_with?: string[];
  required: boolean;
}

interface SystemSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  author: string;
  triggers: string[];
  tags: string[];
  required_tools: string[];
  required_context: string[];
  steps: SkillStep[];
  system_prompt?: string;
  examples?: { input: string; output: string }[];
  metadata?: {
    category?: string;
    estimated_duration?: number;
    requires_approval?: boolean;
  };
  is_active: boolean;
  is_default: boolean;
  allowed_plans?: string[];
  allowed_roles?: string[];
  created_at: string;
  updated_at: string;
}

interface SkillAnalytics {
  skill_slug: string;
  skill_name: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  avg_duration_ms: number | null;
  last_executed_at?: string | null;
}

interface SkillsAnalyticsSummary {
  total_skills: number;
  active_skills: number;
  total_executions: number;
  overall_success_rate: number;
  skills_by_category: Record<string, number>;
  top_skills: SkillAnalytics[];
}

// Category colors
const categoryColors: Record<string, string> = {
  debugging: 'bg-red-500/20 text-red-400',
  quality: 'bg-blue-500/20 text-blue-400',
  testing: 'bg-green-500/20 text-green-400',
  maintenance: 'bg-yellow-500/20 text-yellow-400',
  security: 'bg-purple-500/20 text-purple-400',
  deployment: 'bg-cyan-500/20 text-cyan-400',
  documentation: 'bg-orange-500/20 text-orange-400',
  infrastructure: 'bg-pink-500/20 text-pink-400',
};

// Skill Card Component
interface SkillCardProps {
  skill: SystemSkill;
  analytics?: SkillAnalytics;
  isSuperAdmin: boolean;
  onEdit: (skill: SystemSkill) => void;
  onToggleActive: (skillId: string, isActive: boolean) => void;
  onDelete: (skillId: string) => void;
  onDuplicate: (skillSlug: string) => void;
  onExport: (skillSlug: string) => void;
}

function SkillCard({
  skill,
  analytics,
  isSuperAdmin,
  onEdit,
  onToggleActive,
  onDelete,
  onDuplicate,
  onExport,
}: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${skill.name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete(skill.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const hasAdvancedFeatures = skill.steps.some(
    (s) => s.skill || s.parallel_with?.length || s.on_success || s.on_failure
  );

  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-5',
        skill.is_active ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-semibold text-text-primary">{skill.name}</h3>
            {skill.is_default && (
              <span className="px-2 py-0.5 bg-accent-primary/20 text-accent-primary text-xs rounded-full">
                Default
              </span>
            )}
            {hasAdvancedFeatures && (
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full">
                Advanced
              </span>
            )}
          </div>
          <p className="text-text-muted text-sm font-mono">{skill.slug}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onExport(skill.slug)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Export as YAML"
          >
            <Download className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onDuplicate(skill.slug)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Duplicate"
          >
            <Copy className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onEdit(skill)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
            title="Edit"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleActive(skill.id, !skill.is_active)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              skill.is_active
                ? 'hover:bg-red-500/10 text-red-500'
                : 'hover:bg-green-500/10 text-green-500'
            )}
            title={skill.is_active ? 'Disable' : 'Enable'}
          >
            {skill.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
          {isSuperAdmin && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors disabled:opacity-50"
              title="Delete"
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

      {/* Description */}
      <p className="text-sm text-text-secondary mb-3 line-clamp-2">{skill.description}</p>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {skill.metadata?.category && (
          <span
            className={cn(
              'px-2 py-0.5 rounded text-xs',
              categoryColors[skill.metadata.category] || 'bg-gray-500/20 text-gray-400'
            )}
          >
            {skill.metadata.category}
          </span>
        )}
        <span className="px-2 py-0.5 bg-elevated rounded text-xs text-text-muted">
          {skill.steps.length} steps
        </span>
        {skill.metadata?.estimated_duration && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-elevated rounded text-xs text-text-muted">
            <Clock className="h-3 w-3" />~{Math.round(skill.metadata.estimated_duration / 60)}m
          </span>
        )}
        {skill.metadata?.requires_approval && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">
            <AlertCircle className="h-3 w-3" />
            Approval
          </span>
        )}
      </div>

      {/* Step Features */}
      {hasAdvancedFeatures && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {skill.steps.some((s) => s.skill) && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-accent-primary/10 text-accent-primary rounded text-xs">
              <GitBranch className="h-3 w-3" />
              Chaining
            </span>
          )}
          {skill.steps.some((s) => s.parallel_with?.length) && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded text-xs">
              <Layers className="h-3 w-3" />
              Parallel
            </span>
          )}
          {skill.steps.some((s) => s.on_success || s.on_failure) && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded text-xs">
              <GitFork className="h-3 w-3" />
              Branching
            </span>
          )}
        </div>
      )}

      {/* Analytics */}
      {analytics && analytics.total_executions > 0 && (
        <div className="border-t border-border-subtle pt-3 mt-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-semibold text-text-primary">
                {analytics.total_executions}
              </p>
              <p className="text-xs text-text-muted">Executions</p>
            </div>
            <div>
              <p
                className={cn(
                  'text-lg font-semibold',
                  analytics.success_rate >= 90
                    ? 'text-accent-success'
                    : analytics.success_rate >= 70
                      ? 'text-amber-500'
                      : 'text-accent-error'
                )}
              >
                {analytics.success_rate.toFixed(0)}%
              </p>
              <p className="text-xs text-text-muted">Success</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-text-primary">
                {((analytics.avg_duration_ms ?? 0) / 1000).toFixed(1)}s
              </p>
              <p className="text-xs text-text-muted">Avg Time</p>
            </div>
          </div>
        </div>
      )}

      {/* Expandable Steps */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full mt-3 pt-3 border-t border-border-subtle flex items-center justify-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
      >
        {expanded ? (
          <>
            <ChevronDown className="h-4 w-4" /> Hide Steps
          </>
        ) : (
          <>
            <ChevronRight className="h-4 w-4" /> Show Steps
          </>
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {skill.steps.map((step, idx) => (
            <div key={step.name} className="flex items-start gap-2 p-2 bg-elevated rounded-lg">
              <span className="flex items-center justify-center h-5 w-5 rounded-full bg-surface text-[10px] text-text-muted border border-border-subtle shrink-0">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium text-text-primary">{step.name}</span>
                  {step.skill && (
                    <span className="px-1 py-0.5 text-[10px] bg-accent-primary/10 text-accent-primary rounded">
                      Chain: {step.skill}
                    </span>
                  )}
                  {step.parallel_with?.length ? (
                    <span className="px-1 py-0.5 text-[10px] bg-amber-500/10 text-amber-600 rounded">
                      Parallel
                    </span>
                  ) : null}
                  {(step.on_success || step.on_failure) && (
                    <span className="px-1 py-0.5 text-[10px] bg-blue-500/10 text-blue-600 rounded">
                      Branch
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted truncate">{step.description}</p>
                {step.tool && (
                  <code className="text-[10px] text-text-muted bg-surface px-1 rounded">
                    {step.tool}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Edit Modal Component
interface EditSkillModalProps {
  skill: SystemSkill | null;
  onClose: () => void;
  onSave: (data: Partial<SystemSkill>) => Promise<void>;
}

function EditSkillModal({ skill, onClose, onSave }: EditSkillModalProps) {
  const [formData, setFormData] = useState<Partial<SystemSkill> & { examplesJson?: string }>({
    name: skill?.name || '',
    slug: skill?.slug || '',
    description: skill?.description || '',
    version: skill?.version || '1.0.0',
    author: skill?.author || 'system',
    triggers: skill?.triggers || [],
    tags: skill?.tags || [],
    required_tools: skill?.required_tools || [],
    required_context: skill?.required_context || [],
    steps: skill?.steps || [],
    system_prompt: skill?.system_prompt || '',
    examples: skill?.examples || [],
    examplesJson: JSON.stringify(skill?.examples || [], null, 2),
    metadata: skill?.metadata || { category: '', estimated_duration: 60, requires_approval: false },
    is_active: skill?.is_active ?? true,
    is_default: skill?.is_default ?? true,
    allowed_plans: skill?.allowed_plans || [],
    allowed_roles: skill?.allowed_roles || [],
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'steps' | 'advanced'>('basic');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Parse examples JSON
      let parsedExamples: { input: string; output: string }[] = [];
      try {
        parsedExamples = JSON.parse(formData.examplesJson || '[]');
      } catch {
        parsedExamples = [];
      }
      const { examplesJson: _examplesJson, ...dataToSave } = formData;
      await onSave({ ...dataToSave, examples: parsedExamples });
      onClose();
    } catch (error) {
      console.error('Failed to save skill:', error);
    } finally {
      setSaving(false);
    }
  };

  const addStep = () => {
    setFormData({
      ...formData,
      steps: [
        ...(formData.steps || []),
        {
          name: `step_${(formData.steps?.length || 0) + 1}`,
          description: '',
          tool: '',
          parameters: {},
          required: true,
        },
      ],
    });
  };

  const updateStep = (index: number, updates: Partial<SkillStep>) => {
    const newSteps = [...(formData.steps || [])];
    newSteps[index] = { ...newSteps[index], ...updates } as SkillStep;
    setFormData({ ...formData, steps: newSteps });
  };

  const removeStep = (index: number) => {
    const newSteps = [...(formData.steps || [])];
    newSteps.splice(index, 1);
    setFormData({ ...formData, steps: newSteps });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border-subtle">
          <h2 className="text-xl font-semibold text-text-primary">
            {skill ? 'Edit Skill' : 'Create Skill'}
          </h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-6">
          {(['basic', 'steps', 'advanced'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab
                  ? 'border-accent-primary text-accent-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-text-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Slug</label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary font-mono"
                    required
                    disabled={!!skill}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary h-24"
                  required
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm text-text-muted mb-1">Version</label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Author</label>
                  <input
                    type="text"
                    value={formData.author}
                    onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                    placeholder="system"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Category</label>
                  <select
                    value={formData.metadata?.category || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        metadata: { ...formData.metadata, category: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  >
                    <option value="">Select...</option>
                    <option value="debugging">Debugging</option>
                    <option value="quality">Quality</option>
                    <option value="testing">Testing</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="security">Security</option>
                    <option value="deployment">Deployment</option>
                    <option value="documentation">Documentation</option>
                    <option value="infrastructure">Infrastructure</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Est. Duration (sec)</label>
                  <input
                    type="number"
                    value={formData.metadata?.estimated_duration || 60}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        metadata: {
                          ...formData.metadata,
                          estimated_duration: parseInt(e.target.value) || 60,
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                    min={0}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Triggers (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.triggers?.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      triggers: e.target.value.split(',').map((t) => t.trim()),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="fix bug, debug, troubleshoot"
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={formData.tags?.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      tags: e.target.value.split(',').map((t) => t.trim()),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="coder, debugging, fix"
                />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded border-border-subtle"
                  />
                  <span className="text-sm text-text-secondary">Active</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="rounded border-border-subtle"
                  />
                  <span className="text-sm text-text-secondary">Default for all users</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.metadata?.requires_approval}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        metadata: { ...formData.metadata, requires_approval: e.target.checked },
                      })
                    }
                    className="rounded border-border-subtle"
                  />
                  <span className="text-sm text-text-secondary">Requires approval</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'steps' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-text-muted">
                  Define the workflow steps for this skill. Steps can execute tools, chain to other
                  skills, run in parallel, or branch based on results.
                </p>
                <button
                  type="button"
                  onClick={addStep}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm hover:bg-accent-primary/90"
                >
                  <Plus className="h-4 w-4" /> Add Step
                </button>
              </div>

              {formData.steps?.map((step, idx) => (
                <div key={idx} className="p-4 bg-elevated rounded-lg border border-border-subtle">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-text-primary">Step {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeStep(idx)}
                      className="p-1 hover:bg-red-500/10 text-red-500 rounded"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Name</label>
                      <input
                        type="text"
                        value={step.name}
                        onChange={(e) => updateStep(idx, { name: e.target.value })}
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Tool OR Skill</label>
                      <input
                        type="text"
                        value={step.tool || step.skill || ''}
                        onChange={(e) => {
                          if (e.target.value.includes('_skill')) {
                            updateStep(idx, { skill: e.target.value, tool: undefined });
                          } else {
                            updateStep(idx, { tool: e.target.value, skill: undefined });
                          }
                        }}
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        placeholder="search_code or bug_fix (skill)"
                      />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="block text-xs text-text-muted mb-1">Description</label>
                    <input
                      type="text"
                      value={step.description}
                      onChange={(e) => updateStep(idx, { description: e.target.value })}
                      className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Condition</label>
                      <input
                        type="text"
                        value={step.condition || ''}
                        onChange={(e) =>
                          updateStep(idx, { condition: e.target.value || undefined })
                        }
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        placeholder="has_tests == true"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        On Success → Step
                      </label>
                      <input
                        type="text"
                        value={step.on_success || ''}
                        onChange={(e) =>
                          updateStep(idx, { on_success: e.target.value || undefined })
                        }
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        placeholder="step_name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        On Failure → Step
                      </label>
                      <input
                        type="text"
                        value={step.on_failure || ''}
                        onChange={(e) =>
                          updateStep(idx, { on_failure: e.target.value || undefined })
                        }
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        placeholder="step_name"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        Parallel With (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={step.parallel_with?.join(', ') || ''}
                        onChange={(e) =>
                          updateStep(idx, {
                            parallel_with: e.target.value
                              ? e.target.value.split(',').map((s) => s.trim())
                              : undefined,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded bg-surface border border-border-subtle text-text-primary text-sm"
                        placeholder="step_2, step_3"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 pb-1.5">
                        <input
                          type="checkbox"
                          checked={step.required}
                          onChange={(e) => updateStep(idx, { required: e.target.checked })}
                          className="rounded border-border-subtle"
                        />
                        <span className="text-xs text-text-secondary">Required step</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}

              {!formData.steps?.length && (
                <div className="text-center py-8 text-text-muted">
                  <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No steps defined. Click "Add Step" to create your first step.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm text-text-muted mb-1">System Prompt</label>
                <textarea
                  value={formData.system_prompt || ''}
                  onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary h-32 font-mono text-sm"
                  placeholder="Optional system prompt to guide the agent..."
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Examples (JSON array of {`{input, output}`} objects)
                </label>
                <textarea
                  value={formData.examplesJson || '[]'}
                  onChange={(e) => setFormData({ ...formData, examplesJson: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary h-32 font-mono text-sm"
                  placeholder='[{"input": "Example question", "output": "Example response"}]'
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Required Tools (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.required_tools?.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      required_tools: e.target.value.split(',').map((t) => t.trim()),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="search_code, read_file, write_file"
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Required Context (comma-separated)
                </label>
                <input
                  type="text"
                  value={formData.required_context?.join(', ')}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      required_context: e.target.value.split(',').map((t) => t.trim()),
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="workspace_path, error_message"
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Allowed Plans (comma-separated, leave empty for all)
                </label>
                <input
                  type="text"
                  value={formData.allowed_plans?.join(', ') || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      allowed_plans: e.target.value
                        ? e.target.value.split(',').map((t) => t.trim())
                        : [],
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="pro, team, enterprise"
                />
              </div>

              <div>
                <label className="block text-sm text-text-muted mb-1">
                  Allowed Agent Roles (comma-separated, leave empty for all)
                </label>
                <input
                  type="text"
                  value={formData.allowed_roles?.join(', ') || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      allowed_roles: e.target.value
                        ? e.target.value.split(',').map((t) => t.trim())
                        : [],
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                  placeholder="coder, reviewer, architect"
                />
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-6 border-t border-border-subtle flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Page Component
export default function SkillsManagement() {
  useDocumentTitle('System Skills');
  const [skills, setSkills] = useState<SystemSkill[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, SkillAnalytics>>({});
  const [analyticsSummary, setAnalyticsSummary] = useState<SkillsAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingSkill, setEditingSkill] = useState<SystemSkill | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const currentUser = useUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<{ items: SystemSkill[] }>('/api/v1/admin/skills');
      setSkills(data.items || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      setError('Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const data = await api.get<SkillsAnalyticsSummary>('/api/v1/admin/skills/analytics?days=30');
      setAnalyticsSummary(data);
      // Build map from top skills for per-skill analytics
      const analyticsMap: Record<string, SkillAnalytics> = {};
      (data.top_skills || []).forEach((item: SkillAnalytics) => {
        analyticsMap[item.skill_slug] = item;
      });
      setAnalytics(analyticsMap);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchAnalytics();
  }, [fetchSkills, fetchAnalytics]);

  const handleToggleActive = async (skillId: string, isActive: boolean) => {
    try {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) return;

      await api.patch(`/api/v1/admin/skills/${skill.slug}`, { is_active: isActive });

      setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, is_active: isActive } : s)));
      toast.success(isActive ? 'Skill enabled' : 'Skill disabled');
    } catch (err) {
      console.error('Failed to toggle skill:', err);
      toast.error('Failed to update skill');
    }
  };

  const handleSaveSkill = async (data: Partial<SystemSkill>) => {
    try {
      if (editingSkill) {
        const updated = await api.patch<SystemSkill>(
          `/api/v1/admin/skills/${editingSkill.slug}`,
          data
        );
        setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updated : s)));
        toast.success('Skill updated');
      } else {
        const created = await api.post<SystemSkill>('/api/v1/admin/skills', data);
        setSkills((prev) => [...prev, created]);
        toast.success('Skill created');
      }
    } catch (err) {
      console.error('Failed to save skill:', err);
      toast.error('Failed to save skill');
      throw err;
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    try {
      const skill = skills.find((s) => s.id === skillId);
      if (!skill) return;

      await api.delete(`/api/v1/admin/skills/${skill.slug}`);

      setSkills((prev) => prev.filter((s) => s.id !== skillId));
      toast.success('Skill deleted');
    } catch (err) {
      console.error('Failed to delete skill:', err);
      toast.error('Failed to delete skill');
    }
  };

  const handleDuplicateSkill = async (slug: string) => {
    try {
      const duplicated = await api.post<SystemSkill>(`/api/v1/admin/skills/${slug}/duplicate`, {});
      setSkills((prev) => [...prev, duplicated]);
      toast.success('Skill duplicated');
    } catch (err) {
      console.error('Failed to duplicate skill:', err);
      toast.error('Failed to duplicate skill');
    }
  };

  const handleExportSkill = async (slug: string) => {
    try {
      const exportData = await api.get<Record<string, unknown>>(
        `/api/v1/admin/skills/${slug}/export`
      );
      const jsonContent = JSON.stringify(exportData, null, 2);

      // Download as file
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success('Skill exported');
    } catch (err) {
      console.error('Failed to export skill:', err);
      toast.error('Failed to export skill');
    }
  };

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      searchQuery === '' ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || skill.metadata?.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = [...new Set(skills.map((s) => s.metadata?.category).filter(Boolean))];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">System Skills</h1>
          <p className="text-text-muted mt-1">
            Manage platform-wide skills available to all agents
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEditingSkill(null);
              setShowEditModal(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Skill
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-surface rounded-xl border border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-primary/20">
              <Zap className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">
                {analyticsSummary?.total_skills ?? skills.length}
              </p>
              <p className="text-sm text-text-muted">Total Skills</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">
                {analyticsSummary?.active_skills ?? skills.filter((s) => s.is_active).length}
              </p>
              <p className="text-sm text-text-muted">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <BarChart3 className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">
                {analyticsSummary?.total_executions ?? 0}
              </p>
              <p className="text-sm text-text-muted">Total Executions</p>
            </div>
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-border-subtle p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Tag className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">
                {analyticsSummary?.overall_success_rate?.toFixed(0) ?? 0}%
              </p>
              <p className="text-sm text-text-muted">Success Rate</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top Skills by Popularity */}
      {analyticsSummary?.top_skills && analyticsSummary.top_skills.length > 0 && (
        <div className="bg-surface rounded-xl border border-border-subtle p-6 mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-accent-primary" />
            Top Skills by Popularity (Last 30 Days)
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-border-subtle">
                  <th className="pb-3 text-sm font-medium text-text-muted">Rank</th>
                  <th className="pb-3 text-sm font-medium text-text-muted">Skill</th>
                  <th className="pb-3 text-sm font-medium text-text-muted text-right">
                    Executions
                  </th>
                  <th className="pb-3 text-sm font-medium text-text-muted text-right">
                    Success Rate
                  </th>
                  <th className="pb-3 text-sm font-medium text-text-muted text-right">
                    Avg Duration
                  </th>
                  <th className="pb-3 text-sm font-medium text-text-muted text-right">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {analyticsSummary.top_skills.map((skill, idx) => (
                  <tr
                    key={skill.skill_slug}
                    className="border-b border-border-subtle/50 last:border-0"
                  >
                    <td className="py-3">
                      <span
                        className={cn(
                          'inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium',
                          idx === 0
                            ? 'bg-amber-500/20 text-amber-500'
                            : idx === 1
                              ? 'bg-gray-400/20 text-gray-400'
                              : idx === 2
                                ? 'bg-orange-600/20 text-orange-600'
                                : 'bg-elevated text-text-muted'
                        )}
                      >
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-sm font-medium text-text-primary">
                        {skill.skill_name}
                      </span>
                      <span className="text-xs text-text-muted ml-2 font-mono">
                        {skill.skill_slug}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="text-sm font-semibold text-text-primary">
                        {skill.total_executions}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={cn(
                          'text-sm font-medium',
                          skill.success_rate >= 90
                            ? 'text-accent-success'
                            : skill.success_rate >= 70
                              ? 'text-amber-500'
                              : 'text-accent-error'
                        )}
                      >
                        {skill.success_rate.toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="text-sm text-text-secondary">
                        {skill.avg_duration_ms
                          ? `${(skill.avg_duration_ms / 1000).toFixed(1)}s`
                          : '-'}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="text-xs text-text-muted">
                        {skill.last_executed_at
                          ? new Date(skill.last_executed_at).toLocaleDateString()
                          : '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {/* Skills Grid */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              analytics={analytics[skill.slug]}
              isSuperAdmin={isSuperAdmin}
              onEdit={(s) => {
                setEditingSkill(s);
                setShowEditModal(true);
              }}
              onToggleActive={handleToggleActive}
              onDelete={handleDeleteSkill}
              onDuplicate={handleDuplicateSkill}
              onExport={handleExportSkill}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredSkills.length === 0 && (
        <div className="text-center py-12">
          <Zap className="h-12 w-12 mx-auto mb-4 text-text-muted opacity-50" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No skills found</h3>
          <p className="text-text-muted">
            {searchQuery || categoryFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create your first system skill'}
          </p>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <EditSkillModal
          skill={editingSkill}
          onClose={() => {
            setShowEditModal(false);
            setEditingSkill(null);
          }}
          onSave={handleSaveSkill}
        />
      )}
    </div>
  );
}
