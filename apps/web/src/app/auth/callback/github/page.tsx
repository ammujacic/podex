'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle } from 'lucide-react';
import { handleGitHubCallbackAuto } from '@/lib/api';
import { toast } from 'sonner';

type CallbackState = 'loading' | 'processing' | 'success' | 'link-success' | 'error';

// Session storage key for tracking callback attempts (prevents double execution)
const CALLBACK_ATTEMPT_KEY = 'github_oauth_callback_attempted';

function GitHubCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [isLinkFlow, setIsLinkFlow] = useState(false);

  useEffect(() => {
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');

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
    const errorParam = searchParams.get('error');

    // Check for OAuth error from GitHub
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

    // Use the unified callback endpoint that auto-detects flow type server-side
    // This is more reliable than sessionStorage-based detection
    handleGitHubCallbackAuto(code, stateParam)
      .then((response) => {
        if (response.flow_type === 'link') {
          // Account linking flow
          setIsLinkFlow(true);
          setLinkMessage(response.link_message || 'GitHub account linked successfully');
          setState('link-success');
          toast.success(`Successfully linked GitHub account @${response.github_username}`);
          // Redirect to settings after showing success
          setTimeout(() => {
            router.push('/settings');
          }, 1500);
        } else {
          // Login/signup flow
          setIsLinkFlow(false);
          setState('success');
          toast.success('Successfully signed in with GitHub!');
          // Redirect immediately for login
          router.push('/dashboard');
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to complete GitHub authentication');
        setState('error');
      });
  }, [searchParams, router]);

  // Clear stored states on completion (success or error)
  useEffect(() => {
    if (
      (state === 'error' || state === 'success' || state === 'link-success') &&
      typeof window !== 'undefined'
    ) {
      // Clean up any leftover sessionStorage (for hygiene, no longer relied upon)
      sessionStorage.removeItem('github_link_state');
      // Clean up callback attempt markers for this state param
      const stateParam = searchParams.get('state');
      if (stateParam) {
        sessionStorage.removeItem(`${CALLBACK_ATTEMPT_KEY}:${stateParam}`);
      }
    }
  }, [state, searchParams]);

  // Loading state - show while initializing
  if (state === 'loading' || state === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-4" />
          <p className="text-text-secondary">Completing GitHub authentication...</p>
        </div>
      </div>
    );
  }

  // Success state for login - brief display before redirect
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

  // Link success state
  if (state === 'link-success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="bg-surface rounded-lg border border-border-default p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-6 h-6 text-green-400" />
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">GitHub Linked!</h1>
          <p className="text-text-secondary mb-4">{linkMessage}</p>
          <p className="text-sm text-text-muted">Redirecting to settings...</p>
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
          <h1 className="text-xl font-bold text-text-primary mb-2">
            {isLinkFlow ? 'Link Failed' : 'Authentication Failed'}
          </h1>
          <p className="text-text-secondary mb-6">{error}</p>
          <a
            href={isLinkFlow ? '/settings' : '/auth/login'}
            className="inline-block px-4 py-2 bg-accent-primary text-text-inverse rounded-md hover:bg-accent-primary/90"
          >
            {isLinkFlow ? 'Back to Settings' : 'Back to Login'}
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

export default function GitHubCallbackPage() {
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
      <GitHubCallbackContent />
    </Suspense>
  );
}
