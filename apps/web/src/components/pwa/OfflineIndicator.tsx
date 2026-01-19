'use client';

import { WifiOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePWAStore } from '@/stores/pwa';

export function OfflineIndicator() {
  const { isOnline, hasPendingSync } = usePWAStore();

  // Don't show if online and no pending sync
  if (isOnline && !hasPendingSync) return null;

  return (
    <div
      className={cn(
        'fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 px-4 py-2 rounded-full',
        'border shadow-lg backdrop-blur-sm',
        'transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
        !isOnline
          ? 'bg-red-500/10 border-red-500/30 text-red-400'
          : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
      )}
      role="status"
      aria-live="polite"
    >
      {!isOnline ? (
        <>
          <WifiOff className="h-4 w-4" />
          <span className="text-sm font-medium">You&apos;re offline</span>
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Syncing changes...</span>
        </>
      )}
    </div>
  );
}
