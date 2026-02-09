import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, Brain, Code, Shield, TestTube, Layers, ArrowRight, Sparkles } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'AI Agents',
  description:
    'Explore Podex specialized AI agents: Orchestrator, Architect, Coder, Reviewer, and Tester. Multi-agent collaboration for faster development.',
  alternates: {
    canonical: '/agents',
  },
};

const agents = [
  {
    name: 'Orchestrator',
    description:
      'The conductor of your development symphony. Coordinates multiple agents, manages task dependencies, and ensures smooth parallel execution.',
    icon: Layers,
    color: 'accent-primary',
    capabilities: [
      'Multi-agent coordination',
      'Task dependency management',
      'Parallel execution',
      'Progress monitoring',
    ],
  },
  {
    name: 'Architect',
    description:
      'Designs system architecture and creates execution plans. Breaks down complex requirements into actionable tasks with clear dependencies.',
    icon: Brain,
    color: 'agent-1',
    capabilities: [
      'System design',
      'Execution planning',
      'Dependency analysis',
      'Technical specifications',
    ],
  },
  {
    name: 'Coder',
    description:
      'Writes production-ready code following best practices. Generates clean, maintainable code with proper error handling and documentation.',
    icon: Code,
    color: 'agent-2',
    capabilities: ['Code generation', 'Refactoring', 'Documentation', 'Best practices'],
  },
  {
    name: 'Reviewer',
    description:
      'Analyzes code quality, security, and performance. Provides actionable feedback and suggestions for improvements.',
    icon: Shield,
    color: 'agent-3',
    capabilities: [
      'Code review',
      'Security analysis',
      'Performance optimization',
      'Quality assurance',
    ],
  },
  {
    name: 'Tester',
    description:
      'Creates comprehensive test suites and validates functionality. Ensures code reliability through unit, integration, and e2e tests.',
    icon: TestTube,
    color: 'agent-4',
    capabilities: ['Test generation', 'Coverage analysis', 'Integration testing', 'E2E testing'],
  },
  {
    name: 'Agent Builder',
    description:
      'Create custom agents tailored to your specific workflows. Define capabilities, behaviors, and integrations for specialized tasks.',
    icon: Bot,
    color: 'accent-secondary',
    capabilities: [
      'Custom agent creation',
      'Behavior definition',
      'Integration setup',
      'Workflow automation',
    ],
  },
];

export default function AgentsPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-void">
        {/* Hero */}
        <section className="py-24 lg:py-32 relative overflow-hidden">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent-primary/10 rounded-full blur-3xl" />
          </div>

          <div className="mx-auto max-w-7xl px-4 lg:px-8 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-primary/30 bg-accent-primary/10 px-4 py-1.5 text-sm text-accent-primary mb-6">
              <Sparkles className="h-4 w-4" />
              Specialized AI Agents
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6">
              Meet Your <span className="text-accent-primary">AI Development Team</span>
            </h1>
            <p className="text-xl text-text-secondary max-w-3xl mx-auto mb-8">
              Podex agents work together seamlessly, each bringing specialized skills to accelerate
              your development workflow. From planning to deployment, they&apos;ve got you covered.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/auth/signup"
                className="px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all inline-flex items-center gap-2"
              >
                Start Building Free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/#demo"
                className="px-6 py-3 rounded-xl bg-surface border border-border-default text-text-primary font-medium hover:border-border-strong transition-all"
              >
                Watch Demo
              </Link>
            </div>
          </div>
        </section>

        {/* Agents Grid */}
        <section className="py-16 lg:py-24 bg-surface">
          <div className="mx-auto max-w-7xl px-4 lg:px-8">
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className="relative rounded-2xl border border-border-default bg-elevated p-8 hover:border-border-strong transition-all group"
                >
                  <div className={`p-3 rounded-xl bg-${agent.color}/10 w-fit mb-4`}>
                    <agent.icon className={`h-8 w-8 text-${agent.color}`} />
                  </div>
                  <h3 className="text-2xl font-bold text-text-primary mb-3">{agent.name}</h3>
                  <p className="text-text-secondary mb-6">{agent.description}</p>
                  <ul className="space-y-2">
                    {agent.capabilities.map((cap) => (
                      <li key={cap} className="flex items-center gap-2 text-sm text-text-muted">
                        <span className={`w-1.5 h-1.5 rounded-full bg-${agent.color}`} />
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 lg:px-8 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Ready to supercharge your development?
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto mb-8">
              Start building with AI agents today. No credit card required.
            </p>
            <Link
              href="/auth/signup"
              className="px-8 py-4 rounded-xl bg-accent-primary text-text-inverse font-medium text-lg hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all inline-flex items-center gap-2"
            >
              Get Started Free
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </div>
      <Footer />
    </>
  );
}
