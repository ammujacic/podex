'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to Sentry
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'app',
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="mb-6 text-6xl">:(</div>
        <h1 className="mb-4 text-xl font-bold">Something went wrong</h1>
        <p className="mb-6 text-text-secondary">
          We encountered an unexpected error. Please try again or contact support if the problem
          persists.
        </p>
        {error.digest && (
          <p className="mb-4 font-mono text-xs text-text-tertiary">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-4">
          <button
            onClick={reset}
            className="rounded-lg bg-accent-primary px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
          >
            Try again
          </button>
          <button
            onClick={() => (window.location.href = '/')}
            className="rounded-lg border border-border-default bg-bg-elevated px-6 py-2 text-sm font-medium transition-colors hover:bg-bg-subtle"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}
