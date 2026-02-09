import type { Metadata } from 'next';
import Link from 'next/link';
import { Book, Code, Rocket, Zap, ArrowRight, Search } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Learn how to use Podex with our comprehensive documentation. Get started guides, API reference, and tutorials.',
  alternates: {
    canonical: '/docs',
  },
};

const sections = [
  {
    title: 'Getting Started',
    description: 'Learn the basics and get up and running quickly.',
    icon: Rocket,
    color: 'accent-primary',
    links: [
      { name: 'Quick Start Guide', href: '/docs' },
      { name: 'Creating Your First Project', href: '/docs' },
      { name: 'Understanding Agents', href: '/agents' },
    ],
  },
  {
    title: 'Features',
    description: 'Deep dive into Podex capabilities.',
    icon: Zap,
    color: 'accent-secondary',
    links: [
      { name: 'Agent Memory', href: '/docs' },
      { name: 'Vision Analysis', href: '/docs' },
      { name: 'Voice Commands', href: '/docs' },
    ],
  },
  {
    title: 'Resources',
    description: 'Helpful resources and references.',
    icon: Book,
    color: 'agent-3',
    links: [
      { name: 'FAQ', href: '/faq' },
      { name: 'Glossary', href: '/glossary' },
      { name: 'Contact Support', href: '/contact' },
    ],
  },
  {
    title: 'Security',
    description: 'Learn about our security practices.',
    icon: Code,
    color: 'agent-2',
    links: [
      { name: 'Security Overview', href: '/security' },
      { name: 'Privacy Policy', href: '/privacy' },
      { name: 'Terms of Service', href: '/terms' },
    ],
  },
];

export default function DocsPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-void py-24 lg:py-32">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          {/* Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">Documentation</h1>
            <p className="text-xl text-text-secondary max-w-2xl mx-auto mb-8">
              Everything you need to build amazing things with Podex.
            </p>

            {/* Search */}
            <div className="max-w-xl mx-auto relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-muted" />
              <input
                type="text"
                placeholder="Search documentation..."
                className="w-full pl-12 pr-4 py-4 rounded-xl bg-surface border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Sections Grid */}
          <div className="grid gap-8 md:grid-cols-2">
            {sections.map((section) => (
              <div
                key={section.title}
                className="p-8 rounded-2xl bg-surface border border-border-default hover:border-border-strong transition-all"
              >
                <div className={`p-3 rounded-xl bg-${section.color}/10 w-fit mb-4`}>
                  <section.icon className={`h-6 w-6 text-${section.color}`} />
                </div>
                <h2 className="text-xl font-bold text-text-primary mb-2">{section.title}</h2>
                <p className="text-text-secondary mb-6">{section.description}</p>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="flex items-center gap-2 text-text-muted hover:text-accent-primary transition-colors"
                      >
                        <ArrowRight className="h-4 w-4" />
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Help CTA */}
          <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
            <h3 className="text-xl font-bold text-text-primary mb-2">Need Help?</h3>
            <p className="text-text-secondary mb-4">
              Can&apos;t find what you&apos;re looking for? Our team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
