'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { MessageSquare, GitBranch, Users, CheckCircle2, Rocket, ArrowRight } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: MessageSquare,
    title: 'Describe',
    description:
      'Tell your agents what you want to build in plain English. Be as specific or general as you like.',
    color: 'agent-1',
    example: '"Add user authentication with OAuth, email verification, and password reset"',
  },
  {
    number: '02',
    icon: GitBranch,
    title: 'Plan',
    description:
      'The Architect agent creates a detailed execution plan, breaking down your request into actionable steps.',
    color: 'agent-2',
    example: '→ Design auth schema\n→ Create API routes\n→ Build UI components\n→ Add tests',
  },
  {
    number: '03',
    icon: Users,
    title: 'Execute',
    description:
      'Specialized agents work in parallel. Frontend, Backend, and QA agents collaborate on your codebase.',
    color: 'agent-3',
    example: '4 agents working • 12 files modified • Real-time sync',
  },
  {
    number: '04',
    icon: CheckCircle2,
    title: 'Review',
    description:
      'Preview all changes with full diff view. Accept, reject, or request modifications to any change.',
    color: 'agent-4',
    example: '+142 lines added • 8 components created • 0 errors',
  },
  {
    number: '05',
    icon: Rocket,
    title: 'Deploy',
    description:
      'One-click deployment to your preferred platform. Automatic preview environments for every change.',
    color: 'agent-5',
    example: '✓ Build passed • ✓ Tests green • ✓ Preview live',
  },
];

function StepCard({
  step,
  index,
  isInView,
}: {
  step: (typeof steps)[0];
  index: number;
  isInView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="relative h-full"
    >
      {/* Connector line */}
      {index < steps.length - 1 && (
        <div className="hidden lg:flex absolute top-1/2 -translate-y-1/2 left-full w-8 items-center justify-center z-10">
          <motion.div
            className="w-full h-0.5 bg-border-default"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={isInView ? { scaleX: 1, opacity: 1 } : {}}
            transition={{ duration: 0.4, delay: index * 0.15 + 0.3 }}
            style={{ transformOrigin: 'left' }}
          />
        </div>
      )}

      <div className="group relative h-full flex flex-col bg-surface border border-border-default rounded-2xl p-6 hover:border-border-strong transition-all duration-300 hover:shadow-panel">
        {/* Step number badge */}
        <div
          className={`absolute -top-3 -left-3 w-10 h-10 rounded-full bg-${step.color} flex items-center justify-center text-sm font-bold text-text-inverse shadow-lg`}
        >
          {step.number}
        </div>

        {/* Icon + Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`inline-flex p-3 rounded-xl bg-${step.color}/10`}>
            <step.icon className={`h-6 w-6 text-${step.color}`} />
          </div>
          <h3 className="text-xl font-semibold text-text-primary">{step.title}</h3>
        </div>

        {/* Content */}
        <p className="text-sm text-text-secondary mb-4 flex-grow">{step.description}</p>

        {/* Example */}
        <div className="bg-void rounded-lg p-3 border border-border-subtle mt-auto">
          <pre className={`text-xs font-mono text-${step.color} whitespace-pre-wrap`}>
            {step.example}
          </pre>
        </div>
      </div>
    </motion.div>
  );
}

export function HowItWorksSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="how-it-works"
      ref={ref}
      className="py-12 lg:py-16 bg-void relative overflow-hidden"
    >
      {/* Background elements */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-accent-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent-secondary/5 rounded-full blur-3xl" />
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
            From idea to production in <span className="text-accent-primary">minutes</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            A streamlined workflow that turns your natural language descriptions into
            production-ready code.
          </motion.p>
        </div>

        {/* Steps grid */}
        <div className="grid gap-8 lg:grid-cols-5">
          {steps.map((step, index) => (
            <StepCard key={step.title} step={step} index={index} isInView={isInView} />
          ))}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.8 }}
          className="mt-16 text-center"
        >
          <p className="text-text-secondary mb-4">Ready to transform how you build software?</p>
          <a
            href="/auth/signup"
            className="inline-flex items-center gap-2 btn btn-primary text-lg px-8 py-3"
          >
            Get Started Free
            <ArrowRight className="h-5 w-5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
