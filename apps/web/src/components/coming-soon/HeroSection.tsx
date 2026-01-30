'use client';

import { motion } from 'framer-motion';
import { Bot, GitBranch, Terminal, Smartphone, Laptop, Code, Zap, Cloud } from 'lucide-react';

import { PodexIcon } from '@/components/icons/PodexIcon';

// Floating UI element component
function FloatingElement({
  children,
  className,
  delay = 0,
  duration = 20,
  x = [0, 20, 0],
  y = [0, -15, 0],
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  x?: number[];
  y?: number[];
}) {
  return (
    <motion.div
      className={`absolute pointer-events-none ${className}`}
      initial={{ opacity: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        x,
        y,
      }}
      transition={{
        duration,
        repeat: Infinity,
        delay,
        ease: 'easeInOut',
      }}
    >
      {children}
    </motion.div>
  );
}

// Code block floating element
function FloatingCodeBlock({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement className={className} delay={delay} duration={25} y={[0, -20, 0]}>
      <div className="bg-elevated/80 backdrop-blur-sm border border-border-subtle/60 rounded-lg p-3 w-48">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-red-400/60" />
          <div className="w-2 h-2 rounded-full bg-yellow-400/60" />
          <div className="w-2 h-2 rounded-full bg-green-400/60" />
        </div>
        <div className="space-y-1.5 font-mono text-[10px]">
          <div className="text-purple-400">const agent = new Agent();</div>
          <div className="text-cyan-400">await agent.execute(task);</div>
          <div className="text-green-400">// Autonomous execution</div>
        </div>
      </div>
    </FloatingElement>
  );
}

// Terminal floating element
function FloatingTerminal({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={22}
      x={[0, -15, 0]}
      y={[0, 10, 0]}
    >
      <div className="bg-void/90 backdrop-blur-sm border border-purple-500/50 rounded-lg p-3 w-44">
        <div className="flex items-center gap-2 mb-2">
          <Terminal className="w-3 h-3 text-purple-400" />
          <span className="text-[10px] text-purple-400 font-mono">terminal</span>
        </div>
        <div className="space-y-1 font-mono text-[9px] text-text-muted">
          <div>$ podex run build</div>
          <div className="text-green-400/60">✓ Build complete</div>
          <motion.div
            className="text-purple-400/60"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            █
          </motion.div>
        </div>
      </div>
    </FloatingElement>
  );
}

