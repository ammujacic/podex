'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { Check, Sparkles, Zap, Users, Building2 } from 'lucide-react';
import { listSubscriptionPlans, type SubscriptionPlanResponse } from '@/lib/api';

// Map feature keys to human-readable labels
const featureLabels: Record<string, string> = {
  private_projects: 'Private projects',
  git_integration: 'Git integration',
  agent_memory: 'Agent memory',
  planning_mode: 'Planning mode',
  vision_analysis: 'Vision analysis',
  team_collaboration: 'Team collaboration',
  gpu_access: 'GPU access',
  advanced_analytics: 'Advanced analytics',
  audit_logs: 'Audit logs',
  custom_agents: 'Custom agents',
  sso_saml: 'SSO/SAML',
  self_hosted_option: 'Self-hosted option',
  sla: 'SLA guarantee',
  community_support: 'Community support',
  email_support: 'Email support',
  priority_support: 'Priority support',
  dedicated_support: 'Dedicated support',
};

// Map plan slugs to icons and colors
const planStyles: Record<string, { icon: typeof Zap; color: string }> = {
  free: { icon: Zap, color: 'agent-3' },
  pro: { icon: Sparkles, color: 'accent-primary' },
  max: { icon: Users, color: 'agent-2' },
  enterprise: { icon: Building2, color: 'accent-secondary' },
};

function getEnabledFeatures(features: Record<string, boolean>): string[] {
  return Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([key]) => featureLabels[key] || key)
    .slice(0, 7); // Limit to 7 features for display
}

export function PricingSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [isYearly, setIsYearly] = useState(true);
  const [plans, setPlans] = useState<SubscriptionPlanResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    listSubscriptionPlans()
      .then((data) => {
        // Filter out enterprise plans (they use "Contact us" instead)
        setPlans(data.filter((p) => !p.is_enterprise));
      })
      .catch((err) => {
        console.error('Failed to fetch plans:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Calculate yearly discount percentage (comparing to monthly)
  const yearlyDiscount =
    plans.length > 0 && plans[1]
      ? Math.round((1 - plans[1].price_yearly / 12 / plans[1].price_monthly) * 100)
      : 17;

  return (
    <section id="pricing" ref={ref} className="py-12 lg:py-16 bg-surface relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
        <div className="absolute top-1/2 left-0 w-[600px] h-[600px] bg-accent-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-accent-secondary/5 rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-text-primary mb-4"
          >
            Start free, scale as you <span className="text-accent-secondary">grow</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto mb-8"
          >
            No credit card required. Start building with AI agents today.
          </motion.p>

          {/* Billing toggle */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="inline-flex items-center gap-3 p-1 rounded-full bg-elevated border border-border-default"
          >
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                !isYearly
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Yearly
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  isYearly ? 'bg-text-inverse/20' : 'bg-accent-success/20 text-accent-success'
                }`}
              >
                -{yearlyDiscount}%
              </span>
            </button>
          </motion.div>
        </div>

        {/* Pricing cards */}
        <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto">
          {isLoading
            ? // Loading skeleton
              Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="relative rounded-2xl border border-border-default bg-elevated p-8 animate-pulse"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-surface" />
                    <div className="flex-1">
                      <div className="h-6 w-20 bg-surface rounded mb-2" />
                      <div className="h-4 w-32 bg-surface rounded" />
                    </div>
                  </div>
                  <div className="h-10 w-24 bg-surface rounded mb-6" />
                  <div className="h-12 w-full bg-surface rounded mb-8" />
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-5 bg-surface rounded w-3/4" />
                    ))}
                  </div>
                </div>
              ))
            : plans.map((plan, index) => {
                const style = planStyles[plan.slug] || { icon: Zap, color: 'accent-primary' };
                const PlanIcon = style.icon;
                const planColor = style.color;
                const features = getEnabledFeatures(plan.features);
                const monthlyPrice = isYearly
                  ? Math.round(plan.price_yearly / 12)
                  : plan.price_monthly;
                const ctaText = plan.price_monthly === 0 ? 'Get Started' : 'Start Free Trial';

                return (
                  <motion.div
                    key={plan.slug}
                    initial={{ opacity: 0, y: 30 }}
                    animate={isInView ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                    className={`relative rounded-2xl border p-8 ${
                      plan.is_popular
                        ? 'border-accent-primary bg-void shadow-[0_0_60px_-15px_rgba(0,229,255,0.3)]'
                        : 'border-border-default bg-elevated'
                    }`}
                  >
                    {/* Popular badge */}
                    {plan.is_popular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                        <span className="px-4 py-1.5 rounded-full bg-accent-primary text-text-inverse text-sm font-medium">
                          Most Popular
                        </span>
                      </div>
                    )}

                    {/* Plan header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`p-2.5 rounded-xl bg-${planColor}/10`}>
                        <PlanIcon className={`h-6 w-6 text-${planColor}`} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-text-primary">{plan.name}</h3>
                        <p className="text-sm text-text-muted">{plan.description}</p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="mb-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold text-text-primary">
                          ${monthlyPrice}
                        </span>
                        <span className="text-text-muted">/month</span>
                      </div>
                      {isYearly && plan.price_monthly > 0 && (
                        <p className="text-sm text-text-muted mt-1">
                          Billed annually (${plan.price_yearly}/year)
                        </p>
                      )}
                    </div>

                    {/* CTA */}
                    <a
                      href="/auth/signup"
                      className={`block w-full py-3 px-4 rounded-xl text-center font-medium transition-all ${
                        plan.is_popular
                          ? 'bg-accent-primary text-text-inverse hover:shadow-[0_0_30px_rgba(0,229,255,0.4)]'
                          : 'bg-surface border border-border-default text-text-primary hover:border-border-strong hover:bg-overlay'
                      }`}
                    >
                      {ctaText}
                    </a>

                    {/* Features */}
                    <ul className="mt-8 space-y-3">
                      {features.map((feature) => (
                        <li key={feature} className="flex items-start gap-3">
                          <Check className={`h-5 w-5 text-${planColor} shrink-0 mt-0.5`} />
                          <span className="text-sm text-text-secondary">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                );
              })}
        </div>

        {/* FAQ teaser */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-16 text-center"
        >
          <p className="text-text-secondary">
            Have questions?{' '}
            <a href="/faq" className="text-accent-primary hover:underline">
              Check our FAQ
            </a>{' '}
            or{' '}
            <a href="/contact" className="text-accent-primary hover:underline">
              contact us
            </a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
