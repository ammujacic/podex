'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  Crown,
  Building2,
  ArrowRight,
  CreditCard,
  BarChart3,
} from 'lucide-react';
import { useBillingData } from '@/hooks/useBillingData';
import { PlanCard } from '@/components/billing';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import type { SubscriptionPlanResponse } from '@/lib/api';
import {
  useOrgContext,
  useIsInOrganization,
  useOrganizationStore,
  type UserOrgContext,
} from '@/stores/organization';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function getPlanFeatures(plan: SubscriptionPlanResponse) {
  const isOrg = plan.is_enterprise;
  const features = [
    {
      name: 'tokens per month',
      value: isOrg ? 'Unlimited' : formatNumber(plan.tokens_included || 0),
      included: true,
    },
    {
      name: 'compute credits',
      value: isOrg ? 'Unlimited' : `$${(plan.compute_credits_included || 0).toFixed(0)}`,
      included: true,
    },
    {
      name: 'storage',
      value: isOrg ? 'Unlimited' : `${plan.storage_gb_included || 0}GB`,
      included: true,
    },
    {
      name: 'concurrent sessions',
      value: isOrg ? 'Unlimited' : (plan.max_sessions || 0).toString(),
      included: true,
    },
    {
      name: 'agents per session',
      value: isOrg ? 'Unlimited' : (plan.max_agents || 0).toString(),
      included: true,
    },
    {
      name: 'live collaborators',
      value: isOrg
        ? 'Unlimited'
        : (plan.max_team_members || 0) > 0
          ? (plan.max_team_members || 0).toString()
          : 'Solo',
      included: true,
    },
  ];

  // Add feature flags - safely check if features object exists
  const planFeatures = plan.features || {};
  if (planFeatures.priority_support) {
    features.push({ name: 'Priority support', value: '', included: true });
  }
  if (planFeatures.gpu_access) {
    features.push({ name: 'GPU access', value: '', included: true });
  }
  if (planFeatures.custom_models) {
    features.push({ name: 'Custom models', value: '', included: true });
  }
  if (planFeatures.sso) {
    features.push({ name: 'SSO authentication', value: '', included: true });
  }
  if (plan.overage_allowed) {
    features.push({ name: 'Overage allowed (pay-as-you-go)', value: '', included: true });
  }

  return features;
}

