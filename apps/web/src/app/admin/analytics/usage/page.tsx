'use client';

import { useEffect, useState } from 'react';
import { Zap, Cpu, HardDrive, Activity, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

interface DateRangeSelectorProps {
  value: number;
  onChange: (days: number) => void;
}

function DateRangeSelector({ value, onChange }: DateRangeSelectorProps) {
  const options = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
    { label: '1 year', value: 365 },
  ];

  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-colors',
            value === option.value
              ? 'bg-accent-primary text-white'
              : 'bg-elevated text-text-secondary hover:text-text-primary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface BarChartProps {
  data: Array<{ label: string; value: number }>;
  maxValue?: number;
  formatValue?: (value: number) => string;
  barColor?: string;
}

function SimpleBarChart({
  data,
  maxValue,
  formatValue = (v) => v.toString(),
  barColor = 'bg-accent-primary',
}: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value));

  return (
    <div className="space-y-3">
      {data.map((item, i) => (
        <div key={i} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">{item.label}</span>
            <span className="text-text-primary font-medium">{formatValue(item.value)}</span>
          </div>
          <div className="h-2 bg-elevated rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', barColor)}
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface DailyChartProps {
  data: Array<{ date: string; tokens: number }>;
}

function DailyUsageChart({ data }: DailyChartProps) {
  const maxTokens = Math.max(...data.map((d) => d.tokens));
  const totalTokens = data.reduce((sum, d) => sum + d.tokens, 0);
  const avgTokens = totalTokens / data.filter((d) => d.tokens > 0).length || 0;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Debug: Uncomment to see chart rendering data
  // console.log('DailyUsageChart rendering:', {
  //   dataLength: data.length,
  //   data: data,
  //   maxTokens,
  // });

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-text-muted">No data available</div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
  };

  // Determine which dates to show as labels (show ~5-7 labels max)
  const labelInterval = Math.max(1, Math.floor(data.length / 6));
  const shouldShowLabel = (index: number) => {
    return index === 0 || index === data.length - 1 || index % labelInterval === 0;
  };

  return (
    <div className="space-y-4">
      {/* Hover info display */}
      <div className="h-20 flex items-center justify-center border-b border-border-subtle pb-4">
        {hoveredIndex !== null && data[hoveredIndex] ? (
          <div className="text-center space-y-1">
            <div className="text-3xl font-bold text-yellow-500">
              {formatNumber(data[hoveredIndex].tokens)}
            </div>
            <div className="text-sm text-text-primary font-medium">
              {formatDate(data[hoveredIndex].date)}
            </div>
            <div className="text-xs text-text-muted flex items-center justify-center gap-3">
              <span>
                {totalTokens > 0 ? ((data[hoveredIndex].tokens / totalTokens) * 100).toFixed(1) : 0}
                % of total
              </span>
              <span>•</span>
              <span>
                {data[hoveredIndex].tokens > avgTokens
                  ? `${(((data[hoveredIndex].tokens - avgTokens) / avgTokens) * 100).toFixed(0)}% above avg`
                  : `${(((avgTokens - data[hoveredIndex].tokens) / avgTokens) * 100).toFixed(0)}% below avg`}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-1">
            <div className="text-3xl font-bold text-text-primary">{formatNumber(totalTokens)}</div>
            <div className="text-sm text-text-muted">
              Total tokens • Avg {formatNumber(Math.round(avgTokens))}/day
            </div>
            <div className="text-xs text-text-muted">Hover over bars for details</div>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative">
        <div className="h-56 flex items-end gap-1 relative">
          {data.map((item, i) => {
            const heightPercent = maxTokens > 0 ? (item.tokens / maxTokens) * 100 : 0;
            const isHovered = hoveredIndex === i;
            const hasData = item.tokens > 0;
            const isAboveAvg = item.tokens > avgTokens;

            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center justify-end gap-1 h-full group relative"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Bar */}
                <div
                  className={cn(
                    'w-full rounded-t transition-all duration-200 cursor-pointer relative',
                    hasData
                      ? isHovered
                        ? 'bg-yellow-400 shadow-lg scale-105'
                        : isAboveAvg
                          ? 'bg-yellow-500 hover:bg-yellow-400'
                          : 'bg-yellow-600 hover:bg-yellow-500'
                      : 'bg-elevated'
                  )}
                  style={{
                    height: `${Math.max(heightPercent, hasData ? 2 : 0)}%`,
                    minHeight: hasData ? '6px' : '0px',
                  }}
                >
                  {/* Token count label on bar (show for larger bars or on hover) */}
                  {hasData && (heightPercent > 20 || isHovered) && (
                    <div
                      className={cn(
                        'absolute inset-x-0 top-2 text-center text-[10px] font-bold transition-all duration-200',
                        isHovered
                          ? 'text-yellow-900 opacity-100 scale-110'
                          : 'text-yellow-900 opacity-60'
                      )}
                      style={{
                        writingMode: data.length > 30 ? 'vertical-rl' : 'horizontal-tb',
                        transform: data.length > 30 ? 'rotate(180deg)' : undefined,
                      }}
                    >
                      {formatNumber(item.tokens)}
                    </div>
                  )}

                  {/* Hover indicator */}
                  {isHovered && (
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Date labels */}
        <div className="flex items-start gap-1 mt-2">
          {data.map((item, i) => (
            <div key={i} className="flex-1 flex justify-center">
              {shouldShowLabel(i) && (
                <span className="text-[10px] text-text-muted transform -rotate-45 origin-top-left whitespace-nowrap">
                  {formatDateShort(item.date)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function UsageAnalytics() {
  const [days, setDays] = useState(7);
  const { usageMetrics, analyticsLoading, fetchUsageMetrics, error } = useAdminStore();

  useEffect(() => {
    fetchUsageMetrics(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (analyticsLoading && !usageMetrics) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Usage Analytics</h1>
        <div className="animate-pulse space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-surface rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-surface rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Usage Analytics</h1>
          <p className="text-text-muted mt-1">Platform usage metrics and trends</p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-8 flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Error loading usage metrics: {error}
        </div>
      )}

      {usageMetrics && (
        <div className="space-y-8">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-5 w-5 text-yellow-500" />
                <span className="text-text-muted text-sm">Total Tokens</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {formatNumber(usageMetrics.total_tokens)}
              </p>
              <p className="text-text-muted text-sm mt-2">
                {formatNumber(usageMetrics.input_tokens)} in /{' '}
                {formatNumber(usageMetrics.output_tokens)} out
              </p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="h-5 w-5 text-blue-500" />
                <span className="text-text-muted text-sm">Compute Hours</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {usageMetrics.total_compute_hours.toFixed(1)}
              </p>
              <p className="text-text-muted text-sm mt-2">Total compute time</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <HardDrive className="h-5 w-5 text-purple-500" />
                <span className="text-text-muted text-sm">Storage Used</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {usageMetrics.total_storage_gb.toFixed(1)} GB
              </p>
              <p className="text-text-muted text-sm mt-2">Across all users</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="h-5 w-5 text-green-500" />
                <span className="text-text-muted text-sm">Input/Output Ratio</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {usageMetrics.input_tokens > 0
                  ? (usageMetrics.output_tokens / usageMetrics.input_tokens).toFixed(2)
                  : '0'}
              </p>
              <p className="text-text-muted text-sm mt-2">Output per input token</p>
            </div>
          </div>

          {/* Daily Usage Chart */}
          {usageMetrics.daily_usage.length > 0 && (
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">Daily Token Usage</h2>
                  <p className="text-sm text-text-muted mt-1">
                    Usage trends over the selected time period
                  </p>
                </div>
                {/* Top model and provider badges */}
                <div className="flex flex-wrap gap-2">
                  {usageMetrics.tokens_by_model.length > 0 && usageMetrics.tokens_by_model[0] && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated rounded-lg">
                      <span className="text-xs text-text-muted">Top Model:</span>
                      <span className="text-xs font-semibold text-yellow-500">
                        {usageMetrics.tokens_by_model[0].model}
                      </span>
                      <span className="text-xs text-text-muted">
                        ({formatNumber(usageMetrics.tokens_by_model[0].tokens)})
                      </span>
                    </div>
                  )}
                  {usageMetrics.tokens_by_provider.length > 0 &&
                    usageMetrics.tokens_by_provider[0] && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-elevated rounded-lg">
                        <span className="text-xs text-text-muted">Top Provider:</span>
                        <span className="text-xs font-semibold text-blue-500">
                          {usageMetrics.tokens_by_provider[0].provider}
                        </span>
                        <span className="text-xs text-text-muted">
                          ({formatNumber(usageMetrics.tokens_by_provider[0].tokens)})
                        </span>
                      </div>
                    )}
                </div>
              </div>
              <DailyUsageChart data={usageMetrics.daily_usage} />
            </div>
          )}

          {/* Token Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Tokens by Model</h2>
              {usageMetrics.tokens_by_model.length > 0 ? (
                <SimpleBarChart
                  data={usageMetrics.tokens_by_model.slice(0, 8).map((m) => ({
                    label: m.model,
                    value: m.tokens,
                  }))}
                  formatValue={(v) => formatNumber(v)}
                  barColor="bg-yellow-500"
                />
              ) : (
                <p className="text-text-muted">No model usage data available</p>
              )}
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Tokens by Provider</h2>
              {usageMetrics.tokens_by_provider.length > 0 ? (
                <SimpleBarChart
                  data={usageMetrics.tokens_by_provider.map((p) => ({
                    label: p.provider,
                    value: p.tokens,
                  }))}
                  formatValue={(v) => formatNumber(v)}
                  barColor="bg-blue-500"
                />
              ) : (
                <p className="text-text-muted">No provider usage data available</p>
              )}
            </div>
          </div>

          {/* Compute Breakdown */}
          <div className="bg-surface rounded-xl p-6 border border-border-subtle">
            <h2 className="text-lg font-semibold text-text-primary mb-6">
              Compute Usage by Instance Type
            </h2>
            {usageMetrics.compute_by_tier.length > 0 ? (
              <div className="space-y-3">
                {usageMetrics.compute_by_tier.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 bg-elevated rounded-xl"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 font-bold text-sm">
                        {i + 1}
                      </div>
                      <span className="text-text-primary font-medium">{item.tier}</span>
                    </div>
                    <span className="text-2xl font-bold text-text-primary">
                      {item.minutes.toFixed(1)} min
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-muted">No compute usage data available</p>
            )}
          </div>

          {/* Token Split */}
          <div className="bg-surface rounded-xl p-6 border border-border-subtle">
            <h2 className="text-lg font-semibold text-text-primary mb-6">Token Distribution</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Input Tokens</p>
                <p className="text-4xl font-bold text-blue-500">
                  {formatNumber(usageMetrics.input_tokens)}
                </p>
                <p className="text-text-muted text-xs mt-2">
                  {((usageMetrics.input_tokens / usageMetrics.total_tokens) * 100).toFixed(1)}% of
                  total
                </p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Output Tokens</p>
                <p className="text-4xl font-bold text-green-500">
                  {formatNumber(usageMetrics.output_tokens)}
                </p>
                <p className="text-text-muted text-xs mt-2">
                  {((usageMetrics.output_tokens / usageMetrics.total_tokens) * 100).toFixed(1)}% of
                  total
                </p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Total Tokens</p>
                <p className="text-4xl font-bold text-text-primary">
                  {formatNumber(usageMetrics.total_tokens)}
                </p>
                <p className="text-text-muted text-xs mt-2">Combined usage</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
