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

  return (
    <div className="h-48 flex items-end gap-1">
      {data.map((item, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-yellow-500 rounded-t transition-all hover:bg-yellow-400"
            style={{ height: `${maxTokens > 0 ? (item.tokens / maxTokens) * 100 : 0}%` }}
            title={`${item.date}: ${formatNumber(item.tokens)} tokens`}
          />
        </div>
      ))}
    </div>
  );
}

export default function UsageAnalytics() {
  const [days, setDays] = useState(30);
  const { usageMetrics, analyticsLoading, fetchUsageMetrics, error } = useAdminStore();

  useEffect(() => {
    fetchUsageMetrics(days);
  }, [days, fetchUsageMetrics]);

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
              <h2 className="text-lg font-semibold text-text-primary mb-6">Daily Token Usage</h2>
              <DailyUsageChart data={usageMetrics.daily_usage} />
              <div className="flex justify-between text-xs text-text-muted mt-2">
                <span>{usageMetrics.daily_usage[0]?.date}</span>
                <span>{usageMetrics.daily_usage[usageMetrics.daily_usage.length - 1]?.date}</span>
              </div>
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
            <h2 className="text-lg font-semibold text-text-primary mb-6">Compute Usage by Tier</h2>
            {usageMetrics.compute_by_tier.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {usageMetrics.compute_by_tier.map((tier, i) => (
                  <div key={i} className="bg-elevated rounded-xl p-4 text-center">
                    <p className="text-text-muted text-sm mb-2">{tier.tier}</p>
                    <p className="text-2xl font-bold text-text-primary">{tier.hours.toFixed(1)}h</p>
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
