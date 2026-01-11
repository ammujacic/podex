'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getSubscription,
  listSubscriptionPlans,
  getUsageSummary,
  getQuotas,
  getCreditBalance,
  createSubscription,
  cancelSubscription,
  type SubscriptionResponse,
  type SubscriptionPlanResponse,
  type UsageSummaryResponse,
  type QuotaResponse,
  type CreditBalanceResponse,
} from '@/lib/api';
import { useBillingStore } from '@/stores/billing';

// Helper to format currency
const formatCurrency = (amount: number, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
};

// Helper to format numbers
const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

// Progress bar component
function QuotaProgressBar({
  label,
  current,
  max,
  unit,
  isWarning,
  isExceeded,
}: {
  label: string;
  current: number;
  max: number;
  unit: string;
  isWarning: boolean;
  isExceeded: boolean;
}) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-neutral-400">{label}</span>
        <span
          className={
            isExceeded ? 'text-red-400' : isWarning ? 'text-amber-400' : 'text-neutral-300'
          }
        >
          {formatNumber(current)} / {formatNumber(max)} {unit}
        </span>
      </div>
      <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            isExceeded ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// Plan card component
function PlanCard({
  plan,
  currentPlanSlug,
  billingCycle,
  onSelect,
  isLoading,
}: {
  plan: SubscriptionPlanResponse;
  currentPlanSlug?: string;
  billingCycle: 'monthly' | 'yearly';
  onSelect: (slug: string) => void;
  isLoading: boolean;
}) {
  const isCurrentPlan = plan.slug === currentPlanSlug;
  const price = billingCycle === 'yearly' ? plan.price_yearly / 12 : plan.price_monthly;
  const yearlyDiscount =
    plan.price_monthly > 0
      ? Math.round((1 - plan.price_yearly / 12 / plan.price_monthly) * 100)
      : 0;

  return (
    <div
      className={`relative rounded-xl border p-6 ${
        plan.is_popular
          ? 'border-blue-500 bg-blue-500/5'
          : isCurrentPlan
            ? 'border-emerald-500 bg-emerald-500/5'
            : 'border-neutral-700 bg-neutral-800/50'
      }`}
    >
      {plan.is_popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
          Most Popular
        </div>
      )}
      {isCurrentPlan && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-500 text-white text-xs font-medium rounded-full">
          Current Plan
        </div>
      )}

      <div className="space-y-4">
        <div>
          <h3 className="text-xl font-semibold text-white">{plan.name}</h3>
          <p className="text-sm text-neutral-400 mt-1">{plan.description}</p>
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-white">
            {plan.price_monthly === 0 ? 'Free' : formatCurrency(price)}
          </span>
          {plan.price_monthly > 0 && <span className="text-neutral-400">/month</span>}
          {billingCycle === 'yearly' && yearlyDiscount > 0 && (
            <span className="ml-2 text-sm text-emerald-400">-{yearlyDiscount}%</span>
          )}
        </div>

        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2 text-neutral-300">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {formatNumber(plan.tokens_included)} tokens/month
          </li>
          <li className="flex items-center gap-2 text-neutral-300">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {formatCurrency(plan.compute_credits_included)} compute credits/month
          </li>
          <li className="flex items-center gap-2 text-neutral-300">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {plan.storage_gb_included} GB storage
          </li>
          <li className="flex items-center gap-2 text-neutral-300">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {plan.max_agents} AI agents
          </li>
          <li className="flex items-center gap-2 text-neutral-300">
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {plan.max_sessions} concurrent sessions
          </li>
          {plan.features.gpu_access && (
            <li className="flex items-center gap-2 text-neutral-300">
              <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              GPU access
            </li>
          )}
          {plan.features.team_collaboration && (
            <li className="flex items-center gap-2 text-neutral-300">
              <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              Team collaboration ({plan.max_team_members} members)
            </li>
          )}
        </ul>

        {!plan.is_enterprise ? (
          <button
            onClick={() => onSelect(plan.slug)}
            disabled={isCurrentPlan || isLoading}
            className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
              isCurrentPlan
                ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
                : plan.is_popular
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-neutral-700 hover:bg-neutral-600 text-white'
            }`}
          >
            {isCurrentPlan ? 'Current Plan' : isLoading ? 'Processing...' : 'Select Plan'}
          </button>
        ) : (
          <Link
            href="/contact"
            className="block w-full py-2 px-4 rounded-lg font-medium text-center bg-neutral-700 hover:bg-neutral-600 text-white transition-colors"
          >
            Contact Sales
          </Link>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanResponse[]>([]);
  const [usage, setUsage] = useState<UsageSummaryResponse | null>(null);
  const [quotas, setQuotas] = useState<QuotaResponse[]>([]);
  const [credits, setCredits] = useState<CreditBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load billing data
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [subData, plansData, usageData, quotasData, creditsData] = await Promise.all([
          getSubscription().catch(() => null),
          listSubscriptionPlans(),
          getUsageSummary().catch(() => null),
          getQuotas().catch(() => []),
          getCreditBalance().catch(() => null),
        ]);

        setSubscription(subData);
        setPlans(plansData);
        setUsage(usageData);
        setQuotas(quotasData);
        setCredits(creditsData);

        // Update store
        const store = useBillingStore.getState();
        store.setPlans(
          plansData.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            priceMonthly: p.price_monthly,
            priceYearly: p.price_yearly,
            currency: p.currency,
            tokensIncluded: p.tokens_included,
            computeHoursIncluded: p.compute_hours_included,
            computeCreditsIncluded: p.compute_credits_included,
            storageGbIncluded: p.storage_gb_included,
            maxAgents: p.max_agents,
            maxSessions: p.max_sessions,
            maxTeamMembers: p.max_team_members,
            overageAllowed: p.overage_allowed,
            overageTokenRate: p.overage_token_rate,
            overageComputeRate: p.overage_compute_rate,
            overageStorageRate: p.overage_storage_rate,
            features: p.features,
            isPopular: p.is_popular,
            isEnterprise: p.is_enterprise,
          }))
        );
      } catch (err) {
        setError('Failed to load billing data');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleSelectPlan = async (slug: string) => {
    try {
      setActionLoading(true);
      setError(null);

      if (subscription) {
        // Update existing subscription
        // For now, we'll need to cancel and create new (Stripe handles prorations)
        await cancelSubscription();
      }

      const newSub = await createSubscription(slug, billingCycle);
      setSubscription(newSub);
    } catch (err) {
      setError('Failed to update subscription');
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

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

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-700 rounded w-1/4" />
          <div className="h-40 bg-neutral-700 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-neutral-700 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing & Usage</h1>
        <p className="text-neutral-400 mt-1">
          Manage your subscription, view usage, and purchase credits
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {/* Current Subscription Summary */}
      {subscription && (
        <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Current Plan: {subscription.plan.name}
              </h2>
              <p className="text-neutral-400 text-sm mt-1">
                {subscription.billing_cycle === 'yearly' ? 'Annual' : 'Monthly'} billing
                {subscription.cancel_at_period_end && (
                  <span className="ml-2 text-amber-400">(Canceling at period end)</span>
                )}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-white">
                {formatCurrency(
                  subscription.billing_cycle === 'yearly'
                    ? subscription.plan.price_yearly
                    : subscription.plan.price_monthly
                )}
                <span className="text-sm text-neutral-400 font-normal">
                  /{subscription.billing_cycle === 'yearly' ? 'year' : 'month'}
                </span>
              </p>
              <p className="text-sm text-neutral-400">
                Renews {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            </div>
          </div>

          {!subscription.cancel_at_period_end && subscription.plan.slug !== 'free' && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Cancel subscription
            </button>
          )}
        </div>
      )}

      {/* Usage Overview */}
      {usage && (
        <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Usage This Period</h2>
            <Link
              href="/settings/billing/usage"
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              View details
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-neutral-700/30 rounded-lg">
              <p className="text-sm text-neutral-400">Tokens Used</p>
              <p className="text-xl font-semibold text-white mt-1">
                {formatNumber(usage.tokens_total)}
              </p>
              <p className="text-xs text-neutral-500">{formatCurrency(usage.tokens_cost)}</p>
            </div>
            <div className="p-4 bg-neutral-700/30 rounded-lg">
              <p className="text-sm text-neutral-400">Compute Hours</p>
              <p className="text-xl font-semibold text-white mt-1">
                {usage.compute_hours.toFixed(1)}h
              </p>
              <p className="text-xs text-neutral-500">{formatCurrency(usage.compute_cost)}</p>
            </div>
            <div className="p-4 bg-neutral-700/30 rounded-lg">
              <p className="text-sm text-neutral-400">Storage</p>
              <p className="text-xl font-semibold text-white mt-1">
                {usage.storage_gb.toFixed(1)} GB
              </p>
              <p className="text-xs text-neutral-500">{formatCurrency(usage.storage_cost)}</p>
            </div>
            <div className="p-4 bg-neutral-700/30 rounded-lg">
              <p className="text-sm text-neutral-400">Total Cost</p>
              <p className="text-xl font-semibold text-white mt-1">
                {formatCurrency(usage.total_cost)}
              </p>
              <p className="text-xs text-neutral-500">This period</p>
            </div>
          </div>

          {/* Quota Progress Bars */}
          {quotas.length > 0 && (
            <div className="space-y-4 pt-4 border-t border-neutral-700">
              {quotas.map((quota) => (
                <QuotaProgressBar
                  key={quota.id}
                  label={quota.quota_type
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (l) => l.toUpperCase())}
                  current={quota.current_usage}
                  max={quota.limit_value}
                  unit=""
                  isWarning={quota.is_warning}
                  isExceeded={quota.is_exceeded}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Credit Balance */}
      {credits && (
        <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Credit Balance</h2>
              <p className="text-2xl font-bold text-emerald-400 mt-1">
                {formatCurrency(credits.balance)}
              </p>
            </div>
            <Link
              href="/settings/billing/credits"
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              Add Credits
            </Link>
          </div>
          {credits.expiring_soon > 0 && (
            <p className="text-sm text-amber-400 mt-2">
              {formatCurrency(credits.expiring_soon)} expiring in the next 30 days
            </p>
          )}
        </div>
      )}

      {/* Plans */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Available Plans</h2>
          <div className="flex items-center gap-2 p-1 bg-neutral-700 rounded-lg">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-neutral-600 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-3 py-1 rounded-md text-sm transition-colors ${
                billingCycle === 'yearly'
                  ? 'bg-neutral-600 text-white'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Yearly
              <span className="ml-1 text-emerald-400">Save up to 17%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              currentPlanSlug={subscription?.plan.slug}
              billingCycle={billingCycle}
              onSelect={handleSelectPlan}
              isLoading={actionLoading}
            />
          ))}
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/settings/billing/usage"
          className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-colors"
        >
          <h3 className="font-medium text-white">Usage History</h3>
          <p className="text-sm text-neutral-400 mt-1">View detailed usage breakdown</p>
        </Link>
        <Link
          href="/settings/billing/invoices"
          className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-colors"
        >
          <h3 className="font-medium text-white">Invoices</h3>
          <p className="text-sm text-neutral-400 mt-1">Download past invoices</p>
        </Link>
        <Link
          href="/settings/billing/credits"
          className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700 hover:border-neutral-600 transition-colors"
        >
          <h3 className="font-medium text-white">Credits</h3>
          <p className="text-sm text-neutral-400 mt-1">Purchase and manage credits</p>
        </Link>
      </div>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-white">Cancel Subscription</h3>
            <p className="text-neutral-400 mt-2">
              Are you sure you want to cancel your subscription? You'll retain access until the end
              of your current billing period.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2 px-4 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={actionLoading}
                className="flex-1 py-2 px-4 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {actionLoading ? 'Canceling...' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
