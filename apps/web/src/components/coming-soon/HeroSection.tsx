'use client';

import { motion } from 'framer-motion';
import {
  Bot,
  GitBranch,
  Terminal,
  Smartphone,
  Laptop,
  Code,
  Zap,
  Cloud,
  MessageSquare,
  FolderTree,
  Users,
} from 'lucide-react';

import { PodexIcon } from '@/components/icons/PodexIcon';

// Floating UI element component
function FloatingElement({
  children,
  className,
  delay = 0,
  duration = 8,
  x = [0, 15, 0],
  y = [0, -10, 0],
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
      className={`absolute cursor-pointer ${className}`}
      initial={{ opacity: 1, filter: 'brightness(1.1)' }}
      animate={{
        opacity: [0.95, 1, 1, 0.95],
        x,
        y,
      }}
      whileHover={{
        opacity: 1,
        filter: 'brightness(2)',
        scale: 1.12,
        transition: { duration: 0.1 },
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
    <FloatingElement className={className} delay={delay} duration={6} y={[0, -12, 0]}>
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
    <FloatingElement className={className} delay={delay} duration={7} x={[0, -10, 0]} y={[0, 8, 0]}>
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
    <FloatingElement className={className} delay={delay} duration={5} x={[0, 8, 0]} y={[0, -10, 0]}>
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
    <FloatingElement className={className} delay={delay} duration={6} x={[0, -8, 0]} y={[0, 10, 0]}>
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
    <FloatingElement className={className} delay={delay} duration={7} x={[0, 10, 0]} y={[0, -8, 0]}>
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
      duration={8}
      x={[0, -12, 0]}
      y={[0, 10, 0]}
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
    <FloatingElement className={className} delay={delay} duration={8} x={[0, 12, 0]} y={[0, -8, 0]}>
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

// Chat/AI conversation widget
function FloatingChat({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement className={className} delay={delay} duration={7} x={[0, -8, 0]} y={[0, 12, 0]}>
      <div className="bg-elevated/80 backdrop-blur-sm border border-amber-500/60 rounded-lg p-2 w-36">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="w-3 h-3 text-amber-400" />
          <span className="text-[9px] text-amber-400 font-medium">AI Chat</span>
        </div>
        <div className="space-y-1.5">
          <div className="bg-amber-500/20 rounded px-2 py-1 text-[8px] text-text-muted">
            Fix the auth bug
          </div>
          <div className="bg-purple-500/20 rounded px-2 py-1 text-[8px] text-purple-300">
            Found 3 issues...
          </div>
        </div>
      </div>
    </FloatingElement>
  );
}

// File tree widget
function FloatingFileTree({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement
      className={className}
      delay={delay}
      duration={6}
      x={[0, 10, 0]}
      y={[0, -10, 0]}
    >
      <div className="bg-elevated/80 backdrop-blur-sm border border-cyan-500/60 rounded-lg p-2 w-32">
        <div className="flex items-center gap-2 mb-2">
          <FolderTree className="w-3 h-3 text-cyan-400" />
          <span className="text-[9px] text-cyan-400 font-medium">Files</span>
        </div>
        <div className="space-y-1 text-[8px] font-mono text-text-muted">
          <div className="flex items-center gap-1">
            <span className="text-cyan-400">📁</span> src/
          </div>
          <div className="flex items-center gap-1 pl-2">
            <span className="text-purple-400">📄</span> index.ts
          </div>
          <div className="flex items-center gap-1 pl-2">
            <span className="text-green-400">📄</span> api.ts
          </div>
        </div>
      </div>
    </FloatingElement>
  );
}

// Collaboration/presence widget
function FloatingPresence({ className, delay }: { className?: string; delay?: number }) {
  return (
    <FloatingElement className={className} delay={delay} duration={5} x={[0, -6, 0]} y={[0, 8, 0]}>
      <div className="bg-elevated/80 backdrop-blur-sm border border-green-500/60 rounded-lg p-2">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3 h-3 text-green-400" />
          <span className="text-[9px] text-green-400 font-medium">Team</span>
        </div>
        <div className="flex -space-x-2">
          <div className="w-5 h-5 rounded-full bg-purple-500/60 border border-void flex items-center justify-center text-[7px] text-white">
            A
          </div>
          <div className="w-5 h-5 rounded-full bg-cyan-500/60 border border-void flex items-center justify-center text-[7px] text-white">
            M
          </div>
          <div className="w-5 h-5 rounded-full bg-green-500/60 border border-void flex items-center justify-center text-[7px] text-white">
            +2
          </div>
        </div>
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

      {/* Floating UI elements - positioned around the hero */}
      {/* Top row */}
      <FloatingCodeBlock className="top-[8%] left-[5%]" delay={0} />
      <FloatingPresence className="top-[5%] left-[30%]" delay={0.5} />
      <FloatingTerminal className="top-[8%] right-[5%]" delay={1} />

      {/* Upper middle */}
      <FloatingAgentCard className="top-[22%] left-[3%]" delay={1.5} />
      <FloatingChat className="top-[18%] right-[4%]" delay={2} />

      {/* Middle sides */}
      <FloatingMobile className="top-[45%] left-[2%]" delay={2.5} />
      <FloatingFileTree className="top-[42%] right-[3%]" delay={3} />

      {/* Lower middle */}
      <FloatingCloud className="bottom-[25%] left-[4%]" delay={3.5} />
      <FloatingLaptop className="bottom-[22%] right-[4%]" delay={4} />

      {/* Bottom row */}
      <FloatingWorkflow className="bottom-[8%] left-[15%]" delay={4.5} />
      <FloatingMobile className="bottom-[6%] right-[38%]" delay={5} />

      {/* Additional elements on larger screens */}
      <FloatingAgentCard className="hidden lg:block top-[12%] left-[22%]" delay={5.5} />
      <FloatingFileTree className="hidden lg:block bottom-[8%] right-[15%]" delay={6} />
      <FloatingChat className="hidden xl:block top-[28%] right-[20%]" delay={6.5} />
      <FloatingCloud className="hidden xl:block bottom-[18%] left-[18%]" delay={7} />

      {/* Edge fade overlays - very subtle */}
      <div className="absolute inset-0 bg-gradient-to-r from-void/20 via-transparent to-void/20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-void/10 via-transparent to-void/10 pointer-events-none" />

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
          AI-powered agents, mobile-first development, and code from anywhere. Invite only.... For
          now!
        </motion.p>
      </div>
    </section>
  );
}
