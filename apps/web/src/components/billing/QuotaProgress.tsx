'use client';

interface QuotaProgressProps {
  label: string;
  current: number;
  limit: number;
  unit?: string;
  showPercentage?: boolean;
  warningThreshold?: number;
  criticalThreshold?: number;
}

export function QuotaProgress({
  label,
  current,
  limit,
  unit = '',
  showPercentage = true,
  warningThreshold = 80,
  criticalThreshold = 95,
}: QuotaProgressProps) {
  const percentage = limit > 0 ? (current / limit) * 100 : 0;
  const isWarning = percentage >= warningThreshold && percentage < criticalThreshold;
  const isCritical = percentage >= criticalThreshold;
  const isExceeded = percentage >= 100;

  const getBarColor = () => {
    if (isExceeded) return 'bg-red-600';
    if (isCritical) return 'bg-red-500';
    if (isWarning) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getTextColor = () => {
    if (isExceeded) return 'text-red-400';
    if (isCritical) return 'text-red-400';
    if (isWarning) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const formatValue = (value: number) => {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toLocaleString();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-300">{label}</span>
        <span className={`text-sm font-medium ${getTextColor()}`}>
          {formatValue(current)}
          {unit && ` ${unit}`}
          <span className="text-neutral-500">
            {' '}
            / {formatValue(limit)}
            {unit && ` ${unit}`}
          </span>
        </span>
      </div>

      <div className="relative h-2 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${getBarColor()}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
        {isExceeded && (
          <div
            className="absolute inset-y-0 bg-red-500/30 animate-pulse"
            style={{ left: '100%', width: `${percentage - 100}%` }}
          />
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        {showPercentage && (
          <span className={`${getTextColor()}`}>{percentage.toFixed(1)}% used</span>
        )}
        {isExceeded && <span className="text-red-400 font-medium">Limit exceeded!</span>}
        {isCritical && !isExceeded && (
          <span className="text-red-400 font-medium">Almost at limit</span>
        )}
        {isWarning && !isCritical && (
          <span className="text-amber-400 font-medium">Approaching limit</span>
        )}
      </div>
    </div>
  );
}

interface QuotaCardProps {
  quotas: Array<{
    type: string;
    label: string;
    current: number;
    limit: number;
    unit?: string;
  }>;
}

export function QuotaCard({ quotas }: QuotaCardProps) {
  return (
    <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Usage Quotas</h3>
      <div className="space-y-6">
        {quotas.map((quota) => (
          <QuotaProgress
            key={quota.type}
            label={quota.label}
            current={quota.current}
            limit={quota.limit}
            unit={quota.unit}
          />
        ))}
      </div>
    </div>
  );
}