// Agent status card
function FloatingAgentCard({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={18}
      x={[0, 10, 0]}
      y={[0, -25, 0]}
    >
      <div className="bg-elevated/80 backdrop-blur-sm border border-purple-500/60 rounded-xl p-3 w-40">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-purple-500/30 flex items-center justify-center">
            <Bot className="w-3 h-3 text-purple-400" />
          </div>
          <div>
            <div className="text-[10px] font-medium text-text-primary">Claude Agent</div>
            <div className="text-[8px] text-green-400 flex items-center gap-1">
              <motion.div
                className="w-1.5 h-1.5 rounded-full bg-green-400"
                animate={{ scale: [1, 1.2, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              Active
            </div>
          </div>
        </div>
        <div className="text-[9px] text-text-muted">Refactoring auth module...</div>
      </div>
    </FloatingElement>
  );
}

// Mobile device mockup
function FloatingMobile({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={24}
      x={[0, -10, 0]}
      y={[0, 15, 0]}
    >
      <div className="bg-void/95 backdrop-blur-sm border-2 border-cyan-500/50 rounded-2xl p-1.5 w-20">
        <div className="bg-elevated/60 rounded-xl h-36 p-2 flex flex-col">
          <div className="flex items-center gap-1 mb-2">
            <Smartphone className="w-2 h-2 text-cyan-400" />
            <span className="text-[7px] text-cyan-400">Podex Mobile</span>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="h-2 bg-purple-500/60 rounded-full w-full" />
            <div className="h-2 bg-cyan-500/60 rounded-full w-3/4" />
            <div className="h-2 bg-green-500/60 rounded-full w-1/2" />
          </div>
          <motion.div
            className="mt-auto flex justify-center"
            animate={{ scale: [1, 0.95, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <div className="w-8 h-1 bg-text-muted/60 rounded-full" />
          </motion.div>
        </div>
      </div>
    </FloatingElement>
  );
}

// Workflow node connection
function FloatingWorkflow({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={20}
      x={[0, 15, 0]}
      y={[0, -10, 0]}
    >
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-purple-500/40 border border-purple-500/60 flex items-center justify-center">
          <Code className="w-4 h-4 text-purple-400" />
        </div>
        <motion.div
          className="flex items-center gap-1"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        >
          <div className="w-1 h-1 rounded-full bg-purple-400/50" />
          <div className="w-1 h-1 rounded-full bg-purple-400/50" />
          <div className="w-1 h-1 rounded-full bg-purple-400/50" />
        </motion.div>
        <div className="w-8 h-8 rounded-lg bg-cyan-500/40 border border-cyan-500/60 flex items-center justify-center">
          <GitBranch className="w-4 h-4 text-cyan-400" />
        </div>
        <motion.div
          className="flex items-center gap-1"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
        >
          <div className="w-1 h-1 rounded-full bg-cyan-400/50" />
          <div className="w-1 h-1 rounded-full bg-cyan-400/50" />
          <div className="w-1 h-1 rounded-full bg-cyan-400/50" />
        </motion.div>
        <div className="w-8 h-8 rounded-lg bg-green-500/20 border border-green-500/60 flex items-center justify-center">
          <Zap className="w-4 h-4 text-green-400" />
        </div>
      </div>
    </FloatingElement>
  );
}

// Cloud workspace indicator
function FloatingCloud({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={26}
      x={[0, -20, 0]}
      y={[0, 20, 0]}
    >
      <div className="bg-elevated/80 backdrop-blur-sm border border-green-500/60 rounded-lg p-2 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-green-500/40 flex items-center justify-center">
          <Cloud className="w-3 h-3 text-green-400" />
        </div>
        <div>
          <div className="text-[9px] font-medium text-text-primary">Cloud Pod</div>
          <div className="text-[8px] text-text-muted">us-west-2 • 4 cores</div>
        </div>
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-green-400"
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </div>
    </FloatingElement>
  );
}

// Laptop mockup
function FloatingLaptop({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={28}
      x={[0, 12, 0]}
      y={[0, -18, 0]}
    >
      <div className="relative">
        {/* Screen */}
        <div className="bg-void/95 backdrop-blur-sm border border-purple-500/50 rounded-t-lg p-1 w-32">
          <div className="bg-elevated/50 rounded h-20 p-1.5 flex flex-col">
            <div className="flex items-center gap-1 mb-1">
              <Laptop className="w-2 h-2 text-purple-400" />
              <span className="text-[6px] text-purple-400">workspace</span>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-1">
              <div className="bg-purple-500/40 rounded" />
              <div className="bg-cyan-500/40 rounded" />
              <div className="col-span-2 bg-green-500/40 rounded" />
            </div>
          </div>
        </div>
        {/* Base */}
        <div className="bg-border-subtle/60 h-1.5 rounded-b-sm mx-2" />
        <div className="bg-border-subtle/40 h-0.5 rounded-b-lg mx-1" />
      </div>
    </FloatingElement>
  );
}

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-void via-void to-void" />

      {/* Subtle radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-purple-500/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Floating UI elements - positioned around the edges */}
      <FloatingCodeBlock className="top-[15%] left-[5%]" delay={0} />
      <FloatingTerminal className="top-[20%] right-[8%]" delay={2} />
      <FloatingAgentCard className="bottom-[25%] left-[8%]" delay={4} />
      <FloatingMobile className="top-[35%] right-[5%]" delay={1} />
      <FloatingWorkflow className="bottom-[20%] right-[10%]" delay={3} />
      <FloatingCloud className="top-[60%] left-[3%]" delay={5} />
      <FloatingLaptop className="bottom-[35%] right-[3%]" delay={2.5} />

      {/* Additional elements on larger screens */}
      <FloatingCodeBlock className="hidden lg:block bottom-[15%] left-[15%]" delay={6} />
      <FloatingAgentCard className="hidden lg:block top-[10%] left-[25%]" delay={7} />
      <FloatingWorkflow className="hidden xl:block top-[15%] right-[25%]" delay={8} />

      {/* Edge fade overlays - subtle to keep floating elements visible */}
      <div className="absolute inset-0 bg-gradient-to-r from-void/50 via-transparent to-void/50 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-void/30 via-transparent to-void/30 pointer-events-none" />

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          {/* Logo with glow effect */}
          <motion.div
            className="mx-auto mb-8 w-24 h-24 relative flex items-center justify-center"
            animate={{
              boxShadow: [
                '0 0 40px rgba(139, 92, 246, 0.3)',
                '0 0 80px rgba(139, 92, 246, 0.5)',
                '0 0 40px rgba(139, 92, 246, 0.3)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ borderRadius: '12px' }}
          >
            <PodexIcon size={96} className="rounded-xl" />
            <motion.div
              className="absolute inset-0 rounded-xl border-2 border-purple-400/30"
              animate={{ scale: [1, 1.15, 1], opacity: [1, 0, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        </motion.div>

        <motion.h1
          className="text-5xl md:text-7xl font-bold text-primary mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8 }}
        >
          The future of development
          <br />
          <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-purple-500 bg-clip-text text-transparent">
            is autonomous
          </span>
        </motion.h1>

        <motion.p
          className="text-xl text-muted max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.8 }}
        >
          AI-powered agents, cloud workspaces, and seamless collaboration.
          <br className="hidden md:block" />
          Coming soon.
        </motion.p>
      </div>
    </section>
  );
}
