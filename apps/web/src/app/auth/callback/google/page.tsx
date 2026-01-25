'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle } from 'lucide-react';
import { handleOAuthCallback } from '@/lib/api';
import { toast } from 'sonner';

type CallbackState = 'loading' | 'processing' | 'success' | 'error';

// Session storage key for tracking callback attempts
const CALLBACK_ATTEMPT_KEY = 'google_oauth_callback_attempted';

function GoogleCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const errorParam = searchParams.get('error');

    // Use sessionStorage to prevent double execution across Suspense remounts
    // Key includes the state param to allow retries with different OAuth attempts
    const attemptKey = `${CALLBACK_ATTEMPT_KEY}:${stateParam}`;
    if (typeof window !== 'undefined' && sessionStorage.getItem(attemptKey)) {
      // Already attempted this callback, skip to avoid consuming state twice
      return;
    }
    if (typeof window !== 'undefined' && stateParam) {
      sessionStorage.setItem(attemptKey, 'true');
    }

    // Check for OAuth error from Google
    if (errorParam) {
      setError(searchParams.get('error_description') || 'OAuth authentication failed');
      setState('error');
      return;
    }

    // Validate required params
    if (!code || !stateParam) {
      setError('Missing authorization code or state');
      setState('error');
      return;
    }

    setState('processing');

    // Exchange code for tokens
    handleOAuthCallback('google', code, stateParam)
      .then(() => {
        setState('success');
        toast.success('Successfully signed in with Google!');
        router.push('/dashboard');
      })
      .catch((err) => {
        setError(err.message || 'Failed to complete OAuth flow');
        setState('error');
      });
  }, [searchParams, router]);

  // Clear callback attempt marker on completion
  useEffect(() => {
    if ((state === 'error' || state === 'success') && typeof window !== 'undefined') {
      const stateParam = searchParams.get('state');
      if (stateParam) {
        sessionStorage.removeItem(`${CALLBACK_ATTEMPT_KEY}:${stateParam}`);
      }
    }
  }, [state, searchParams]);

  // Loading state
  if (state === 'loading' || state === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-4" />
          <p className="text-text-secondary">Completing Google sign in...</p>
        </div>
      </div>
    );
  }

  // Success state - brief display before redirect
  if (state === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-4" />
          <p className="text-text-secondary">Signed in! Redirecting...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="bg-surface rounded-lg border border-border-default p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-accent-error/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-accent-error text-2xl">!</span>
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">Authentication Failed</h1>
          <p className="text-text-secondary mb-6">{error}</p>
          <a
            href="/auth/login"
            className="inline-block px-4 py-2 bg-accent-primary text-text-inverse rounded-md hover:bg-accent-primary/90"
          >
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  // Fallback loading
  return (
    <div className="min-h-screen flex items-center justify-center bg-void">
      <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-void">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-4" />
            <p className="text-text-secondary">Loading...</p>
          </div>
        </div>
      }
    >
      <GoogleCallbackContent />
    </Suspense>
  );
}
