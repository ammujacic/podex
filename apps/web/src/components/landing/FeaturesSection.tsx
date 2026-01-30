'use client';

import { memo, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  Brain,
  GitBranch,
  Map,
  Eye,
  Mic,
  Volume2,
  Cpu,
  Server,
  Plug,
  Users,
  Radio,
  Sparkles,
  Bot,
  Workflow,
  Shield,
  Gauge,
} from 'lucide-react';

const featureCategories = [
  {
    title: 'Advanced Agent Types',
    description: 'Specialized agents that work together to build your applications',
    color: 'agent-1',
    features: [
      {
        icon: Workflow,
        title: 'Orchestrator Agent',
        description:
          'Coordinates multiple agents, delegates tasks, and synthesizes results for complex workflows.',
      },
      {
        icon: Bot,
        title: 'Agent Creator',
        description:
          'Generate custom agents on-the-fly with specific skills, tools, and personalities.',
      },
      {
        icon: Brain,
        title: 'Agent Memory',
        description:
          'Agents remember your preferences, past decisions, and project patterns across sessions.',
      },
      {
        icon: Map,
        title: 'Execution Planning',
        description:
          'Break down complex tasks into actionable steps with confidence scoring and rollback.',
      },
    ],
  },
  {
    title: 'Voice & Vision',
    description: 'Interact with your agents naturally through voice and images',
    color: 'agent-2',
    features: [
      {
        icon: Mic,
        title: 'Speech-to-Text',
        description:
          'Talk to your agents naturally. Voice commands are transcribed and executed in real-time.',
      },
      {
        icon: Volume2,
        title: 'Text-to-Speech',
        description:
          'Agents can speak their responses. Get audio summaries and updates hands-free.',
      },
      {
        icon: Eye,
        title: 'Vision Analysis',
        description:
          'Upload screenshots and mockups. Agents understand and generate code from images.',
      },
      {
        icon: Radio,
        title: 'Live Sessions',
        description: 'Real-time streaming responses with live collaboration and instant feedback.',
      },
    ],
  },
  {
    title: 'Compute & Integrations',
    description: 'Flexible compute options and powerful integrations',
    color: 'agent-3',
    features: [
      {
        icon: Cpu,
        title: 'Multiple Compute Types',
        description:
          'Choose between cloud, local, or hybrid compute. Run agents where your data lives.',
      },
      {
        icon: Server,
        title: 'Local Pods',
        description: 'Run compute locally on your machine for maximum privacy and zero latency.',
      },
      {
        icon: Plug,
        title: 'MCP Integrations',
        description:
          'Connect to external tools via Model Context Protocol. GitHub, Slack, databases, and more.',
      },
      {
        icon: GitBranch,
        title: 'Git Integration',
        description: 'Built-in version control with branch management, commits, and pull requests.',
      },
    ],
  },
  {
    title: 'Enterprise Ready',
    description: 'Built for teams and organizations at scale',
    color: 'agent-5',
    features: [
      {
        icon: Shield,
        title: 'Security First',
        description: 'SOC2 compliant with encryption at rest and in transit, audit logs, and SSO.',
      },
      {
        icon: Users,
        title: 'Team Collaboration',
        description:
          'Real-time collaboration with CRDT sync, shared sessions, and team workspaces.',
      },
      {
        icon: Gauge,
        title: 'Usage Analytics',
        description: 'Token tracking, cost estimation, and detailed usage reports per agent.',
      },
      {
        icon: Sparkles,
        title: 'Custom Agents',
        description: 'Build and deploy your own specialized agents with custom skills and tools.',
      },
    ],
  },
];

const FeatureCard = memo(function FeatureCard({
  feature,
  index,
  isInView,
  categoryColor,
}: {
  feature: (typeof featureCategories)[0]['features'][0];
  index: number;
  isInView: boolean;
  categoryColor: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="group relative bg-elevated border border-border-default rounded-xl p-5 hover:border-border-strong hover:shadow-panel transition-all duration-300"
    >
      {/* Icon */}
      <div
        className={`inline-flex p-2.5 rounded-lg bg-${categoryColor}/10 mb-3 group-hover:bg-${categoryColor}/20 transition-colors`}
      >
        <feature.icon className={`h-5 w-5 text-${categoryColor}`} />
      </div>

      {/* Content */}
      <h4 className="text-base font-semibold text-text-primary mb-1.5">{feature.title}</h4>
      <p className="text-sm text-text-secondary leading-relaxed">{feature.description}</p>
    </motion.div>
  );
});

const CategorySection = memo(function CategorySection({
  category,
  isInView,
  categoryIndex,
}: {
  category: (typeof featureCategories)[0];
  isInView: boolean;
  categoryIndex: number;
}) {
  return (
    <div className="mb-16 last:mb-0">
      {/* Category header */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={isInView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.4, delay: categoryIndex * 0.2 }}
        className="mb-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className={`w-1 h-8 rounded-full bg-${category.color}`} />
          <h3 className="text-xl font-bold text-text-primary">{category.title}</h3>
        </div>
        <p className="text-text-secondary ml-4">{category.description}</p>
      </motion.div>

      {/* Features grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {category.features.map((feature, index) => (
          <FeatureCard
            key={feature.title}
            feature={feature}
            index={index}
            isInView={isInView}
            categoryColor={category.color}
          />
        ))}
      </div>
    </div>
  );
});

export function FeaturesSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="features" ref={ref} className="py-12 lg:py-16 bg-void relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 right-0 w-96 h-96 bg-agent-1/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-agent-2/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-primary/3 rounded-full blur-3xl" />
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
            Everything you need to{' '}
            <span className="bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
              build faster
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            A complete AI-powered development environment with intelligent agents, powerful editor,
            and enterprise-grade features.
          </motion.p>
        </div>

        {/* Feature categories */}
        {featureCategories.map((category, index) => (
          <CategorySection
            key={category.title}
            category={category}
            isInView={isInView}
            categoryIndex={index}
          />
        ))}
      </div>
    </section>
  );
}
