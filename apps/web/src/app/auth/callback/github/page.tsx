'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle } from 'lucide-react';
import { handleOAuthCallback, handleGitHubLinkCallback } from '@/lib/api';
import { toast } from 'sonner';

type CallbackState = 'loading' | 'processing' | 'success' | 'link-success' | 'error';

function GitHubCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [isLinkFlow, setIsLinkFlow] = useState(false);

  // Use ref to prevent double execution in React strict mode
  const hasStarted = useRef(false);

  useEffect(() => {
    // Prevent double execution
    if (hasStarted.current) return;
    hasStarted.current = true;

    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
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

    // Determine flow type BEFORE starting the callback
    const storedLinkState =
      typeof window !== 'undefined' ? sessionStorage.getItem('github_link_state') : null;

    const isLink = storedLinkState === stateParam;
    setIsLinkFlow(isLink);
    setState('processing');

    if (isLink) {
      // Account linking flow
      handleGitHubLinkCallback(code, stateParam)
        .then((response) => {
          setLinkMessage(response.message);
          setState('link-success');
          toast.success(`Successfully linked GitHub account @${response.github_username}`);
          // Redirect to settings after showing success
          setTimeout(() => {
            router.push('/settings');
          }, 1500);
        })
        .catch((err) => {
          setError(err.message || 'Failed to link GitHub account');
          setState('error');
        });
    } else {
      // Login/signup flow
      handleOAuthCallback('github', code, stateParam)
        .then(() => {
          setState('success');
          toast.success('Successfully signed in with GitHub!');
          // Redirect immediately for login
          router.push('/dashboard');
        })
        .catch((err) => {
          setError(err.message || 'Failed to complete OAuth flow');
          setState('error');
        });
    }
  }, [searchParams, router]);

  // Clear stored state on error
  useEffect(() => {
    if (state === 'error' && typeof window !== 'undefined') {
      sessionStorage.removeItem('github_link_state');
    }
  }, [state]);

  // Loading state - show while initializing
  if (state === 'loading' || state === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-void">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-4" />
          <p className="text-text-secondary">
            {isLinkFlow ? 'Linking your GitHub account...' : 'Completing GitHub sign in...'}
          </p>
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
