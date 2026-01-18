'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Check,
  X,
  Eye,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronRight,
  User,
  Mail,
  Trash2,
  BarChart3,
  GitBranch,
  Layers,
  GitFork,
  Store,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Types matching the API
interface MarketplaceSkill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  category: string;
  triggers: string[];
  tags: string[];
  required_tools: string[];
  required_context: string[];
  steps: SkillStep[];
  system_prompt?: string;
  examples?: { input: string; output: string }[];
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  usage_count: number;
  install_count: number;
  submitted_by: string;
  submitted_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  approved_skill_id?: string;
  submitter_name?: string;
  submitter_email?: string;
}

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

interface MarketplaceStats {
  total: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
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
  automation: 'bg-indigo-500/20 text-indigo-400',
  integration: 'bg-teal-500/20 text-teal-400',
};

const statusStyles = {
  pending: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  approved: 'bg-green-500/20 text-green-500 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-500 border-red-500/30',
};

const statusIcons = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

// Skill Card Component
interface SkillCardProps {
  skill: MarketplaceSkill;
  onView: (skill: MarketplaceSkill) => void;
  onApprove: (skillId: string) => void;
  onReject: (skillId: string, reason: string) => void;
  onDelete: (skillId: string) => void;
}

function SkillCard({ skill, onView, onApprove, onReject, onDelete }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const StatusIcon = statusIcons[skill.status];

  const hasAdvancedFeatures = skill.steps.some(
    (s) => s.skill || s.parallel_with?.length || s.on_success || s.on_failure
  );

  const handleApprove = async () => {
    setIsProcessing(true);
    try {
      await onApprove(skill.id);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (rejectReason.length < 10) {
      toast.error('Rejection reason must be at least 10 characters');
      return;
    }
    setIsProcessing(true);
    try {
      await onReject(skill.id, rejectReason);
      setShowRejectModal(false);
      setRejectReason('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${skill.name}"? This cannot be undone.`)) return;
    setIsProcessing(true);
    try {
      await onDelete(skill.id);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'bg-surface rounded-xl border p-5',
          skill.status === 'pending' ? 'border-amber-500/30' : 'border-border-subtle'
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold text-text-primary">{skill.name}</h3>
              <span
                className={cn(
                  'px-2 py-0.5 text-xs rounded-full border flex items-center gap-1',
                  statusStyles[skill.status]
                )}
              >
                <StatusIcon className="h-3 w-3" />
                {skill.status}
              </span>
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
              onClick={() => onView(skill)}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
              title="View Details"
            >
              <Eye className="h-4 w-4 text-text-muted" />
            </button>
            {skill.status === 'pending' && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={isProcessing}
                  className="p-2 hover:bg-green-500/10 text-green-500 rounded-lg transition-colors disabled:opacity-50"
                  title="Approve"
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={isProcessing}
                  className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors disabled:opacity-50"
                  title="Reject"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={handleDelete}
              disabled={isProcessing}
              className="p-2 hover:bg-red-500/10 text-red-500 rounded-lg transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-text-secondary mb-3 line-clamp-2">{skill.description}</p>

        {/* Submitter Info */}
        <div className="flex items-center gap-4 text-xs text-text-muted mb-3">
          {skill.submitter_name && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {skill.submitter_name}
            </span>
          )}
          {skill.submitter_email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {skill.submitter_email}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(skill.submitted_at).toLocaleDateString()}
          </span>
        </div>

        {/* Rejection Reason */}
        {skill.status === 'rejected' && skill.rejection_reason && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-3">
            <p className="text-xs text-red-400 font-medium mb-1">Rejection Reason:</p>
            <p className="text-sm text-red-300">{skill.rejection_reason}</p>
          </div>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span
            className={cn(
              'px-2 py-0.5 rounded text-xs',
              categoryColors[skill.category] || 'bg-gray-500/20 text-gray-400'
            )}
          >
            {skill.category}
          </span>
          <span className="px-2 py-0.5 bg-elevated rounded text-xs text-text-muted">
            {skill.steps.length} steps
          </span>
          {skill.status === 'approved' && (
            <span className="px-2 py-0.5 bg-elevated rounded text-xs text-text-muted">
              {skill.install_count} installs
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

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-xl border border-border-subtle w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Reject Skill</h3>
            <p className="text-sm text-text-muted mb-4">
              Provide a reason for rejecting "{skill.name}". The submitter will see this.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason (min 10 characters)..."
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary h-32 mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={rejectReason.length < 10 || isProcessing}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {isProcessing ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Detail Modal Component
interface DetailModalProps {
  skill: MarketplaceSkill;
  onClose: () => void;
}

function DetailModal({ skill, onClose }: DetailModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">{skill.name}</h2>
              <p className="text-sm text-text-muted font-mono">{skill.slug}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <X className="h-5 w-5 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Status & Meta */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-text-muted mb-1">Status</p>
              <span
                className={cn(
                  'px-2 py-1 text-sm rounded-full border inline-flex items-center gap-1',
                  statusStyles[skill.status]
                )}
              >
                {skill.status.charAt(0).toUpperCase() + skill.status.slice(1)}
              </span>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Category</p>
              <span
                className={cn(
                  'px-2 py-1 text-sm rounded',
                  categoryColors[skill.category] || 'bg-gray-500/20 text-gray-400'
                )}
              >
                {skill.category}
              </span>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Version</p>
              <p className="text-sm text-text-primary">{skill.version}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Submitted</p>
              <p className="text-sm text-text-primary">
                {new Date(skill.submitted_at).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Submitter */}
          <div className="bg-elevated rounded-lg p-4">
            <p className="text-xs text-text-muted mb-2">Submitted By</p>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
                <User className="h-5 w-5 text-accent-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {skill.submitter_name || 'Unknown User'}
                </p>
                <p className="text-xs text-text-muted">
                  {skill.submitter_email || skill.submitted_by}
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <p className="text-xs text-text-muted mb-1">Description</p>
            <p className="text-sm text-text-secondary">{skill.description}</p>
          </div>

          {/* Triggers */}
          <div>
            <p className="text-xs text-text-muted mb-2">Triggers</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.triggers.map((trigger) => (
                <span
                  key={trigger}
                  className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary"
                >
                  {trigger}
                </span>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <p className="text-xs text-text-muted mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-accent-primary/10 text-accent-primary rounded text-xs"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Required Tools */}
          <div>
            <p className="text-xs text-text-muted mb-2">Required Tools</p>
            <div className="flex flex-wrap gap-1.5">
              {skill.required_tools.map((tool) => (
                <code
                  key={tool}
                  className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary font-mono"
                >
                  {tool}
                </code>
              ))}
            </div>
          </div>

          {/* Steps */}
          <div>
            <p className="text-xs text-text-muted mb-2">Workflow Steps ({skill.steps.length})</p>
            <div className="space-y-2">
              {skill.steps.map((step, idx) => (
                <div key={step.name} className="flex items-start gap-3 p-3 bg-elevated rounded-lg">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-surface text-xs text-text-muted border border-border-subtle shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium text-text-primary">{step.name}</span>
                      {step.tool && (
                        <code className="px-1.5 py-0.5 text-xs bg-surface text-text-muted rounded font-mono">
                          {step.tool}
                        </code>
                      )}
                      {step.skill && (
                        <span className="px-1.5 py-0.5 text-xs bg-accent-primary/10 text-accent-primary rounded">
                          → {step.skill}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">{step.description}</p>
                    {(step.condition || step.on_success || step.on_failure) && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {step.condition && (
                          <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">
                            if: {step.condition}
                          </span>
                        )}
                        {step.on_success && (
                          <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded">
                            success → {step.on_success}
                          </span>
                        )}
                        {step.on_failure && (
                          <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded">
                            failure → {step.on_failure}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* System Prompt */}
          {skill.system_prompt && (
            <div>
              <p className="text-xs text-text-muted mb-2">System Prompt</p>
              <pre className="p-3 bg-elevated rounded-lg text-xs text-text-secondary font-mono whitespace-pre-wrap">
                {skill.system_prompt}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border-subtle flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Page Component
export default function MarketplaceManagement() {
  const [skills, setSkills] = useState<MarketplaceSkill[]>([]);
  const [stats, setStats] = useState<MarketplaceStats>({
    total: 0,
    pending_count: 0,
    approved_count: 0,
    rejected_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingSkill, setViewingSkill] = useState<MarketplaceSkill | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>(
    'pending'
  );

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const statusParam = statusFilter === 'all' ? '' : `?status_filter=${statusFilter}`;
      const response = await fetch(`/api/v1/admin/marketplace${statusParam}`);
      if (!response.ok) throw new Error('Failed to fetch marketplace skills');
      const data = await response.json();
      setSkills(data.skills || []);
      setStats({
        total: data.total,
        pending_count: data.pending_count,
        approved_count: data.approved_count,
        rejected_count: data.rejected_count,
      });
      setError(null);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
      setError('Failed to load marketplace skills');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleApprove = async (skillId: string) => {
    try {
      const response = await fetch(`/api/v1/admin/marketplace/${skillId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_default: false }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to approve skill');
      }
      toast.success('Skill approved and added to system skills');
      fetchSkills();
    } catch (err) {
      console.error('Failed to approve skill:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to approve skill');
      throw err;
    }
  };

  const handleReject = async (skillId: string, reason: string) => {
    try {
      const response = await fetch(`/api/v1/admin/marketplace/${skillId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error('Failed to reject skill');
      toast.success('Skill rejected');
      fetchSkills();
    } catch (err) {
      console.error('Failed to reject skill:', err);
      toast.error('Failed to reject skill');
      throw err;
    }
  };

  const handleDelete = async (skillId: string) => {
    try {
      const response = await fetch(`/api/v1/admin/marketplace/${skillId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete skill');
      toast.success('Skill deleted');
      fetchSkills();
    } catch (err) {
      console.error('Failed to delete skill:', err);
      toast.error('Failed to delete skill');
    }
  };

  // Filter skills by search
  const filteredSkills = skills.filter(
    (skill) =>
      searchQuery === '' ||
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.submitter_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.submitter_email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Store className="h-6 w-6 text-accent-primary" />
            Skill Marketplace
          </h1>
          <p className="text-text-muted mt-1">Review and approve community-submitted skills</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <button
          onClick={() => setStatusFilter('pending')}
          className={cn(
            'bg-surface rounded-xl border p-4 transition-colors text-left',
            statusFilter === 'pending'
              ? 'border-amber-500'
              : 'border-border-subtle hover:border-border'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <Clock className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.pending_count}</p>
              <p className="text-sm text-text-muted">Pending Review</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('approved')}
          className={cn(
            'bg-surface rounded-xl border p-4 transition-colors text-left',
            statusFilter === 'approved'
              ? 'border-green-500'
              : 'border-border-subtle hover:border-border'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.approved_count}</p>
              <p className="text-sm text-text-muted">Approved</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('rejected')}
          className={cn(
            'bg-surface rounded-xl border p-4 transition-colors text-left',
            statusFilter === 'rejected'
              ? 'border-red-500'
              : 'border-border-subtle hover:border-border'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/20">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.rejected_count}</p>
              <p className="text-sm text-text-muted">Rejected</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => setStatusFilter('all')}
          className={cn(
            'bg-surface rounded-xl border p-4 transition-colors text-left',
            statusFilter === 'all'
              ? 'border-accent-primary'
              : 'border-border-subtle hover:border-border'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-primary/20">
              <BarChart3 className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.total}</p>
              <p className="text-sm text-text-muted">Total Submissions</p>
            </div>
          </div>
        </button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name, slug, or submitter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6 flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
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
              onView={setViewingSkill}
              onApprove={handleApprove}
              onReject={handleReject}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredSkills.length === 0 && (
        <div className="text-center py-12">
          <Store className="h-12 w-12 mx-auto mb-4 text-text-muted opacity-50" />
          <h3 className="text-lg font-medium text-text-primary mb-2">
            {statusFilter === 'pending'
              ? 'No pending submissions'
              : statusFilter === 'approved'
                ? 'No approved skills'
                : statusFilter === 'rejected'
                  ? 'No rejected skills'
                  : 'No submissions yet'}
          </h3>
          <p className="text-text-muted">
            {statusFilter === 'pending'
              ? 'All submissions have been reviewed'
              : 'Check other status filters'}
          </p>
        </div>
      )}

      {/* Detail Modal */}
      {viewingSkill && <DetailModal skill={viewingSkill} onClose={() => setViewingSkill(null)} />}
    </div>
  );
}
