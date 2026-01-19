import type { Metadata } from 'next';
import { Download, Mail, ExternalLink } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Press Kit',
  description:
    'Press resources, brand assets, and media information for Podex. Download logos, screenshots, and company facts.',
  alternates: {
    canonical: '/press',
  },
};

const pressReleases = [
  {
    date: '2025-01-15',
    title: 'Podex Launches Multi-Agent Orchestration',
    excerpt:
      'New feature enables multiple AI agents to work together on complex development tasks.',
  },
  {
    date: '2024-12-01',
    title: 'Podex Reaches 10,000 Active Developers',
    excerpt:
      'Milestone achievement marks rapid growth in AI-powered development platform adoption.',
  },
  {
    date: '2024-10-15',
    title: 'Podex Introduces Vision Analysis',
    excerpt: 'Revolutionary feature converts design mockups directly into production code.',
  },
];

const facts = [
  { label: 'Founded', value: '2024' },
  { label: 'Headquarters', value: 'San Francisco, CA' },
  { label: 'Team Size', value: '15+ people' },
  { label: 'Active Users', value: '10,000+' },
  { label: 'Projects Created', value: '500,000+' },
  { label: 'Funding', value: 'Seed Stage' },
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">Press Kit</h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Resources for media and press. For inquiries, contact{' '}
            <a href="mailto:press@podex.dev" className="text-accent-primary hover:underline">
              press@podex.dev
            </a>
          </p>
        </div>

        {/* Brand Assets */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-6">Brand Assets</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl bg-surface border border-border-default">
              <div className="aspect-video bg-elevated rounded-lg flex items-center justify-center mb-4">
                <span className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                  Podex
                </span>
              </div>
              <h3 className="font-semibold text-text-primary mb-2">Logo (Light)</h3>
              <p className="text-sm text-text-muted mb-4">
                Primary logo for light backgrounds. Available in SVG, PNG, and PDF.
              </p>
              <button className="flex items-center gap-2 text-sm text-accent-primary hover:underline">
                <Download className="h-4 w-4" />
                Download Logo Pack
              </button>
            </div>

            <div className="p-6 rounded-xl bg-surface border border-border-default">
              <div className="aspect-video bg-void rounded-lg flex items-center justify-center mb-4 border border-border-subtle">
                <span className="text-4xl font-bold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                  Podex
                </span>
              </div>
              <h3 className="font-semibold text-text-primary mb-2">Logo (Dark)</h3>
              <p className="text-sm text-text-muted mb-4">
                Primary logo for dark backgrounds. Available in SVG, PNG, and PDF.
              </p>
              <button className="flex items-center gap-2 text-sm text-accent-primary hover:underline">
                <Download className="h-4 w-4" />
                Download Logo Pack
              </button>
            </div>
          </div>
        </section>

        {/* Company Facts */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-6">Company Facts</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="p-4 rounded-xl bg-surface border border-border-default"
              >
                <div className="text-sm text-text-muted mb-1">{fact.label}</div>
                <div className="text-lg font-semibold text-text-primary">{fact.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* About Podex */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-6">About Podex</h2>
          <div className="p-6 rounded-xl bg-surface border border-border-default">
            <p className="text-text-secondary mb-4">
              <strong className="text-text-primary">Boilerplate (Short):</strong>
            </p>
            <p className="text-text-secondary mb-6">
              Podex is a web-based agentic IDE platform that enables developers to deploy pods of AI
              agents that remember, plan, and execute together. With specialized agents for
              architecture, coding, review, and testing, Podex makes developers 10x more productive.
            </p>
            <p className="text-text-secondary mb-4">
              <strong className="text-text-primary">Boilerplate (Long):</strong>
            </p>
            <p className="text-text-secondary">
              Founded in 2024, Podex is reimagining software development with AI-first tooling. Our
              platform provides a cloud-based development environment where multiple specialized AI
              agents collaborate to help developers build software faster. Key features include
              agent memory for context persistence, planning mode for complex tasks, vision analysis
              for design-to-code conversion, and voice commands for hands-free development. Podex
              serves over 10,000 developers worldwide, from indie hackers to enterprise engineering
              teams.
            </p>
          </div>
        </section>

        {/* Press Releases */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-6">Recent Press Releases</h2>
          <div className="space-y-4">
            {pressReleases.map((release) => (
              <article
                key={release.title}
                className="p-6 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all group cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-text-muted mb-2">
                      {new Date(release.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    <h3 className="text-lg font-semibold text-text-primary group-hover:text-accent-primary transition-colors mb-1">
                      {release.title}
                    </h3>
                    <p className="text-sm text-text-muted">{release.excerpt}</p>
                  </div>
                  <ExternalLink className="h-5 w-5 text-text-muted group-hover:text-accent-primary transition-colors shrink-0" />
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Press Contact */}
        <section>
          <div className="p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
            <Mail className="h-8 w-8 text-accent-primary mx-auto mb-4" />
            <h3 className="text-xl font-bold text-text-primary mb-2">Press Inquiries</h3>
            <p className="text-text-secondary mb-4">
              For interviews, media inquiries, or additional information, please contact our press
              team.
            </p>
            <a
              href="mailto:press@podex.dev"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              <Mail className="h-4 w-4" />
              press@podex.dev
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
