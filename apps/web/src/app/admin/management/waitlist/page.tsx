'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Search,
  Send,
  Clock,
  CheckCircle,
  UserPlus,
  Mail,
  Trash2,
  MoreVertical,
  Users,
  RefreshCw,
  Gift,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listWaitlistEntries,
  sendWaitlistInvitation,
  deleteWaitlistEntry,
  bulkInviteWaitlist,
  type WaitlistEntry,
} from '@/lib/api';
import { useAdminStore } from '@/stores/admin';
import { toast } from 'sonner';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface StatusBadgeProps {
  status: WaitlistEntry['status'];
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    waiting: {
      icon: Clock,
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      label: 'Waiting',
    },
    invited: {
      icon: Send,
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      label: 'Invited',
    },
    registered: {
      icon: CheckCircle,
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      label: 'Registered',
    },
  }[status];

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
        config.bg,
        config.text
      )}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

interface WaitlistRowProps {
  entry: WaitlistEntry;
  onInvite: (id: string) => void;
  onDelete: (id: string) => void;
}

function WaitlistRow({ entry, onInvite, onDelete }: WaitlistRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOpenMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.right - 160, // 160px is min-w of menu, align right edge
      });
    }
    setShowMenu(true);
  };

  return (
    <tr className="border-b border-border-subtle hover:bg-overlay/30 transition-colors">
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
            <Mail className="w-5 h-5 text-accent-primary" />
          </div>
          <div>
            <p className="text-text-primary font-medium">{entry.email}</p>
            <p className="text-text-muted text-xs">
              Source: {entry.source}
              {entry.referral_code && ` • Referral: ${entry.referral_code}`}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-center">
        {entry.position ? (
          <span className="text-accent-primary font-bold">#{entry.position}</span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-4">
        <StatusBadge status={entry.status} />
      </td>
      <td className="px-4 py-4 text-text-muted text-sm">{formatDate(entry.created_at)}</td>
      <td className="px-4 py-4 text-text-muted text-sm">
        {entry.invited_at ? formatDate(entry.invited_at) : '—'}
      </td>
      <td className="px-4 py-4">
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={handleOpenMenu}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
          >
            <MoreVertical className="h-4 w-4 text-text-muted" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div
                className="fixed bg-surface border border-border-subtle rounded-lg shadow-lg py-1 z-50 min-w-[160px]"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                {entry.status === 'waiting' && (
                  <button
                    onClick={() => {
                      onInvite(entry.id);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2 text-text-primary"
                  >
                    <Send className="h-4 w-4 text-blue-400" />
                    <span>Send Invite</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    onDelete(entry.id);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2 text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

interface BulkInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    count: number,
    options?: { message?: string; gift_plan_id?: string; gift_months?: number }
  ) => Promise<void>;
  waitingCount: number;
}

function BulkInviteModal({ isOpen, onClose, onSubmit, waitingCount }: BulkInviteModalProps) {
  const { plans, fetchPlans } = useAdminStore();
  const [count, setCount] = useState(10);
  const [message, setMessage] = useState('');
  const [giftEnabled, setGiftEnabled] = useState(false);
  const [giftPlanId, setGiftPlanId] = useState('');
  const [giftMonths, setGiftMonths] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && plans.length === 0) {
      fetchPlans();
    }
  }, [isOpen, plans.length, fetchPlans]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await onSubmit(count, {
        message: message || undefined,
        gift_plan_id: giftEnabled ? giftPlanId : undefined,
        gift_months: giftEnabled ? giftMonths : undefined,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border-subtle rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border-subtle">
          <h2 className="text-xl font-bold text-text-primary">Bulk Invite Users</h2>
          <p className="text-text-muted text-sm mt-1">Invite multiple users from the waitlist</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Number of users to invite (max {Math.min(waitingCount, 50)})
            </label>
            <input
              type="number"
              min={1}
              max={Math.min(waitingCount, 50)}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Personal message (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Add a personal note to all invitations..."
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none resize-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="gift-toggle"
              checked={giftEnabled}
              onChange={(e) => setGiftEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-border-subtle bg-elevated text-accent-primary focus:ring-accent-primary/50"
            />
            <label
              htmlFor="gift-toggle"
              className="text-sm text-text-secondary flex items-center gap-2"
            >
              <Gift className="w-4 h-4 text-purple-400" />
              Include subscription gift
            </label>
          </div>

          {giftEnabled && (
            <div className="pl-6 space-y-4 border-l-2 border-purple-500/30">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Gift Plan
                </label>
                <select
                  value={giftPlanId}
                  onChange={(e) => setGiftPlanId(e.target.value)}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none"
                >
                  <option value="">Select a plan...</option>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} (${(plan.price_monthly_cents / 100).toFixed(0)}/mo)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Gift Duration (months)
                </label>
                <select
                  value={giftMonths}
                  onChange={(e) => setGiftMonths(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none"
                >
                  {[1, 2, 3, 6, 12, 24].map((m) => (
                    <option key={m} value={m}>
                      {m} month{m > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || count < 1}
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Users className="w-4 h-4" />
                  Invite {count} Users
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [stats, setStats] = useState({ total: 0, waiting: 0, invited: 0, registered: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const pageSize = 20;

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listWaitlistEntries(
        page,
        pageSize,
        statusFilter || undefined,
        search || undefined
      );
      setEntries(response.items);
      setTotal(response.total);
      setHasMore(response.has_more);
      setStats(response.stats);
    } catch (error) {
      console.error('Failed to fetch waitlist entries:', error);
      toast.error('Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleInvite = async (entryId: string) => {
    try {
      await sendWaitlistInvitation(entryId);
      toast.success('Invitation sent');
      fetchEntries();
    } catch (error) {
      console.error('Failed to send invitation:', error);
      toast.error('Failed to send invitation');
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this waitlist entry?')) return;

    try {
      await deleteWaitlistEntry(entryId);
      toast.success('Entry deleted');
      fetchEntries();
    } catch (error) {
      console.error('Failed to delete entry:', error);
      toast.error('Failed to delete entry');
    }
  };

  const handleBulkInvite = async (
    count: number,
    options?: { message?: string; gift_plan_id?: string; gift_months?: number }
  ) => {
    try {
      const result = await bulkInviteWaitlist(count, options);
      toast.success(
        `${result.invited} invitations sent${result.skipped > 0 ? `, ${result.skipped} skipped` : ''}`
      );
      fetchEntries();
    } catch (error) {
      console.error('Failed to bulk invite:', error);
      toast.error('Failed to send bulk invitations');
      throw error;
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Waitlist</h1>
          <p className="text-text-muted">Manage users waiting for platform access</p>
        </div>
        <button
          onClick={() => setShowBulkModal(true)}
          disabled={stats.waiting === 0}
          className="flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <UserPlus className="w-4 h-4" />
          Bulk Invite
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-primary/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-accent-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
              <p className="text-text-muted text-sm">Total Signups</p>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{stats.waiting}</p>
              <p className="text-text-muted text-sm">Waiting</p>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Send className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{stats.invited}</p>
              <p className="text-text-muted text-sm">Invited</p>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{stats.registered}</p>
              <p className="text-text-muted text-sm">Registered</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/50 outline-none"
        >
          <option value="">All statuses</option>
          <option value="waiting">Waiting</option>
          <option value="invited">Invited</option>
          <option value="registered">Registered</option>
        </select>
        <button
          onClick={fetchEntries}
          className="px-4 py-2 bg-surface border border-border-subtle rounded-lg text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors flex items-center gap-2"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-elevated border-b border-border-subtle">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider">
                  Position
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Invited
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-2" />
                    <p className="text-text-muted">Loading waitlist...</p>
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <Users className="w-8 h-8 text-text-muted mx-auto mb-2" />
                    <p className="text-text-muted">No waitlist entries found</p>
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <WaitlistRow
                    key={entry.id}
                    entry={entry}
                    onInvite={handleInvite}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > pageSize && (
          <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between">
            <p className="text-sm text-text-muted">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}{' '}
              entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm bg-elevated border border-border-subtle rounded-lg hover:border-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore}
                className="px-3 py-1.5 text-sm bg-elevated border border-border-subtle rounded-lg hover:border-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk Invite Modal */}
      <BulkInviteModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onSubmit={handleBulkInvite}
        waitingCount={stats.waiting}
      />
    </div>
  );
}
