'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CreditCard, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreditExhaustedBannerProps {
  /** Type of quota that was exceeded */
  type?: 'tokens' | 'compute' | 'credits' | 'general';
  /** Custom message to display */
  message?: string;
  /** Whether the banner can be dismissed */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Additional className */
  className?: string;
}

export function CreditExhaustedBanner({
  type = 'general',
  message,
  dismissible = true,
  onDismiss,
  size = 'md',
  className,
}: CreditExhaustedBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  if (isDismissed) return null;

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  const getDefaultMessage = () => {
    switch (type) {
      case 'tokens':
        return "You've exceeded your token quota for this billing period.";
      case 'compute':
        return "You've exceeded your compute credits quota.";
      case 'credits':
        return "You've run out of credits. Add more to continue using agents.";
      default:
        return "You've run out of credits. Add credits or upgrade your plan to continue.";
    }
  };

  const displayMessage = message || getDefaultMessage();

  const Icon = type === 'tokens' ? Zap : type === 'compute' ? Zap : CreditCard;

  return (
    <div
      className={cn(
        'rounded-lg border',
        'bg-amber-500/10 border-amber-500/30',
        size === 'sm' ? 'p-2' : 'p-3',
        className
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={cn('shrink-0 text-amber-400', size === 'sm' ? 'h-4 w-4' : 'h-5 w-5 mt-0.5')}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('text-amber-200 font-medium', size === 'sm' ? 'text-xs' : 'text-sm')}>
              {displayMessage}
            </p>
            {dismissible && (
              <button
                onClick={handleDismiss}
                className="shrink-0 p-1 rounded hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className={cn('flex gap-2 flex-wrap', size === 'sm' ? 'mt-1.5' : 'mt-2')}>
            <Link
              href="/settings/billing/credits"
              className={cn(
                'inline-flex items-center gap-1 rounded font-medium transition-colors',
                'bg-amber-500 hover:bg-amber-600 text-white',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs'
              )}
            >
              <Icon className="h-3 w-3" />
              Buy Credits
            </Link>
            <Link
              href="/settings/billing/plans"
              className={cn(
                'inline-flex items-center gap-1 rounded font-medium transition-colors',
                'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-xs'
              )}
            >
              Upgrade Plan
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
