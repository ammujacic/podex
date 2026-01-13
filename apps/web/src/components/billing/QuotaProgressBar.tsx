import type { Quota } from '@/lib/api';
import { cn } from '@/lib/utils';

interface QuotaProgressBarProps {
  quota: Quota;
  showLabel?: boolean;
  showDetails?: boolean;
  height?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function QuotaProgressBar({
  quota,
  showLabel = true,
  showDetails = true,
  height = 'md',
  className = '',
}: QuotaProgressBarProps) {
  const heightClasses = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  };

  const getColor = () => {
    if (quota.isExceeded) return 'bg-accent-error';
    if (quota.isWarning) return 'bg-accent-warning';
    return 'bg-accent-success';
  };

  const getTextColor = () => {
    if (quota.isExceeded) return 'text-accent-error';
    if (quota.isWarning) return 'text-accent-warning';
    return 'text-accent-success';
  };

  const formatValue = (value: number): string => {
    // Format large numbers with K/M/B suffixes
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString();
  };

  const getQuotaLabel = (type: string): string => {
    const labels: Record<string, string> = {
      tokens: 'Tokens',
      compute_credits: 'Compute Credits',
      compute_hours: 'Compute Hours',
      storage_gb: 'Storage',
      storage: 'Storage',
      sessions: 'Sessions',
      agents: 'Agents',
      api_calls: 'API Calls',
    };
    return labels[type] || type;
  };

  const getUnit = (type: string): string => {
    const units: Record<string, string> = {
      storage_gb: 'GB',
      storage: 'GB',
    };
    return units[type] || '';
  };

  const formatValueWithUnit = (value: number): string => {
    const formattedValue = formatValue(value);
    const unit = getUnit(quota.quotaType);
    return unit ? `${formattedValue}${unit}` : formattedValue;
  };

  return (
    <div className={cn('space-y-1', className)}>
      {showLabel && (
        <div className="flex justify-between text-sm">
          <span className="font-medium text-text-primary">{getQuotaLabel(quota.quotaType)}</span>
          {showDetails && (
            <span className={cn('font-medium', getTextColor())}>
              {formatValueWithUnit(quota.currentUsage)} / {formatValueWithUnit(quota.limitValue)}
            </span>
          )}
        </div>
      )}
      <div className={cn('w-full bg-overlay rounded-full overflow-hidden', heightClasses[height])}>
        <div
          className={cn(getColor(), heightClasses[height], 'transition-all duration-500 ease-out')}
          style={{ width: `${quota.isExceeded ? 100 : Math.min(quota.usagePercentage, 100)}%` }}
        />
      </div>
      {showDetails && (
        <>
          {quota.isExceeded && (
            <p className="text-xs text-accent-error font-medium">
              Quota exceeded {quota.overageAllowed && '(overage charges apply)'}
            </p>
          )}
          {quota.isWarning && !quota.isExceeded && (
            <p className="text-xs text-accent-warning font-medium">
              {quota.usagePercentage.toFixed(0)}% used - approaching limit
            </p>
          )}
          {!quota.isWarning && !quota.isExceeded && quota.usagePercentage > 50 && (
            <p className="text-xs text-text-muted">{quota.usagePercentage.toFixed(0)}% used</p>
          )}
        </>
      )}
    </div>
  );
}
