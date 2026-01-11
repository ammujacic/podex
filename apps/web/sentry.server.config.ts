import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment configuration
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'podex-web@0.1.0',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Metrics (beta)
  _experiments: {
    metricsAggregator: true,
  },

  integrations: [
    // HTTP integration for server-side requests
    Sentry.httpIntegration(),

    // Note: nodeProfilingIntegration requires @sentry/profiling-node package
    // Note: consoleIntegration is not available in @sentry/nextjs

    // Prisma integration (if using Prisma in the future)
    // Sentry.prismaIntegration(),
  ],

  // Filter out known non-actionable errors
  ignoreErrors: [
    // Next.js specific
    'NEXT_NOT_FOUND',
    'NEXT_REDIRECT',
    // Expected network errors
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
  ],

  // Filter out health check transactions
  ignoreTransactions: [
    /^GET \/health/,
    /^GET \/api\/health/,
    /^GET \/_next\/static/,
    /^GET \/favicon\.ico/,
  ],

  // Attach user context when available
  beforeSend(event) {
    // Scrub sensitive data from headers
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }

    // Scrub sensitive data from request body
    if (event.request?.data) {
      const sensitiveFields = [
        'password',
        'token',
        'secret',
        'apiKey',
        'accessToken',
        'refreshToken',
      ];
      try {
        const data =
          typeof event.request.data === 'string'
            ? JSON.parse(event.request.data)
            : event.request.data;

        for (const field of sensitiveFields) {
          if (data[field]) {
            data[field] = '[Filtered]';
          }
        }
        event.request.data = JSON.stringify(data);
      } catch {
        // If parsing fails, just continue
      }
    }

    return event;
  },

  // Trace propagation to backend services
  tracePropagationTargets: ['localhost', /^https:\/\/.*\.podex\.dev/, /^https:\/\/api\.podex\.dev/],

  // Debug mode for development
  debug: process.env.NODE_ENV === 'development' && process.env.SENTRY_DEBUG === 'true',

  // Maximum breadcrumbs
  maxBreadcrumbs: 50,

  // Attach stack trace to all messages
  attachStacktrace: true,

  // Spotlight for local development (Sentry's local dev tool)
  spotlight: process.env.NODE_ENV === 'development',
});
