'use client';

import { useState } from 'react';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button, Input } from '@podex/ui';
import { api } from '@/lib/api';
import { useUser, useAuthStore } from '@/stores/auth';
import { useRouter } from 'next/navigation';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  mfaEnabled?: boolean;
}

export function DeleteAccountModal({
  isOpen,
  onClose,
  mfaEnabled = false,
}: DeleteAccountModalProps) {
  const user = useUser();
  const router = useRouter();
  const { logout } = useAuthStore();
  const [step, setStep] = useState<'warning' | 'confirm'>(mfaEnabled ? 'warning' : 'warning');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (step === 'warning') {
      setStep('confirm');
      return;
    }

    if (confirmation.toLowerCase() !== user?.email?.toLowerCase()) {
      setError('Email does not match');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.post('/api/auth/account/delete', {
        password,
        mfa_code: mfaEnabled ? mfaCode : undefined,
        confirmation,
      });

      // Clear auth state and redirect
      logout();
      router.push('/auth/login?deleted=true');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete account';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('warning');
    setPassword('');
    setMfaCode('');
    setConfirmation('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border-default rounded-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-accent-error flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Delete Account
          </h2>
          <button onClick={handleClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'warning' && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-accent-error/10 border border-accent-error/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-accent-error">This action cannot be undone</p>
                  <p className="text-sm text-text-secondary mt-1">
                    Deleting your account will permanently remove:
                  </p>
                  <ul className="text-sm text-text-muted mt-2 space-y-1 list-disc list-inside">
                    <li>All your projects and sessions</li>
                    <li>Your billing history and subscription</li>
                    <li>All saved settings and preferences</li>
                    <li>Your conversation history with agents</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => setStep('confirm')}
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-accent-error/10 border border-accent-error/20 text-accent-error text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Type your email to confirm
              </label>
              <Input
                type="email"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={user?.email || 'your@email.com'}
                required
                disabled={loading}
              />
              <p className="text-xs text-text-muted mt-1">
                Type <span className="font-mono text-text-secondary">{user?.email}</span> to confirm
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                disabled={loading}
              />
            </div>

            {mfaEnabled && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  Two-Factor Code
                </label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  required
                  autoComplete="one-time-code"
                  disabled={loading}
                  className="text-center tracking-widest"
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('warning')}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={
                  loading || !password || !confirmation || (mfaEnabled && mfaCode.length < 6)
                }
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete My Account'
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
