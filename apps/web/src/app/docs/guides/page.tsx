import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Clock, BookOpen } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Guides',
  description:
    'Step-by-step guides and tutorials for getting the most out of Podex. Learn best practices and advanced techniques.',
  alternates: {
    canonical: '/docs/guides',
  },
};

const guides = [
  {
    title: 'Getting Started with Podex',
    description: 'Learn the basics of Podex and create your first AI-assisted project.',
    readTime: '5 min',
    category: 'Beginner',
    categoryColor: 'accent-success',
  },
  {
    title: 'Working with AI Agents',
    description: 'Understand how to effectively communicate with and utilize different agents.',
    readTime: '10 min',
    category: 'Beginner',
    categoryColor: 'accent-success',
  },
  {
    title: 'Agent Memory and Context',
    description: 'Learn how agent memory works and how to leverage it for better results.',
    readTime: '8 min',
    category: 'Intermediate',
    categoryColor: 'agent-4',
  },
  {
    title: 'Multi-Agent Orchestration',
    description: 'Coordinate multiple agents to work on complex tasks in parallel.',
    readTime: '12 min',
    category: 'Advanced',
    categoryColor: 'accent-secondary',
  },
  {
    title: 'Git Integration Deep Dive',
    description: 'Master version control within Podex with branches, commits, and PRs.',
    readTime: '10 min',
    category: 'Intermediate',
    categoryColor: 'agent-4',
  },
  {
    title: 'Team Collaboration',
    description: 'Set up your team, manage permissions, and collaborate in real-time.',
    readTime: '8 min',
    category: 'Intermediate',
    categoryColor: 'agent-4',
  },
  {
    title: 'Voice Commands Guide',
    description: 'Use voice to control Podex and dictate code hands-free.',
    readTime: '6 min',
    category: 'Beginner',
    categoryColor: 'accent-success',
  },
  {
    title: 'Vision Analysis Tutorial',
    description: 'Convert designs and screenshots to code using the Vision agent.',
    readTime: '10 min',
    category: 'Intermediate',
    categoryColor: 'agent-4',
  },
];

export default function GuidesPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 lg:px-8">
        {/* Back link */}
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 text-text-muted hover:text-text-primary mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Documentation
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-text-primary mb-4">Guides & Tutorials</h1>
          <p className="text-xl text-text-secondary">
            Step-by-step guides to help you get the most out of Podex.
          </p>
        </div>

        {/* Guides List */}
        <div className="space-y-4">
          {guides.map((guide) => (
            <article
              key={guide.title}
              className="group p-6 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium bg-${guide.categoryColor}/10 text-${guide.categoryColor}`}
                    >
                      {guide.category}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <Clock className="h-3 w-3" />
                      {guide.readTime}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-text-primary group-hover:text-accent-primary transition-colors mb-1">
                    {guide.title}
                  </h2>
                  <p className="text-text-muted text-sm">{guide.description}</p>
                </div>
                <ArrowRight className="h-5 w-5 text-text-muted group-hover:text-accent-primary transition-colors shrink-0 mt-1" />
              </div>
            </article>
          ))}
        </div>

        {/* Request Guide */}
        <div className="mt-12 p-8 rounded-2xl bg-surface border border-border-default text-center">
          <BookOpen className="h-8 w-8 text-accent-primary mx-auto mb-4" />
          <h3 className="text-xl font-bold text-text-primary mb-2">Missing a Guide?</h3>
          <p className="text-text-secondary mb-4">
            Let us know what topics you&apos;d like us to cover.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
          >
            Request a Guide
          </Link>
        </div>
      </div>
    </div>
  );
}
