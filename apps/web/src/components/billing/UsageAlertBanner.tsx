'use client';

import { AlertTriangle, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export interface QuotaStatus {
  quotaType: string;
  currentUsage: number;
  limitValue: number;
  unit: string;
}

interface UsageAlertBannerProps {
  quotas: QuotaStatus[];
  isOrg?: boolean;
  dismissable?: boolean;
}

const ALERT_THRESHOLD = 0.9; // 90%

function formatQuotaType(quotaType: string): string {
  switch (quotaType) {
    case 'tokens':
      return 'Tokens';
    case 'compute_credits':
      return 'Compute Credits';
    case 'storage':
      return 'Storage';
    case 'sessions':
      return 'Sessions';
    default:
      return quotaType.charAt(0).toUpperCase() + quotaType.slice(1).replace('_', ' ');
  }
}

export function UsageAlertBanner({ quotas, isOrg, dismissable = true }: UsageAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Filter quotas that are at or above the threshold
  const criticalQuotas = quotas.filter((q) => {
    if (!q.limitValue || q.limitValue <= 0) return false;
    const percentage = q.currentUsage / q.limitValue;
    return percentage >= ALERT_THRESHOLD;
  });

  if (criticalQuotas.length === 0) return null;

  // Separate exceeded (100%+) and warning (90-99%)
  const exceededQuotas = criticalQuotas.filter((q) => q.currentUsage >= q.limitValue);
  const warningQuotas = criticalQuotas.filter((q) => q.currentUsage < q.limitValue);

  const hasExceeded = exceededQuotas.length > 0;

  const quotaNames = criticalQuotas.map((q) => formatQuotaType(q.quotaType)).join(', ');
  const usageLink = isOrg ? '/settings/organization/usage' : '/settings/usage';

  return (
    <div
      className={`${
        hasExceeded
          ? 'bg-accent-error/10 border-b border-accent-error text-accent-error'
          : 'bg-accent-warning/10 border-b border-accent-warning text-accent-warning'
      } px-4 py-2 text-sm flex items-center justify-between`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span>
          {isOrg ? 'Organization' : 'You'}{' '}
          {hasExceeded ? (
            <>
              <strong>exceeded</strong> limit on:{' '}
              {exceededQuotas.map((q) => formatQuotaType(q.quotaType)).join(', ')}
              {warningQuotas.length > 0 && (
                <>
                  {' '}
                  and approaching limit on:{' '}
                  {warningQuotas.map((q) => formatQuotaType(q.quotaType)).join(', ')}
                </>
              )}
            </>
          ) : (
            <>approaching limit on: {quotaNames}</>
          )}
        </span>
        <Link href={usageLink} className="underline ml-2 hover:no-underline">
          View Usage
        </Link>
        {!isOrg && (
          <Link href="/settings/billing/plans" className="underline ml-2 hover:no-underline">
            Upgrade
          </Link>
        )}
      </div>
      {dismissable && (
        <button
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
