'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { CreditCard, AlertTriangle, X, Zap, HardDrive } from 'lucide-react';
import {
  useBillingStore,
  useQuotaWarnings,
  useQuotaExceeded,
  useQuotaSeverity,
} from '@/stores/billing';
import { cn } from '@/lib/utils';

interface CreditWarningIndicatorProps {
  className?: string;
}

export function CreditWarningIndicator({ className }: CreditWarningIndicatorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const quotaWarnings = useQuotaWarnings();
  const quotaExceeded = useQuotaExceeded();
  const severity = useQuotaSeverity();
  const creditBalance = useBillingStore((state) => state.creditBalance);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [showDropdown]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && showDropdown) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showDropdown]);

  // Don't show if no issues
  if (severity === 'none') return null;

  const allIssues = [...quotaExceeded, ...quotaWarnings];
  const issueCount = allIssues.length;

  const getQuotaIcon = (type: string) => {
    switch (type) {
      case 'tokens':
        return Zap;
      case 'compute_credits':
        return CreditCard;
      case 'storage_gb':
        return HardDrive;
      default:
        return AlertTriangle;
    }
  };

  const getQuotaLabel = (type: string) => {
    switch (type) {
      case 'tokens':
        return 'Token Usage';
      case 'compute_credits':
        return 'Compute Credits';
      case 'storage_gb':
        return 'Storage';
      default:
        return type;
    }
  };

  const formatValue = (type: string, value: number) => {
    if (type === 'compute_credits') {
      return `$${(value / 100).toFixed(2)}`;
    }
    if (type === 'storage_gb') {
      return `${value.toFixed(1)} GB`;
    }
    // Tokens - format with K/M
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
  };

  return (
    <div className={cn('relative', className)} ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        aria-label={`Credit warnings (${issueCount} issue${issueCount !== 1 ? 's' : ''})`}
        aria-expanded={showDropdown}
        aria-haspopup="true"
        className={cn(
          'relative rounded-md p-2 transition-colors',
          severity === 'exceeded'
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-yellow-400 hover:bg-yellow-500/10',
          showDropdown && (severity === 'exceeded' ? 'bg-red-500/10' : 'bg-yellow-500/10')
        )}
      >
        <CreditCard className="h-4 w-4" aria-hidden="true" />
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white',
            severity === 'exceeded' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
          )}
        >
          {issueCount}
        </span>
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div
          className="absolute right-0 top-full mt-1 w-80 bg-surface border border-border-default rounded-xl shadow-xl z-50 overflow-hidden"
          role="dialog"
          aria-label="Credit and quota status"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated">
            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
              <AlertTriangle
                className={cn(
                  'h-4 w-4',
                  severity === 'exceeded' ? 'text-red-400' : 'text-yellow-400'
                )}
              />
              {severity === 'exceeded' ? 'Quota Exceeded' : 'Approaching Limits'}
            </h3>
            <button
              onClick={() => setShowDropdown(false)}
              className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Quota Issues List */}
          <div className="max-h-64 overflow-y-auto p-2 space-y-2">
            {allIssues.map((quota) => {
              const Icon = getQuotaIcon(quota.quotaType);
              const isExceeded = quota.isExceeded;

              return (
                <div
                  key={quota.id}
                  className={cn(
                    'p-3 rounded-lg border',
                    isExceeded
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cn('h-4 w-4', isExceeded ? 'text-red-400' : 'text-yellow-400')}
                      />
                      <span className="text-sm font-medium text-text-primary">
                        {getQuotaLabel(quota.quotaType)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium px-1.5 py-0.5 rounded',
                        isExceeded
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      )}
                    >
                      {isExceeded ? 'Exceeded' : `${quota.usagePercentage.toFixed(0)}%`}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 bg-void rounded-full overflow-hidden mb-1.5">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        isExceeded ? 'bg-red-500' : 'bg-yellow-500'
                      )}
                      style={{ width: `${Math.min(quota.usagePercentage, 100)}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-text-muted">
                    <span>{formatValue(quota.quotaType, quota.currentUsage)} used</span>
                    <span>{formatValue(quota.quotaType, quota.limitValue)} limit</span>
                  </div>
                </div>
              );
            })}

            {/* Credit Balance */}
            {creditBalance && (
              <div className="p-3 rounded-lg bg-elevated border border-border-subtle">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">Credit Balance</span>
                  <span
                    className={cn(
                      'text-sm font-medium',
                      creditBalance.balance < 100
                        ? 'text-red-400'
                        : creditBalance.balance < 500
                          ? 'text-yellow-400'
                          : 'text-text-primary'
                    )}
                  >
                    ${(creditBalance.balance / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="p-3 border-t border-border-subtle bg-elevated flex gap-2">
            <Link
              href="/settings/billing/credits"
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-accent-primary hover:bg-accent-primary/90 text-white transition-colors"
              onClick={() => setShowDropdown(false)}
            >
              <CreditCard className="h-4 w-4" />
              Buy Credits
            </Link>
            <Link
              href="/settings/billing/plans"
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-elevated hover:bg-overlay text-text-primary border border-border-default transition-colors"
              onClick={() => setShowDropdown(false)}
            >
              Upgrade Plan
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
