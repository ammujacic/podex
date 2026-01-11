'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { Check, Sparkles, Building2, Zap, Users } from 'lucide-react';

const plans = [
  {
    name: 'Free',
    description: 'Perfect for trying out Podex',
    price: { monthly: 0, yearly: 0 },
    icon: Zap,
    color: 'agent-3',
    features: [
      'Limited tokens & compute',
      'Public projects only',
      'Basic agent features',
      'Community support',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    name: 'Pro',
    description: 'For professional developers',
    price: { monthly: 29, yearly: 24 },
    icon: Sparkles,
    color: 'accent-primary',
    features: [
      'Generous tokens & compute',
      'Private projects',
      'Agent memory',
      'Planning mode',
      'Vision analysis',
      'Git integration',
      'Email support',
    ],
    cta: 'Start Free Trial',
    popular: true,
  },
  {
    name: 'Team',
    description: 'For growing teams',
    price: { monthly: 79, yearly: 66 },
    icon: Users,
    color: 'agent-2',
    features: [
      'Everything in Pro',
      'Team collaboration',
      'GPU access',
      'Advanced analytics',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    popular: false,
  },
  {
    name: 'Enterprise',
    description: 'For organizations at scale',
    price: { monthly: 'Custom', yearly: 'Custom' },
    icon: Building2,
    color: 'accent-secondary',
    features: [
      'Everything in Team',
      'Unlimited team members',
      'Custom agent templates',
      'SSO & SAML',
      'Audit logs',
      'Self-hosted option',
      'SLA & dedicated support',
    ],
    cta: 'Contact Sales',
    popular: false,
  },
];

export function PricingSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [isYearly, setIsYearly] = useState(true);

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
                -17%
              </span>
            </button>
          </motion.div>
        </div>

        {/* Pricing cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
              className={`relative rounded-2xl border p-8 ${
                plan.popular
                  ? 'border-accent-primary bg-void shadow-[0_0_60px_-15px_rgba(0,229,255,0.3)]'
                  : 'border-border-default bg-elevated'
              }`}
            >
              {/* Popular badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1.5 rounded-full bg-accent-primary text-text-inverse text-sm font-medium">
                    Most Popular
                  </span>
                </div>
              )}

              {/* Plan header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`p-2.5 rounded-xl bg-${plan.color}/10`}>
                  <plan.icon className={`h-6 w-6 text-${plan.color}`} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-text-primary">{plan.name}</h3>
                  <p className="text-sm text-text-muted">{plan.description}</p>
                </div>
              </div>

              {/* Price */}
              <div className="mb-6">
                {typeof plan.price.monthly === 'number' ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-text-primary">
                      ${isYearly ? plan.price.yearly : plan.price.monthly}
                    </span>
                    <span className="text-text-muted">/month</span>
                  </div>
                ) : (
                  <div className="text-4xl font-bold text-text-primary">Custom</div>
                )}
                {isYearly &&
                  typeof plan.price.monthly === 'number' &&
                  typeof plan.price.yearly === 'number' &&
                  plan.price.monthly > 0 && (
                    <p className="text-sm text-text-muted mt-1">
                      Billed annually (${plan.price.yearly * 12}/year)
                    </p>
                  )}
              </div>

              {/* CTA */}
              <a
                href={plan.name === 'Enterprise' ? '/contact' : '/auth/signup'}
                className={`block w-full py-3 px-4 rounded-xl text-center font-medium transition-all ${
                  plan.popular
                    ? 'bg-accent-primary text-text-inverse hover:shadow-[0_0_30px_rgba(0,229,255,0.4)]'
                    : 'bg-surface border border-border-default text-text-primary hover:border-border-strong hover:bg-overlay'
                }`}
              >
                {plan.cta}
              </a>

              {/* Features */}
              <ul className="mt-8 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className={`h-5 w-5 text-${plan.color} shrink-0 mt-0.5`} />
                    <span className="text-sm text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
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
