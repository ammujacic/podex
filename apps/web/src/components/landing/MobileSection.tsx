'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import {
  Smartphone,
  Mic,
  Wifi,
  Battery,
  Signal,
  ChevronRight,
  ChevronDown,
  Code2,
  CheckCircle2,
  Volume2,
  Camera,
  Fingerprint,
  Cloud,
  Zap,
  Send,
  Paperclip,
  Eye,
  Loader2,
  MoreVertical,
  Workflow,
  GitBranch,
} from 'lucide-react';

const mobileFeatures = [
  {
    icon: Mic,
    title: 'Voice-First Coding',
    description:
      'Dictate code changes, ask questions, and command your agents hands-free while commuting.',
    color: 'agent-1',
  },
  {
    icon: Camera,
    title: 'Screenshot to Code',
    description:
      'Snap a photo of a design, whiteboard, or error message. Agents understand and act on it.',
    color: 'agent-2',
  },
  {
    icon: Cloud,
    title: 'Cloud Sync',
    description: 'Your pods run in the cloud. Pick up exactly where you left off on any device.',
    color: 'agent-3',
  },
  {
    icon: Fingerprint,
    title: 'Secure & Fast',
    description: 'Biometric authentication and optimized mobile experience. No compromises.',
    color: 'agent-5',
  },
];

function PhoneMockup({ activeDemo }: { activeDemo: number }) {
  return (
    <div className="relative mx-auto w-[280px] h-[580px]">
      <div className="absolute inset-0 bg-gradient-to-b from-gray-800 to-gray-900 rounded-[3rem] shadow-2xl">
        <div className="absolute inset-[3px] bg-void rounded-[2.8rem] overflow-hidden flex flex-col">
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 py-2 bg-surface/50">
            <span className="text-[10px] text-text-muted font-medium">9:41</span>
            <div className="flex items-center gap-1">
              <Signal className="h-3 w-3 text-text-muted" />
              <Wifi className="h-3 w-3 text-text-muted" />
              <Battery className="h-3 w-3 text-text-muted" />
            </div>
          </div>
          {/* Dynamic island */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-6 bg-black rounded-full" />

          {/* App content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeDemo === 0 && <VoiceDemo />}
            {activeDemo === 1 && <ScreenshotDemo />}
            {activeDemo === 2 && <SyncDemo />}
          </div>

          {/* Home indicator */}
          <div className="py-2">
            <div className="w-32 h-1 bg-text-muted/30 rounded-full mx-auto" />
          </div>
        </div>
      </div>
      <div className="absolute -inset-8 bg-accent-primary/20 rounded-full blur-3xl -z-10 opacity-50" />
    </div>
  );
}

// Realistic agent card header component
function AgentHeader({
  name,
  role,
  color,
  status,
  mode,
}: {
  name: string;
  role: string;
  color: string;
  status: 'active' | 'idle';
  mode: string;
}) {
  const Icon = role === 'coder' ? Code2 : Workflow;
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface">
      <div className="flex items-center gap-2">
        <div className={`rounded-md bg-elevated p-1.5 text-${color}`}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-text-primary">{name}</span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-accent-success animate-pulse' : 'bg-text-muted'}`}
          />
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">
            {mode}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-text-muted flex items-center gap-0.5">
          Sonnet 4 <ChevronDown className="h-2 w-2" />
        </span>
        <MoreVertical className="h-3 w-3 text-text-muted" />
      </div>
    </div>
  );
}

