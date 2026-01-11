'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { handleOAuthCallback } from '@/lib/api';
import { toast } from 'sonner';

function GoogleCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(searchParams.get('error_description') || 'OAuth authentication failed');
      return;
    }

    if (!code || !state) {
      setError('Missing authorization code or state');
      return;
    }

    // Exchange code for tokens
    handleOAuthCallback('google', code, state)
      .then(() => {
        toast.success('Successfully signed in with Google!');
        router.push('/dashboard');
      })
      .catch((err) => {
        setError(err.message || 'Failed to complete OAuth flow');
      });
  }, [searchParams, router]);

  if (error) {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-void">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto mb-4" />
        <p className="text-text-secondary">Completing Google sign in...</p>
      </div>
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
