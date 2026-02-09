'use client';

import { useEffect, useState, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  ShieldCheck,
  Database,
  UserCheck,
  Download,
  Plus,
  RefreshCw,
  ChevronRight,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Eye,
  Edit,
  Trash2,
  Calendar,
  FileText,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface ComplianceStats {
  total_policies: number;
  enabled_policies: number;
  policies_executed_last_24h: number;
  total_archived: number;
  total_deleted: number;
  pending_reviews: number;
  in_progress_reviews: number;
  completed_reviews_30d: number;
  overdue_reviews: number;
  pending_exports: number;
  completed_exports_30d: number;
  failed_exports_30d: number;
}

interface DataRetentionPolicy {
  id: string;
  name: string;
  data_type: string;
  retention_days: number;
  archive_after_days: number | null;
  delete_after_archive_days: number | null;
  description: string | null;
  legal_basis: string | null;
  is_enabled: boolean;
  last_executed_at: string | null;
  records_archived: number;
  records_deleted: number;
  created_at: string;
  updated_at: string;
}

interface AccessReview {
  id: string;
  review_type: string;
  review_period_start: string;
  review_period_end: string;
  status: string;
  target_user_id: string | null;
  reviewer_id: string | null;
  findings: Record<string, unknown> | null;
  actions_taken: Record<string, unknown>[] | null;
  notes: string | null;
  initiated_at: string;
  completed_at: string | null;
  due_date: string | null;
}

interface DataExportRequest {
  id: string;
  user_id: string;
  request_type: string;
  data_categories: string[];
  status: string;
  processed_by: string | null;
  error_message: string | null;
  export_file_size_bytes: number | null;
  download_expires_at: string | null;
  download_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border-subtle p-4">
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <p className="text-text-muted text-sm">{title}</p>
          <p className="text-text-primary text-2xl font-semibold">{value}</p>
          {subtitle && <p className="text-text-muted text-xs mt-1">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ElementType; color: string }> = {
    pending: { icon: Clock, color: 'bg-yellow-500/20 text-yellow-500' },
    in_progress: { icon: RefreshCw, color: 'bg-blue-500/20 text-blue-400' },
    completed: { icon: CheckCircle, color: 'bg-green-500/20 text-green-500' },
    cancelled: { icon: XCircle, color: 'bg-gray-500/20 text-gray-400' },
    failed: { icon: XCircle, color: 'bg-red-500/20 text-red-500' },
    processing: { icon: RefreshCw, color: 'bg-blue-500/20 text-blue-400' },
  };

  const { icon: Icon, color } = (config[status] ?? config.pending)!;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        color
      )}
    >
      <Icon className="h-3 w-3" />
      {status.replace('_', ' ')}
    </span>
  );
}

interface PolicyModalProps {
  policy?: DataRetentionPolicy;
  onClose: () => void;
  onSave: (data: Partial<DataRetentionPolicy>) => void;
}

