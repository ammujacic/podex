'use client';

import { useEffect } from 'react';
import { X, Share, Plus, CheckCircle, Smartphone } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { usePWAStore } from '@/stores/pwa';

export function IOSInstallModal() {
  const { showIOSModal, closeIOSModal, dismissIOSInstructions } = usePWAStore();
  const modalRef = useFocusTrap<HTMLDivElement>(showIOSModal);

  // Handle escape key
  useEffect(() => {
    if (!showIOSModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeIOSModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showIOSModal, closeIOSModal]);

  if (!showIOSModal) return null;

  const handleDone = () => {
    dismissIOSInstructions();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={closeIOSModal}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-install-title"
        aria-describedby="ios-install-description"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Smartphone className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="ios-install-title" className="text-lg font-semibold text-text-primary">
                Install Podex
              </h2>
              <p id="ios-install-description" className="text-sm text-text-muted">
                Add to your home screen
              </p>
            </div>
          </div>
          <button
            onClick={closeIOSModal}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-text-secondary">
            Install Podex on your device for the best experience with offline access and quick
            launch from your home screen.
          </p>

          <div className="space-y-3">
            {/* Step 1 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-elevated">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <Share className="h-4 w-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">1. Tap Share</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Tap the{' '}
                  <span className="inline-flex items-center align-middle mx-0.5 px-1 py-0.5 bg-blue-500/10 rounded text-blue-400">
                    <Share className="h-3 w-3" />
                  </span>{' '}
                  button in Safari&apos;s toolbar at the bottom of your screen
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-elevated">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
                <Plus className="h-4 w-4 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">2. Add to Home Screen</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Scroll down in the share menu and tap{' '}
                  <span className="font-medium text-text-secondary">
                    &quot;Add to Home Screen&quot;
                  </span>
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-elevated">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
                <CheckCircle className="h-4 w-4 text-accent-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">3. Confirm</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Tap <span className="font-medium text-text-secondary">&quot;Add&quot;</span> in
                  the top right corner to install Podex
                </p>
              </div>
            </div>
          </div>

          {/* Note */}
          <p className="text-xs text-text-muted">
            After installation, you can launch Podex directly from your home screen. The app will
            work offline and provide a native app experience.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-border-subtle px-6 py-4 gap-3">
          <button
            onClick={closeIOSModal}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDone}
            className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