// Message bubble component
function Message({
  role,
  content,
  isTyping,
}: {
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
}) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[10px] ${
          role === 'user' ? 'bg-accent-primary text-text-inverse' : 'bg-elevated text-text-primary'
        }`}
      >
        {content}
        {isTyping && (
          <span className="inline-block w-1.5 h-3 bg-accent-primary animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

// Input bar component
function InputBar({ isRecording, placeholder }: { isRecording?: boolean; placeholder?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-2 border-t border-border-subtle bg-surface">
      <button className="p-1.5 rounded-md bg-elevated text-text-muted">
        <Paperclip className="h-3 w-3" />
      </button>
      <button
        className={`p-1.5 rounded-md transition-colors ${
          isRecording
            ? 'bg-accent-error text-text-inverse animate-pulse'
            : 'bg-elevated text-text-muted'
        }`}
      >
        <Mic className="h-3 w-3" />
      </button>
      <div className="flex-1 bg-elevated border border-border-default rounded-md px-2 py-1.5">
        <span className="text-[9px] text-text-muted">
          {placeholder || 'Type / for commands...'}
        </span>
      </div>
      <button className="p-1.5 rounded-md bg-accent-primary text-text-inverse">
        <Send className="h-3 w-3" />
      </button>
    </div>
  );
}

function VoiceDemo() {
  return (
    <div className="flex flex-col h-full">
      {/* Agent header */}
      <AgentHeader name="Frontend" role="coder" color="agent-2" status="active" mode="Auto" />

      {/* Messages area */}
      <div className="flex-1 overflow-hidden p-2 space-y-2 bg-surface/30">
        <Message role="user" content="Add a loading spinner to the submit button" />

        {/* Agent thinking/working indicator */}
        <div className="flex justify-start">
          <div className="bg-elevated rounded-lg px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
              <Loader2 className="h-3 w-3 animate-spin text-agent-2" />
              <span>Reading Button.tsx...</span>
            </div>
          </div>
        </div>

        <Message
          role="assistant"
          content="I'll add a spinner component. Editing Button.tsx..."
          isTyping
        />

        {/* Tool result */}
        <div className="bg-elevated/50 rounded-lg p-2 border border-border-subtle">
          <div className="flex items-center gap-1.5 text-[9px] text-text-muted mb-1">
            <Code2 className="h-3 w-3" />
            <span>Button.tsx</span>
          </div>
          <div className="text-[8px] font-mono text-green-400 bg-void/50 rounded p-1.5">
            + &lt;Spinner className=&quot;animate-spin&quot; /&gt;
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[9px] text-accent-success">
          <CheckCircle2 className="h-3 w-3" />
          <span>Done! 2 files modified</span>
        </div>
      </div>

      {/* Voice recording overlay - compact */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 bottom-14 rounded-lg bg-agent-1/95 backdrop-blur px-4 py-2 border border-agent-1"
        animate={{ scale: [1, 1.02, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-white" />
          <div className="flex gap-0.5">
            {[1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-0.5 bg-white rounded-full"
                animate={{ height: ['6px', '14px', '6px'] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </div>
          <span className="text-[9px] text-white/90 ml-1">Listening...</span>
        </div>
      </motion.div>

      <InputBar isRecording placeholder="Listening..." />
    </div>
  );
}

function ScreenshotDemo() {
  return (
    <div className="flex flex-col h-full">
      <AgentHeader name="Architect" role="architect" color="agent-1" status="active" mode="Plan" />

      <div className="flex-1 overflow-hidden p-2 space-y-2 bg-surface/30">
        {/* User message with image attachment */}
        <div className="flex justify-end">
          <div className="max-w-[85%] space-y-1.5">
            <div className="rounded-lg overflow-hidden border border-accent-primary/30">
              <div className="aspect-[4/3] bg-gradient-to-br from-agent-3/30 via-surface to-agent-5/30 flex items-center justify-center">
                <div className="text-center">
                  <Camera className="h-6 w-6 text-text-muted mx-auto mb-1" />
                  <p className="text-[8px] text-text-muted">dashboard_sketch.jpg</p>
                </div>
              </div>
            </div>
            <div className="bg-accent-primary text-text-inverse rounded-lg px-2.5 py-1.5 text-[10px]">
              Build this dashboard design
            </div>
          </div>
        </div>

        {/* Vision analysis */}
        <div className="bg-elevated rounded-lg p-2 border border-border-subtle">
          <div className="flex items-center gap-1.5 text-[9px] text-accent-primary mb-1.5">
            <Eye className="h-3 w-3" />
            <span className="font-medium">Vision Analysis</span>
          </div>
          <div className="space-y-1 text-[9px] text-text-secondary">
            <p>Layout: Dashboard with sidebar</p>
            <p>Components: Nav, Stats cards, Chart</p>
            <p>Colors: Dark theme, cyan accents</p>
          </div>
        </div>

        {/* Plan output */}
        <Message
          role="assistant"
          content="I'll create a plan for this dashboard. Here's my approach:"
        />

        <div className="bg-blue-500/10 rounded-lg p-2 border border-blue-500/30">
          <div className="flex items-center gap-1.5 text-[9px] text-blue-400 mb-1.5 font-medium">
            <Workflow className="h-3 w-3" />
            Implementation Plan
          </div>
          <div className="space-y-1 text-[9px] text-text-secondary">
            <p>1. Create DashboardLayout component</p>
            <p>2. Build Sidebar with navigation</p>
            <p>3. Add StatsCard components</p>
            <p>4. Integrate Chart library</p>
          </div>
        </div>
      </div>

      <InputBar placeholder="Type to refine the plan..." />
    </div>
  );
}

function SyncDemo() {
  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent-primary/20 flex items-center justify-center">
            <Zap className="h-3.5 w-3.5 text-accent-primary" />
          </div>
          <div>
            <span className="text-[11px] font-medium text-text-primary block">my-saas-app</span>
            <span className="text-[9px] text-text-muted flex items-center gap-1">
              <GitBranch className="h-2.5 w-2.5" /> feature/auth
            </span>
          </div>
        </div>
        <div className="text-[9px] text-accent-success flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-success" />
          Synced
        </div>
      </div>

      {/* Agents grid */}
      <div className="flex-1 overflow-hidden p-2 space-y-2 bg-surface/30">
        <p className="text-[9px] text-text-muted px-1">3 agents active</p>

        {/* Agent cards */}
        {[
          {
            name: 'Architect',
            role: 'architect',
            color: 'agent-1',
            status: 'Planning auth flow...',
            mode: 'Plan',
          },
          {
            name: 'Frontend',
            role: 'coder',
            color: 'agent-2',
            status: 'Building LoginForm.tsx',
            mode: 'Auto',
          },
          {
            name: 'Backend',
            role: 'coder',
            color: 'agent-3',
            status: 'API routes ready',
            mode: 'Auto',
            done: true,
          },
        ].map((agent) => (
          <div
            key={agent.name}
            className="rounded-lg border border-border-subtle bg-surface overflow-hidden"
          >
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle">
              <div className="flex items-center gap-1.5">
                <div className={`rounded p-1 bg-elevated text-${agent.color}`}>
                  {agent.role === 'architect' ? (
                    <Workflow className="h-2.5 w-2.5" />
                  ) : (
                    <Code2 className="h-2.5 w-2.5" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-text-primary">{agent.name}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${agent.done ? 'bg-accent-success' : 'bg-accent-success animate-pulse'}`}
                />
              </div>
              <span
                className={`text-[8px] px-1.5 py-0.5 rounded-full ${
                  agent.mode === 'Plan'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-green-500/20 text-green-400'
                }`}
              >
                {agent.mode}
              </span>
            </div>
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[9px] text-text-secondary">
                {agent.done ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-accent-success" />
                    <span className="text-accent-success">{agent.status}</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{agent.status}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Sync info */}
        <div className="rounded-lg bg-elevated/50 p-2 border border-border-subtle">
          <div className="flex items-center justify-between text-[9px]">
            <span className="text-text-muted">Last sync</span>
            <span className="text-text-primary">Just now</span>
          </div>
          <div className="flex items-center justify-between text-[9px] mt-1">
            <span className="text-text-muted">Files changed</span>
            <span className="text-text-primary">12 files</span>
          </div>
        </div>

        {/* Audio playback hint */}
        <div className="flex items-center gap-2 text-[9px] text-text-muted px-1">
          <Volume2 className="h-3 w-3 text-accent-primary" />
          <span>Tap any message to hear it</span>
        </div>
      </div>

      <InputBar placeholder="Ask all agents..." />
    </div>
  );
}

