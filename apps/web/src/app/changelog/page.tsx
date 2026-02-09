import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, Tag, ArrowRight } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Changelog',
  description:
    'Stay up to date with the latest Podex updates, new features, improvements, and bug fixes.',
  alternates: {
    canonical: '/changelog',
  },
};

const releases = [
  {
    version: '1.5.0',
    date: '2025-01-15',
    title: 'Multi-Agent Orchestration',
    type: 'feature',
    changes: [
      'Introduced Orchestrator agent for coordinating multiple agents',
      'Added parallel task execution with dependency management',
      'New progress monitoring dashboard for agent activities',
      'Improved agent memory persistence across sessions',
    ],
  },
  {
    version: '1.4.0',
    date: '2025-01-08',
    title: 'Vision Analysis',
    type: 'feature',
    changes: [
      'Screenshot-to-code conversion with Vision agent',
      'Design mockup analysis and component generation',
      'UI/UX feedback and suggestions',
      'Image-based debugging assistance',
    ],
  },
  {
    version: '1.3.2',
    date: '2025-01-03',
    title: 'Performance Improvements',
    type: 'improvement',
    changes: [
      'Reduced agent response latency by 40%',
      'Optimized memory usage for large codebases',
      'Improved code completion accuracy',
      'Fixed edge cases in git integration',
    ],
  },
  {
    version: '1.3.0',
    date: '2024-12-20',
    title: 'Voice Commands',
    type: 'feature',
    changes: [
      'Voice-first coding interface',
      'Natural language to code conversion',
      'Hands-free development mode',
      'Multi-language voice support',
    ],
  },
  {
    version: '1.2.0',
    date: '2024-12-10',
    title: 'Team Collaboration',
    type: 'feature',
    changes: [
      'Real-time collaborative editing',
      'Shared agent sessions',
      'Team activity feed',
      'Role-based permissions',
    ],
  },
];

const typeColors = {
  feature: 'accent-primary',
  improvement: 'agent-3',
  fix: 'accent-secondary',
};

export default function ChangelogPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-void py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          {/* Page Header */}
          <div className="text-center mb-16">
            <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">Changelog</h1>
            <p className="text-xl text-text-secondary">
              All the latest updates, improvements, and fixes to Podex.
            </p>
          </div>

          {/* Releases */}
          <div className="space-y-12">
            {releases.map((release) => (
              <article
                key={release.version}
                className="relative pl-8 border-l-2 border-border-subtle"
              >
                <div className="absolute -left-2 top-0 w-4 h-4 rounded-full bg-accent-primary border-4 border-void" />

                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <span className="px-3 py-1 rounded-full bg-elevated text-text-primary font-mono text-sm">
                    v{release.version}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full bg-${typeColors[release.type as keyof typeof typeColors]}/10 text-${typeColors[release.type as keyof typeof typeColors]} text-sm capitalize`}
                  >
                    {release.type}
                  </span>
                  <span className="flex items-center gap-1 text-text-muted text-sm">
                    <Calendar className="h-4 w-4" />
                    {new Date(release.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>

                <h2 className="text-2xl font-bold text-text-primary mb-4">{release.title}</h2>

                <ul className="space-y-2">
                  {release.changes.map((change, i) => (
                    <li key={i} className="flex items-start gap-2 text-text-secondary">
                      <ArrowRight className="h-4 w-4 mt-1 text-accent-primary shrink-0" />
                      {change}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          {/* Subscribe */}
          <div className="mt-16 p-8 rounded-2xl bg-surface border border-border-default text-center">
            <Tag className="h-8 w-8 text-accent-primary mx-auto mb-4" />
            <h3 className="text-xl font-bold text-text-primary mb-2">Stay Updated</h3>
            <p className="text-text-secondary mb-4">
              Subscribe to our newsletter to get notified about new releases.
            </p>
            <Link
              href="/#footer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              Subscribe
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
