'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
  AlertTriangle,
  Check,
  X,
  FileText,
  User,
  Calendar,
  RefreshCw,
  Filter,
  Download,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

interface AuditLog {
  id: string;
  user_id: string | null;
  user_email: string | null;
  session_id: string | null;
  action: string;
  category: string;
  resource_type: string | null;
  resource_id: string | null;
  status: string;
  details: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  request_path: string | null;
  request_method: string | null;
  created_at: string;
}

interface AuditStats {
  total_logs: number;
  by_category: Record<string, number>;
  by_action: Record<string, number>;
  by_status: Record<string, number>;
  recent_failures: number;
  unique_users: number;
  date_range: { oldest: string | null; newest: string | null };
}

interface AuditListResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    success: { icon: Check, color: 'bg-green-500/20 text-green-500' },
    failure: { icon: X, color: 'bg-red-500/20 text-red-500' },
    denied: { icon: AlertTriangle, color: 'bg-yellow-500/20 text-yellow-500' },
  }[status] || { icon: FileText, color: 'bg-gray-500/20 text-gray-500' };

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        config.color
      )}
    >
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    auth: 'bg-blue-500/20 text-blue-400',
    file: 'bg-purple-500/20 text-purple-400',
    agent: 'bg-cyan-500/20 text-cyan-400',
    session: 'bg-green-500/20 text-green-400',
    billing: 'bg-yellow-500/20 text-yellow-400',
    admin: 'bg-red-500/20 text-red-400',
  };

  return (
    <span
      className={cn(
        'inline-flex px-2 py-0.5 rounded text-xs font-medium',
        colors[category] || 'bg-gray-500/20 text-gray-400'
      )}
    >
      {category}
    </span>
  );
}

interface AuditRowProps {
  log: AuditLog;
  onViewDetails: (log: AuditLog) => void;
}

