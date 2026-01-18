'use client';

import { Check, X } from 'lucide-react';
import Link from 'next/link';

interface PlanFeature {
  name: string;
  included: boolean;
  value?: string;
}

interface PlanCardProps {
  name: string;
  description?: string;
  price: number;
  priceYearly?: number;
  currency?: string;
  billingCycle: 'monthly' | 'yearly';
  features: PlanFeature[];
  isPopular?: boolean;
  isEnterprise?: boolean;
  isCurrent?: boolean;
  isDowngrade?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  enterpriseHref?: string;
}

export function PlanCard({
  name,
  description,
  price,
  priceYearly,
  currency = 'USD',
  billingCycle,
  features,
  isPopular = false,
  isEnterprise = false,
  isCurrent = false,
  isDowngrade = false,
  onSelect,
  disabled = false,
  enterpriseHref,
}: PlanCardProps) {
  const displayPrice = billingCycle === 'yearly' && priceYearly ? priceYearly / 12 : price;
  const savings =
    billingCycle === 'yearly' && priceYearly ? Math.round((1 - priceYearly / 12 / price) * 100) : 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div
      className={`relative bg-surface rounded-xl border p-6 transition-all flex flex-col ${
        isPopular
          ? 'border-accent-primary ring-1 ring-accent-primary/20'
          : isCurrent
            ? 'border-accent-success ring-1 ring-accent-success/20'
            : 'border-border-default hover:border-border-hover'
      }`}
    >
      {/* Badge */}
      {isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-accent-primary text-white text-xs font-medium rounded-full">
            Most Popular
          </span>
        </div>
      )}
      {isCurrent && !isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="px-3 py-1 bg-accent-success text-white text-xs font-medium rounded-full">
            Current Plan
          </span>
        </div>
      )}

      {/* Plan name and description */}
      <div className="text-center mb-4">
        <h3 className="text-xl font-bold text-text-primary">{name}</h3>
        {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
      </div>

      {/* Price */}
      <div className="text-center mb-6">
        {isEnterprise ? (
          <div className="text-2xl font-bold text-text-primary">Custom</div>
        ) : (
          <>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-text-primary">
                {formatCurrency(displayPrice)}
              </span>
              <span className="text-text-muted">/mo</span>
            </div>
            {billingCycle === 'yearly' && savings > 0 && (
              <p className="text-sm text-accent-success mt-1">
                Save {savings}% with yearly billing
              </p>
            )}
          </>
        )}
      </div>

      {/* Features */}
      <ul className="space-y-3 mb-6 flex-grow">
        {features.map((feature, index) => (
          <li key={index} className="flex items-start gap-3">
            {feature.included ? (
              <Check className="w-5 h-5 text-accent-success flex-shrink-0 mt-0.5" />
            ) : (
              <X className="w-5 h-5 text-text-muted flex-shrink-0 mt-0.5" />
            )}
            <span className={feature.included ? 'text-text-secondary' : 'text-text-muted'}>
              {feature.value ? (
                <>
                  <span className="font-medium text-text-primary">{feature.value}</span>{' '}
                  {feature.name}
                </>
              ) : (
                feature.name
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA Button */}
      {isEnterprise && enterpriseHref ? (
        <Link
          href={enterpriseHref}
          className={`w-full py-3 rounded-lg font-medium transition-colors text-center block ${
            isCurrent
              ? 'bg-accent-success/20 text-accent-success cursor-default pointer-events-none'
              : 'bg-elevated hover:bg-overlay text-text-primary'
          }`}
        >
          {isCurrent ? 'Current Plan' : 'Upgrade'}
        </Link>
      ) : (
        <button
          onClick={onSelect}
          disabled={disabled || isCurrent}
          className={`w-full py-3 rounded-lg font-medium transition-colors ${
            isCurrent
              ? 'bg-accent-success/20 text-accent-success cursor-default'
              : isPopular
                ? 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                : isDowngrade
                  ? 'bg-elevated hover:bg-overlay text-text-secondary'
                  : 'bg-elevated hover:bg-overlay text-text-primary'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isCurrent ? 'Current Plan' : isDowngrade ? 'Downgrade' : 'Upgrade'}
        </button>
      )}
    </div>
  );
}

interface PlanComparisonProps {
  plans: Array<{
    id: string;
    name: string;
    description?: string;
    price: number;
    priceYearly?: number;
    features: PlanFeature[];
    isPopular?: boolean;
    isEnterprise?: boolean;
  }>;
  currentPlanId?: string;
  billingCycle: 'monthly' | 'yearly';
  onSelectPlan: (planId: string) => void;
}

export function PlanComparison({
  plans,
  currentPlanId,
  billingCycle,
  onSelectPlan,
}: PlanComparisonProps) {
  const currentPlanIndex = plans.findIndex((p) => p.id === currentPlanId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {plans.map((plan, index) => (
        <PlanCard
          key={plan.id}
          name={plan.name}
          description={plan.description}
          price={plan.price}
          priceYearly={plan.priceYearly}
          billingCycle={billingCycle}
          features={plan.features}
          isPopular={plan.isPopular}
          isEnterprise={plan.isEnterprise}
          isCurrent={plan.id === currentPlanId}
          isDowngrade={currentPlanIndex > -1 && index < currentPlanIndex}
          onSelect={() => onSelectPlan(plan.id)}
        />
      ))}
    </div>
  );
}
