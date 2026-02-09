'use client';

import { useEffect, useState } from 'react';
import {
  Zap,
  Play,
  ChevronRight,
  ChevronDown,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  SkipForward,
  AlertCircle,
  GitBranch,
  Layers,
  Search,
  Tag,
  ArrowRight,
  GitFork,
  Store,
  Plus,
  Check,
  X,
  Download,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getMarketplaceSkills,
  getMyMarketplaceSkills,
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
  getSkillTemplates,
  type MarketplaceSkill,
  type UserAddedSkill,
  type SkillTemplate,
} from '@/lib/api';
import { SkillWizard } from '@/components/skills/SkillWizard';
import { useSkillsStore, type Skill, type SkillExecution, type SkillStep } from '@/stores/skills';
import { useSkillSocket, useLoadSkills } from '@/hooks/useSkillSocket';

interface SkillsPanelProps {
  sessionId: string;
}

// Step status icon component
function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-accent-success" />;
    case 'failed':
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-accent-error" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-accent-primary animate-spin" />;
    case 'skipped':
      return <SkipForward className="h-3.5 w-3.5 text-text-muted" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-text-muted" />;
  }
}

// Skill step visualization component
function SkillStepItem({
  step,
  index,
  totalSteps,
  executionResult,
}: {
  step: SkillStep;
  index: number;
  totalSteps: number;
  executionResult?: { status: string };
}) {
  const hasChaining = !!step.skill;
  const hasParallel = step.parallelWith && step.parallelWith.length > 0;
  const hasBranching = !!step.onSuccess || !!step.onFailure;

  return (
    <div className="relative flex items-start gap-2 py-1.5">
      {/* Connection line */}
      {index < totalSteps - 1 && (
        <div className="absolute left-[7px] top-6 h-full w-px bg-border-subtle" />
      )}

      {/* Status indicator */}
      <div className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface border border-border-subtle">
        {executionResult ? (
          <StepStatusIcon status={executionResult.status} />
        ) : (
          <span className="text-[10px] text-text-muted">{index + 1}</span>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary truncate">{step.name}</span>

          {/* Feature badges */}
          {hasChaining && (
            <span
              className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] bg-accent-primary/10 text-accent-primary rounded"
              title={`Chains to skill: ${step.skill}`}
            >
              <GitBranch className="h-2.5 w-2.5" />
              Chain
            </span>
          )}
          {hasParallel && (
            <span
              className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] bg-amber-500/10 text-amber-600 rounded"
              title={`Runs in parallel with: ${step.parallelWith?.join(', ')}`}
            >
              <Layers className="h-2.5 w-2.5" />
              Parallel
            </span>
          )}
          {hasBranching && (
            <span
              className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] bg-blue-500/10 text-blue-600 rounded"
              title={`Branches: Success → ${step.onSuccess || 'next'}, Failure → ${step.onFailure || 'stop'}`}
            >
              <GitFork className="h-2.5 w-2.5" />
              Branch
            </span>
          )}
        </div>

        <p className="text-[11px] text-text-muted truncate">{step.description}</p>

        {/* Tool/Skill indicator */}
        {step.tool && (
          <span className="text-[10px] text-text-muted">
            Tool: <code className="px-1 bg-overlay rounded">{step.tool}</code>
          </span>
        )}
        {step.skill && (
          <span className="text-[10px] text-text-muted">
            Skill: <code className="px-1 bg-overlay rounded">{step.skill}</code>
          </span>
        )}

        {/* Branching visualization */}
        {hasBranching && (
          <div className="mt-1 flex items-center gap-2 text-[10px]">
            {step.onSuccess && (
              <span className="flex items-center gap-0.5 text-accent-success">
                <CheckCircle2 className="h-2.5 w-2.5" />
                <ArrowRight className="h-2 w-2" />
                {step.onSuccess}
              </span>
            )}
            {step.onFailure && (
              <span className="flex items-center gap-0.5 text-accent-error">
                <XCircle className="h-2.5 w-2.5" />
                <ArrowRight className="h-2 w-2" />
                {step.onFailure}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Active execution card component
function ExecutionCard({ execution }: { execution: SkillExecution }) {
  const [expanded, setExpanded] = useState(true);
  const skill = useSkillsStore((state) => state.getSkillBySlug(execution.skillSlug));

  const progress =
    execution.totalSteps > 0
      ? Math.round((execution.stepsCompleted / execution.totalSteps) * 100)
      : 0;

  return (
    <div className="border border-border-subtle rounded-lg bg-elevated overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-overlay transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
        )}

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {execution.skillName}
            </span>
            {execution.status === 'running' && (
              <Loader2 className="h-3.5 w-3.5 text-accent-primary animate-spin shrink-0" />
            )}
            {execution.status === 'completed' && (
              <CheckCircle2 className="h-3.5 w-3.5 text-accent-success shrink-0" />
            )}
            {execution.status === 'failed' && (
              <XCircle className="h-3.5 w-3.5 text-accent-error shrink-0" />
            )}
          </div>
          <div className="text-[11px] text-text-muted">
            Step {execution.stepsCompleted}/{execution.totalSteps} &middot; {progress}%
          </div>
        </div>

        {/* Progress ring */}
        <div className="relative h-8 w-8 shrink-0">
          <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-border-subtle"
            />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray={`${progress * 0.88} 88`}
              className={cn(
                execution.status === 'completed'
                  ? 'text-accent-success'
                  : execution.status === 'failed'
                    ? 'text-accent-error'
                    : 'text-accent-primary'
              )}
            />
          </svg>
        </div>
      </button>

      {/* Expanded content - Steps */}
      {expanded && skill && (
        <div className="px-3 pb-3 border-t border-border-subtle">
          <div className="mt-2 space-y-0">
            {skill.steps.map((step, idx) => {
              const result = execution.results.find((r) => r.step === step.name);
              return (
                <SkillStepItem
                  key={step.name}
                  step={step}
                  index={idx}
                  totalSteps={skill.steps.length}
                  executionResult={result}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Duration if completed */}
      {execution.durationMs !== undefined && (
        <div className="px-3 py-2 border-t border-border-subtle text-[11px] text-text-muted flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Completed in {(execution.durationMs / 1000).toFixed(1)}s
        </div>
      )}

      {/* Error if failed */}
      {execution.error && (
        <div className="px-3 py-2 border-t border-accent-error/20 text-[11px] text-accent-error flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {execution.error}
        </div>
      )}
    </div>
  );
}

// Marketplace Modal Component
function MarketplaceModal({
  isOpen,
  onClose,
  onSkillInstalled,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSkillInstalled: () => void;
}) {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [mySkills, setMySkills] = useState<UserAddedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [uninstallingSlug, setUninstallingSlug] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'installed'>('browse');

  useEffect(() => {
    if (isOpen) {
      fetchSkills();
      fetchMySkills();
    }
  }, [isOpen]);

  const fetchSkills = async () => {
    try {
      setLoading(true);
      const data = await getMarketplaceSkills();
      setSkills(data.skills || []);
    } catch (err) {
      console.error('Failed to fetch marketplace skills:', err);
      toast.error('Failed to load marketplace');
    } finally {
      setLoading(false);
    }
  };

  const fetchMySkills = async () => {
    try {
      const data = await getMyMarketplaceSkills();
      setMySkills(data || []);
    } catch (err) {
      console.error('Failed to fetch my skills:', err);
    }
  };

  const handleInstall = async (slug: string) => {
    setInstallingSlug(slug);
    try {
      await installMarketplaceSkill(slug);
      toast.success('Skill added to your account');
      fetchMySkills();
      onSkillInstalled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install skill');
    } finally {
      setInstallingSlug(null);
    }
  };

  const handleUninstall = async (slug: string) => {
    setUninstallingSlug(slug);
    try {
      await uninstallMarketplaceSkill(slug);
      toast.success('Skill removed from your account');
      fetchMySkills();
      onSkillInstalled();
    } catch {
      toast.error('Failed to remove skill');
    } finally {
      setUninstallingSlug(null);
    }
  };

  const isInstalled = (slug: string) => mySkills.some((s) => s.skill_slug === slug);

  // Filter skills
  const filteredSkills = skills.filter((skill) => {
    const matchesSearch =
      searchQuery === '' ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || skill.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Get unique categories
  const categories = [...new Set(skills.map((s) => s.category).filter(Boolean))];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-accent-primary" />
              <h2 className="text-lg font-semibold text-text-primary">Skill Marketplace</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-text-muted" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('browse')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                activeTab === 'browse'
                  ? 'bg-accent-primary text-white'
                  : 'bg-elevated text-text-secondary hover:text-text-primary'
              )}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('installed')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5',
                activeTab === 'installed'
                  ? 'bg-accent-primary text-white'
                  : 'bg-elevated text-text-secondary hover:text-text-primary'
              )}
            >
              Installed
              {mySkills.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-white/20 rounded-full">
                  {mySkills.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Browse Tab */}
        {activeTab === 'browse' && (
          <>
            {/* Search & Filter */}
            <div className="p-3 border-b border-border-subtle flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search skills..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-sm bg-elevated border border-border-subtle rounded-lg focus:outline-none focus:border-accent-primary"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-elevated border border-border-subtle rounded-lg text-text-primary"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* Skills List */}
            <div className="flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 text-accent-primary animate-spin" />
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="text-center py-12 text-text-muted">
                  <Store className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No skills found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSkills.map((skill) => {
                    const installed = isInstalled(skill.slug);
                    const isInstalling = installingSlug === skill.slug;

                    return (
                      <div
                        key={skill.id}
                        className="flex items-start gap-3 p-3 bg-elevated rounded-lg border border-border-subtle"
                      >
                        <div className="p-2 rounded-lg bg-accent-primary/10 shrink-0">
                          <Zap className="h-4 w-4 text-accent-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-medium text-text-primary">{skill.name}</h4>
                            <span className="px-1.5 py-0.5 text-[10px] bg-overlay rounded text-text-muted">
                              {skill.category}
                            </span>
                          </div>
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                            {skill.description}
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
                            <span className="flex items-center gap-0.5">
                              <Download className="h-3 w-3" />
                              {skill.install_count} installs
                            </span>
                            <span>v{skill.version}</span>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            installed ? handleUninstall(skill.slug) : handleInstall(skill.slug)
                          }
                          disabled={isInstalling || uninstallingSlug === skill.slug}
                          className={cn(
                            'px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1 shrink-0',
                            installed
                              ? 'bg-green-500/10 text-green-500 hover:bg-red-500/10 hover:text-red-500'
                              : 'bg-accent-primary text-white hover:bg-accent-primary/90',
                            (isInstalling || uninstallingSlug === skill.slug) && 'opacity-50'
                          )}
                        >
                          {isInstalling || uninstallingSlug === skill.slug ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : installed ? (
                            <>
                              <Check className="h-3 w-3" />
                              Installed
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              Add
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Installed Tab */}
        {activeTab === 'installed' && (
          <div className="flex-1 overflow-y-auto p-3">
            {mySkills.length === 0 ? (
              <div className="text-center py-12 text-text-muted">
                <Store className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm">No marketplace skills installed</p>
                <button
                  onClick={() => setActiveTab('browse')}
                  className="mt-2 text-xs text-accent-primary hover:underline"
                >
                  Browse marketplace
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {mySkills.map((skill) => {
                  const isUninstalling = uninstallingSlug === skill.skill_slug;

                  return (
                    <div
                      key={skill.id}
                      className="flex items-center gap-3 p-3 bg-elevated rounded-lg border border-border-subtle"
                    >
                      <div className="p-2 rounded-lg bg-accent-primary/10 shrink-0">
                        <Zap className="h-4 w-4 text-accent-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-text-primary">
                          {skill.skill_name}
                        </h4>
                        <p className="text-[10px] text-text-muted">
                          Added {new Date(skill.added_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => handleUninstall(skill.skill_slug)}
                        disabled={isUninstalling}
                        className="p-2 hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded-lg transition-colors disabled:opacity-50"
                        title="Remove skill"
                      >
                        {isUninstalling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Available skill card component
function SkillCard({ skill, onRun }: { skill: Skill; onRun?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const hasAdvancedFeatures = skill.steps.some(
    (s) => s.skill || s.parallelWith?.length || s.onSuccess || s.onFailure
  );

  return (
    <div className="border border-border-subtle rounded-lg bg-surface overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-overlay transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
        )}

        <Zap
          className={cn(
            'h-4 w-4 shrink-0',
            skill.skillType === 'system' ? 'text-accent-primary' : 'text-accent-secondary'
          )}
        />

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary truncate">{skill.name}</span>
            {hasAdvancedFeatures && (
              <span className="px-1 py-0.5 text-[9px] bg-accent-primary/10 text-accent-primary rounded">
                Advanced
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted truncate">{skill.description}</p>
        </div>

        {onRun && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRun();
            }}
            className="p-1.5 rounded hover:bg-accent-primary/10 text-text-muted hover:text-accent-primary transition-colors"
            title="Run skill"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border-subtle">
          {/* Tags */}
          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] bg-overlay text-text-secondary rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Triggers */}
          {skill.triggers.length > 0 && (
            <div className="mt-2">
              <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Triggers
              </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {skill.triggers.slice(0, 5).map((trigger) => (
                  <span
                    key={trigger}
                    className="px-1.5 py-0.5 text-[10px] bg-accent-primary/10 text-accent-primary rounded"
                  >
                    "{trigger}"
                  </span>
                ))}
                {skill.triggers.length > 5 && (
                  <span className="text-[10px] text-text-muted">
                    +{skill.triggers.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Steps preview */}
          <div className="mt-3">
            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Steps ({skill.steps.length})
            </span>
            <div className="mt-1.5 space-y-0">
              {skill.steps.map((step, idx) => (
                <SkillStepItem
                  key={step.name}
                  step={step}
                  index={idx}
                  totalSteps={skill.steps.length}
                />
              ))}
            </div>
          </div>

          {/* Metadata */}
          {skill.metadata && (
            <div className="mt-3 flex items-center gap-3 text-[10px] text-text-muted">
              {skill.metadata.category && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {skill.metadata.category}
                </span>
              )}
              {skill.metadata.estimatedDuration && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />~{Math.round(skill.metadata.estimatedDuration / 60)}m
                </span>
              )}
              {skill.metadata.requiresApproval && (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertCircle className="h-3 w-3" />
                  Requires approval
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SkillsPanel({ sessionId }: SkillsPanelProps) {
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Subscribe to socket events
  useSkillSocket({ sessionId });

  // Load skills on mount
  const { loadSkills } = useLoadSkills();
  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleSkillInstalled = () => {
    // Reload skills when a marketplace skill is installed/uninstalled
    loadSkills();
  };

  const handleOpenWizard = async () => {
    setShowWizard(true);
    setTemplatesLoading(true);
    try {
      const data = await getSkillTemplates();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to fetch skill templates:', err);
      toast.error('Failed to load skill templates');
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleSkillCreated = () => {
    loadSkills();
    toast.success('Skill created successfully');
  };

  // Store state
  const skills = useSkillsStore((state) => state.skills);
  const skillsLoading = useSkillsStore((state) => state.skillsLoading);
  const skillsError = useSkillsStore((state) => state.skillsError);
  const getFilteredSkills = useSkillsStore((state) => state.getFilteredSkills);
  const getActiveExecutions = useSkillsStore((state) => state.getActiveExecutions);
  const searchQuery = useSkillsStore((state) => state.searchQuery);
  const setSearchQuery = useSkillsStore((state) => state.setSearchQuery);
  const typeFilter = useSkillsStore((state) => state.typeFilter);
  const setTypeFilter = useSkillsStore((state) => state.setTypeFilter);

  const activeExecutions = getActiveExecutions(sessionId);
  const filteredSkills = getFilteredSkills();

  // Group skills by type
  const systemSkills = filteredSkills.filter((s) => s.skillType === 'system');
  const userSkills = filteredSkills.filter((s) => s.skillType === 'user');

  return (
    <div className="flex flex-col h-full">
      {/* Search and filter */}
      <div className="p-2 space-y-2 border-b border-border-subtle shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 text-sm bg-overlay border border-border-subtle rounded focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="flex gap-1">
          {(['all', 'system', 'user'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'flex-1 px-2 py-1 text-xs rounded transition-colors',
                typeFilter === type
                  ? 'bg-accent-primary text-white'
                  : 'bg-overlay text-text-secondary hover:text-text-primary'
              )}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Active executions */}
        {activeExecutions.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Active ({activeExecutions.length})
            </h3>
            <div className="space-y-2">
              {activeExecutions.map((execution) => (
                <ExecutionCard key={execution.id} execution={execution} />
              ))}
            </div>
          </div>
        )}

        {/* Loading state */}
        {skillsLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-accent-primary animate-spin" />
          </div>
        )}

        {/* Error state */}
        {skillsError && (
          <div className="text-center py-8 text-accent-error">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-sm">{skillsError}</p>
            <button
              onClick={() => loadSkills()}
              className="mt-2 text-xs text-accent-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* System skills */}
        {!skillsLoading && systemSkills.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-accent-primary" />
              System Skills ({systemSkills.length})
            </h3>
            <div className="space-y-2">
              {systemSkills.map((skill) => (
                <SkillCard key={skill.slug} skill={skill} />
              ))}
            </div>
          </div>
        )}

        {/* User skills */}
        {!skillsLoading && userSkills.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-accent-secondary" />
              My Skills ({userSkills.length})
            </h3>
            <div className="space-y-2">
              {userSkills.map((skill) => (
                <SkillCard key={skill.slug} skill={skill} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!skillsLoading && !skillsError && skills.length === 0 && (
          <div className="text-center py-8 text-text-muted">
            <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No skills available</p>
          </div>
        )}

        {/* No results */}
        {!skillsLoading && !skillsError && skills.length > 0 && filteredSkills.length === 0 && (
          <div className="text-center py-8 text-text-muted">
            <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No skills match your search</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-2 border-t border-border-subtle shrink-0 space-y-2">
        <button
          onClick={handleOpenWizard}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Custom Skill
        </button>
        <button
          onClick={() => setShowMarketplace(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-elevated hover:bg-overlay text-text-secondary hover:text-text-primary rounded-lg transition-colors"
        >
          <Store className="h-4 w-4" />
          Browse Marketplace
        </button>
      </div>

      {/* Marketplace Modal */}
      <MarketplaceModal
        isOpen={showMarketplace}
        onClose={() => setShowMarketplace(false)}
        onSkillInstalled={handleSkillInstalled}
      />

      {/* Skill Wizard */}
      <SkillWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleSkillCreated}
        templates={templates as any} // eslint-disable-line @typescript-eslint/no-explicit-any
        isLoading={templatesLoading}
      />
    </div>
  );
}