function AuditRow({ log, onViewDetails }: AuditRowProps) {
  return (
    <tr className="border-b border-border-subtle hover:bg-overlay/30 transition-colors">
      <td className="px-4 py-3">
        <span className="text-text-muted text-xs font-mono">
          {formatRelativeTime(log.created_at)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <CategoryBadge category={log.category} />
          <span className="text-text-primary text-sm font-medium">{log.action}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {log.user_email ? (
            <>
              <User className="h-4 w-4 text-text-muted" />
              <span className="text-text-secondary text-sm">{log.user_email}</span>
            </>
          ) : (
            <span className="text-text-muted text-sm italic">System</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {log.resource_type && log.resource_id ? (
          <span className="text-text-secondary text-sm">
            {log.resource_type}/{log.resource_id.substring(0, 8)}...
          </span>
        ) : (
          <span className="text-text-muted text-sm">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={log.status} />
      </td>
      <td className="px-4 py-3">
        <span className="text-text-muted text-xs font-mono">{log.ip_address || '-'}</span>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onViewDetails(log)}
          className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors"
        >
          <Eye className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

interface AuditDetailsModalProps {
  log: AuditLog;
  onClose: () => void;
}

function AuditDetailsModal({ log, onClose }: AuditDetailsModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-xl border border-border-subtle max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Audit Log Details</h2>
          <button onClick={onClose} className="p-1 hover:bg-elevated rounded">
            <X className="h-5 w-5 text-text-muted" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Action</label>
              <p className="text-text-primary font-medium">{log.action}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Category</label>
              <div className="mt-1">
                <CategoryBadge category={log.category} />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Status</label>
              <div className="mt-1">
                <StatusBadge status={log.status} />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Timestamp</label>
              <p className="text-text-secondary text-sm">{formatDate(log.created_at)}</p>
            </div>
          </div>

          <hr className="border-border-subtle" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">User</label>
              <p className="text-text-secondary text-sm">{log.user_email || 'System'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">User ID</label>
              <p className="text-text-muted text-xs font-mono">{log.user_id || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">IP Address</label>
              <p className="text-text-muted text-xs font-mono">{log.ip_address || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Session</label>
              <p className="text-text-muted text-xs font-mono">
                {log.session_id ? log.session_id.substring(0, 8) + '...' : '-'}
              </p>
            </div>
          </div>

          <hr className="border-border-subtle" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">
                Resource Type
              </label>
              <p className="text-text-secondary text-sm">{log.resource_type || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">Resource ID</label>
              <p className="text-text-muted text-xs font-mono">{log.resource_id || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">
                Request Path
              </label>
              <p className="text-text-muted text-xs font-mono">{log.request_path || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-text-muted uppercase tracking-wide">
                Request Method
              </label>
              <p className="text-text-secondary text-sm">{log.request_method || '-'}</p>
            </div>
          </div>

          {log.details && Object.keys(log.details).length > 0 && (
            <>
              <hr className="border-border-subtle" />
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wide mb-2 block">
                  Details
                </label>
                <pre className="bg-elevated rounded-lg p-3 text-xs text-text-secondary overflow-x-auto">
                  {JSON.stringify(log.details, null, 2)}
                </pre>
              </div>
            </>
          )}

          {log.changes && Object.keys(log.changes).length > 0 && (
            <>
              <hr className="border-border-subtle" />
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wide mb-2 block">
                  Changes
                </label>
                <pre className="bg-elevated rounded-lg p-3 text-xs text-text-secondary overflow-x-auto">
                  {JSON.stringify(log.changes, null, 2)}
                </pre>
              </div>
            </>
          )}

          {log.user_agent && (
            <>
              <hr className="border-border-subtle" />
              <div>
                <label className="text-xs text-text-muted uppercase tracking-wide">
                  User Agent
                </label>
                <p className="text-text-muted text-xs break-all">{log.user_agent}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border-subtle p-4">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-text-muted text-sm">{title}</p>
          <p className="text-text-primary text-xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 50;

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (startDate) params.set('start_date', new Date(startDate).toISOString());
      if (endDate) params.set('end_date', new Date(endDate).toISOString());

      const data = await api.get<AuditListResponse>(`/api/admin/audit?${params}`);
      setLogs(data.logs);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryFilter, statusFilter, startDate, endDate]);

  const fetchStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('start_date', new Date(startDate).toISOString());
      if (endDate) params.set('end_date', new Date(endDate).toISOString());

      const data = await api.get<AuditStats>(`/api/admin/audit/stats?${params}`);
      setStats(data);
    } catch {
      // Stats are non-critical
    }
  }, [startDate, endDate]);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.get<string[]>('/api/admin/audit/categories');
      setCategories(data);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleExport = () => {
    const params = new URLSearchParams({
      page: '1',
      page_size: '1000',
    });
    if (search) params.set('search', search);
    if (categoryFilter) params.set('category', categoryFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (startDate) params.set('start_date', new Date(startDate).toISOString());
    if (endDate) params.set('end_date', new Date(endDate).toISOString());

    window.open(`/api/admin/audit?${params}`, '_blank');
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-3">
            <Shield className="h-7 w-7 text-accent-primary" />
            Audit Logs
          </h1>
          <p className="text-text-muted mt-1">
            Monitor and review security-relevant actions across the platform
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              fetchLogs();
              fetchStats();
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:bg-overlay transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatsCard
            title="Total Events"
            value={stats.total_logs.toLocaleString()}
            icon={FileText}
            color="bg-blue-500/20 text-blue-400"
          />
          <StatsCard
            title="Unique Users"
            value={stats.unique_users}
            icon={User}
            color="bg-green-500/20 text-green-400"
          />
          <StatsCard
            title="Recent Failures (24h)"
            value={stats.recent_failures}
            icon={AlertTriangle}
            color="bg-red-500/20 text-red-400"
          />
          <StatsCard
            title="Success Rate"
            value={
              stats.total_logs > 0
                ? `${(((stats.by_status['success'] || 0) / stats.total_logs) * 100).toFixed(1)}%`
                : '100%'
            }
            icon={Check}
            color="bg-emerald-500/20 text-emerald-400"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search actions, emails, IPs..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
        >
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="denied">Denied</option>
        </select>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-text-muted" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary text-sm"
          />
          <span className="text-text-muted">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary text-sm"
          />
        </div>

        {(search || categoryFilter || statusFilter || startDate || endDate) && (
          <button
            onClick={() => {
              setSearch('');
              setCategoryFilter('');
              setStatusFilter('');
              setStartDate('');
              setEndDate('');
              setPage(1);
            }}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-elevated transition-colors"
          >
            <Filter className="h-4 w-4" />
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border-subtle overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-elevated">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Resource
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  IP
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="border-b border-border-subtle">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="h-6 bg-elevated rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                    No audit logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <AuditRow key={log.id} log={log} onViewDetails={setSelectedLog} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
          <p className="text-sm text-text-muted">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}{' '}
            events
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-text-secondary">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedLog && <AuditDetailsModal log={selectedLog} onClose={() => setSelectedLog(null)} />}
    </div>
  );
}
