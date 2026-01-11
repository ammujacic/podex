'use client';

import Link from 'next/link';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  Code2,
  Eye,
  GitBranch,
  Play,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { useIsAuthenticated } from '@/stores/auth';
import { useEffect, useState, useMemo } from 'react';

// Floating particle component
function Particle({
  delay,
  duration,
  x,
  y,
  size,
}: {
  delay: number;
  duration: number;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full bg-accent-primary/20"
      style={{ width: size, height: size, left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 0.6, 0],
        scale: [0, 1, 0],
        y: [0, -100],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeOut',
      }}
    />
  );
}

// Grid background pattern
function GridPattern() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #00e5ff 1px, transparent 1px),
            linear-gradient(to bottom, #00e5ff 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
}

// Typewriter effect hook
function useTypewriter(texts: string[], typingSpeed = 50, pauseDuration = 2000) {
  const [displayText, setDisplayText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentText = texts[textIndex] ?? '';

    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          if (charIndex < currentText.length) {
            setDisplayText(currentText.slice(0, charIndex + 1));
            setCharIndex(charIndex + 1);
          } else {
            setTimeout(() => setIsDeleting(true), pauseDuration);
          }
        } else {
          if (charIndex > 0) {
            setDisplayText(currentText.slice(0, charIndex - 1));
            setCharIndex(charIndex - 1);
          } else {
            setIsDeleting(false);
            setTextIndex((textIndex + 1) % texts.length);
          }
        }
      },
      isDeleting ? typingSpeed / 2 : typingSpeed
    );

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, textIndex, texts, typingSpeed, pauseDuration]);

  return displayText;
}

// Animated code line component
function AnimatedCodeLine({ code, delay }: { code: string; delay: number }) {
  const [displayCode, setDisplayCode] = useState('');

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const timeout = setTimeout(() => {
      let i = 0;
      intervalId = setInterval(() => {
        if (i <= code.length) {
          setDisplayCode(code.slice(0, i));
          i++;
        } else {
          if (intervalId) clearInterval(intervalId);
        }
      }, 30);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (intervalId) clearInterval(intervalId);
    };
  }, [code, delay]);

  return (
    <span>
      {displayCode}
      <span className="animate-pulse">|</span>
    </span>
  );
}

// Stats counter animation - exported for potential future use
export function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, Math.round);
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const animation = animate(count, value, { duration: 2 });
    const unsubscribe = rounded.on('change', (v) => setDisplayValue(v));
    return () => {
      animation.stop();
      unsubscribe();
    };
  }, [count, rounded, value]);

  return (
    <span>
      {displayValue.toLocaleString()}
      {suffix}
    </span>
  );
}

