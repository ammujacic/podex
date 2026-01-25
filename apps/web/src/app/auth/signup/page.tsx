'use client';

import type { FormEvent } from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input } from '@podex/ui';
import { register, getOAuthURL, validateInvitation, type InvitationValidation } from '@/lib/api';
import { useAuthError, useAuthLoading } from '@/stores/auth';
import { toast } from 'sonner';
import { Loader2, Github, Check, Sparkles, Gift, Clock, User } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';

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
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [oauthLoading, setOauthLoading] = useState<'github' | 'google' | null>(null);
  const isLoading = useAuthLoading();
  const error = useAuthError();

  // Invitation state
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationValidation | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationError, setInvitationError] = useState<string | null>(null);

  // Check for invitation token in URL
  useEffect(() => {
    const token = searchParams.get('invitation');
    if (token) {
      setInvitationToken(token);
      setInvitationLoading(true);
      validateInvitation(token)
        .then((result) => {
          if (result.valid) {
            setInvitation(result);
            // Pre-fill email from invitation
            if (result.email) {
              setEmail(result.email);
            }
          } else {
            setInvitationError('This invitation is invalid or has expired.');
          }
        })
        .catch(() => {
          setInvitationError('Failed to validate invitation.');
        })
        .finally(() => {
          setInvitationLoading(false);
        });
    }
  }, [searchParams]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    try {
      await register(email, password, name, invitationToken ?? undefined);
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
      // For OAuth with invitation, the backend will match by email
      const url = await getOAuthURL(provider);
      window.location.href = url;
    } catch {
      toast.error(`Failed to start ${provider} sign up`);
      setOauthLoading(null);
    }
  };

  const isDisabled = isLoading || oauthLoading !== null || invitationLoading;
  const hasValidInvitation = invitation?.valid;

  const passwordRequirements = [
    { met: password.length >= 8, text: 'At least 8 characters' },
    { met: /[A-Z]/.test(password), text: 'One uppercase letter' },
    { met: /[a-z]/.test(password), text: 'One lowercase letter' },
    { met: /\d/.test(password), text: 'One number' },
  ];

  // Loading state for invitation validation
  if (invitationLoading) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-lg border border-border-default p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mx-auto" />
          <p className="mt-4 text-text-secondary">Validating your invitation...</p>
        </div>
      </div>
    );
  }

  // Invalid invitation error
  if (invitationToken && invitationError) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-lg border border-red-500/20 p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">Invitation Expired</h1>
          <p className="text-text-secondary mb-6">{invitationError}</p>
          <Link href="/auth/signup">
            <Button variant="secondary">Sign Up Without Invitation</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      {/* Exclusive Invitation Banner */}
      {hasValidInvitation && (
        <div className="mb-6 p-6 rounded-xl bg-gradient-to-br from-accent-primary/10 via-purple-500/10 to-accent-secondary/10 border border-accent-primary/20 relative overflow-hidden">
          {/* Background sparkles */}
          <div className="absolute top-2 right-2">
            <Sparkles className="w-6 h-6 text-accent-primary/30" />
          </div>
          <div className="absolute bottom-2 left-2">
            <Sparkles className="w-4 h-4 text-purple-400/30" />
          </div>

          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-accent-primary/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-accent-primary" />
              </div>
              <div>
                <p className="text-sm text-accent-primary font-medium">Exclusive Invitation</p>
                <h2 className="text-lg font-bold text-text-primary">You&apos;re Invited!</h2>
              </div>
            </div>

            {invitation?.inviter_name && (
              <div className="flex items-center gap-2 mb-3 text-sm text-text-secondary">
                <User className="w-4 h-4 text-text-muted" />
                <span>
                  <strong className="text-text-primary">{invitation.inviter_name}</strong> invited
                  you to join Podex
                </span>
              </div>
            )}

            {invitation?.message && (
              <div className="mb-4 p-3 bg-surface/50 rounded-lg border border-border-subtle">
                <p className="text-sm text-text-secondary italic">
                  &ldquo;{invitation.message}&rdquo;
                </p>
              </div>
            )}

            {invitation?.gift_plan_name && invitation?.gift_months && (
              <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm text-purple-300">Your Gift</p>
                    <p className="text-lg font-bold text-purple-400">
                      {invitation.gift_months} month{invitation.gift_months > 1 ? 's' : ''} of{' '}
                      {invitation.gift_plan_name}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          'bg-surface rounded-lg border p-8',
          hasValidInvitation ? 'border-accent-primary/30' : 'border-border-default'
        )}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">
            {hasValidInvitation ? 'Accept Your Invitation' : 'Create your account'}
          </h1>
          <p className="text-text-secondary">
            {hasValidInvitation
              ? 'Complete your registration to get started'
              : 'Start building with AI-powered development'}
          </p>
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
              disabled={isDisabled || hasValidInvitation}
            />
            {hasValidInvitation && (
              <p className="text-xs text-text-muted">Email is set from your invitation</p>
            )}
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

          <Button
            type="submit"
            className={cn(
              'w-full',
              hasValidInvitation &&
                'bg-gradient-to-r from-accent-primary to-accent-secondary hover:shadow-lg hover:shadow-accent-primary/25'
            )}
            disabled={isDisabled}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating account...
              </>
            ) : hasValidInvitation ? (
              <>
                <Sparkles className="w-4 h-4" />
                Accept Invitation
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
