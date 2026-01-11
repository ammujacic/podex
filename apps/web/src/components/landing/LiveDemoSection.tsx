'use client';

import { motion, useInView, AnimatePresence } from 'framer-motion';
import { useRef, useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  Workflow,
  Code2,
  Terminal,
  TestTube,
  Check,
  Loader2,
  MessageSquare,
  Play,
  Pause,
} from 'lucide-react';

type AgentStatus = 'idle' | 'working' | 'done';

interface Agent {
  id: string;
  name: string;
  icon: typeof Code2;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  task: string;
  output: string;
}

// Using explicit color classes that Tailwind can detect at build time
const agents: Agent[] = [
  {
    id: 'frontend',
    name: 'Frontend',
    icon: Code2,
    colorClass: 'text-agent-2',
    bgClass: 'bg-agent-2/10',
    borderClass: 'border-agent-2',
    task: 'Build login UI',
    output: 'LoginForm.tsx created',
  },
  {
    id: 'backend',
    name: 'Backend',
    icon: Terminal,
    colorClass: 'text-agent-3',
    bgClass: 'bg-agent-3/10',
    borderClass: 'border-agent-3',
    task: 'Create auth API',
    output: '/api/auth routes ready',
  },
  {
    id: 'qa',
    name: 'QA',
    icon: TestTube,
    colorClass: 'text-agent-4',
    bgClass: 'bg-agent-4/10',
    borderClass: 'border-agent-4',
    task: 'Write tests',
    output: '12 tests passing',
  },
];

// Line colors using CSS variable hex values for inline styles
// (Tailwind can't detect dynamic class names at build time)
const lineColors = [
  'rgba(168, 85, 247, 0.6)', // agent-2: #a855f7
  'rgba(34, 197, 94, 0.6)', // agent-3: #22c55e
  'rgba(249, 115, 22, 0.6)', // agent-4: #f97316
];

