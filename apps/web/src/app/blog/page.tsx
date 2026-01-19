import type { Metadata } from 'next';
import Link from 'next/link';
import { Calendar, Clock, ArrowRight, Rss } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Latest news, tutorials, and insights from the Podex team. Learn about AI-powered development and best practices.',
  alternates: {
    canonical: '/blog',
  },
};

const posts = [
  {
    title: 'Introducing Multi-Agent Orchestration',
    excerpt:
      'Learn how to coordinate multiple AI agents to work on complex tasks in parallel, dramatically speeding up your development workflow.',
    date: '2025-01-15',
    readTime: '8 min',
    category: 'Product',
    categoryColor: 'accent-primary',
    slug: 'introducing-multi-agent-orchestration',
  },
  {
    title: 'The Future of AI-Assisted Development',
    excerpt:
      'Exploring how AI agents are transforming software development and what it means for developers in 2025 and beyond.',
    date: '2025-01-10',
    readTime: '12 min',
    category: 'Insights',
    categoryColor: 'agent-3',
    slug: 'future-of-ai-development',
  },
  {
    title: 'Best Practices for Agent Memory',
    excerpt:
      'Tips and tricks for getting the most out of agent memory. Learn how to structure context for better code generation.',
    date: '2025-01-05',
    readTime: '6 min',
    category: 'Tutorial',
    categoryColor: 'agent-2',
    slug: 'agent-memory-best-practices',
  },
  {
    title: 'Vision Analysis: From Design to Code',
    excerpt:
      'A deep dive into our Vision agent and how it converts screenshots and mockups into production-ready components.',
    date: '2024-12-28',
    readTime: '10 min',
    category: 'Product',
    categoryColor: 'accent-primary',
    slug: 'vision-analysis-design-to-code',
  },
  {
    title: 'Building a SaaS in a Weekend with Podex',
    excerpt:
      'A step-by-step walkthrough of building a complete SaaS application using Podex agents, from idea to deployment.',
    date: '2024-12-20',
    readTime: '15 min',
    category: 'Tutorial',
    categoryColor: 'agent-2',
    slug: 'building-saas-weekend',
  },
  {
    title: 'Our Journey to 10,000 Users',
    excerpt:
      'Reflecting on our growth, lessons learned, and the community that made it possible. Thank you for being part of this journey.',
    date: '2024-12-15',
    readTime: '7 min',
    category: 'Company',
    categoryColor: 'accent-secondary',
    slug: 'journey-to-10000-users',
  },
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-4xl font-bold text-text-primary mb-2">Blog</h1>
            <p className="text-text-secondary">
              News, tutorials, and insights from the Podex team.
            </p>
          </div>
          <a
            href="/blog/rss.xml"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border-default text-text-secondary hover:text-text-primary hover:border-border-strong transition-all"
          >
            <Rss className="h-4 w-4" />
            RSS
          </a>
        </div>

        {/* Featured Post */}
        {posts[0] && (
          <article className="mb-12 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default">
            <span className="inline-block px-3 py-1 rounded-full bg-accent-primary/20 text-accent-primary text-sm font-medium mb-4">
              Featured
            </span>
            <h2 className="text-2xl font-bold text-text-primary mb-3">{posts[0].title}</h2>
            <p className="text-text-secondary mb-4">{posts[0].excerpt}</p>
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {new Date(posts[0].date).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {posts[0].readTime}
              </span>
            </div>
          </article>
        )}

        {/* Posts List */}
        <div className="space-y-6">
          {posts.slice(1).map((post) => (
            <article
              key={post.slug}
              className="group p-6 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium bg-${post.categoryColor}/10 text-${post.categoryColor}`}
                    >
                      {post.category}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-text-primary group-hover:text-accent-primary transition-colors mb-2">
                    {post.title}
                  </h2>
                  <p className="text-sm text-text-muted mb-3">{post.excerpt}</p>
                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(post.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {post.readTime}
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-text-muted group-hover:text-accent-primary transition-colors shrink-0" />
              </div>
            </article>
          ))}
        </div>

        {/* Newsletter CTA */}
        <div className="mt-12 p-8 rounded-2xl bg-surface border border-border-default text-center">
          <h3 className="text-xl font-bold text-text-primary mb-2">Never Miss an Update</h3>
          <p className="text-text-secondary mb-4">
            Subscribe to our newsletter for the latest articles and product updates.
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
  );
}
