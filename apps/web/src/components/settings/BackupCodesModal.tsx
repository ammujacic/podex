'use client';

import { useState } from 'react';
import { X, Loader2, Copy, Download, Check, Key, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { regenerateBackupCodes } from '@/lib/api';
import { toast } from 'sonner';

interface BackupCodesModalProps {
  isOpen: boolean;
  onClose: () => void;
  backupCodesRemaining: number;
  onRegenerate: () => void;
}

export function BackupCodesModal({
  isOpen,
  onClose,
  backupCodesRemaining,
  onRegenerate,
}: BackupCodesModalProps) {
  const [mode, setMode] = useState<'info' | 'regenerate' | 'codes'>('info');
  const [verifyCode, setVerifyCode] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleRegenerate = async () => {
    if (!verifyCode || verifyCode.length < 6) {
      setError('Please enter a 6-digit code from your authenticator app');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await regenerateBackupCodes(verifyCode);
      setNewCodes(result.backup_codes);
      setMode('codes');
      onRegenerate();
    } catch {
      setError('Invalid verification code. Please use your authenticator app.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCodes = async () => {
    const codesText = newCodes.join('\n');
    await navigator.clipboard.writeText(codesText);
    setCopiedCodes(true);
    toast.success('Backup codes copied to clipboard');
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const handleDownloadCodes = () => {
    const codesText = `Podex MFA Backup Codes\n${'='.repeat(30)}\n\nKeep these codes safe. Each code can only be used once.\n\n${newCodes.join('\n')}\n\nGenerated: ${new Date().toISOString()}`;
    const blob = new Blob([codesText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'podex-backup-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Backup codes downloaded');
  };

  const handleClose = () => {
    onClose();
    // Reset state after a delay
    setTimeout(() => {
      setMode('info');
      setVerifyCode('');
      setNewCodes([]);
      setError(null);
    }, 200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
                <Key className="w-5 h-5 text-accent-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Backup Codes</h3>
                <p className="text-sm text-text-muted">
                  {mode === 'info' && `${backupCodesRemaining} codes remaining`}
                  {mode === 'regenerate' && 'Verify to regenerate codes'}
                  {mode === 'codes' && 'Save your new codes'}
                </p>
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
        <div className="p-6">
          {mode === 'info' ? (
            <div className="space-y-6">
              <div className="p-4 bg-elevated rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-text-secondary">Backup codes remaining</span>
                  <span
                    className={cn(
                      'text-2xl font-bold',
                      backupCodesRemaining <= 2 ? 'text-red-400' : 'text-text-primary'
                    )}
                  >
                    {backupCodesRemaining}
                  </span>
                </div>
                <div className="w-full bg-surface rounded-full h-2">
                  <div
                    className={cn(
                      'h-2 rounded-full transition-all',
                      backupCodesRemaining <= 2 ? 'bg-red-500' : 'bg-green-500'
                    )}
                    style={{ width: `${(backupCodesRemaining / 10) * 100}%` }}
                  />
                </div>
              </div>

              {backupCodesRemaining <= 3 && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-yellow-400 text-sm font-medium">Low backup codes</p>
                    <p className="text-text-muted text-sm">
                      Consider regenerating your backup codes to ensure you don&apos;t get locked
                      out.
                    </p>
                  </div>
                </div>
              )}

              <div className="text-text-secondary text-sm">
                <p className="mb-2">Backup codes can be used to access your account if you:</p>
                <ul className="list-disc list-inside space-y-1 text-text-muted">
                  <li>Lose your phone</li>
                  <li>Can&apos;t access your authenticator app</li>
                  <li>Get a new phone</li>
                </ul>
              </div>

              <button
                onClick={() => setMode('regenerate')}
                className="w-full py-3 px-4 bg-accent-primary text-text-inverse rounded-lg font-medium hover:bg-accent-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-5 h-5" />
                Regenerate Codes
              </button>

              <p className="text-xs text-text-muted text-center">
                Regenerating will invalidate all existing backup codes
              </p>
            </div>
          ) : mode === 'regenerate' ? (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-400 text-sm font-medium mb-1">Warning</p>
                <p className="text-text-muted text-sm">
                  This will invalidate all your existing backup codes. Make sure you can access your
                  authenticator app.
                </p>
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Enter code from authenticator app
                </label>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerifyCode(val);
                    setError(null);
                  }}
                  placeholder="000000"
                  maxLength={6}
                  className={cn(
                    'w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em]',
                    'bg-elevated border rounded-lg',
                    'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                    error ? 'border-red-500' : 'border-border-subtle'
                  )}
                  autoFocus
                />
                <p className="mt-2 text-xs text-text-muted text-center">
                  Backup codes cannot be used for this action
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setMode('info');
                    setVerifyCode('');
                    setError(null);
                  }}
                  className="flex-1 py-3 px-4 border border-border-subtle text-text-secondary rounded-lg font-medium hover:bg-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={loading || verifyCode.length < 6}
                  className="flex-1 py-3 px-4 bg-accent-primary text-text-inverse rounded-lg font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="w-5 h-5" />
                      Regenerate
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-green-400 text-sm font-medium mb-1">New codes generated!</p>
                <p className="text-text-muted text-sm">
                  Save these codes now. You won&apos;t be able to see them again.
                </p>
              </div>

              {/* Backup codes grid */}
              <div className="grid grid-cols-2 gap-2 p-4 bg-elevated rounded-lg font-mono text-sm">
                {newCodes.map((code, i) => (
                  <div
                    key={i}
                    className="px-3 py-2 bg-surface rounded border border-border-subtle text-center text-text-primary"
                  >
                    {code}
                  </div>
                ))}
              </div>

              {/* Copy/Download buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleCopyCodes}
                  className="flex-1 py-2.5 px-4 border border-border-subtle text-text-secondary rounded-lg font-medium hover:bg-elevated transition-colors flex items-center justify-center gap-2"
                >
                  {copiedCodes ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copiedCodes ? 'Copied!' : 'Copy All'}
                </button>
                <button
                  onClick={handleDownloadCodes}
                  className="flex-1 py-2.5 px-4 border border-border-subtle text-text-secondary rounded-lg font-medium hover:bg-elevated transition-colors flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>

              <button
                onClick={handleClose}
                className="w-full py-3 px-4 bg-accent-primary text-text-inverse rounded-lg font-medium hover:bg-accent-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