export function LiveDemoSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [phase, setPhase] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({
    frontend: 'idle',
    backend: 'idle',
    qa: 'idle',
  });

  const runDemo = useCallback(() => {
    // Phase 0: Initial state
    setPhase(0);
    setAgentStatuses({ frontend: 'idle', backend: 'idle', qa: 'idle' });

    // Phase 1: User input (500ms)
    setTimeout(() => setPhase(1), 500);

    // Phase 2: Orchestrator planning (1500ms)
    setTimeout(() => setPhase(2), 1500);

    // Phase 3: Delegate to agents (2500ms)
    setTimeout(() => {
      setPhase(3);
      setAgentStatuses({ frontend: 'working', backend: 'working', qa: 'working' });
    }, 2500);

    // Phase 4: Agents complete (staggered - more spaced out)
    setTimeout(() => setAgentStatuses((s) => ({ ...s, frontend: 'done' })), 5000);
    setTimeout(() => setAgentStatuses((s) => ({ ...s, backend: 'done' })), 7000);
    setTimeout(() => setAgentStatuses((s) => ({ ...s, qa: 'done' })), 9000);

    // Phase 5: Complete (10000ms)
    setTimeout(() => setPhase(5), 10000);
  }, []);

  // Auto-play animation when in view
  useEffect(() => {
    if (!isInView || !isPlaying) return;

    runDemo();
    const interval = setInterval(runDemo, 15000);
    return () => clearInterval(interval);
  }, [isInView, isPlaying, runDemo]);

  const goToPhase = (targetPhase: number) => {
    setIsPlaying(false);
    setPhase(targetPhase);

    // Set agent statuses based on phase
    if (targetPhase < 3) {
      setAgentStatuses({ frontend: 'idle', backend: 'idle', qa: 'idle' });
    } else if (targetPhase < 5) {
      setAgentStatuses({ frontend: 'working', backend: 'working', qa: 'working' });
    } else {
      setAgentStatuses({ frontend: 'done', backend: 'done', qa: 'done' });
    }
  };

  const togglePlayback = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      runDemo();
    }
  };

  return (
    <section id="demo" ref={ref} className="py-12 lg:py-16 bg-surface relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-border-subtle to-transparent" />
        <div className="absolute top-1/3 right-0 w-[500px] h-[500px] bg-accent-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 left-0 w-[500px] h-[500px] bg-accent-secondary/5 rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-text-primary mb-4"
          >
            Watch agents <span className="text-agent-3">build together</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            The Orchestrator coordinates specialized agents to build features in parallel.
          </motion.p>
        </div>

        {/* Demo visualization */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="relative max-w-5xl mx-auto"
        >
          <div className="absolute -inset-4 bg-gradient-to-r from-agent-1/10 via-agent-2/10 to-agent-3/10 rounded-3xl blur-2xl opacity-50" />

          <div className="relative bg-void border border-border-default rounded-2xl p-8 lg:p-12">
            {/* User input */}
            <div className="flex justify-center mb-8">
              <AnimatePresence mode="wait">
                {phase >= 1 && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 px-4 py-2 rounded-full bg-surface border border-border-default"
                  >
                    <MessageSquare className="h-4 w-4 text-accent-primary" />
                    <span className="text-sm text-text-primary font-mono">
                      &quot;Build a user authentication system&quot;
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Orchestrator */}
            <div className="flex justify-center mb-6 relative z-10">
              <motion.div
                className={`relative p-6 rounded-2xl border-2 transition-all duration-300 ${
                  phase >= 2 ? 'bg-agent-1/10 border-agent-1' : 'bg-surface border-border-default'
                }`}
                animate={phase >= 2 && phase < 5 ? { scale: [1, 1.02, 1] } : {}}
                transition={{ duration: 1, repeat: Infinity }}
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-agent-1/20">
                    <Workflow className="h-8 w-8 text-agent-1" />
                  </div>
                  <div>
                    <h3 className="font-bold text-text-primary text-lg">Orchestrator</h3>
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={phase}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-sm text-text-muted"
                      >
                        {phase < 2 && 'Waiting...'}
                        {phase === 2 && 'Planning execution...'}
                        {phase >= 3 && phase < 5 && 'Coordinating agents...'}
                        {phase >= 5 && 'Task complete!'}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                  {phase >= 5 && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="ml-2 p-1.5 rounded-full bg-accent-success"
                    >
                      <Check className="h-4 w-4 text-text-inverse" />
                    </motion.div>
                  )}
                </div>
              </motion.div>
            </div>

            {/* Connection lines from Orchestrator to Agents */}
            <div className="relative h-16 mb-2">
              {/* Vertical line from orchestrator */}
              <AnimatePresence>
                {phase >= 3 && (
                  <motion.div
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.3 }}
                    className="absolute left-1/2 -translate-x-1/2 top-0 w-0.5 h-8"
                    style={{
                      transformOrigin: 'top',
                      backgroundColor: 'rgba(139, 92, 246, 0.6)', // agent-1: #8B5CF6
                    }}
                  />
                )}
              </AnimatePresence>
              {/* Horizontal line spanning all agents */}
              <AnimatePresence>
                {phase >= 3 && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                    className="absolute top-8 left-[16.67%] right-[16.67%] h-0.5"
                    style={{
                      transformOrigin: 'center',
                      background: `linear-gradient(to right, ${lineColors[0]}, ${lineColors[1]}, ${lineColors[2]})`,
                    }}
                  />
                )}
              </AnimatePresence>
              {/* Vertical lines down to each agent */}
              <AnimatePresence>
                {phase >= 3 && (
                  <>
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.2, delay: 0.4 }}
                      className="absolute top-8 w-0.5 h-8"
                      style={{
                        left: '16.67%',
                        transform: 'translateX(-50%)',
                        transformOrigin: 'top',
                        backgroundColor: lineColors[0],
                      }}
                    />
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.2, delay: 0.5 }}
                      className="absolute top-8 w-0.5 h-8"
                      style={{
                        left: '50%',
                        transform: 'translateX(-50%)',
                        transformOrigin: 'top',
                        backgroundColor: lineColors[1],
                      }}
                    />
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.2, delay: 0.6 }}
                      className="absolute top-8 w-0.5 h-8"
                      style={{
                        left: '83.33%',
                        transform: 'translateX(-50%)',
                        transformOrigin: 'top',
                        backgroundColor: lineColors[2],
                      }}
                    />
                  </>
                )}
              </AnimatePresence>
            </div>

            {/* Agent cards */}
            <div className="grid grid-cols-3 gap-6 relative z-10">
              {agents.map((agent, i) => {
                const status = agentStatuses[agent.id];
                const isActive = status === 'working';
                const isDone = status === 'done';

                return (
                  <motion.div
                    key={agent.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0.3, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.1 }}
                    className={`p-4 rounded-xl border transition-all duration-300 ${
                      isDone
                        ? 'bg-accent-success/10 border-accent-success'
                        : isActive
                          ? `${agent.bgClass} ${agent.borderClass}`
                          : 'bg-surface border-border-default'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 rounded-lg ${agent.bgClass.replace('/10', '/20')}`}>
                        <agent.icon className={`h-5 w-5 ${agent.colorClass}`} />
                      </div>
                      <span className="font-semibold text-text-primary">{agent.name}</span>
                      {isActive && (
                        <Loader2 className={`h-4 w-4 ${agent.colorClass} animate-spin ml-auto`} />
                      )}
                      {isDone && <Check className="h-4 w-4 text-accent-success ml-auto" />}
                    </div>
                    <p className="text-xs text-text-muted mb-2">{agent.task}</p>
                    <AnimatePresence>
                      {isDone && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="text-xs font-mono text-accent-success bg-accent-success/10 px-2 py-1 rounded"
                        >
                          ✓ {agent.output}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            {/* Progress indicator with controls */}
            <div className="mt-8 flex items-center justify-center gap-4">
              <button
                onClick={togglePlayback}
                className="p-2 rounded-lg bg-surface border border-border-default hover:border-border-strong transition-colors"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4 text-text-secondary" />
                ) : (
                  <Play className="h-4 w-4 text-text-secondary" />
                )}
              </button>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((step) => (
                  <button
                    key={step}
                    onClick={() => goToPhase(step)}
                    className={`h-2 rounded-full transition-all duration-300 cursor-pointer hover:opacity-80 ${
                      phase >= step
                        ? 'w-8 bg-accent-primary'
                        : 'w-2 bg-border-default hover:bg-border-strong'
                    }`}
                    aria-label={`Go to phase ${step}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-10 text-center"
        >
          <a
            href="/auth/signup"
            className="inline-flex items-center gap-2 btn btn-primary text-lg px-8 py-3"
          >
            Try It Yourself
            <ArrowRight className="h-5 w-5" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}