export default function PlansPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const { subscription, plans, loading, error, refetch, handlePlanChange } = useBillingData();
  const [changingPlan, setChangingPlan] = useState<string | null>(null);

  // Organization context
  const isInOrg = useIsInOrganization();
  const orgContext = useOrgContext();
  const { contextLoading, setContextLoading, setContext } = useOrganizationStore();

  // Fetch org context on mount to check if user is in an org
  useEffect(() => {
    const fetchContext = async () => {
      setContextLoading(true);
      try {
        const response = (await api.get('/api/organizations/me')) as UserOrgContext;
        if (response) setContext(response);
      } catch {
        // User is not in an org, that's fine
        setContext(null);
      } finally {
        setContextLoading(false);
      }
    };
    fetchContext();
  }, [setContextLoading, setContext]);

  const handleSelectPlan = async (planSlug: string) => {
    if (changingPlan) return;

    setChangingPlan(planSlug);
    try {
      await handlePlanChange(planSlug, billingCycle);
      // Redirect happens in handlePlanChange
    } catch (err) {
      console.error('Failed to change plan:', err);
      alert('Failed to initiate plan change. Please try again.');
      setChangingPlan(null);
    }
  };

  if (loading || contextLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  // User is in an organization - billing is managed by the org
  if (isInOrg && orgContext) {
    const org = orgContext.organization;
    const limits = orgContext.limits;
    const formatCents = (cents: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary mb-2">Plans</h1>
          <p className="text-text-muted">Your billing is managed by your organization</p>
        </div>

        {/* Organization Card */}
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-accent-primary/10 rounded-lg">
              <Building2 className="w-6 h-6 text-accent-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-text-primary">{org.name}</h2>
                <span className="px-3 py-1 bg-accent-primary/20 text-accent-primary text-xs font-medium rounded-full capitalize">
                  {orgContext.role}
                </span>
              </div>
              <p className="text-text-muted text-sm mb-4">
                As a member of {org.name}, your usage is billed to your organization. You don&apos;t
                need a personal subscription.
              </p>
              <Link href="/settings/organization">
                <Button variant="outline">
                  <Building2 className="w-4 h-4 mr-2" />
                  View Organization Settings
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Your Limits & Usage */}
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-6">
          <h3 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Your Usage & Limits
          </h3>

          <div className="space-y-4">
            {/* Spending Limit */}
            {limits.spendingLimitCents !== null && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-text-muted">Spending Limit</span>
                  <span className="text-text-primary">
                    {formatCents(limits.currentSpendingCents)} /{' '}
                    {formatCents(limits.spendingLimitCents)}
                  </span>
                </div>
                <div className="w-full bg-elevated rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      limits.isAtLimit ? 'bg-accent-error' : 'bg-accent-primary'
                    }`}
                    style={{
                      width: `${Math.min((limits.currentSpendingCents / limits.spendingLimitCents) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Allocated Credits (for allocated model) */}
            {org.creditModel === 'allocated' && limits.allocatedCreditsCents > 0 && (
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-text-muted">Allocated Credits</span>
                  <span className="text-text-primary">
                    {formatCents(limits.usedCreditsCents)} /{' '}
                    {formatCents(limits.allocatedCreditsCents)}
                  </span>
                </div>
                <div className="w-full bg-elevated rounded-full h-2">
                  <div
                    className="bg-accent-secondary h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.min((limits.usedCreditsCents / limits.allocatedCreditsCents) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Allowed Models */}
            {limits.allowedModels && limits.allowedModels.length > 0 && (
              <div>
                <p className="text-sm text-text-muted mb-2">Allowed Models</p>
                <div className="flex flex-wrap gap-2">
                  {limits.allowedModels.map((model) => (
                    <span
                      key={model}
                      className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary"
                    >
                      {model}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Allowed Instance Types */}
            {limits.allowedInstanceTypes && limits.allowedInstanceTypes.length > 0 && (
              <div>
                <p className="text-sm text-text-muted mb-2">Allowed Instance Types</p>
                <div className="flex flex-wrap gap-2">
                  {limits.allowedInstanceTypes.map((type) => (
                    <span
                      key={type}
                      className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary"
                    >
                      {type}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* No specific limits set */}
            {limits.spendingLimitCents === null &&
              (!limits.allowedModels || limits.allowedModels.length === 0) &&
              (!limits.allowedInstanceTypes || limits.allowedInstanceTypes.length === 0) && (
                <p className="text-sm text-text-muted">
                  No specific limits have been set for your account. You have access to all
                  organization resources.
                </p>
              )}
          </div>
        </div>

        {/* At Limit Warning */}
        {limits.isAtLimit && (
          <div className="bg-accent-error/10 border border-accent-error/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-accent-error">Spending Limit Reached</h3>
                <p className="text-sm text-text-muted mt-1">
                  You&apos;ve reached your spending limit for this period. Contact your organization
                  admin to increase your limit.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Blocked Warning */}
        {orgContext.isBlocked && (
          <div className="bg-accent-error/10 border border-accent-error/20 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-accent-error">Account Blocked</h3>
                <p className="text-sm text-text-muted mt-1">
                  Your organization account has been blocked. Please contact your organization admin
                  for assistance.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/settings/organization/billing"
            className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <CreditCard className="w-5 h-5 text-text-muted" />
              <div>
                <p className="font-medium text-text-primary">Organization Billing</p>
                <p className="text-sm text-text-muted">View usage and invoices</p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-text-muted" />
          </Link>

          <Link
            href="/settings/usage"
            className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-text-muted" />
              <div>
                <p className="font-medium text-text-primary">Your Usage</p>
                <p className="text-sm text-text-muted">View your usage history</p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-text-muted" />
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="bg-accent-error/10 border border-accent-error/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-accent-error">Error Loading Plans</h3>
              <p className="text-sm text-text-secondary mt-1">{error}</p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={refetch}>
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Sort plans: Free -> Pro -> Max -> Enterprise (custom pricing always last)
  const sortedPlans = [...plans].sort((a, b) => {
    // Enterprise (custom pricing) always goes last
    if (a.is_enterprise) return 1;
    if (b.is_enterprise) return -1;
    // Otherwise sort by price (cheapest first)
    return a.price_monthly - b.price_monthly;
  });

  // Show empty state if no plans available
  if (!loading && plans.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="bg-surface border border-border-default rounded-lg p-8 text-center">
          <AlertCircle className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Plans Available</h3>
          <p className="text-sm text-text-muted mb-4">
            Unable to load subscription plans. Please try again later.
          </p>
          <Button variant="secondary" size="sm" onClick={refetch}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Plans</h1>
        <p className="text-text-muted">Manage your subscription plan</p>
      </div>

      {/* Current Plan Section */}
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
                {subscription.is_sponsored && (
                  <span className="px-3 py-1 bg-purple-500/20 text-purple-400 text-xs font-medium rounded-full flex items-center gap-1">
                    <Crown className="w-3 h-3" />
                    Sponsored
                  </span>
                )}
              </div>
              {subscription.plan.description && (
                <p className="text-sm text-text-muted mb-4">{subscription.plan.description}</p>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
                    {formatNumber(subscription.plan.tokens_included || 0)}
                  </div>
                  <div className="text-xs text-text-muted">Tokens/month</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
                    ${(subscription.plan.compute_credits_included || 0).toFixed(0)}
                  </div>
                  <div className="text-xs text-text-muted">Compute Credits</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
                    {subscription.plan.storage_gb_included || 0}GB
                  </div>
                  <div className="text-xs text-text-muted">Storage</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
                    {subscription.plan.max_sessions || 0}
                  </div>
                  <div className="text-xs text-text-muted">Sessions</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
                    {subscription.plan.max_agents || 0}
                  </div>
                  <div className="text-xs text-text-muted">Agents</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-text-primary">
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
                  : subscription.billing_cycle === 'yearly'
                    ? `$${((subscription.plan.price_yearly || 0) / 12).toFixed(0)}`
                    : `$${(subscription.plan.price_monthly || 0).toFixed(0)}`}
              </div>
              <div className="text-sm text-text-muted">
                per month{subscription.billing_cycle === 'yearly' ? ' (billed yearly)' : ''}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-accent-error/10 border border-accent-error/20 rounded-xl p-6 mb-8">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-accent-error">Subscription Data Missing</h3>
              <p className="text-sm text-text-muted mt-1">
                Unable to load your subscription information. All users should be on at least the
                Free plan. Please contact support if this persists.
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={refetch}>
                Retry Loading
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <button
          onClick={() => setBillingCycle('monthly')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            billingCycle === 'monthly'
              ? 'bg-accent-primary text-white'
              : 'bg-surface text-text-secondary hover:bg-elevated'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBillingCycle('yearly')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            billingCycle === 'yearly'
              ? 'bg-accent-primary text-white'
              : 'bg-surface text-text-secondary hover:bg-elevated'
          }`}
        >
          Yearly
          <span className="ml-2 text-xs bg-accent-success/20 text-accent-success px-2 py-0.5 rounded-full">
            Save 20%
          </span>
        </button>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12">
        {(() => {
          const currentPlanIndex = sortedPlans.findIndex((p) => p.id === subscription?.plan.id);
          return sortedPlans.map((plan, index) => {
            const isDowngrade = currentPlanIndex > -1 && index < currentPlanIndex;
            return (
              <PlanCard
                key={plan.id}
                name={plan.is_enterprise ? 'Organization' : plan.name}
                description={
                  plan.is_enterprise
                    ? 'Unlimited resources for your organization'
                    : plan.description || undefined
                }
                price={plan.price_monthly}
                priceYearly={plan.price_yearly}
                billingCycle={billingCycle}
                features={getPlanFeatures(plan)}
                isPopular={plan.is_popular}
                isEnterprise={plan.is_enterprise}
                isCurrent={subscription?.plan.id === plan.id}
                isDowngrade={isDowngrade}
                onSelect={() => handleSelectPlan(plan.slug)}
                disabled={changingPlan !== null}
                enterpriseHref="/settings/organization"
              />
            );
          });
        })()}
      </div>

      {/* Feature Comparison Table */}
      <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
        <h2 className="text-xl font-semibold text-text-primary mb-6">Feature Comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Feature</th>
                {sortedPlans.map((plan) => (
                  <th
                    key={plan.id}
                    className="text-center py-3 px-4 text-sm font-medium text-text-primary"
                  >
                    {plan.is_enterprise ? 'Organization' : plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Monthly Price</td>
                {sortedPlans.map((plan) => (
                  <td
                    key={plan.id}
                    className="text-center py-3 px-4 text-sm text-text-primary font-medium"
                  >
                    {plan.is_enterprise
                      ? 'Custom'
                      : plan.price_monthly === 0
                        ? 'Free'
                        : `$${plan.price_monthly.toFixed(2)}`}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Tokens / Month</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise ? 'Unlimited' : formatNumber(plan.tokens_included || 0)}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Compute Credits</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise
                      ? 'Unlimited'
                      : `$${(plan.compute_credits_included || 0).toFixed(0)}`}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Storage</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise ? 'Unlimited' : `${plan.storage_gb_included || 0}GB`}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Concurrent Sessions</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise ? 'Unlimited' : plan.max_sessions || 0}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Max Agents</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise ? 'Unlimited' : plan.max_agents || 0}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Live Collaborators</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4 text-sm text-text-primary">
                    {plan.is_enterprise
                      ? 'Unlimited'
                      : (plan.max_team_members || 0) > 0
                        ? plan.max_team_members
                        : '-'}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">GPU Access</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4">
                    {plan.features?.gpu_access ? (
                      <Check className="w-5 h-5 text-accent-success mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-text-muted mx-auto" />
                    )}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border-subtle">
                <td className="py-3 px-4 text-sm text-text-secondary">Priority Support</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4">
                    {plan.features?.priority_support ? (
                      <Check className="w-5 h-5 text-accent-success mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-text-muted mx-auto" />
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-3 px-4 text-sm text-text-secondary">Overage Allowed</td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="text-center py-3 px-4">
                    {plan.overage_allowed ? (
                      <Check className="w-5 h-5 text-accent-success mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-text-muted mx-auto" />
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
