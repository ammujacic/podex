'use client';

import { useState } from 'react';
import { X, Loader2, Copy, Download, Check, Shield, Smartphone, Key } from 'lucide-react';
import { cn } from '@/lib/utils';
import { setupMFA, verifyMFASetup, type MFASetupResponse } from '@/lib/api';
import { toast } from 'sonner';

interface MFASetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'scan' | 'verify' | 'backup';

export function MFASetupModal({ isOpen, onClose, onSuccess }: MFASetupModalProps) {
  const [step, setStep] = useState<Step>('scan');
  const [setupData, setSetupData] = useState<MFASetupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [savedCodes, setSavedCodes] = useState(false);

  // Initialize setup on mount
  const initSetup = async () => {
    if (setupData) return;
    setLoading(true);
    try {
      const data = await setupMFA();
      setSetupData(data);
    } catch {
      toast.error('Failed to initialize MFA setup');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  // Start setup when modal opens
  if (isOpen && !setupData && !loading) {
    initSetup();
  }

  const handleVerify = async () => {
    if (!verifyCode || verifyCode.length < 6) {
      setVerifyError('Please enter a 6-digit code');
      return;
    }

    setLoading(true);
    setVerifyError(null);

    try {
      await verifyMFASetup(verifyCode);
      setStep('backup');
    } catch {
      setVerifyError('Invalid verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCodes = async () => {
    if (!setupData) return;
    const codesText = setupData.backup_codes.join('\n');
    await navigator.clipboard.writeText(codesText);
    setCopiedCodes(true);
    toast.success('Backup codes copied to clipboard');
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const handleDownloadCodes = () => {
    if (!setupData) return;
    const codesText = `Podex MFA Backup Codes\n${'='.repeat(30)}\n\nKeep these codes safe. Each code can only be used once.\n\n${setupData.backup_codes.join('\n')}\n\nGenerated: ${new Date().toISOString()}`;
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

  const handleComplete = () => {
    if (!savedCodes) {
      toast.error('Please confirm you have saved your backup codes');
      return;
    }
    onSuccess();
    onClose();
    // Reset state for next time
    setStep('scan');
    setSetupData(null);
    setVerifyCode('');
    setSavedCodes(false);
  };

  const handleClose = () => {
    // Don't allow closing during backup step (codes are generated)
    if (step === 'backup') {
      toast.error('Please save your backup codes before closing');
      return;
    }
    onClose();
    // Reset state
    setStep('scan');
    setSetupData(null);
    setVerifyCode('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border-subtle bg-gradient-to-r from-accent-primary/10 to-green-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Set Up Two-Factor Authentication
                </h3>
                <p className="text-sm text-text-muted">
                  {step === 'scan' && 'Step 1: Scan QR code'}
                  {step === 'verify' && 'Step 2: Verify code'}
                  {step === 'backup' && 'Step 3: Save backup codes'}
                </p>
              </div>
            </div>
            {step !== 'backup' && (
              <button
                onClick={handleClose}
                className="p-2 hover:bg-elevated rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading && !setupData ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
          ) : step === 'scan' ? (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-text-secondary mb-4">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy,
                  1Password, etc.)
                </p>
                {setupData?.qr_code_base64 && (
                  <div className="inline-block p-4 bg-white rounded-lg">
                    <img
                      src={`data:image/png;base64,${setupData.qr_code_base64}`}
                      alt="MFA QR Code"
                      className="w-48 h-48"
                    />
                  </div>
                )}
              </div>

              {/* Manual entry */}
              <div className="p-4 bg-elevated rounded-lg">
                <p className="text-sm text-text-muted mb-2 flex items-center gap-2">
                  <Key className="w-4 h-4" />
                  Can&apos;t scan? Enter this code manually:
                </p>
                <code className="block text-sm font-mono text-text-primary bg-surface px-3 py-2 rounded border border-border-subtle break-all">
                  {setupData?.secret}
                </code>
              </div>

              <button
                onClick={() => setStep('verify')}
                className="w-full py-3 px-4 bg-accent-primary text-text-inverse rounded-lg font-medium hover:bg-accent-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <Smartphone className="w-5 h-5" />
                I&apos;ve scanned the code
              </button>
            </div>
          ) : step === 'verify' ? (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-text-secondary mb-6">
                  Enter the 6-digit code from your authenticator app to verify setup.
                </p>
              </div>

              <div>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerifyCode(val);
                    setVerifyError(null);
                  }}
                  placeholder="000000"
                  maxLength={6}
                  className={cn(
                    'w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em]',
                    'bg-elevated border rounded-lg',
                    'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                    verifyError ? 'border-red-500' : 'border-border-subtle'
                  )}
                  autoFocus
                />
                {verifyError && (
                  <p className="mt-2 text-sm text-red-400 text-center">{verifyError}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('scan')}
                  className="flex-1 py-3 px-4 border border-border-subtle text-text-secondary rounded-lg font-medium hover:bg-elevated transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleVerify}
                  disabled={loading || verifyCode.length < 6}
                  className="flex-1 py-3 px-4 bg-accent-primary text-text-inverse rounded-lg font-medium hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Check className="w-5 h-5" />
                      Verify
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-400 text-sm font-medium mb-1">
                  Save these backup codes now!
                </p>
                <p className="text-text-muted text-sm">
                  These codes can be used to access your account if you lose your authenticator.
                  Each code can only be used once.
                </p>
              </div>

              {/* Backup codes grid */}
              <div className="grid grid-cols-2 gap-2 p-4 bg-elevated rounded-lg font-mono text-sm">
                {setupData?.backup_codes.map((code, i) => (
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

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 p-4 bg-elevated rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={savedCodes}
                  onChange={(e) => setSavedCodes(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-border-subtle bg-surface text-accent-primary focus:ring-accent-primary"
                />
                <span className="text-sm text-text-secondary">
                  I have saved these backup codes in a safe place
                </span>
              </label>

              <button
                onClick={handleComplete}
                disabled={!savedCodes}
                className="w-full py-3 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Shield className="w-5 h-5" />
                Complete Setup
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
