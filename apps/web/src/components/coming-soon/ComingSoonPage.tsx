'use client';

import { motion } from 'framer-motion';
import { Bot, ChevronDown, Laptop, Smartphone, Users } from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

import { HeroSection } from './HeroSection';
import { SneakPeekSection } from './SneakPeekSection';
import { WaitlistForm } from './WaitlistForm';

const sneakPeeks = [
  {
    icon: Bot,
    title: 'Agents',
    tagline: 'Your team just got infinite',
    description:
      'AI agents that code alongside you, handling tasks autonomously while you focus on what matters.',
    color: '#8B5CF6',
    gradient: 'from-purple-500/20 to-violet-500/20',
  },
  {
    icon: Smartphone,
    title: 'Mobile',
    tagline: 'Code from anywhere',
    description:
      'A mobile-first development experience that lets you build, review, and deploy on the go.',
    color: '#06B6D4',
    gradient: 'from-cyan-500/20 to-blue-500/20',
  },
  {
    icon: Laptop,
    title: 'Workspace',
    tagline: 'Where ideas become reality',
    description:
      'Cloud-powered workspaces with intelligent tooling, ready in seconds from any device.',
    color: '#22C55E',
    gradient: 'from-green-500/20 to-emerald-500/20',
  },
  {
    icon: Users,
    title: 'Collaboration',
    tagline: 'Build together, ship faster',
    description: 'Real-time collaboration with your team, powered by presence and instant sync.',
    color: '#F59E0B',
    gradient: 'from-amber-500/20 to-orange-500/20',
  },
];

export function ComingSoonPage() {
  const sneakPeeksRef = useRef<HTMLDivElement>(null);

  const scrollToSneakPeeks = () => {
    sneakPeeksRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-void">
      {/* Minimal Header */}
      <header className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm font-logo">P</span>
            </div>
            <span className="text-xl font-bold font-logo text-primary">Podex</span>
          </Link>
          <Link
            href="/auth/login"
            className="text-sm text-muted hover:text-primary transition-colors"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <HeroSection />

      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 cursor-pointer"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, duration: 0.5 }}
        onClick={scrollToSneakPeeks}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="w-6 h-6 text-muted" />
        </motion.div>
      </motion.div>

      {/* Sneak Peek Sections */}
      <div ref={sneakPeeksRef} className="relative">
        {sneakPeeks.map((peek, index) => (
          <SneakPeekSection
            key={peek.title}
            icon={peek.icon}
            title={peek.title}
            tagline={peek.tagline}
            description={peek.description}
            color={peek.color}
            gradient={peek.gradient}
            index={index}
            isReversed={index % 2 === 1}
          />
        ))}
      </div>

      {/* Waitlist CTA Section */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-500/5 to-transparent" />
        <div className="max-w-xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl font-bold text-primary mb-4">Want early access?</h2>
            <p className="text-muted mb-8">
              Join the waitlist and be among the first to experience the future of development.
            </p>

            <WaitlistForm />

            <div className="mt-8 text-sm text-muted">
              Already have access?{' '}
              <Link href="/auth/login" className="text-accent-primary hover:underline">
                Sign in
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="py-8 px-6 border-t border-subtle">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-muted">
          <span>&copy; {new Date().getFullYear()} Podex. All rights reserved.</span>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-primary transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-primary transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
