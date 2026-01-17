import type { Metadata } from 'next';
import Link from 'next/link';
import { Code, Key, Database, Webhook, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'API Reference',
  description: 'Complete API documentation for Podex. Authentication, sessions, agents, and more.',
  alternates: {
    canonical: '/docs/api',
  },
};

const endpoints = [
  {
    category: 'Authentication',
    icon: Key,
    color: 'accent-primary',
    items: [
      { method: 'POST', path: '/api/auth/login', description: 'Authenticate user and get token' },
      { method: 'POST', path: '/api/auth/logout', description: 'Invalidate current session' },
      { method: 'POST', path: '/api/auth/refresh', description: 'Refresh access token' },
    ],
  },
  {
    category: 'Sessions',
    icon: Database,
    color: 'agent-2',
    items: [
      { method: 'GET', path: '/api/sessions', description: 'List all sessions' },
      { method: 'POST', path: '/api/sessions', description: 'Create a new session' },
      { method: 'GET', path: '/api/sessions/:id', description: 'Get session details' },
      { method: 'DELETE', path: '/api/sessions/:id', description: 'Delete a session' },
    ],
  },
  {
    category: 'Agents',
    icon: Code,
    color: 'agent-3',
    items: [
      { method: 'GET', path: '/api/agents', description: 'List available agents' },
      { method: 'POST', path: '/api/agents/invoke', description: 'Invoke an agent' },
      { method: 'GET', path: '/api/agents/:id/status', description: 'Get agent status' },
    ],
  },
  {
    category: 'Webhooks',
    icon: Webhook,
    color: 'accent-secondary',
    items: [
      { method: 'GET', path: '/api/webhooks', description: 'List configured webhooks' },
      { method: 'POST', path: '/api/webhooks', description: 'Create a webhook' },
      { method: 'DELETE', path: '/api/webhooks/:id', description: 'Delete a webhook' },
    ],
  },
];

const methodColors = {
  GET: 'accent-success',
  POST: 'accent-primary',
  PUT: 'agent-4',
  DELETE: 'accent-error',
};

export default function ApiReferencePage() {
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
          <h1 className="text-4xl font-bold text-text-primary mb-4">API Reference</h1>
          <p className="text-xl text-text-secondary">
            Complete reference for the Podex REST API. All endpoints require authentication unless
            noted otherwise.
          </p>
        </div>

        {/* Base URL */}
        <div className="p-4 rounded-xl bg-surface border border-border-default mb-12">
          <p className="text-sm text-text-muted mb-2">Base URL</p>
          <code className="text-accent-primary font-mono">https://api.podex.dev/v1</code>
        </div>

        {/* Endpoints */}
        <div className="space-y-12">
          {endpoints.map((section) => (
            <section key={section.category}>
              <div className="flex items-center gap-3 mb-6">
                <div className={`p-2 rounded-lg bg-${section.color}/10`}>
                  <section.icon className={`h-5 w-5 text-${section.color}`} />
                </div>
                <h2 className="text-2xl font-bold text-text-primary">{section.category}</h2>
              </div>

              <div className="space-y-4">
                {section.items.map((endpoint) => (
                  <div
                    key={endpoint.path}
                    className="p-4 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all"
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-mono font-bold bg-${methodColors[endpoint.method as keyof typeof methodColors]}/10 text-${methodColors[endpoint.method as keyof typeof methodColors]}`}
                      >
                        {endpoint.method}
                      </span>
                      <div className="flex-1">
                        <code className="text-text-primary font-mono">{endpoint.path}</code>
                        <p className="text-sm text-text-muted mt-1">{endpoint.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* SDK CTA */}
        <div className="mt-16 p-8 rounded-2xl bg-surface border border-border-default">
          <h3 className="text-xl font-bold text-text-primary mb-2">Looking for SDKs?</h3>
          <p className="text-text-secondary mb-4">
            We provide official SDKs for popular languages to make integration easier.
          </p>
          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1.5 rounded-lg bg-elevated text-text-muted text-sm">
              TypeScript/JavaScript
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-elevated text-text-muted text-sm">
              Python
            </span>
            <span className="px-3 py-1.5 rounded-lg bg-elevated text-text-muted text-sm">Go</span>
          </div>
        </div>
      </div>
    </div>
  );
}
