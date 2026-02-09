import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment configuration
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'podex-web@0.1.0',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Session Replay
  replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  replaysOnErrorSampleRate: 1.0,

  // Metrics (beta)
  _experiments: {
    metricsAggregator: true,
  },

  integrations: [
    // Session Replay integration
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
      maskAllInputs: true,
      // Mask sensitive elements
      mask: ['[data-sentry-mask]', '.sentry-mask'],
      // Block elements from replay
      block: ['[data-sentry-block]', '.sentry-block'],
    }),

    // Browser tracing for performance
    Sentry.browserTracingIntegration({
      // Trace all fetch requests
      traceFetch: true,
      traceXHR: true,
      // Enable interaction tracing
      enableInp: true,
    }),

    // Capture console errors
    Sentry.captureConsoleIntegration({
      levels: ['error', 'warn'],
    }),

    // HTTP client errors
    Sentry.httpClientIntegration(),

    // Context lines for better error context
    Sentry.contextLinesIntegration(),

    // Report all JavaScript exceptions
    Sentry.reportingObserverIntegration(),
  ],

  // Filter out known non-actionable errors
  ignoreErrors: [
    // Browser extensions
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
    // Benign errors
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    // Network errors that are expected
    'Failed to fetch',
    'NetworkError when attempting to fetch resource',
    'Load failed',
    // AbortController
    'AbortError',
    'The operation was aborted',
    // User-initiated navigation
    'Navigation cancelled',
  ],

  // Filter transactions
  ignoreTransactions: [
    // Health checks
    /^GET \/health/,
    /^GET \/api\/health/,
  ],

  // Attach user context when available
  beforeSend(event) {
    // You can modify the event here before it's sent
    // For example, scrub sensitive data
    if (event.request?.headers) {
      delete event.request.headers['Authorization'];
      delete event.request.headers['Cookie'];
    }
    return event;
  },

  // Trace propagation to backend services
  tracePropagationTargets: ['localhost', /^https:\/\/.*\.podex\.dev/, /^https:\/\/api\.podex\.dev/],

  // Debug mode for development
  debug: process.env.NODE_ENV === 'development' && process.env.SENTRY_DEBUG === 'true',

  // Enable sending default PII (like user IP)
  sendDefaultPii: false,

  // Maximum breadcrumbs
  maxBreadcrumbs: 100,

  // Attach stack trace to all messages
  attachStacktrace: true,

  // Normalize depth for context
  normalizeDepth: 10,
});

// Export for Next.js router transition instrumentation
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
