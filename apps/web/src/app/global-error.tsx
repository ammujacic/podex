'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
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
        errorBoundary: 'global',
        digest: error.digest,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-void text-text-primary antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center p-4">
          <div className="max-w-md text-center">
            <h1 className="mb-4 text-2xl font-bold text-red-500">Something went wrong!</h1>
            <p className="mb-6 text-text-secondary">
              An unexpected error occurred. Our team has been notified and is working on a fix.
            </p>
            {error.digest && (
              <p className="mb-4 font-mono text-xs text-text-tertiary">Error ID: {error.digest}</p>
            )}
            <button
              onClick={reset}
              className="rounded-lg bg-accent-primary px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