function PolicyModal({ policy, onClose, onSave }: PolicyModalProps) {
  const [formData, setFormData] = useState({
    name: policy?.name || '',
    data_type: policy?.data_type || '',
    retention_days: policy?.retention_days || 90,
    archive_after_days: policy?.archive_after_days || null,
    delete_after_archive_days: policy?.delete_after_archive_days || null,
    description: policy?.description || '',
    legal_basis: policy?.legal_basis || '',
    is_enabled: policy?.is_enabled ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-lg w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">
            {policy ? 'Edit Policy' : 'Create Policy'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Policy Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Data Type</label>
            <select
              value={formData.data_type}
              onChange={(e) => setFormData({ ...formData, data_type: e.target.value })}
              required
              disabled={!!policy}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary disabled:opacity-50"
            >
              <option value="">Select data type...</option>
              <option value="audit_logs">Audit Logs</option>
              <option value="sessions">Sessions</option>
              <option value="messages">Messages</option>
              <option value="files">Files</option>
              <option value="analytics">Analytics</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Retention (days)</label>
              <input
                type="number"
                value={formData.retention_days}
                onChange={(e) =>
                  setFormData({ ...formData, retention_days: parseInt(e.target.value) })
                }
                min={1}
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Archive after (days)</label>
              <input
                type="number"
                value={formData.archive_after_days || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    archive_after_days: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                min={1}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Delete after archive</label>
              <input
                type="number"
                value={formData.delete_after_archive_days || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    delete_after_archive_days: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                min={1}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary resize-none"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Legal Basis</label>
            <textarea
              value={formData.legal_basis}
              onChange={(e) => setFormData({ ...formData, legal_basis: e.target.value })}
              rows={2}
              placeholder="e.g., GDPR Article 17, SOC 2 requirement..."
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary resize-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_enabled"
              checked={formData.is_enabled}
              onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="is_enabled" className="text-sm text-text-secondary">
              Policy is enabled
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              {policy ? 'Save Changes' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ReviewModalProps {
  onClose: () => void;
  onSave: (data: Partial<AccessReview>) => void;
}

function ReviewModal({ onClose, onSave }: ReviewModalProps) {
  const today = new Date().toISOString().split('T')[0]!;
  const [formData, setFormData] = useState({
    review_type: 'user_access',
    review_period_start: today,
    review_period_end: today,
    due_date: '',
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      review_type: formData.review_type,
      review_period_start: new Date(formData.review_period_start).toISOString(),
      review_period_end: new Date(formData.review_period_end).toISOString(),
      due_date: formData.due_date ? new Date(formData.due_date).toISOString() : undefined,
      notes: formData.notes || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-lg w-full">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Initiate Access Review</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Review Type</label>
            <select
              value={formData.review_type}
              onChange={(e) => setFormData({ ...formData, review_type: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
            >
              <option value="user_access">User Access Review</option>
              <option value="admin_access">Admin Access Review</option>
              <option value="api_keys">API Keys Review</option>
              <option value="integrations">Integrations Review</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Period Start</label>
              <input
                type="date"
                value={formData.review_period_start}
                onChange={(e) => setFormData({ ...formData, review_period_start: e.target.value })}
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Period End</label>
              <input
                type="date"
                value={formData.review_period_end}
                onChange={(e) => setFormData({ ...formData, review_period_end: e.target.value })}
                required
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Due Date (optional)</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-text-secondary hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              Initiate Review
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type TabType = 'overview' | 'retention' | 'reviews' | 'exports';

export default function CompliancePage() {
  useDocumentTitle('Compliance');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [stats, setStats] = useState<ComplianceStats | null>(null);
  const [policies, setPolicies] = useState<DataRetentionPolicy[]>([]);
  const [reviews, setReviews] = useState<AccessReview[]>([]);
  const [exports, setExports] = useState<DataExportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<DataRetentionPolicy | undefined>();
  const [showReviewModal, setShowReviewModal] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<ComplianceStats>('/api/admin/compliance/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch compliance stats:', err);
    }
  }, []);

  const fetchPolicies = useCallback(async () => {
    try {
      const data = await api.get<DataRetentionPolicy[]>('/api/admin/compliance/retention/policies');
      setPolicies(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, []);

  const fetchReviews = useCallback(async () => {
    try {
      const data = await api.get<AccessReview[]>('/api/admin/compliance/access-reviews');
      setReviews(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, []);

  const fetchExports = useCallback(async () => {
    try {
      const data = await api.get<DataExportRequest[]>('/api/admin/compliance/data-exports');
      setExports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchStats(), fetchPolicies(), fetchReviews(), fetchExports()]);
      setLoading(false);
    };
    loadData();
  }, [fetchStats, fetchPolicies, fetchReviews, fetchExports]);

  const handleSavePolicy = async (data: Partial<DataRetentionPolicy>) => {
    try {
      if (editingPolicy) {
        await api.patch(`/api/admin/compliance/retention/policies/${editingPolicy.id}`, data);
      } else {
        await api.post('/api/admin/compliance/retention/policies', data);
      }

      setShowPolicyModal(false);
      setEditingPolicy(undefined);
      fetchPolicies();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save policy');
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    if (!confirm('Are you sure you want to delete this policy?')) return;

    try {
      await api.delete(`/api/admin/compliance/retention/policies/${policyId}`);
      fetchPolicies();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete policy');
    }
  };

  const handleRunPolicy = async (policyId: string, dryRun: boolean = true) => {
    try {
      const results = await api.post<Record<string, unknown>>(
        `/api/admin/compliance/retention/run?policy_id=${policyId}&dry_run=${dryRun}`,
        {}
      );
      alert(`Policy executed${dryRun ? ' (dry run)' : ''}:\n${JSON.stringify(results, null, 2)}`);
      if (!dryRun) {
        fetchPolicies();
        fetchStats();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to run policy');
    }
  };

  const handleSaveReview = async (data: Partial<AccessReview>) => {
    try {
      await api.post('/api/admin/compliance/access-reviews', data);
      setShowReviewModal(false);
      fetchReviews();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create review');
    }
  };

  const handleProcessExport = async (requestId: string) => {
    try {
      await api.post(`/api/admin/compliance/data-exports/${requestId}/process`, {});
      fetchExports();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to process export');
    }
  };

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: ShieldCheck },
    { id: 'retention' as const, label: 'Data Retention', icon: Database },
    { id: 'reviews' as const, label: 'Access Reviews', icon: UserCheck },
    { id: 'exports' as const, label: 'Data Exports', icon: Download },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-accent-primary" />
          Compliance Center
        </h1>
        <p className="text-text-muted mt-1">
          SOC 2 compliance management, data retention, and access reviews
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-subtle">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.id
                  ? 'text-accent-primary border-accent-primary'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">{error}</div>}

      {/* Overview Tab */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-text-primary">Compliance Dashboard</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Active Policies"
              value={stats.enabled_policies}
              icon={Database}
              color="bg-blue-500/20 text-blue-400"
              subtitle={`${stats.total_policies} total`}
            />
            <StatsCard
              title="Overdue Reviews"
              value={stats.overdue_reviews}
              icon={AlertTriangle}
              color={
                stats.overdue_reviews > 0
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-green-500/20 text-green-400'
              }
              subtitle={`${stats.pending_reviews} pending`}
            />
            <StatsCard
              title="Pending Exports"
              value={stats.pending_exports}
              icon={Download}
              color="bg-purple-500/20 text-purple-400"
              subtitle={`${stats.completed_exports_30d} completed (30d)`}
            />
            <StatsCard
              title="Records Processed"
              value={(stats.total_archived + stats.total_deleted).toLocaleString()}
              icon={FileText}
              color="bg-emerald-500/20 text-emerald-400"
              subtitle={`${stats.total_archived.toLocaleString()} archived, ${stats.total_deleted.toLocaleString()} deleted`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Reviews */}
            <div className="bg-surface rounded-xl border border-border-subtle p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-text-primary">Recent Access Reviews</h3>
                <button
                  onClick={() => setActiveTab('reviews')}
                  className="text-sm text-accent-primary hover:underline flex items-center gap-1"
                >
                  View all <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {reviews.length === 0 ? (
                <p className="text-text-muted text-sm">No access reviews yet</p>
              ) : (
                <div className="space-y-2">
                  {reviews.slice(0, 3).map((review) => (
                    <div
                      key={review.id}
                      className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                    >
                      <div>
                        <p className="text-text-primary text-sm font-medium">
                          {review.review_type.replace('_', ' ')}
                        </p>
                        <p className="text-text-muted text-xs">
                          {formatRelativeTime(review.initiated_at)}
                        </p>
                      </div>
                      <StatusBadge status={review.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Retention Policies */}
            <div className="bg-surface rounded-xl border border-border-subtle p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-text-primary">Data Retention Policies</h3>
                <button
                  onClick={() => setActiveTab('retention')}
                  className="text-sm text-accent-primary hover:underline flex items-center gap-1"
                >
                  Manage <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {policies.length === 0 ? (
                <p className="text-text-muted text-sm">No retention policies configured</p>
              ) : (
                <div className="space-y-2">
                  {policies.slice(0, 3).map((policy) => (
                    <div
                      key={policy.id}
                      className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                    >
                      <div>
                        <p className="text-text-primary text-sm font-medium">{policy.name}</p>
                        <p className="text-text-muted text-xs">
                          {policy.retention_days} days retention
                        </p>
                      </div>
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs',
                          policy.is_enabled
                            ? 'bg-green-500/20 text-green-500'
                            : 'bg-gray-500/20 text-gray-400'
                        )}
                      >
                        {policy.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Data Retention Tab */}
      {activeTab === 'retention' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">Data Retention Policies</h2>
            <button
              onClick={() => {
                setEditingPolicy(undefined);
                setShowPolicyModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              <Plus className="h-4 w-4" />
              Add Policy
            </button>
          </div>

          <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-elevated">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Policy
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Data Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Retention
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Last Run
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {policies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                      No retention policies configured
                    </td>
                  </tr>
                ) : (
                  policies.map((policy) => (
                    <tr
                      key={policy.id}
                      className="border-t border-border-subtle hover:bg-overlay/30"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-text-primary font-medium">{policy.name}</p>
                          {policy.description && (
                            <p className="text-text-muted text-xs truncate max-w-xs">
                              {policy.description}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-sm">{policy.data_type}</td>
                      <td className="px-4 py-3">
                        <div className="text-text-secondary text-sm">
                          <p>{policy.retention_days} days</p>
                          {policy.archive_after_days && (
                            <p className="text-text-muted text-xs">
                              Archive: {policy.archive_after_days}d
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-text-muted text-sm">
                        {formatRelativeTime(policy.last_executed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs',
                            policy.is_enabled
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-gray-500/20 text-gray-400'
                          )}
                        >
                          {policy.is_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRunPolicy(policy.id, true)}
                            className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
                            title="Dry run"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleRunPolicy(policy.id, false)}
                            className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-accent-primary"
                            title="Run policy"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setEditingPolicy(policy);
                              setShowPolicyModal(true);
                            }}
                            className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeletePolicy(policy.id)}
                            className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Access Reviews Tab */}
      {activeTab === 'reviews' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">Access Reviews</h2>
            <button
              onClick={() => setShowReviewModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90"
            >
              <Plus className="h-4 w-4" />
              Initiate Review
            </button>
          </div>

          <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-elevated">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Review Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Period
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Due Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Initiated
                  </th>
                </tr>
              </thead>
              <tbody>
                {reviews.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-text-muted">
                      No access reviews yet
                    </td>
                  </tr>
                ) : (
                  reviews.map((review) => (
                    <tr
                      key={review.id}
                      className="border-t border-border-subtle hover:bg-overlay/30"
                    >
                      <td className="px-4 py-3">
                        <p className="text-text-primary font-medium">
                          {review.review_type.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary text-sm">
                        {formatDate(review.review_period_start).split(',')[0]} -{' '}
                        {formatDate(review.review_period_end).split(',')[0]}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={review.status} />
                      </td>
                      <td className="px-4 py-3">
                        {review.due_date ? (
                          <div className="flex items-center gap-1 text-text-secondary text-sm">
                            <Calendar className="h-4 w-4" />
                            {formatDate(review.due_date).split(',')[0]}
                          </div>
                        ) : (
                          <span className="text-text-muted text-sm">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted text-sm">
                        {formatRelativeTime(review.initiated_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Exports Tab */}
      {activeTab === 'exports' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-text-primary">Data Export Requests</h2>

          <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
            <table className="w-full">
              <thead className="bg-elevated">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Categories
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Requested
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {exports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                      No data export requests
                    </td>
                  </tr>
                ) : (
                  exports.map((request) => (
                    <tr
                      key={request.id}
                      className="border-t border-border-subtle hover:bg-overlay/30"
                    >
                      <td className="px-4 py-3 text-text-secondary text-sm font-mono">
                        {request.user_id.substring(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-text-primary text-sm">
                        {request.request_type.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {request.data_categories.slice(0, 3).map((cat) => (
                            <span
                              key={cat}
                              className="px-2 py-0.5 bg-elevated rounded text-xs text-text-secondary"
                            >
                              {cat}
                            </span>
                          ))}
                          {request.data_categories.length > 3 && (
                            <span className="px-2 py-0.5 bg-elevated rounded text-xs text-text-muted">
                              +{request.data_categories.length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={request.status} />
                      </td>
                      <td className="px-4 py-3 text-text-muted text-sm">
                        {formatRelativeTime(request.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {request.status === 'pending' && (
                          <button
                            onClick={() => handleProcessExport(request.id)}
                            className="flex items-center gap-1 px-3 py-1 rounded bg-accent-primary text-white text-sm hover:bg-accent-primary/90"
                          >
                            <Play className="h-3 w-3" />
                            Process
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {showPolicyModal && (
        <PolicyModal
          policy={editingPolicy}
          onClose={() => {
            setShowPolicyModal(false);
            setEditingPolicy(undefined);
          }}
          onSave={handleSavePolicy}
        />
      )}

      {showReviewModal && (
        <ReviewModal onClose={() => setShowReviewModal(false)} onSave={handleSaveReview} />
      )}
    </div>
  );
}
