/**
 * Sentry-based error reporter.
 */

import * as Sentry from '@sentry/nextjs';
import type { ErrorReporter } from '@podex/api-client';

export class SentryErrorReporter implements ErrorReporter {
  captureError(
    error: Error,
    context: {
      tags?: Record<string, string | number | boolean>;
      extra?: Record<string, unknown>;
    }
  ): void {
    Sentry.captureException(error, {
      tags: context.tags,
      extra: context.extra,
    });
  }
}
