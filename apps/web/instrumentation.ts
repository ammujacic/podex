/// <reference types="node" />

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
