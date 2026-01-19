'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  CreditCard,
  Shield,
  BarChart3,
  Settings,
  Check,
  ArrowRight,
  Lock,
} from 'lucide-react';

const teamFeatures = [
  {
    icon: CreditCard,
    title: 'Centralized Billing',
    description:
      'One bill for your entire team. Purchase credits in bulk and distribute them across your organization.',
  },
  {
    icon: Shield,
    title: 'Usage Controls',
    description:
      'Set spending limits, restrict models, and control which features each team member can access.',
  },
  {
    icon: BarChart3,
    title: 'Usage Analytics',
    description:
      'Track spending and usage across your organization with detailed breakdowns by member and project.',
  },
  {
    icon: Users,
    title: 'Team Management',
    description:
      'Invite members via email or shareable links. Configure role-based permissions (Owner, Admin, Member).',
  },
  {
    icon: Settings,
    title: 'Flexible Credit Models',
    description:
      'Choose pooled credits, allocated budgets, or usage-based billing to match how your team works.',
  },
  {
    icon: Lock,
    title: 'Enterprise Ready',
    description:
      'Domain-based auto-join, audit logs, and compliance features for enterprise security requirements.',
  },
];

export function TeamsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="teams" ref={ref} className="py-16 lg:py-24 bg-void relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
        <div className="absolute top-1/4 right-0 w-[800px] h-[800px] bg-accent-secondary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-[600px] h-[600px] bg-accent-primary/5 rounded-full blur-3xl" />
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
            Build together with <span className="text-accent-secondary">centralized control</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            Create an organization to manage your team with centralized billing, usage controls, and
            detailed analytics. Perfect for teams of any size.
          </motion.p>
        </div>

        {/* Features Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-16">
          {teamFeatures.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.5 + index * 0.1 }}
              className="group"
            >
              <div className="h-full rounded-2xl border border-border-default bg-elevated p-6 hover:border-accent-secondary/50 transition-colors">
                <div className="p-3 rounded-xl bg-accent-secondary/10 w-fit mb-4 group-hover:bg-accent-secondary/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-accent-secondary" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary mb-2">{feature.title}</h3>
                <p className="text-sm text-text-secondary">{feature.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA Box */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="relative rounded-3xl border border-accent-secondary/30 bg-gradient-to-br from-accent-secondary/10 to-accent-primary/5 p-8 lg:p-12"
        >
          <div className="grid gap-8 lg:grid-cols-2 items-center">
            <div>
              <h3 className="text-2xl lg:text-3xl font-bold text-text-primary mb-4">
                Ready to scale your team&apos;s AI development?
              </h3>
              <p className="text-text-secondary mb-6">
                Create your organization in minutes. Invite your team, set up billing, and start
                building with AI agents together.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'No per-seat pricing - pay for what you use',
                  'Set up in under 5 minutes',
                  'Free to create, purchase credits when ready',
                  'Full control over member permissions',
                ].map((item, index) => (
                  <li key={index} className="flex items-center gap-3 text-text-secondary">
                    <Check className="w-5 h-5 text-accent-success shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-4">
                <Link
                  href="/auth/signup?type=organization"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-secondary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(255,100,50,0.4)] transition-all"
                >
                  Create Organization
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/settings/organization"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-surface border border-border-default text-text-primary font-medium hover:border-border-strong transition-colors"
                >
                  Learn More
                </Link>
              </div>
            </div>

            {/* Stats Preview */}
            <div className="hidden lg:block">
              <div className="rounded-2xl border border-border-default bg-void/80 backdrop-blur p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-lg bg-accent-secondary/10">
                    <Building2 className="w-5 h-5 text-accent-secondary" />
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">Acme Inc.</p>
                    <p className="text-xs text-text-muted">12 members</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-elevated rounded-xl p-4">
                    <p className="text-xs text-text-muted mb-1">Credit Balance</p>
                    <p className="text-xl font-bold text-text-primary">$2,450</p>
                  </div>
                  <div className="bg-elevated rounded-xl p-4">
                    <p className="text-xs text-text-muted mb-1">This Month</p>
                    <p className="text-xl font-bold text-text-primary">$1,280</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { name: 'Sarah Chen', spent: 320, limit: 500 },
                    { name: 'Marcus Johnson', spent: 280, limit: 400 },
                    { name: 'Emily Rodriguez', spent: 190, limit: 300 },
                  ].map((member) => (
                    <div key={member.name} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-xs font-medium text-text-muted">
                        {member.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-text-secondary">{member.name}</span>
                          <span className="text-text-muted">
                            ${member.spent}/${member.limit}
                          </span>
                        </div>
                        <div className="h-1.5 bg-void rounded-full">
                          <div
                            className="h-1.5 bg-accent-secondary rounded-full"
                            style={{ width: `${(member.spent / member.limit) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
