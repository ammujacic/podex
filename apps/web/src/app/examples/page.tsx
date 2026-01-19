import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, Github, Star } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Examples',
  description:
    'Explore example projects built with Podex. Learn from real-world applications and get inspired.',
  alternates: {
    canonical: '/examples',
  },
};

const examples = [
  {
    title: 'SaaS Starter Kit',
    description:
      'A full-stack SaaS template with authentication, billing, and team management. Built with Next.js, Prisma, and Stripe.',
    image: '/assets/examples/saas-starter.png',
    tags: ['Next.js', 'Prisma', 'Stripe', 'TypeScript'],
    github: 'https://github.com/podex/saas-starter',
    demo: 'https://saas-starter.podex.dev',
  },
  {
    title: 'AI Chat Application',
    description:
      'Real-time chat application with AI-powered responses. Features streaming, conversation history, and multiple models.',
    image: '/assets/examples/ai-chat.png',
    tags: ['React', 'OpenAI', 'WebSockets', 'Redis'],
    github: 'https://github.com/podex/ai-chat',
    demo: 'https://ai-chat.podex.dev',
  },
  {
    title: 'E-commerce Store',
    description:
      'Complete e-commerce solution with product catalog, cart, checkout, and order management.',
    image: '/assets/examples/ecommerce.png',
    tags: ['Next.js', 'Shopify', 'Tailwind', 'TypeScript'],
    github: 'https://github.com/podex/ecommerce',
    demo: 'https://ecommerce.podex.dev',
  },
  {
    title: 'API Backend Template',
    description:
      'Production-ready REST API with authentication, rate limiting, logging, and documentation.',
    image: '/assets/examples/api-backend.png',
    tags: ['Node.js', 'Express', 'PostgreSQL', 'Docker'],
    github: 'https://github.com/podex/api-template',
  },
  {
    title: 'Dashboard UI Kit',
    description: 'Beautiful admin dashboard with charts, tables, forms, and dark mode support.',
    image: '/assets/examples/dashboard.png',
    tags: ['React', 'Recharts', 'Tailwind', 'shadcn/ui'],
    github: 'https://github.com/podex/dashboard-kit',
    demo: 'https://dashboard.podex.dev',
  },
  {
    title: 'Mobile App Starter',
    description:
      'Cross-platform mobile app template with navigation, authentication, and offline support.',
    image: '/assets/examples/mobile-app.png',
    tags: ['React Native', 'Expo', 'TypeScript'],
    github: 'https://github.com/podex/mobile-starter',
  },
];

export default function ExamplesPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">Examples</h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Explore projects built with Podex. Clone, customize, and deploy your own version.
          </p>
        </div>

        {/* Examples Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {examples.map((example) => (
            <article
              key={example.title}
              className="rounded-2xl bg-surface border border-border-default overflow-hidden hover:border-border-strong transition-all group"
            >
              {/* Image placeholder */}
              <div className="aspect-video bg-elevated flex items-center justify-center">
                <span className="text-4xl">
                  {example.title.includes('SaaS')
                    ? '🚀'
                    : example.title.includes('Chat')
                      ? '💬'
                      : example.title.includes('commerce')
                        ? '🛒'
                        : example.title.includes('API')
                          ? '⚡'
                          : example.title.includes('Dashboard')
                            ? '📊'
                            : '📱'}
                </span>
              </div>

              <div className="p-6">
                <h2 className="text-lg font-bold text-text-primary mb-2 group-hover:text-accent-primary transition-colors">
                  {example.title}
                </h2>
                <p className="text-sm text-text-muted mb-4">{example.description}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {example.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded text-xs bg-elevated text-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                  <a
                    href={example.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <Github className="h-4 w-4" />
                    Source
                  </a>
                  {example.demo && (
                    <a
                      href={example.demo}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-accent-primary hover:text-accent-primary/80 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Live Demo
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* Submit Example */}
        <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
          <Star className="h-8 w-8 text-accent-primary mx-auto mb-4" />
          <h3 className="text-xl font-bold text-text-primary mb-2">Built Something Cool?</h3>
          <p className="text-text-secondary mb-4">
            Share your project with the community and get featured here.
          </p>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
          >
            Submit Your Project
          </Link>
        </div>
      </div>
    </div>
  );
}
