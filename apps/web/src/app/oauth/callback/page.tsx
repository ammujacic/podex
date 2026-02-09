'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

/**
 * OAuth callback page that handles the redirect from OAuth providers.
 * Communicates the result back to the parent window (popup opener).
 */
export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // If error from provider
    if (error) {
      setStatus('error');
      setMessage(errorDescription || error || 'Authentication failed');

      if (window.opener) {
        window.opener.postMessage(
          { type: 'oauth_callback', error: errorDescription || error },
          window.location.origin
        );
      }
      return;
    }

    // If we have code and state, send to parent
    if (code && state) {
      setStatus('success');
      setMessage('Authentication successful! Closing...');

      if (window.opener) {
        window.opener.postMessage({ type: 'oauth_callback', code, state }, window.location.origin);

        // Close popup after a short delay
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        // If not in popup, show success message
        setMessage('Authentication successful! You can close this window.');
      }
    } else {
      setStatus('error');
      setMessage('Missing authentication data');
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-void">
      <div className="bg-surface border border-border-default rounded-xl p-8 max-w-md w-full mx-4 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 mx-auto mb-4 text-accent-primary animate-spin" />
            <h1 className="text-xl font-semibold text-text-primary mb-2">Authenticating</h1>
            <p className="text-text-muted">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
            <h1 className="text-xl font-semibold text-text-primary mb-2">Success!</h1>
            <p className="text-text-muted">{message}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h1 className="text-xl font-semibold text-text-primary mb-2">Authentication Failed</h1>
            <p className="text-text-muted mb-4">{message}</p>
            <button
              onClick={() => window.close()}
              className="px-4 py-2 bg-surface-hover hover:bg-surface-active text-text-primary rounded-lg transition-colors"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  );
}
