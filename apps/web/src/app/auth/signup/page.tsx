'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@podex/ui';
import { register, getOAuthURL } from '@/lib/api';
import { useAuthError, useAuthLoading } from '@/stores/auth';
import { toast } from 'sonner';
import { Loader2, Github, Check } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Google icon component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export default function SignupPage() {
  useDocumentTitle('Sign Up', { showNotifications: false });
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [oauthLoading, setOauthLoading] = useState<'github' | 'google' | null>(null);
  const isLoading = useAuthLoading();
  const error = useAuthError();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      await register(email, password, name);
      toast.success('Account created successfully!');
      router.push('/session/new');
    } catch (err) {
      // Error is already set in the store by the register function
      console.error('Registration failed:', err);
    }
  };

  const handleOAuth = async (provider: 'github' | 'google') => {
    try {
      setOauthLoading(provider);
      const url = await getOAuthURL(provider);
      window.location.href = url;
    } catch {
      toast.error(`Failed to start ${provider} sign up`);
      setOauthLoading(null);
    }
  };

  const isDisabled = isLoading || oauthLoading !== null;

  const passwordRequirements = [
    { met: password.length >= 8, text: 'At least 8 characters' },
    { met: /[A-Z]/.test(password), text: 'One uppercase letter' },
    { met: /[a-z]/.test(password), text: 'One lowercase letter' },
    { met: /\d/.test(password), text: 'One number' },
  ];

  return (
    <div className="w-full max-w-md">
      <div className="bg-surface rounded-lg border border-border-default p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Create your account</h1>
          <p className="text-text-secondary">Start building with AI-powered development</p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-3 rounded-md bg-accent-error/10 border border-accent-error/20 text-accent-error text-sm">
            {error}
          </div>
        )}

        {/* Registration form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="block text-sm font-medium text-text-secondary">
              Full name
            </label>
            <Input
              id="name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              disabled={isDisabled}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-text-secondary">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isDisabled}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Create a secure password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={isDisabled}
            />
            {/* Password requirements */}
            {password && (
              <div className="mt-2 space-y-1">
                {passwordRequirements.map((req, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs ${
                      req.met ? 'text-accent-success' : 'text-text-muted'
                    }`}
                  >
                    {req.met ? <Check className="w-3 h-3" /> : <div className="w-3 h-3" />}
                    {req.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isDisabled}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create account'
            )}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border-default" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-surface px-2 text-text-muted">Or continue with</span>
          </div>
        </div>

        {/* OAuth buttons */}
        <div className="space-y-3">
          <Button
            variant="secondary"
            className="w-full"
            disabled={isDisabled}
            onClick={() => handleOAuth('github')}
          >
            {oauthLoading === 'github' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Github className="w-4 h-4" />
            )}
            Continue with GitHub
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={isDisabled}
            onClick={() => handleOAuth('google')}
          >
            {oauthLoading === 'google' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GoogleIcon className="w-4 h-4" />
            )}
            Continue with Google
          </Button>
        </div>

        {/* Terms */}
        <p className="mt-6 text-center text-xs text-text-muted">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="text-accent-primary hover:underline">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="text-accent-primary hover:underline">
            Privacy Policy
          </Link>
        </p>

        {/* Sign in link */}
        <p className="mt-4 text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-accent-primary hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
