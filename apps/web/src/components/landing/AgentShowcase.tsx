'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef } from 'react';
import { useInView } from 'framer-motion';
import { Workflow, Bot, Brain, Code2, Search, TestTube, ArrowRight, Check } from 'lucide-react';

const agents = [
  {
    id: 'orchestrator',
    name: 'Orchestrator',
    icon: Workflow,
    color: 'agent-1',
    tagline: 'The master coordinator',
    description:
      'Coordinates multiple agents, delegates tasks, and synthesizes results. Manages complex workflows and ensures all agents work together seamlessly.',
    capabilities: [
      'Multi-agent coordination',
      'Task delegation & synthesis',
      'Parallel execution management',
      'Cross-agent communication',
    ],
    demo: {
      type: 'planning',
      content: [
        { label: 'Task', value: 'Build auth system' },
        { label: 'Agents', value: '4 agents delegated' },
        { label: 'Status', value: 'Coordinating...' },
        { label: 'Progress', value: '3/4 complete' },
      ],
    },
  },
  {
    id: 'agent-builder',
    name: 'Agent Builder',
    icon: Bot,
    color: 'agent-2',
    tagline: 'The agent creator',
    description:
      'Creates custom agents on-the-fly with specific skills, tools, and personalities. Design specialized agents tailored to your exact needs.',
    capabilities: [
      'Custom agent generation',
      'Tool & skill configuration',
      'Personality customization',
      'Template-based creation',
    ],
    demo: {
      type: 'code',
      content: `// Creating a custom agent
const dbAgent = await createAgent({
  name: "Database Expert",
  skills: ["SQL", "migrations"],
  tools: ["query", "schema"],
  personality: "thorough"
})`,
    },
  },
  {
    id: 'architect',
    name: 'Architect',
    icon: Brain,
    color: 'agent-3',
    tagline: 'The strategic planner',
    description:
      'Designs system architecture, creates execution plans, and makes technology decisions. Uses memory to recall your preferences and patterns.',
    capabilities: [
      'System design & architecture',
      'Execution planning',
      'Technology stack decisions',
      'Memory-powered context',
    ],
    demo: {
      type: 'planning',
      content: [
        { label: 'Task', value: 'Add user authentication' },
        { label: 'Approach', value: 'JWT + OAuth2' },
        { label: 'Files', value: '8 to create' },
        { label: 'Confidence', value: '94%' },
      ],
    },
  },
  {
    id: 'coder',
    name: 'Coder',
    icon: Code2,
    color: 'agent-4',
    tagline: 'The code craftsman',
    description:
      'Writes production-ready code across any language or framework. Creates clean, maintainable, and well-documented implementations.',
    capabilities: [
      'Multi-language support',
      'Framework expertise',
      'Best practices & patterns',
      'Documentation generation',
    ],
    demo: {
      type: 'code',
      content: `export function LoginForm() {
  const [email, setEmail] = useState('')
  const { login, isLoading } = useAuth()

  return (
    <form onSubmit={handleSubmit}>
      <Input value={email} onChange={setEmail} />
      <Button loading={isLoading}>Sign In</Button>
    </form>
  )
}`,
    },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    icon: Search,
    color: 'agent-5',
    tagline: 'The quality checker',
    description:
      'Reviews code for bugs, security issues, and best practices. Provides actionable feedback and suggests improvements.',
    capabilities: [
      'Code review & analysis',
      'Security vulnerability detection',
      'Best practices enforcement',
      'Performance suggestions',
    ],
    demo: {
      type: 'test',
      content: [
        { name: 'Security check', status: 'passed', time: '2ms' },
        { name: 'Type safety', status: 'passed', time: '5ms' },
        { name: 'Best practices', status: 'passed', time: '3ms' },
        { name: 'Performance', status: 'passed', time: '4ms' },
      ],
    },
  },
  {
    id: 'tester',
    name: 'Tester',
    icon: TestTube,
    color: 'agent-6',
    tagline: 'The quality guardian',
    description:
      'Writes comprehensive tests, catches edge cases, and ensures your code is bulletproof. Creates unit, integration, and E2E tests.',
    capabilities: [
      'Unit & integration tests',
      'E2E test automation',
      'Edge case detection',
      'Coverage optimization',
    ],
    demo: {
      type: 'test',
      content: [
        { name: 'auth.login', status: 'passed', time: '12ms' },
        { name: 'auth.register', status: 'passed', time: '18ms' },
        { name: 'auth.logout', status: 'passed', time: '8ms' },
        { name: 'auth.refresh', status: 'passed', time: '15ms' },
      ],
    },
  },
];

