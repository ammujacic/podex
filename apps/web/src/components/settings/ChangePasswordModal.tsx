'use client';

import { useState } from 'react';
import { X, Eye, EyeOff, Loader2, AlertTriangle, Check } from 'lucide-react';
import { Button, Input } from '@podex/ui';
import { api } from '@/lib/api';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface PasswordStrength {
  strength: string;
  is_valid: boolean;
  errors: string[];
}

export function ChangePasswordModal({ isOpen, onClose, onComplete }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrength | null>(null);
  const [_checkingStrength, setCheckingStrength] = useState(false);

  const checkPasswordStrength = async (password: string) => {
    if (!password || password.length < 4) {
      setPasswordStrength(null);
      return;
    }

    setCheckingStrength(true);
    try {
      const result = await api.post<PasswordStrength>('/api/auth/password/check', { password });
      setPasswordStrength(result);
    } catch {
      // Ignore errors from strength check
    } finally {
      setCheckingStrength(false);
    }
  };

  const handleNewPasswordChange = (value: string) => {
    setNewPassword(value);
    // Debounce strength check
    const timeoutId = setTimeout(() => checkPasswordStrength(value), 500);
    return () => clearTimeout(timeoutId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (passwordStrength && !passwordStrength.is_valid) {
      setError('Please choose a stronger password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.post('/api/auth/password/change', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setPasswordStrength(null);
    onClose();
  };

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'very_strong':
        return 'bg-accent-success';
      case 'strong':
        return 'bg-accent-success/70';
      case 'good':
        return 'bg-accent-warning';
      case 'fair':
        return 'bg-orange-500';
      default:
        return 'bg-accent-error';
    }
  };

  const getStrengthLabel = (strength: string) => {
    return strength.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border-default rounded-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-text-primary">Change Password</h2>
          <button onClick={handleClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-accent-error/10 border border-accent-error/20 text-accent-error text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Current Password
            </label>
            <div className="relative">
              <Input
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              New Password
            </label>
            <div className="relative">
              <Input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => handleNewPasswordChange(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordStrength && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${getStrengthColor(passwordStrength.strength)}`}
                      style={{
                        width:
                          passwordStrength.strength === 'very_strong'
                            ? '100%'
                            : passwordStrength.strength === 'strong'
                              ? '80%'
                              : passwordStrength.strength === 'good'
                                ? '60%'
                                : passwordStrength.strength === 'fair'
                                  ? '40%'
                                  : '20%',
                      }}
                    />
                  </div>
                  <span className="text-xs text-text-muted">
                    {getStrengthLabel(passwordStrength.strength)}
                  </span>
                </div>
                {passwordStrength.errors.length > 0 && (
                  <ul className="text-xs text-text-muted space-y-0.5">
                    {passwordStrength.errors.map((err, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span className="text-accent-error">•</span> {err}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Confirm New Password
            </label>
            <div className="relative">
              <Input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmPassword && newPassword === confirmPassword && (
              <p className="mt-1 text-xs text-accent-success flex items-center gap-1">
                <Check className="w-3 h-3" /> Passwords match
              </p>
            )}
          </div>

          <div className="pt-2 flex gap-3">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                loading ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword ||
                newPassword !== confirmPassword
              }
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Changing...
                </>
              ) : (
                'Change Password'
              )}
            </Button>
          </div>
        </form>

        <p className="mt-4 text-xs text-text-muted text-center">
          You will be logged out of all sessions after changing your password.
        </p>
      </div>
    </div>
  );
}
