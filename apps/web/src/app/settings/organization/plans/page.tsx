'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  ChevronLeft,
  Check,
  Zap,
  Cpu,
  HardDrive,
  Users,
  Bot,
  Layers,
  AlertCircle,
  Crown,
} from 'lucide-react';
import { Button } from '@podex/ui';
import {
  listSubscriptionPlans,
  getOrgSubscription,
  createOrgSubscriptionCheckout,
  createOrgPlanChangeCheckout,
  type SubscriptionPlanResponse,
  type OrgSubscriptionResponse,
} from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsOrgOwner, useOrgContext } from '@/stores/organization';
import Link from 'next/link';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(0)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(0)}K`;
  }
  return num.toLocaleString();
}

export default function OrganizationPlansPage() {
  useDocumentTitle('Organization Plans');
  const router = useRouter();
  const isOwner = useIsOrgOwner();
  const orgContext = useOrgContext();

  const [plans, setPlans] = useState<SubscriptionPlanResponse[]>([]);
  const [subscription, setSubscription] = useState<OrgSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  // Redirect if not owner
  useEffect(() => {
    if (!isOwner && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isOwner, orgContext, router]);

  // Fetch plans and subscription
  useEffect(() => {
    const fetchData = async () => {
      if (!orgContext) return;
      setLoading(true);
      setError(null);
      try {
        const [plansData, subData] = await Promise.all([
          listSubscriptionPlans(),
          getOrgSubscription(orgContext.organization.id),
        ]);
        // Filter to only org-compatible plans (max_team_members > 1)
        const orgPlans = plansData.filter((p) => p.max_team_members > 1);
        setPlans(orgPlans);
        setSubscription(subData);
        if (subData?.billing_cycle) {
          setBillingCycle(subData.billing_cycle as 'monthly' | 'yearly');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load plans');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [orgContext]);

  const handleSelectPlan = async (plan: SubscriptionPlanResponse) => {
    if (!orgContext) return;
    setCheckoutLoading(plan.slug);
    try {
      if (subscription) {
        // Change plan
        const session = await createOrgPlanChangeCheckout(
          orgContext.organization.id,
          plan.slug,
          billingCycle,
          `${window.location.origin}/settings/organization/billing?plan_changed=true`,
          `${window.location.origin}/settings/organization/plans`
        );
        window.location.href = session.url;
      } else {
        // New subscription - start with 1 seat
        const session = await createOrgSubscriptionCheckout(
          orgContext.organization.id,
          plan.slug,
          billingCycle,
          1,
          `${window.location.origin}/settings/organization/billing?success=true`,
          `${window.location.origin}/settings/organization/plans`
        );
        window.location.href = session.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setCheckoutLoading(null);
    }
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="bg-accent-error/10 border border-accent-error/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-accent-error">Error</h3>
              <p className="text-sm text-text-secondary mt-1">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => window.location.reload()}
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentPlanSlug = subscription?.plan_slug;

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/settings/organization/billing"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Billing
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Organization Plans</h1>
            <p className="text-sm text-text-muted mt-1">
              Choose the right plan for your team. All resources are per seat.
            </p>
          </div>
        </div>
      </div>

      {/* Current Subscription Info */}
      {subscription && (
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Crown className="w-5 h-5 text-accent-warning" />
            <h2 className="text-lg font-semibold text-text-primary">Current Plan</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-text-muted">Plan</p>
              <p className="text-lg font-semibold text-text-primary">{subscription.plan_name}</p>
            </div>
            <div>
              <p className="text-sm text-text-muted">Seats</p>
              <p className="text-lg font-semibold text-text-primary">{subscription.seat_count}</p>
            </div>
            <div>
              <p className="text-sm text-text-muted">Billing</p>
              <p className="text-lg font-semibold text-text-primary capitalize">
                {subscription.billing_cycle}
              </p>
            </div>
            <div>
              <p className="text-sm text-text-muted">Renews</p>
              <p className="text-lg font-semibold text-text-primary">
                {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            </div>
          </div>
          {subscription.cancel_at_period_end && (
            <div className="mt-4 px-4 py-2 bg-accent-warning/10 border border-accent-warning/20 rounded-lg">
              <p className="text-sm text-accent-warning">
                Your subscription will be canceled at the end of the current period.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex justify-center mb-8">
        <div className="bg-surface border border-border-default rounded-lg p-1 inline-flex">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              billingCycle === 'monthly'
                ? 'bg-accent-primary text-white'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              billingCycle === 'yearly'
                ? 'bg-accent-primary text-white'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            Yearly
            <span className="ml-2 px-1.5 py-0.5 bg-accent-success/20 text-accent-success rounded text-xs">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const isCurrentPlan = plan.slug === currentPlanSlug;
          const price = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
          const monthlyPrice = billingCycle === 'yearly' ? price / 12 : price;

          return (
            <div
              key={plan.id}
              className={`bg-surface border rounded-xl p-6 flex flex-col ${
                isCurrentPlan
                  ? 'border-accent-primary ring-2 ring-accent-primary/20'
                  : plan.is_popular
                    ? 'border-accent-warning'
                    : 'border-border-default'
              }`}
            >
              {/* Plan Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-text-primary">{plan.name}</h3>
                {isCurrentPlan && (
                  <span className="px-2 py-1 bg-accent-primary/20 text-accent-primary text-xs font-medium rounded">
                    Current
                  </span>
                )}
                {plan.is_popular && !isCurrentPlan && (
                  <span className="px-2 py-1 bg-accent-warning/20 text-accent-warning text-xs font-medium rounded">
                    Popular
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-text-primary">
                    {formatCurrency(monthlyPrice * 100)}
                  </span>
                  <span className="text-text-muted">/seat/mo</span>
                </div>
                {billingCycle === 'yearly' && (
                  <p className="text-sm text-text-muted mt-1">
                    Billed annually ({formatCurrency(price * 100)}/seat/year)
                  </p>
                )}
              </div>

              {/* Description */}
              {plan.description && (
                <p className="text-sm text-text-muted mb-6">{plan.description}</p>
              )}

              {/* Resources */}
              <div className="space-y-3 mb-6 flex-1">
                <div className="flex items-center gap-3 text-sm">
                  <Zap className="w-4 h-4 text-accent-primary flex-shrink-0" />
                  <span className="text-text-primary">
                    {formatNumber(plan.tokens_included)} tokens/seat/mo
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Cpu className="w-4 h-4 text-accent-secondary flex-shrink-0" />
                  <span className="text-text-primary">
                    ${plan.compute_credits_included.toFixed(2)} compute/seat/mo
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <HardDrive className="w-4 h-4 text-info flex-shrink-0" />
                  <span className="text-text-primary">
                    {plan.storage_gb_included}GB storage/seat
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Layers className="w-4 h-4 text-accent-warning flex-shrink-0" />
                  <span className="text-text-primary">
                    {plan.max_sessions} concurrent pods/seat
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Bot className="w-4 h-4 text-accent-success flex-shrink-0" />
                  <span className="text-text-primary">{plan.max_agents} agents/seat</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Users className="w-4 h-4 text-text-muted flex-shrink-0" />
                  <span className="text-text-primary">
                    Up to {plan.max_team_members} team members
                  </span>
                </div>
              </div>

              {/* Features */}
              {Object.keys(plan.features).length > 0 && (
                <div className="border-t border-border-subtle pt-4 mb-6">
                  <p className="text-xs font-medium text-text-muted uppercase mb-3">Features</p>
                  <div className="space-y-2">
                    {Object.entries(plan.features)
                      .filter(([, enabled]) => enabled)
                      .map(([feature]) => (
                        <div key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="w-4 h-4 text-accent-success flex-shrink-0" />
                          <span className="text-text-secondary">
                            {feature.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Action Button */}
              {isCurrentPlan ? (
                <Button variant="outline" disabled className="w-full">
                  Current Plan
                </Button>
              ) : plan.is_enterprise ? (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => (window.location.href = 'mailto:sales@podex.dev')}
                >
                  Contact Sales
                </Button>
              ) : (
                <Button
                  variant={plan.is_popular ? 'primary' : 'secondary'}
                  className="w-full"
                  onClick={() => handleSelectPlan(plan)}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === plan.slug ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : subscription ? (
                    price >
                    (billingCycle === 'yearly'
                      ? subscription.price_yearly_cents / 100
                      : subscription.price_monthly_cents / 100) ? (
                      'Upgrade'
                    ) : (
                      'Switch Plan'
                    )
                  ) : (
                    'Subscribe'
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State */}
      {plans.length === 0 && (
        <div className="text-center py-16">
          <AlertCircle className="w-16 h-16 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Plans Available</h3>
          <p className="text-sm text-text-muted">
            Organization plans are not currently available. Please contact support.
          </p>
        </div>
      )}

      {/* Footer Note */}
      <div className="mt-8 text-center text-sm text-text-muted">
        <p>
          All prices are per seat. Changing plans will prorate your billing.{' '}
          <Link
            href="/settings/organization/billing"
            className="text-accent-primary hover:underline"
          >
            View billing details
          </Link>
        </p>
      </div>
    </div>
  );
}
