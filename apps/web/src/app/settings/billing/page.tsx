'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getSubscription,
  getCreditBalance,
  cancelSubscription,
  listInvoices,
  getInvoice,
  type SubscriptionResponse,
  type CreditBalanceResponse,
  type InvoiceResponse,
} from '@/lib/api';
import { CreditCard, Download } from 'lucide-react';
import CostInsights from '@/components/billing/CostInsights';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const formatCurrency = (amount: number, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatNumber = (num: number): string => {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
};

const statusColors: Record<string, string> = {
  draft: 'bg-text-muted/20 text-text-muted',
  open: 'bg-amber-500/20 text-amber-400',
  paid: 'bg-accent-success/20 text-accent-success',
  void: 'bg-text-muted/20 text-text-muted',
  uncollectible: 'bg-accent-error/20 text-accent-error',
};

export default function BillingPage() {
  useDocumentTitle('Billing');
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [credits, setCredits] = useState<CreditBalanceResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [subData, creditsData, invoicesData] = await Promise.all([
          getSubscription().catch(() => null),
          getCreditBalance().catch(() => null),
          listInvoices(1, 10).catch(() => []),
        ]);

        console.warn('BillingPage - Subscription data:', subData);
        console.warn('BillingPage - Has plan?:', !!subData?.plan);
        console.warn('BillingPage - Plan name:', subData?.plan?.name);

        setSubscription(subData);
        setCredits(creditsData);
        setInvoices(invoicesData);
      } catch (err) {
        setError('Failed to load billing data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleCancelSubscription = async () => {
    try {
      setActionLoading(true);
      setError(null);

      const updated = await cancelSubscription();
      setSubscription(updated);
      setShowCancelModal(false);
    } catch (err) {
      setError('Failed to cancel subscription');
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewInvoice = async (invoiceId: string) => {
    try {
      setDetailLoading(true);
      const data = await getInvoice(invoiceId);
      setSelectedInvoice(data);
    } catch (err) {
      console.error('Failed to load invoice:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface rounded w-1/4" />
          <div className="h-40 bg-surface rounded" />
          <div className="h-64 bg-surface rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Billing</h1>
        <p className="text-text-muted">Manage your subscription and billing information</p>
      </div>

      {error && (
        <div className="p-4 bg-accent-error/10 border border-accent-error/20 rounded-lg text-accent-error mb-6">
          {error}
        </div>
      )}

      {/* Current Plan */}
      {subscription?.plan ? (
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-text-primary">
                  {subscription.plan.name || 'Unknown Plan'}
                </h2>
                <span className="px-3 py-1 bg-accent-success/20 text-accent-success text-xs font-medium rounded-full">
                  Current Plan
                </span>
              </div>
              {subscription.plan.description && (
                <p className="text-sm text-text-muted mb-4">{subscription.plan.description}</p>
              )}
              <p className="text-sm text-text-secondary mb-4">
                {subscription.billing_cycle === 'yearly' ? 'Annual' : 'Monthly'} billing
                {subscription.cancel_at_period_end && (
                  <span className="ml-2 text-amber-400">(Canceling at period end)</span>
                )}
              </p>

              {/* Plan Features Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    {formatNumber(subscription.plan.tokens_included || 0)}
                  </div>
                  <div className="text-xs text-text-muted">Tokens/month</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    ${((subscription.plan.compute_credits_included || 0) / 100).toFixed(0)}
                  </div>
                  <div className="text-xs text-text-muted">Compute Credits</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    {subscription.plan.storage_gb_included || 0}GB
                  </div>
                  <div className="text-xs text-text-muted">Storage</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    {subscription.plan.max_sessions || 0}
                  </div>
                  <div className="text-xs text-text-muted">Sessions</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    {subscription.plan.max_agents || 0}
                  </div>
                  <div className="text-xs text-text-muted">Agents</div>
                </div>
                <div>
                  <div className="text-xl font-semibold text-text-primary">
                    {(subscription.plan.max_team_members || 0) > 0
                      ? subscription.plan.max_team_members
                      : '-'}
                  </div>
                  <div className="text-xs text-text-muted">Live Collaborators</div>
                </div>
              </div>
            </div>

            <div className="text-right ml-6">
              <div className="text-3xl font-bold text-text-primary">
                {subscription.plan.is_enterprise
                  ? 'Custom'
                  : formatCurrency(
                      subscription.billing_cycle === 'yearly'
                        ? subscription.plan.price_yearly || 0
                        : subscription.plan.price_monthly || 0
                    )}
              </div>
              <div className="text-sm text-text-muted mb-2">
                per {subscription.billing_cycle === 'yearly' ? 'year' : 'month'}
              </div>
              <div className="text-xs text-text-secondary">
                Renews {formatDate(subscription.current_period_end)}
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-border-subtle flex items-center gap-3">
            <Link
              href="/settings/plans"
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg transition-colors font-medium"
            >
              Change Plan
            </Link>
            {!subscription.cancel_at_period_end && subscription.plan.slug !== 'free' && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="px-4 py-2 text-sm text-accent-error hover:text-accent-error/80 transition-colors font-medium"
              >
                Cancel subscription
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          <p className="text-sm text-text-muted mb-4">
            No active subscription. Choose a plan to get started.
          </p>
          <Link
            href="/settings/plans"
            className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg transition-colors font-medium inline-flex items-center"
          >
            View Plans
          </Link>
        </div>
      )}

      {/* Credit Balance - Only show if overage is allowed */}
      {credits && subscription?.plan?.overage_allowed && (
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Credit Balance</h2>
              <p className="text-3xl font-bold text-accent-success mt-1">
                {formatCurrency(credits.balance / 100)}
              </p>
              {credits.expiring_soon > 0 && (
                <p className="text-sm text-amber-400 mt-2">
                  {formatCurrency(credits.expiring_soon / 100)} expiring in 30 days
                </p>
              )}
              <p className="text-xs text-text-muted mt-2">
                Used for pay-as-you-go when you exceed plan limits
              </p>
            </div>
            <Link
              href="/settings/billing/credits"
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg transition-colors font-medium"
            >
              Add Credits
            </Link>
          </div>
        </div>
      )}

      {/* Cost Insights */}
      <div className="mb-8">
        <CostInsights />
      </div>

      {/* Payment Methods */}
      <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-5 h-5 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">Payment Methods</h2>
        </div>
        <p className="text-sm text-text-muted mb-4">
          Manage your payment methods and billing details.
        </p>
        <button className="px-4 py-2 bg-elevated hover:bg-overlay text-text-primary rounded-lg transition-colors font-medium">
          Add Payment Method
        </button>
      </div>

      {/* Past Invoices */}
      <div className="bg-surface border border-border-default rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-text-muted" />
            <h2 className="text-lg font-semibold text-text-primary">Past Invoices</h2>
          </div>
          {invoices.length > 5 && (
            <Link
              href="/settings/billing/invoices"
              className="text-sm text-accent-primary hover:text-accent-primary/80"
            >
              View all
            </Link>
          )}
        </div>

        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-text-muted border-b border-border-subtle">
                  <th className="py-3 px-4 font-medium">Invoice</th>
                  <th className="py-3 px-4 font-medium">Date</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {invoices.slice(0, 5).map((invoice) => (
                  <tr key={invoice.id} className="text-sm hover:bg-overlay">
                    <td className="py-3 px-4">
                      <span className="text-text-primary font-mono text-xs">
                        {invoice.invoice_number}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-secondary">
                      {formatDate(invoice.created_at)}
                    </td>
                    <td className="py-3 px-4 text-text-primary font-medium">
                      {formatCurrency(invoice.total / 100)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          statusColors[invoice.status] || 'bg-text-muted/20 text-text-muted'
                        }`}
                      >
                        {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleViewInvoice(invoice.id)}
                          className="text-accent-primary hover:text-accent-primary/80 text-xs font-medium"
                        >
                          View
                        </button>
                        {invoice.pdf_url && (
                          <a
                            href={invoice.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-secondary hover:text-text-primary text-xs"
                          >
                            PDF
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center text-text-muted py-8">No invoices yet</p>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <Link
          href="/settings/plans"
          className="p-4 bg-surface border border-border-default rounded-xl hover:border-border-hover transition-colors"
        >
          <h3 className="font-medium text-text-primary">Plans</h3>
          <p className="text-sm text-text-muted mt-1">View and change your subscription plan</p>
        </Link>
        <Link
          href="/settings/usage"
          className="p-4 bg-surface border border-border-default rounded-xl hover:border-border-hover transition-colors"
        >
          <h3 className="font-medium text-text-primary">Usage</h3>
          <p className="text-sm text-text-muted mt-1">Track your resource consumption</p>
        </Link>
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-xl border border-border-default max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-border-subtle flex items-center justify-between sticky top-0 bg-surface">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  Invoice {selectedInvoice.invoice_number}
                </h2>
                <p className="text-sm text-text-muted mt-1">
                  {formatDate(selectedInvoice.created_at)}
                </p>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-text-muted hover:text-text-primary"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Status</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    statusColors[selectedInvoice.status] || 'bg-text-muted/20 text-text-muted'
                  }`}
                >
                  {selectedInvoice.status.charAt(0).toUpperCase() + selectedInvoice.status.slice(1)}
                </span>
              </div>

              {/* Period */}
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Billing Period</span>
                <span className="text-text-primary">
                  {formatDate(selectedInvoice.period_start)} -{' '}
                  {formatDate(selectedInvoice.period_end)}
                </span>
              </div>

              {/* Line Items */}
              <div>
                <h3 className="text-sm font-medium text-text-muted mb-3">Line Items</h3>
                <div className="bg-elevated rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-text-muted border-b border-border-subtle">
                        <th className="p-3 font-medium">Description</th>
                        <th className="p-3 font-medium text-right">Qty</th>
                        <th className="p-3 font-medium text-right">Unit Price</th>
                        <th className="p-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {selectedInvoice.line_items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-3 text-text-primary">{item.description}</td>
                          <td className="p-3 text-text-secondary text-right">{item.quantity}</td>
                          <td className="p-3 text-text-secondary text-right">
                            {formatCurrency(item.unit_price / 100)}
                          </td>
                          <td className="p-3 text-text-primary text-right">
                            {formatCurrency(item.total / 100)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-2 pt-4 border-t border-border-subtle">
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Subtotal</span>
                  <span className="text-text-primary">
                    {formatCurrency(selectedInvoice.subtotal / 100)}
                  </span>
                </div>
                {selectedInvoice.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Discount</span>
                    <span className="text-accent-success">
                      -{formatCurrency(selectedInvoice.discount / 100)}
                    </span>
                  </div>
                )}
                {selectedInvoice.tax > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Tax</span>
                    <span className="text-text-primary">
                      {formatCurrency(selectedInvoice.tax / 100)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold pt-2">
                  <span className="text-text-primary">Total</span>
                  <span className="text-text-primary">
                    {formatCurrency(selectedInvoice.total / 100)}
                  </span>
                </div>
              </div>

              {/* Payment Info */}
              {selectedInvoice.paid_at && (
                <div className="text-sm text-text-muted">
                  Paid on {formatDate(selectedInvoice.paid_at)}
                  {selectedInvoice.payment_method && ` via ${selectedInvoice.payment_method}`}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                {selectedInvoice.pdf_url && (
                  <a
                    href={selectedInvoice.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 px-4 bg-accent-primary hover:bg-accent-primary/90 text-white text-center rounded-lg transition-colors font-medium"
                  >
                    Download PDF
                  </a>
                )}
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="flex-1 py-2 px-4 bg-elevated hover:bg-overlay text-text-primary rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl border border-border-default p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-primary">Cancel Subscription</h3>
            <p className="text-text-muted mt-2">
              Are you sure you want to cancel your subscription? You'll retain access until the end
              of your current billing period.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2 px-4 bg-elevated hover:bg-overlay text-text-primary rounded-lg transition-colors"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="flex-1 py-2 px-4 bg-accent-error hover:bg-accent-error/90 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Canceling...' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for invoice detail */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary" />
        </div>
      )}
    </div>
  );
}
