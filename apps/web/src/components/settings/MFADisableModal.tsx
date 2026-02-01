'use client';

import { useState } from 'react';
import { X, Loader2, ShieldOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { disableMFA } from '@/lib/api';
import { toast } from 'sonner';

interface MFADisableModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  isOAuthUser: boolean;
}

export function MFADisableModal({ isOpen, onClose, onSuccess, isOAuthUser }: MFADisableModalProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDisable = async () => {
    if (!code || code.length < 6) {
      setError('Please enter your MFA code or backup code');
      return;
    }

    if (!isOAuthUser && !password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await disableMFA(code, isOAuthUser ? 'oauth-skip' : password);
      toast.success('Two-factor authentication has been disabled');
      onSuccess();
      onClose();
      // Reset state
      setCode('');
      setPassword('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to disable MFA';
      setError(message.includes('Invalid') ? 'Invalid code or password' : message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
    setCode('');
    setPassword('');
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle bg-gradient-to-r from-red-500/10 to-orange-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <ShieldOff className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Disable Two-Factor Authentication
                </h3>
                <p className="text-sm text-text-muted">This will make your account less secure</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-elevated rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Warning */}
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-400 text-sm font-medium">Warning</p>
              <p className="text-text-muted text-sm">
                Disabling two-factor authentication will remove an extra layer of security from your
                account. We recommend keeping it enabled.
              </p>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* MFA Code */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Authentication Code
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              placeholder="Enter 6-digit code or backup code"
              className={cn(
                'w-full px-4 py-3 bg-elevated border rounded-lg text-text-primary',
                'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                error ? 'border-red-500' : 'border-border-subtle'
              )}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-text-muted">
              Enter a code from your authenticator app or one of your backup codes
            </p>
          </div>

          {/* Password (for non-OAuth users) */}
          {!isOAuthUser && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="Enter your password"
                className={cn(
                  'w-full px-4 py-3 bg-elevated border rounded-lg text-text-primary',
                  'placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                  error ? 'border-red-500' : 'border-border-subtle'
                )}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              className="flex-1 py-3 px-4 border border-border-subtle text-text-secondary rounded-lg font-medium hover:bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              disabled={loading || !code || (!isOAuthUser && !password)}
              className="flex-1 py-3 px-4 bg-red-600 text-white rounded-lg font-medium hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <ShieldOff className="w-5 h-5" />
                  Disable
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
