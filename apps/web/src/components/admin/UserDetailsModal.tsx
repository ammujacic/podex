'use client';

import { useState, useEffect } from 'react';
import { X, User, CreditCard, Zap, HardDrive, Cpu, Gift, Crown, Loader2 } from 'lucide-react';
import { useAdminStore, type AdminUser, type AdminPlan, type UserUsage } from '@/stores/admin';

interface UserDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: AdminUser | null;
  plans: AdminPlan[];
}

const formatCurrency = (cents: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
};

const formatNumber = (num: number) => {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
};

type TabType = 'usage' | 'credits' | 'actions';

export function UserDetailsModal({ isOpen, onClose, user, plans }: UserDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('usage');
  const [usage, setUsage] = useState<UserUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sponsor form state
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [sponsorReason, setSponsorReason] = useState('');

  // Award credits form state
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');

  const { fetchUserUsage, sponsorUser, removeSponsor, awardCredits } = useAdminStore();

  useEffect(() => {
    if (isOpen && user) {
      setLoading(true);
      setError(null);
      fetchUserUsage(user.id)
        .then(setUsage)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [isOpen, user, fetchUserUsage]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [successMessage]);

  if (!isOpen || !user) return null;

  const handleSponsor = async () => {
    if (!selectedPlanId) {
      setError('Please select a plan');
      return;
    }
    try {
      setActionLoading(true);
      setError(null);
      await sponsorUser(user.id, selectedPlanId, sponsorReason || undefined);
      setSuccessMessage('User subscription sponsored successfully!');
      setSelectedPlanId('');
      setSponsorReason('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveSponsor = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await removeSponsor(user.id);
      setSuccessMessage('Sponsorship removed successfully!');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAwardCredits = async () => {
    const amountCents = Math.round(parseFloat(creditAmount) * 100);
    if (!amountCents || amountCents < 1) {
      setError('Please enter a valid amount');
      return;
    }
    if (!creditReason.trim()) {
      setError('Please provide a reason');
      return;
    }
    try {
      setActionLoading(true);
      setError(null);
      await awardCredits(user.id, amountCents, creditReason);
      setSuccessMessage(`${formatCurrency(amountCents)} credits awarded successfully!`);
      setCreditAmount('');
      setCreditReason('');
      // Refresh usage
      const newUsage = await fetchUserUsage(user.id);
      setUsage(newUsage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const tabs: { id: TabType; label: string }[] = [
    { id: 'usage', label: 'Usage & Quotas' },
    { id: 'credits', label: 'Credits' },
    { id: 'actions', label: 'Actions' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-surface rounded-xl border border-border-subtle shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <User className="w-5 h-5 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{user.name || user.email}</h2>
              <p className="text-sm text-text-muted">{user.email}</p>
            </div>
            {user.is_sponsored && (
              <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs font-medium rounded-full flex items-center gap-1">
                <Crown className="w-3 h-3" />
                Sponsored
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary rounded-lg hover:bg-overlay transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-border-subtle shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm">
              {successMessage}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-accent-primary" />
            </div>
          ) : (
            <>
              {/* Usage Tab */}
              {activeTab === 'usage' && usage && (
                <div className="space-y-4">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                      <div className="flex items-center gap-2 text-text-muted mb-2">
                        <Zap className="w-4 h-4" />
                        <span className="text-sm">Tokens</span>
                      </div>
                      <p className="text-xl font-semibold text-text-primary">
                        {formatNumber(usage.tokens_used)}
                      </p>
                      <p className="text-xs text-text-muted">
                        of {formatNumber(usage.tokens_limit)}
                      </p>
                    </div>
                    <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                      <div className="flex items-center gap-2 text-text-muted mb-2">
                        <Cpu className="w-4 h-4" />
                        <span className="text-sm">Compute</span>
                      </div>
                      <p className="text-xl font-semibold text-text-primary">
                        {formatCurrency(usage.compute_cents_used)}
                      </p>
                      <p className="text-xs text-text-muted">
                        of {formatCurrency(usage.compute_cents_limit)}
                      </p>
                    </div>
                    <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                      <div className="flex items-center gap-2 text-text-muted mb-2">
                        <HardDrive className="w-4 h-4" />
                        <span className="text-sm">Storage</span>
                      </div>
                      <p className="text-xl font-semibold text-text-primary">
                        {usage.storage_gb_used.toFixed(1)} GB
                      </p>
                      <p className="text-xs text-text-muted">of {usage.storage_gb_limit} GB</p>
                    </div>
                  </div>

                  {/* Quota Progress Bars */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-text-secondary">Quota Details</h3>
                    {usage.quotas.map((quota) => (
                      <div key={quota.quota_type} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-text-secondary capitalize">
                            {quota.quota_type.replace('_', ' ')}
                          </span>
                          <span className="text-text-muted">{quota.usage_percent.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-elevated rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              quota.usage_percent >= 100
                                ? 'bg-red-500'
                                : quota.usage_percent >= 80
                                  ? 'bg-yellow-500'
                                  : 'bg-accent-success'
                            }`}
                            style={{ width: `${Math.min(quota.usage_percent, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Credits Tab */}
              {activeTab === 'credits' && usage && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                      <div className="flex items-center gap-2 text-text-muted mb-2">
                        <CreditCard className="w-4 h-4" />
                        <span className="text-sm">Credit Balance</span>
                      </div>
                      <p className="text-2xl font-semibold text-text-primary">
                        {formatCurrency(usage.credit_balance_cents)}
                      </p>
                    </div>
                    <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                      <div className="flex items-center gap-2 text-text-muted mb-2">
                        <Gift className="w-4 h-4" />
                        <span className="text-sm">Total Bonus Credits</span>
                      </div>
                      <p className="text-2xl font-semibold text-purple-400">
                        {formatCurrency(usage.total_bonus_cents)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions Tab */}
              {activeTab === 'actions' && (
                <div className="space-y-6">
                  {/* Sponsor Section */}
                  <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                    <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
                      <Crown className="w-4 h-4 text-purple-400" />
                      Sponsor Subscription
                    </h3>
                    {user.is_sponsored ? (
                      <div className="space-y-3">
                        <p className="text-sm text-text-muted">
                          This user is currently sponsored
                          {user.sponsored_by_name && ` by ${user.sponsored_by_name}`}.
                        </p>
                        <button
                          onClick={handleRemoveSponsor}
                          disabled={actionLoading}
                          className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Removing...' : 'Remove Sponsorship'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm text-text-muted mb-1">Select Plan</label>
                          <select
                            value={selectedPlanId}
                            onChange={(e) => setSelectedPlanId(e.target.value)}
                            className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-primary"
                          >
                            <option value="">Choose a plan...</option>
                            {plans
                              .filter((p) => p.is_active)
                              .map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.name} ({formatCurrency(plan.price_monthly_cents)}/mo)
                                </option>
                              ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-text-muted mb-1">
                            Reason (optional)
                          </label>
                          <input
                            type="text"
                            value={sponsorReason}
                            onChange={(e) => setSponsorReason(e.target.value)}
                            placeholder="e.g., Partnership, Early adopter"
                            className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-primary placeholder:text-text-muted"
                          />
                        </div>
                        <button
                          onClick={handleSponsor}
                          disabled={actionLoading || !selectedPlanId}
                          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Sponsoring...' : 'Sponsor User'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Award Credits Section */}
                  <div className="p-4 bg-elevated rounded-lg border border-border-subtle">
                    <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
                      <Gift className="w-4 h-4 text-green-400" />
                      Award Credits
                    </h3>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm text-text-muted mb-1">Amount (USD)</label>
                        <input
                          type="number"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(e.target.value)}
                          placeholder="e.g., 50.00"
                          min="0.01"
                          step="0.01"
                          className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-primary placeholder:text-text-muted"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-text-muted mb-1">Reason</label>
                        <input
                          type="text"
                          value={creditReason}
                          onChange={(e) => setCreditReason(e.target.value)}
                          placeholder="e.g., Referral bonus, Feedback reward"
                          className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-primary placeholder:text-text-muted"
                        />
                      </div>
                      <button
                        onClick={handleAwardCredits}
                        disabled={actionLoading || !creditAmount || !creditReason}
                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                      >
                        {actionLoading ? 'Awarding...' : 'Award Credits'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
