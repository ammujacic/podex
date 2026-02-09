'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Input } from '@podex/ui';
import { forgotPassword } from '@/lib/api';
import { toast } from 'sonner';
import { Loader2, ArrowLeft, Mail, CheckCircle } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function ForgotPasswordPage() {
  useDocumentTitle('Forgot Password', { showNotifications: false });
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await forgotPassword(email);
      setIsSubmitted(true);
      toast.success('Check your email for reset instructions');
    } catch (err) {
      // Still show success to prevent email enumeration
      // The API always returns success
      setIsSubmitted(true);
      console.error('Password reset request failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Success state after submission
  if (isSubmitted) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-lg border border-border-default p-8">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-accent-success/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-6 h-6 text-accent-success" />
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">Check your email</h1>
            <p className="text-text-secondary mb-6">
              If an account exists for{' '}
              <span className="font-medium text-text-primary">{email}</span>, we&apos;ve sent
              password reset instructions.
            </p>
            <p className="text-sm text-text-muted mb-6">
              The link will expire in 1 hour. If you don&apos;t see the email, check your spam
              folder.
            </p>
            <div className="space-y-3">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setIsSubmitted(false);
                  setEmail('');
                }}
              >
                <Mail className="w-4 h-4" />
                Try a different email
              </Button>
              <Link href="/auth/login">
                <Button variant="ghost" className="w-full">
                  <ArrowLeft className="w-4 h-4" />
                  Back to login
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <div className="bg-surface rounded-lg border border-border-default p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Forgot your password?</h1>
          <p className="text-text-secondary">
            Enter your email address and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        {/* Forgot password form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-text-secondary">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={isLoading}
              autoFocus
            />
          </div>

          <Button type="submit" className="w-full" disabled={isLoading || !email}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending reset link...
              </>
            ) : (
              'Send reset link'
            )}
          </Button>
        </form>

        {/* Back to login link */}
        <div className="mt-6 text-center">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