function DemoContent({ agent }: { agent: (typeof agents)[0] }) {
  const demo = agent.demo;

  if (demo.type === 'planning') {
    return (
      <div className="space-y-3">
        {(demo.content as { label: string; value: string }[]).map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex justify-between items-center py-2 border-b border-border-subtle last:border-0"
          >
            <span className="text-text-muted text-sm">{item.label}</span>
            <span className="text-text-primary font-medium">{item.value}</span>
          </motion.div>
        ))}
      </div>
    );
  }

  if (demo.type === 'code') {
    return (
      <pre className="text-xs font-mono overflow-x-auto">
        <code>
          {(demo.content as string).split('\n').map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.05 }}
              className="leading-relaxed"
            >
              {line.includes('export') && (
                <span className="text-syntax-keyword">{line.split('function')[0]}</span>
              )}
              {line.includes('function') && (
                <span className="text-syntax-function">
                  function {line.split('function ')[1]?.split('(')[0]}
                </span>
              )}
              {line.includes('const') && <span className="text-syntax-keyword">const </span>}
              {line.includes('useState') && <span className="text-syntax-function">useState</span>}
              {line.includes('return') && <span className="text-syntax-keyword">return</span>}
              {!line.includes('export') && !line.includes('const') && !line.includes('return') && (
                <span className="text-text-secondary">{line}</span>
              )}
            </motion.div>
          ))}
        </code>
      </pre>
    );
  }

  if (demo.type === 'terminal') {
    const lines = demo.content as unknown as string[];
    return (
      <div className="font-mono text-xs space-y-1">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.1 }}
            className={
              line.startsWith('$')
                ? 'text-accent-primary'
                : line.startsWith('✓')
                  ? 'text-accent-success'
                  : line.startsWith('→')
                    ? 'text-agent-3'
                    : 'text-text-muted'
            }
          >
            {line}
          </motion.div>
        ))}
      </div>
    );
  }

  if (demo.type === 'test') {
    return (
      <div className="space-y-2">
        {(demo.content as { name: string; status: string; time: string }[]).map((test, i) => (
          <motion.div
            key={test.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex items-center justify-between text-sm"
          >
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-accent-success" />
              <span className="text-text-primary font-mono">{test.name}</span>
            </div>
            <span className="text-text-muted">{test.time}</span>
          </motion.div>
        ))}
        <div className="mt-4 pt-4 border-t border-border-subtle flex justify-between text-sm">
          <span className="text-accent-success">4 passed</span>
          <span className="text-text-muted">100% coverage</span>
        </div>
      </div>
    );
  }

  if (demo.type === 'deploy') {
    const stages = demo.content as unknown as { stage: string; status: string; duration: string }[];
    return (
      <div className="space-y-3">
        {stages.map((stage, i) => (
          <motion.div
            key={stage.stage}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15 }}
            className="flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-accent-success/20 flex items-center justify-center">
                <Check className="h-3 w-3 text-accent-success" />
              </div>
              <span className="text-text-primary">{stage.stage}</span>
            </div>
            <span className="text-text-muted text-sm">{stage.duration}</span>
          </motion.div>
        ))}
        <div className="mt-4 p-3 rounded-lg bg-accent-success/10 border border-accent-success/20 text-center">
          <span className="text-accent-success text-sm font-medium">✓ Deployed to production</span>
        </div>
      </div>
    );
  }

  if (demo.type === 'vision') {
    const content = demo.content as unknown as { detected: string[]; confidence: number };
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {content.detected.map((item, i) => (
            <motion.div
              key={item}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className="p-2 rounded bg-agent-6/10 border border-agent-6/20 text-xs text-center text-agent-6"
            >
              {item}
            </motion.div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
          <span className="text-text-muted text-sm">Confidence</span>
          <div className="flex items-center gap-2">
            <div className="w-20 h-2 bg-void rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-agent-6"
                initial={{ width: 0 }}
                animate={{ width: `${content.confidence}%` }}
                transition={{ duration: 0.5, delay: 0.3 }}
              />
            </div>
            <span className="text-agent-6 font-medium">{content.confidence}%</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export function AgentShowcase() {
  const firstAgent = agents[0]!;
  const [activeAgent, setActiveAgent] = useState(firstAgent);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section id="agents" ref={ref} className="py-12 lg:py-16 bg-surface relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
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
            Specialized agents for <span className="text-accent-secondary">every task</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            Each agent is an expert in their domain, working together seamlessly to build your
            application.
          </motion.p>
        </div>

        {/* Agent selector tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-2 mb-12"
        >
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setActiveAgent(agent)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                activeAgent.id === agent.id
                  ? `bg-${agent.color}/20 text-${agent.color} border border-${agent.color}/30`
                  : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-overlay border border-transparent'
              }`}
            >
              <agent.icon className="h-4 w-4" />
              {agent.name}
            </button>
          ))}
        </motion.div>

        {/* Agent detail view */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeAgent.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid lg:grid-cols-2 gap-8 lg:gap-12"
          >
            {/* Left: Agent info */}
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div
                  className={`p-4 rounded-2xl bg-${activeAgent.color}/10 border border-${activeAgent.color}/20`}
                >
                  <activeAgent.icon className={`h-8 w-8 text-${activeAgent.color}`} />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-text-primary">{activeAgent.name}</h3>
                  <p className={`text-${activeAgent.color}`}>{activeAgent.tagline}</p>
                </div>
              </div>

              <p className="text-text-secondary text-lg">{activeAgent.description}</p>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-muted uppercase tracking-wide">
                  Capabilities
                </h4>
                <ul className="space-y-2">
                  {activeAgent.capabilities.map((cap, i) => (
                    <motion.li
                      key={cap}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-center gap-3 text-text-primary"
                    >
                      <div className={`w-1.5 h-1.5 rounded-full bg-${activeAgent.color}`} />
                      {cap}
                    </motion.li>
                  ))}
                </ul>
              </div>

              <button
                className={`inline-flex items-center gap-2 text-${activeAgent.color} hover:underline font-medium`}
              >
                Learn more about {activeAgent.name}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            {/* Right: Live demo preview */}
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-accent-primary/10 via-accent-secondary/10 to-agent-3/10 rounded-3xl blur-2xl opacity-50" />
              <div className="relative bg-void border border-border-default rounded-2xl overflow-hidden">
                {/* Demo header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface/50">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full bg-${activeAgent.color} animate-pulse`} />
                    <span className="text-sm text-text-muted">{activeAgent.name} Agent</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-accent-success/10 text-accent-success">
                    Live
                  </span>
                </div>

                {/* Demo content */}
                <div className="p-6 min-h-[300px]">
                  <DemoContent agent={activeAgent} />
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