export function HeroSection() {
  const isAuthenticated = useIsAuthenticated();

  const typewriterTexts = [
    'Build a landing page with auth',
    'Create a REST API with validation',
    'Add real-time notifications',
    'Refactor to microservices',
    'Set up CI/CD pipeline',
  ];

  const typedText = useTypewriter(typewriterTexts, 60, 2500);

  // Generate particles
  const particles = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        delay: Math.random() * 5,
        duration: 3 + Math.random() * 4,
        x: Math.random() * 100,
        y: 50 + Math.random() * 50,
        size: 2 + Math.random() * 4,
      })),
    []
  );

  return (
    <section className="relative overflow-hidden py-16 lg:py-24">
      {/* Animated background elements */}
      <div className="absolute inset-0 -z-10">
        {/* Gradient orbs with animation */}
        <motion.div
          className="absolute top-0 left-1/4 h-[600px] w-[600px] rounded-full bg-accent-primary/10 blur-[120px]"
          animate={{
            scale: [1, 1.2, 1],
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-accent-secondary/10 blur-[100px]"
          animate={{
            scale: [1, 1.3, 1],
            x: [0, -40, 0],
            y: [0, -40, 0],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[400px] rounded-full bg-agent-3/5 blur-[80px]"
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </div>

      {/* Grid pattern */}
      <GridPattern />

      {/* Floating particles */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {particles.map((p) => (
          <Particle key={p.id} {...p} />
        ))}
      </div>

      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="text-center">
          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl font-bold tracking-tight text-text-primary sm:text-7xl lg:text-8xl"
          >
            Your Cloud
            <span className="relative">
              <span className="text-accent-primary"> Pods</span>
              <motion.span
                className="absolute -bottom-2 left-0 right-0 h-1 bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary rounded-full"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
              />
            </span>
            <div className="mt-6">
              <span className="bg-gradient-to-r from-text-primary via-accent-primary to-accent-secondary bg-clip-text text-transparent">
                For AI Agents
              </span>
            </div>
          </motion.h1>

          {/* Subheadline with typewriter */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mx-auto mt-8 max-w-3xl"
          >
            <p className="text-xl text-text-secondary lg:text-2xl">
              Deploy a pod of AI agents that{' '}
              <span className="text-accent-primary font-semibold">remember</span>,{' '}
              <span className="text-accent-secondary font-semibold">plan</span>, and{' '}
              <span className="text-agent-3 font-semibold">execute</span> together.
            </p>
            <div className="mt-4 h-8 text-lg text-text-muted font-mono">
              <span className="text-accent-primary">$</span> podex{' '}
              <span className="text-text-primary">&quot;{typedText}&quot;</span>
              <span className="animate-pulse text-accent-primary">_</span>
            </div>
          </motion.div>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <Link
              href={isAuthenticated ? '/dashboard' : '/auth/signup'}
              className="group relative overflow-hidden btn text-lg px-8 py-4 bg-accent-primary text-text-inverse font-semibold rounded-xl shadow-lg hover:shadow-[0_0_40px_rgba(0,229,255,0.4)] transition-all duration-300"
            >
              <span className="relative z-10 flex items-center gap-2">
                {isAuthenticated ? 'Go to Dashboard' : 'Start Building Free'}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </span>
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-primary"
                initial={{ x: '-100%' }}
                whileHover={{ x: '100%' }}
                transition={{ duration: 0.5 }}
              />
            </Link>
            <Link
              href="/demo"
              className="group btn text-lg px-8 py-4 bg-elevated border border-border-default text-text-primary rounded-xl hover:border-accent-primary/50 hover:bg-overlay transition-all duration-300"
            >
              <Play className="h-5 w-5 mr-2 text-accent-primary" />
              Watch Demo
            </Link>
          </motion.div>
        </div>

        {/* Interactive Demo Preview */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.4, type: 'spring' }}
          className="mt-16 lg:mt-20"
        >
          <div className="relative">
            {/* Glow effect behind the window */}
            <div className="absolute -inset-4 bg-gradient-to-r from-accent-primary/20 via-accent-secondary/20 to-agent-3/20 rounded-2xl blur-2xl opacity-50" />

            <div className="relative rounded-2xl border border-border-default bg-surface/80 backdrop-blur-xl shadow-2xl overflow-hidden">
              {/* Window header */}
              <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3 bg-elevated/50">
                <div className="flex items-center gap-4">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-accent-error hover:opacity-80 transition-opacity cursor-pointer" />
                    <div className="h-3 w-3 rounded-full bg-accent-warning hover:opacity-80 transition-opacity cursor-pointer" />
                    <div className="h-3 w-3 rounded-full bg-accent-success hover:opacity-80 transition-opacity cursor-pointer" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-text-muted">
                    <Zap className="h-4 w-4 text-accent-primary" />
                    <span>podex — my-saas-app</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs rounded-full bg-accent-success/10 text-accent-success border border-accent-success/20">
                    4 agents active
                  </span>
                </div>
              </div>

              {/* Preview content - Enhanced Agent Grid */}
              <div className="grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-2 bg-void/50">
                {/* Agent 1 - Architect with Memory */}
                <motion.div
                  className="agent-card active"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <div className="panel-header bg-surface/80">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-agent-1/10">
                        <Brain className="h-4 w-4 text-agent-1" />
                      </div>
                      <span className="font-medium">Architect</span>
                      <span className="text-xs text-agent-1 bg-agent-1/10 px-2 py-0.5 rounded-full">
                        Planning
                      </span>
                    </div>
                    <span className="status-dot active" />
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-text-secondary">Designing authentication flow...</p>
                    <div className="rounded-lg bg-elevated p-3 text-xs font-mono text-text-muted border border-border-subtle">
                      <div className="flex items-center gap-2 text-accent-primary mb-2">
                        <Sparkles className="h-3 w-3" />
                        <span className="text-text-secondary">Memory recalled</span>
                      </div>
                      <p className="text-agent-1">→ Previous: JWT preferred</p>
                      <p className="text-agent-2">→ User prefers: httpOnly cookies</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-xs px-2 py-1 rounded bg-void text-text-muted">
                        security
                      </span>
                      <span className="text-xs px-2 py-1 rounded bg-void text-text-muted">
                        auth
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* Agent 2 - Frontend with Code */}
                <motion.div
                  className="agent-card"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <div className="panel-header bg-surface/80">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-agent-2/10">
                        <Code2 className="h-4 w-4 text-agent-2" />
                      </div>
                      <span className="font-medium">Frontend</span>
                      <span className="text-xs text-agent-3 bg-agent-3/10 px-2 py-0.5 rounded-full">
                        Coding
                      </span>
                    </div>
                    <span className="status-dot active" />
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-text-secondary">Building login component...</p>
                    <div className="rounded-lg bg-void p-3 text-xs font-mono overflow-hidden border border-border-subtle">
                      <div className="text-text-muted mb-1">// LoginForm.tsx</div>
                      <div>
                        <span className="text-syntax-keyword">export function</span>{' '}
                        <span className="text-syntax-function">LoginForm</span>
                        <span className="text-text-muted">() {'{'}</span>
                      </div>
                      <div className="pl-4">
                        <span className="text-syntax-keyword">const</span>{' '}
                        <span className="text-syntax-variable">[email, setEmail]</span>{' '}
                        <span className="text-text-muted">=</span>{' '}
                        <AnimatedCodeLine code="useState('')" delay={500} />
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Agent 3 - Backend with Terminal */}
                <motion.div
                  className="agent-card"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <div className="panel-header bg-surface/80">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-agent-3/10">
                        <Terminal className="h-4 w-4 text-agent-3" />
                      </div>
                      <span className="font-medium">Backend</span>
                      <span className="text-xs text-agent-4 bg-agent-4/10 px-2 py-0.5 rounded-full">
                        Running
                      </span>
                    </div>
                    <span className="status-dot active" />
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-text-secondary">Setting up API routes...</p>
                    <div className="rounded-lg bg-void p-3 text-xs font-mono border border-border-subtle">
                      <p className="text-accent-success">$ pnpm run dev</p>
                      <p className="text-text-muted">Starting server...</p>
                      <p className="text-accent-success">✓ API ready at :3001</p>
                      <p className="text-accent-primary">✓ Auth routes mounted</p>
                    </div>
                  </div>
                </motion.div>

                {/* Agent 4 - Vision Agent */}
                <motion.div
                  className="agent-card"
                  whileHover={{ scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <div className="panel-header bg-surface/80">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-agent-5/10">
                        <Eye className="h-4 w-4 text-agent-5" />
                      </div>
                      <span className="font-medium">Vision</span>
                      <span className="text-xs text-text-muted bg-overlay px-2 py-0.5 rounded-full">
                        Analyzing
                      </span>
                    </div>
                    <span className="status-dot active" />
                  </div>
                  <div className="p-4 space-y-3">
                    <p className="text-sm text-text-secondary">Analyzing UI screenshot...</p>
                    <div className="rounded-lg bg-void p-3 border border-border-subtle">
                      <div className="flex items-center gap-2 text-xs text-text-muted mb-2">
                        <Eye className="h-3 w-3 text-agent-5" />
                        <span>Design analysis</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {[1, 2, 3].map((i) => (
                          <motion.div
                            key={i}
                            className="h-8 rounded bg-gradient-to-br from-agent-5/20 to-accent-secondary/20"
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 1.5, delay: i * 0.2, repeat: Infinity }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2 bg-elevated/50">
                <div className="flex items-center gap-4 text-xs text-text-muted">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    feature/auth
                  </span>
                  <span>12 files changed</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-accent-success">● Connected</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
