'use client';

import { useState } from 'react';
import { Download, X, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePWAStore } from '@/stores/pwa';

interface InstallBannerProps {
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional className */
  className?: string;
}

export function InstallBanner({ size = 'md', className }: InstallBannerProps) {
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  const {
    isIOS,
    shouldShowInstallBanner,
    shouldShowIOSInstructions,
    dismissInstallPrompt,
    dismissIOSInstructions,
    openIOSModal,
    triggerInstall,
  } = usePWAStore();

  // Show for Chrome/Edge/Samsung or iOS (with different actions)
  const showBanner = shouldShowInstallBanner() || shouldShowIOSInstructions();

  if (!showBanner) return null;

  const handleDismiss = () => {
    setIsAnimatingOut(true);
    setTimeout(() => {
      if (isIOS) {
        dismissIOSInstructions();
      } else {
        dismissInstallPrompt();
      }
    }, 200);
  };

  const handleInstall = async () => {
    if (isIOS) {
      // Open iOS instructions modal
      openIOSModal();
    } else {
      // Trigger native install prompt
      await triggerInstall();
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border transition-all duration-200',
        'bg-accent-primary/10 border-accent-primary/30',
        size === 'sm' ? 'p-2' : 'p-3',
        isAnimatingOut && 'opacity-0 -translate-y-2',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg bg-accent-primary/20',
            size === 'sm' ? 'h-7 w-7' : 'h-9 w-9'
          )}
        >
          {isIOS ? (
            <Smartphone
              className={cn('text-accent-primary', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            />
          ) : (
            <Download
              className={cn('text-accent-primary', size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4')}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p
                className={cn(
                  'font-medium text-text-primary',
                  size === 'sm' ? 'text-xs' : 'text-sm'
                )}
              >
                Install Podex
              </p>
              <p
                className={cn('text-text-muted', size === 'sm' ? 'text-[10px]' : 'text-xs mt-0.5')}
              >
                {isIOS
                  ? 'Add to your home screen for the best experience'
                  : 'Add to your device for quick access and offline support'}
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="shrink-0 p-1 rounded hover:bg-accent-primary/20 text-text-muted hover:text-text-primary transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className={cn('flex gap-2 flex-wrap', size === 'sm' ? 'mt-1.5' : 'mt-2')}>
            <button
              onClick={handleInstall}
              className={cn(
                'inline-flex items-center gap-1.5 rounded font-medium transition-colors',
                'bg-accent-primary hover:bg-accent-primary/90 text-white',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-xs'
              )}
            >
              {isIOS ? (
                <>
                  <Smartphone className="h-3 w-3" />
                  How to Install
                </>
              ) : (
                <>
                  <Download className="h-3 w-3" />
                  Install App
                </>
              )}
            </button>
            <button
              onClick={handleDismiss}
              className={cn(
                'inline-flex items-center gap-1 rounded font-medium transition-colors',
                'bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-xs'
              )}
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
