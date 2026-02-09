'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Github, Twitter, Linkedin, Youtube, Mail, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '@/components/ui/Logo';

const footerLinks = {
  Product: [
    { name: 'Features', href: '/#features' },
    { name: 'Pricing', href: '/#pricing' },
    { name: 'Agents', href: '/agents' },
    { name: 'Compare', href: '/compare' },
    { name: 'Changelog', href: '/changelog' },
    { name: 'Roadmap', href: '/roadmap' },
  ],
  Resources: [
    { name: 'Documentation', href: '/docs' },
    { name: 'FAQ', href: '/faq' },
    { name: 'Glossary', href: '/glossary' },
    { name: 'Status', href: '/status' },
  ],
  Company: [
    { name: 'About', href: '/about' },
    { name: 'Contact', href: '/contact' },
  ],
  Legal: [
    { name: 'Privacy', href: '/privacy' },
    { name: 'Terms', href: '/terms' },
    { name: 'Security', href: '/security' },
  ],
};

const socialLinks = [
  { name: 'GitHub', icon: Github, href: 'https://github.com/podex' },
  { name: 'Twitter', icon: Twitter, href: 'https://twitter.com/podex' },
  { name: 'LinkedIn', icon: Linkedin, href: 'https://linkedin.com/company/podex' },
  { name: 'YouTube', icon: Youtube, href: 'https://youtube.com/@podex' },
];

export function Footer() {
  const [email, setEmail] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setIsSubscribed(true);
      setEmail('');
    }
  };

  return (
    <footer className="bg-void border-t border-border-subtle">
      {/* Newsletter section */}
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-16">
        <div className="relative rounded-2xl bg-gradient-to-r from-accent-primary/10 via-accent-secondary/10 to-agent-3/10 p-8 lg:p-12 overflow-hidden">
          {/* Background glow */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent-secondary/10 rounded-full blur-3xl" />

          <div className="relative grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-2xl lg:text-3xl font-bold text-text-primary mb-2">
                Stay up to date
              </h3>
              <p className="text-text-secondary">
                Get the latest updates on new features, agent capabilities, and development tips.
              </p>
            </div>

            <form onSubmit={handleSubscribe} className="flex gap-3">
              {isSubscribed ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2 text-accent-success"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>Thanks for subscribing!</span>
                </motion.div>
              ) : (
                <>
                  <div className="flex-1 relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-muted" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(139,92,246,0.4)] transition-all flex items-center gap-2"
                  >
                    Subscribe
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Main footer */}
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-12">
        <div className="grid gap-12 lg:grid-cols-6">
          {/* Logo and description */}
          <div className="lg:col-span-2">
            <div className="mb-4">
              <Logo />
            </div>
            <p className="text-text-secondary mb-6 max-w-xs">
              Podex is a web-based agentic IDE platform that enables developers to deploy pods of
              specialized AI agents that remember context, plan tasks, and execute code together.
              Unlike traditional code assistants that offer single-turn suggestions, Podex provides
              a multi-agent development environment where AI agents collaborate on complex software
              projects from planning to deployment.
            </p>

            {/* Social links */}
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.name}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-elevated hover:bg-overlay transition-colors group"
                  aria-label={social.name}
                >
                  <social.icon className="h-5 w-5 text-text-muted group-hover:text-text-primary transition-colors" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-semibold text-text-primary mb-4">{category}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      className="text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-border-subtle">
        <div className="mx-auto max-w-7xl px-4 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-text-muted">
              &copy; {new Date().getFullYear()} Podex. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-sm text-text-muted">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent-success animate-pulse" />
                All systems operational
              </span>
              <a href="/status" className="hover:text-text-primary transition-colors">
                Status
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
