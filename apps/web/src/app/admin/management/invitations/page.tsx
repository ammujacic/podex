'use client';

import { useEffect, useState, useCallback } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  Search,
  Plus,
  Send,
  XCircle,
  Clock,
  CheckCircle,
  RefreshCw,
  Gift,
  Mail,
  Trash2,
  MoreVertical,
  User,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listPlatformInvitations,
  createPlatformInvitation,
  resendPlatformInvitation,
  revokePlatformInvitation,
  deletePlatformInvitation,
  type PlatformInvitation,
  type CreateInvitationRequest,
} from '@/lib/api';
import { useAdminStore } from '@/stores/admin';

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Expired';
  if (diffDays === 0) return 'Expires today';
  if (diffDays === 1) return 'Expires tomorrow';
  return `Expires in ${diffDays} days`;
}

interface StatusBadgeProps {
  status: PlatformInvitation['status'];
}

function StatusBadge({ status }: StatusBadgeProps) {
  const config = {
    pending: {
      icon: Clock,
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      label: 'Pending',
    },
    accepted: {
      icon: CheckCircle,
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      label: 'Accepted',
    },
    expired: {
      icon: Clock,
      bg: 'bg-gray-500/20',
      text: 'text-gray-400',
      label: 'Expired',
    },
    revoked: {
      icon: XCircle,
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      label: 'Revoked',
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

interface InvitationRowProps {
  invitation: PlatformInvitation;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  onDelete: (id: string) => void;
}

function InvitationRow({ invitation, onResend, onRevoke, onDelete }: InvitationRowProps) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <tr className="border-b border-border-subtle hover:bg-overlay/30 transition-colors">
      <td className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
            <Mail className="w-5 h-5 text-accent-primary" />
          </div>
          <div>
            <p className="text-text-primary font-medium">{invitation.email}</p>
            {invitation.message && (
              <p className="text-text-muted text-sm truncate max-w-[300px]">
                &ldquo;{invitation.message}&rdquo;
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <StatusBadge status={invitation.status} />
      </td>
      <td className="px-4 py-4">
        {invitation.gift_plan_name && invitation.gift_months ? (
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-purple-400" />
            <div>
              <p className="text-purple-400 font-medium text-sm">{invitation.gift_plan_name}</p>
              <p className="text-text-muted text-xs">
                {invitation.gift_months} month{invitation.gift_months > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        ) : (
          <span className="text-text-muted text-sm">No gift</span>
        )}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-col">
          <span className="text-text-secondary text-sm">
            {invitation.status === 'pending' ? formatRelativeDate(invitation.expires_at) : '—'}
          </span>
          <span className="text-text-muted text-xs">{formatDate(invitation.expires_at)}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        {invitation.invited_by_name ? (
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-text-muted" />
            <span className="text-text-secondary text-sm">{invitation.invited_by_name}</span>
          </div>
        ) : (
          <span className="text-text-muted text-sm">System</span>
        )}
      </td>
      <td className="px-4 py-4 text-text-muted text-sm">{formatDate(invitation.created_at)}</td>
      <td className="px-4 py-4">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 hover:bg-elevated rounded-lg transition-colors"
          >
            <MoreVertical className="h-4 w-4 text-text-muted" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 bg-surface border border-border-subtle rounded-lg shadow-lg py-1 z-20 min-w-[160px]">
                {invitation.status === 'pending' && (
                  <>
                    <button
                      onClick={() => {
                        onResend(invitation.id);
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2 text-text-primary"
                    >
                      <RefreshCw className="h-4 w-4 text-blue-400" />
                      <span>Resend</span>
                    </button>
                    <button
                      onClick={() => {
                        onRevoke(invitation.id);
                        setShowMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-overlay flex items-center gap-2 text-text-primary"
                    >
                      <XCircle className="h-4 w-4 text-yellow-400" />
                      <span>Revoke</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    onDelete(invitation.id);
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

interface CreateInvitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateInvitationRequest) => Promise<void>;
}

function CreateInvitationModal({ isOpen, onClose, onSubmit }: CreateInvitationModalProps) {
  const { plans, fetchPlans } = useAdminStore();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [giftEnabled, setGiftEnabled] = useState(false);
  const [giftPlanId, setGiftPlanId] = useState('');
  const [giftMonths, setGiftMonths] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && plans.length === 0) {
      fetchPlans();
    }
  }, [isOpen, plans.length, fetchPlans]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await onSubmit({
        email,
        message: message || undefined,
        gift_plan_id: giftEnabled && giftPlanId ? giftPlanId : undefined,
        gift_months: giftEnabled && giftPlanId ? giftMonths : undefined,
        expires_in_days: expiresInDays,
      });
      // Reset form
      setEmail('');
      setMessage('');
      setGiftEnabled(false);
      setGiftPlanId('');
      setGiftMonths(1);
      setExpiresInDays(7);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invitation');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const activePlans = plans.filter((p) => p.is_active);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-accent-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Send Exclusive Invitation</h3>
              <p className="text-sm text-text-muted">Invite someone special to join Podex</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Email Address *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="colleague@company.com"
              className="w-full px-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
            />
          </div>

          {/* Personal Message */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Personal Message (Optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Add a personal note to make the invitation more welcoming..."
              className="w-full px-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary resize-none"
            />
            <p className="mt-1 text-xs text-text-muted">{message.length}/500</p>
          </div>

          {/* Gift Subscription Toggle */}
          <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={giftEnabled}
                onChange={(e) => setGiftEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-border-subtle bg-elevated text-purple-500 focus:ring-purple-500"
              />
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium text-text-primary">
                  Include subscription gift
                </span>
              </div>
            </label>

            {giftEnabled && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Plan</label>
                  <select
                    value={giftPlanId}
                    onChange={(e) => setGiftPlanId(e.target.value)}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="">Select a plan</option>
                    {activePlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Months</label>
                  <select
                    value={giftMonths}
                    onChange={(e) => setGiftMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Invitation Expires In
            </label>
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !email}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
                'bg-gradient-to-r from-accent-primary to-accent-secondary text-white',
                'hover:shadow-lg hover:shadow-accent-primary/25',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Send Invitation</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function InvitationsManagement() {
  useDocumentTitle('Invitations');
  const [invitations, setInvitations] = useState<PlatformInvitation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const pageSize = 20;

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listPlatformInvitations(
        page,
        pageSize,
        statusFilter || undefined,
        searchQuery || undefined
      );
      setInvitations(response.items);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to load invitations:', error);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchQuery]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  const handleCreate = async (data: CreateInvitationRequest) => {
    await createPlatformInvitation(data);
    await loadInvitations();
  };

  const handleResend = async (id: string) => {
    await resendPlatformInvitation(id);
    await loadInvitations();
  };

  const handleRevoke = async (id: string) => {
    if (confirm('Are you sure you want to revoke this invitation?')) {
      await revokePlatformInvitation(id);
      await loadInvitations();
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this invitation? This cannot be undone.')) {
      await deletePlatformInvitation(id);
      await loadInvitations();
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  // Stats
  const pendingCount = invitations.filter((i) => i.status === 'pending').length;
  const acceptedCount = invitations.filter((i) => i.status === 'accepted').length;
  const giftedCount = invitations.filter((i) => i.gift_plan_id).length;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-primary/20 to-accent-secondary/20 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-accent-primary" />
            </div>
            Platform Invitations
          </h1>
          <p className="text-text-muted mt-1">
            Send exclusive invitations to users, even when registration is disabled
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
            'bg-gradient-to-r from-accent-primary to-accent-secondary text-white',
            'hover:shadow-lg hover:shadow-accent-primary/25'
          )}
        >
          <Plus className="w-4 h-4" />
          <span>Invite User</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <p className="text-text-muted text-sm">Total Invitations</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{total}</p>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <p className="text-text-muted text-sm">Pending</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{pendingCount}</p>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <p className="text-text-muted text-sm">Accepted</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{acceptedCount}</p>
        </div>
        <div className="bg-surface border border-border-subtle rounded-xl p-4">
          <p className="text-text-muted text-sm flex items-center gap-1.5">
            <Gift className="w-4 h-4 text-purple-400" />
            With Gift
          </p>
          <p className="text-2xl font-bold text-purple-400 mt-1">{giftedCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="w-full pl-10 pr-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-4 py-2.5 bg-elevated border border-border-subtle rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
        >
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-elevated/50 border-b border-border-subtle">
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Recipient
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Gift
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Expires
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Invited By
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Created
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin text-text-muted mx-auto" />
                  <p className="text-text-muted mt-2">Loading invitations...</p>
                </td>
              </tr>
            ) : invitations.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Mail className="w-10 h-10 text-text-muted mx-auto opacity-50" />
                  <p className="text-text-muted mt-2">No invitations found</p>
                  <p className="text-text-muted text-sm">Create an invitation to get started</p>
                </td>
              </tr>
            ) : (
              invitations.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onResend={handleResend}
                  onRevoke={handleRevoke}
                  onDelete={handleDelete}
                />
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between">
            <p className="text-sm text-text-muted">
              Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="p-2 rounded-lg hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Previous</span>←
              </button>
              <span className="text-sm text-text-secondary">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
                className="p-2 rounded-lg hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Next</span>→
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateInvitationModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
