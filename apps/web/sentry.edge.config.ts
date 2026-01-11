import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment configuration
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'podex-web@0.1.0',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Filter out known non-actionable errors
  ignoreErrors: ['NEXT_NOT_FOUND', 'NEXT_REDIRECT'],

  // Filter out health check transactions
  ignoreTransactions: [/^GET \/health/, /^GET \/api\/health/],

  // Trace propagation to backend services
  tracePropagationTargets: ['localhost', /^https:\/\/.*\.podex\.dev/, /^https:\/\/api\.podex\.dev/],

  // Debug mode for development
  debug: process.env.NODE_ENV === 'development' && process.env.SENTRY_DEBUG === 'true',

  // Maximum breadcrumbs
  maxBreadcrumbs: 30,
});