export function MobileSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [activeDemo, setActiveDemo] = useState(0);

  const demos = [
    { label: 'Voice Commands', icon: Mic },
    { label: 'Screenshot to Code', icon: Camera },
    { label: 'Cloud Sync', icon: Cloud },
  ];

  return (
    <section id="mobile" ref={ref} className="py-12 lg:py-20 bg-void relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-0 w-[600px] h-[600px] bg-agent-1/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] bg-accent-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="text-center mb-12 lg:mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-text-primary mb-4"
          >
            Code from{' '}
            <span className="bg-gradient-to-r from-accent-primary to-agent-3 bg-clip-text text-transparent">
              anywhere
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            Your AI agents work for you 24/7. Review code on your commute, voice-command changes
            from the couch, or snap a whiteboard design and watch it come to life.
          </motion.p>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="order-2 lg:order-1"
          >
            <PhoneMockup activeDemo={activeDemo} />
            <div className="flex justify-center gap-2 mt-8">
              {demos.map((demo, index) => (
                <button
                  key={demo.label}
                  onClick={() => setActiveDemo(index)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all ${
                    activeDemo === index
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-surface border border-border-default text-text-secondary hover:border-border-strong'
                  }`}
                >
                  <demo.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{demo.label}</span>
                </button>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="order-1 lg:order-2 space-y-6"
          >
            {mobileFeatures.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.4, delay: 0.5 + index * 0.1 }}
                className="group flex items-center gap-4 p-4 rounded-xl bg-surface/50 border border-border-default hover:border-border-strong hover:bg-elevated transition-all cursor-pointer"
              >
                <div
                  className={`shrink-0 w-14 h-14 flex items-center justify-center rounded-xl bg-${feature.color}/10 group-hover:bg-${feature.color}/20 transition-colors`}
                >
                  <feature.icon className={`h-6 w-6 text-${feature.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-text-primary mb-1 flex items-center gap-2">
                    {feature.title}
                    <ChevronRight className="h-4 w-4 text-text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </h3>
                  <p className="text-sm text-text-secondary">{feature.description}</p>
                </div>
              </motion.div>
            ))}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.4, delay: 0.9 }}
              className="pt-4"
            >
              <a
                href="/auth/signup"
                className="inline-flex items-center gap-2 btn btn-primary px-6 py-3"
              >
                <Smartphone className="h-5 w-5" />
                Try on Mobile
                <ChevronRight className="h-4 w-4" />
              </a>
              <p className="text-sm text-text-muted mt-3">
                Works on iOS, Android, and any modern browser
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
