'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  DollarSign,
  TrendingUp,
  Users,
  Calendar,
  Loader2,
  ChevronLeft,
  Download,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@podex/ui';
import {
  getOrgBillingSummary,
  getOrgPaymentMethods,
  createOrgCreditsCheckout,
  createOrgPortalSession,
  type PaymentMethodsListResponse,
} from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsOrgOwner, useOrgContext } from '@/stores/organization';
import Link from 'next/link';

interface BillingSummary {
  currentPeriodStart: string;
  currentPeriodEnd: string;
  totalSpendingCents: number;
  creditPoolCents: number;
  memberCount: number;
  topSpenders: {
    userId: string;
    name: string | null;
    email: string;
    spendingCents: number;
  }[];
  recentTransactions: {
    id: string;
    type: string;
    amountCents: number;
    description: string;
    createdAt: string;
  }[];
}

export default function OrganizationBillingPage() {
  useDocumentTitle('Organization Billing');
  const router = useRouter();
  const isOwner = useIsOrgOwner();
  const orgContext = useOrgContext();

  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState<number>(5000);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodsListResponse | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  // Redirect if not owner
  useEffect(() => {
    if (!isOwner && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isOwner, orgContext, router]);

  // Fetch billing summary and payment methods on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!orgContext) return;
      setLoading(true);
      try {
        // Fetch billing summary and payment methods in parallel
        const [summaryResponse, paymentMethodsResponse] = await Promise.all([
          getOrgBillingSummary(orgContext.organization.id),
          getOrgPaymentMethods(orgContext.organization.id).catch(() => null),
        ]);

        setSummary({
          currentPeriodStart: summaryResponse.period_start,
          currentPeriodEnd: summaryResponse.period_end,
          totalSpendingCents: summaryResponse.total_spending_cents,
          creditPoolCents: summaryResponse.credit_pool_cents,
          memberCount: summaryResponse.member_count,
          topSpenders:
            summaryResponse.top_users?.map((user) => ({
              userId: user.user_id,
              name: user.name,
              email: user.email,
              spendingCents: user.spending_cents,
            })) || [],
          recentTransactions: [],
        });
        setPaymentMethods(paymentMethodsResponse);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [orgContext]);

  const formatCents = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handlePurchaseCredits = async () => {
    if (!orgContext) return;
    setPurchaseLoading(true);
    try {
      const session = await createOrgCreditsCheckout(
        orgContext.organization.id,
        purchaseAmount * 100,
        `${window.location.origin}/settings/organization/billing?success=true`,
        `${window.location.origin}/settings/organization/billing`
      );
      window.location.href = session.url;
    } finally {
      setPurchaseLoading(false);
    }
  };

  const handleOpenPortal = async () => {
    if (!orgContext) return;
    setPortalLoading(true);
    try {
      const response = await createOrgPortalSession(
        orgContext.organization.id,
        `${window.location.origin}/settings/organization/billing`
      );
      window.location.href = response.url;
    } finally {
      setPortalLoading(false);
    }
  };

  if (!isOwner) {
    return null;
  }

  const creditModelDescriptions = {
    pooled: 'Credits are shared across all team members with individual spending caps.',
    allocated:
      'Credits are pre-assigned to each team member. They can only use their allocated amount.',
    usage_based: 'Usage is tracked and billed at the end of each billing period with caps.',
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings/organization"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Organization
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
              <CreditCard className="w-6 h-6" />
              Billing
            </h1>
            <p className="text-text-muted mt-1">
              Manage your organization&apos;s credits and view usage
            </p>
          </div>
          <Button onClick={() => setShowPurchaseModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Purchase Credits
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        </div>
      ) : summary ? (
        <>
          {/* Credit Model Info */}
          <section className="mb-8">
            <div className="bg-surface border border-border-default rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium text-text-primary">Credit Model</h2>
                <span className="px-2 py-1 bg-accent-primary/10 text-accent-primary rounded text-sm font-medium capitalize">
                  {orgContext?.organization.creditModel.replace('_', ' ')}
                </span>
              </div>
              <p className="text-sm text-text-muted">
                {creditModelDescriptions[orgContext?.organization.creditModel || 'pooled']}
              </p>
            </div>
          </section>

          {/* Stats Grid */}
          <section className="mb-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-2 text-text-muted mb-2">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm">Credit Balance</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">
                  {formatCents(summary.creditPoolCents)}
                </p>
              </div>
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-2 text-text-muted mb-2">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm">This Period</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">
                  {formatCents(summary.totalSpendingCents)}
                </p>
              </div>
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-2 text-text-muted mb-2">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">Members</span>
                </div>
                <p className="text-2xl font-semibold text-text-primary">{summary.memberCount}</p>
              </div>
              <div className="bg-surface border border-border-default rounded-xl p-4">
                <div className="flex items-center gap-2 text-text-muted mb-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">Period Ends</span>
                </div>
                <p className="text-lg font-semibold text-text-primary">
                  {formatDate(summary.currentPeriodEnd)}
                </p>
              </div>
            </div>
          </section>

          {/* Payment Methods */}
          <section className="mb-8">
            <div className="bg-surface border border-border-default rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-text-muted" />
                  <h2 className="font-medium text-text-primary">Payment Methods</h2>
                </div>
                <button
                  onClick={handleOpenPortal}
                  disabled={portalLoading}
                  className="px-3 py-1.5 bg-elevated hover:bg-overlay text-text-primary rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center gap-2 text-sm"
                >
                  {portalLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {portalLoading ? 'Opening...' : 'Manage'}
                </button>
              </div>

              {paymentMethods && paymentMethods.payment_methods.length > 0 ? (
                <div className="space-y-3">
                  {paymentMethods.payment_methods.map((pm) => (
                    <div
                      key={pm.id}
                      className="flex items-center justify-between p-4 bg-elevated rounded-lg border border-border-subtle"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-7 bg-overlay rounded flex items-center justify-center">
                          <span className="text-xs font-bold text-text-muted uppercase">
                            {pm.brand || pm.type}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {pm.brand
                              ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)
                              : pm.type}{' '}
                            ending in {pm.last4}
                          </p>
                          {pm.exp_month && pm.exp_year && (
                            <p className="text-xs text-text-muted">
                              Expires {pm.exp_month.toString().padStart(2, '0')}/{pm.exp_year}
                            </p>
                          )}
                        </div>
                      </div>
                      {pm.is_default && (
                        <span className="px-2 py-1 text-xs font-medium bg-accent-primary/20 text-accent-primary rounded">
                          Default
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  No payment methods on file. Add one to enable purchases.
                </p>
              )}
            </div>
          </section>

          {/* Top Spenders */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-text-primary">Top Spenders</h2>
              <Link
                href="/settings/organization/usage"
                className="text-sm text-accent-primary hover:underline"
              >
                View all usage
              </Link>
            </div>
            {summary.topSpenders.length === 0 ? (
              <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
                <TrendingUp className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-muted">No usage data yet</p>
                <p className="text-sm text-text-muted mt-1">
                  Usage will appear here as your team uses the platform
                </p>
              </div>
            ) : (
              <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                        Member
                      </th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">
                        Spending
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topSpenders.map((spender, index) => (
                      <tr
                        key={spender.userId}
                        className="border-b border-border-subtle last:border-0"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-elevated rounded-full flex items-center justify-center text-sm font-medium text-text-muted">
                              {index + 1}
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">
                                {spender.name || 'No name'}
                              </p>
                              <p className="text-sm text-text-muted">{spender.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-medium text-text-primary">
                            {formatCents(spender.spendingCents)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Transactions */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-text-primary">Recent Transactions</h2>
            </div>
            {summary.recentTransactions.length === 0 ? (
              <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
                <RefreshCw className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-muted">No transactions yet</p>
                <p className="text-sm text-text-muted mt-1">
                  Credit purchases and allocations will appear here
                </p>
              </div>
            ) : (
              <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                        Description
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                        Type
                      </th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">
                        Amount
                      </th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentTransactions.map((transaction) => (
                      <tr
                        key={transaction.id}
                        className="border-b border-border-subtle last:border-0"
                      >
                        <td className="px-4 py-3 text-text-primary">{transaction.description}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary capitalize">
                            {transaction.type.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={
                              transaction.amountCents > 0
                                ? 'text-accent-success'
                                : 'text-text-primary'
                            }
                          >
                            {transaction.amountCents > 0 ? '+' : ''}
                            {formatCents(transaction.amountCents)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-text-muted">
                          {formatDate(transaction.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Invoices */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-text-primary">Invoices</h2>
            </div>
            <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
              <Download className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No invoices yet</p>
              <p className="text-sm text-text-muted mt-1">
                Invoices will be generated after your first credit purchase
              </p>
            </div>
          </section>
        </>
      ) : null}

      {/* Purchase Credits Modal */}
      {showPurchaseModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Purchase Credits</h2>
            <p className="text-text-muted mb-6">
              Add credits to your organization&apos;s pool. Credits can be used by all team members
              within their limits.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Select Amount
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[2500, 5000, 10000].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setPurchaseAmount(amount)}
                      className={`px-4 py-3 rounded-lg text-center transition-colors ${
                        purchaseAmount === amount
                          ? 'bg-accent-primary text-white'
                          : 'bg-elevated text-text-primary hover:bg-border-subtle'
                      }`}
                    >
                      <p className="font-semibold">{formatCents(amount * 100)}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Custom Amount ($)
                </label>
                <input
                  type="number"
                  value={purchaseAmount / 100}
                  onChange={(e) => setPurchaseAmount(parseFloat(e.target.value) * 100 || 0)}
                  min={10}
                  step={10}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div className="bg-elevated rounded-lg p-4">
                <div className="flex justify-between font-medium">
                  <span className="text-text-primary">Total</span>
                  <span className="text-text-primary">{formatCents(purchaseAmount * 100)}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowPurchaseModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handlePurchaseCredits}
                disabled={purchaseAmount < 10 || purchaseLoading}
              >
                {purchaseLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Continue to Payment
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
