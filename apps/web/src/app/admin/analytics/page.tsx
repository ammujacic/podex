'use client';

import { useEffect, useState } from 'react';
import { DollarSign, Activity, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

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

export default function AnalyticsOverview() {
  const [days, setDays] = useState(30);
  const {
    revenueMetrics,
    usageMetrics,
    costMetrics,
    analyticsLoading,
    fetchRevenueMetrics,
    fetchUsageMetrics,
    fetchCostMetrics,
    error,
  } = useAdminStore();

  useEffect(() => {
    fetchRevenueMetrics(days);
    fetchUsageMetrics(days);
    fetchCostMetrics(days);
  }, [days, fetchRevenueMetrics, fetchUsageMetrics, fetchCostMetrics]);

  if (analyticsLoading && !revenueMetrics) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Analytics Overview</h1>
        <div className="animate-pulse space-y-8">
          <div className="h-48 bg-surface rounded-xl" />
          <div className="h-48 bg-surface rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Analytics Overview</h1>
          <p className="text-text-muted mt-1">Key metrics and insights</p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-8">
          Error loading analytics: {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Revenue Section */}
        <div className="bg-surface rounded-xl p-6 border border-border-subtle">
          <div className="flex items-center gap-2 mb-6">
            <DollarSign className="h-5 w-5 text-green-500" />
            <h2 className="text-lg font-semibold text-text-primary">Revenue</h2>
          </div>

          {revenueMetrics && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-text-muted text-sm">MRR</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    {formatCurrency(revenueMetrics.mrr_cents)}
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-sm">ARR</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    {formatCurrency(revenueMetrics.arr_cents)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-elevated rounded-lg p-3">
                  <p className="text-text-muted text-xs">ARPU</p>
                  <p className="text-lg font-medium">{formatCurrency(revenueMetrics.arpu_cents)}</p>
                </div>
                <div className="bg-elevated rounded-lg p-3">
                  <p className="text-text-muted text-xs">LTV</p>
                  <p className="text-lg font-medium">{formatCurrency(revenueMetrics.ltv_cents)}</p>
                </div>
                <div className="bg-elevated rounded-lg p-3">
                  <p className="text-text-muted text-xs">NRR</p>
                  <p className="text-lg font-medium">{revenueMetrics.nrr_percent.toFixed(0)}%</p>
                </div>
              </div>

              {revenueMetrics.revenue_by_plan.length > 0 && (
                <div>
                  <p className="text-text-muted text-sm mb-3">Revenue by Plan</p>
                  <SimpleBarChart
                    data={revenueMetrics.revenue_by_plan.map((p) => ({
                      label: `${p.plan} (${p.subscribers})`,
                      value: p.mrr_cents,
                    }))}
                    formatValue={(v) => formatCurrency(v)}
                    barColor="bg-green-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Usage Section */}
        <div className="bg-surface rounded-xl p-6 border border-border-subtle">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="h-5 w-5 text-yellow-500" />
            <h2 className="text-lg font-semibold text-text-primary">Usage</h2>
          </div>

          {usageMetrics && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-text-muted text-sm">Total Tokens</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    {formatNumber(usageMetrics.total_tokens)}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatNumber(usageMetrics.input_tokens)} in /{' '}
                    {formatNumber(usageMetrics.output_tokens)} out
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-sm">Compute Hours</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    {usageMetrics.total_compute_hours.toFixed(1)}
                  </p>
                </div>
              </div>

              {usageMetrics.tokens_by_model.length > 0 && (
                <div>
                  <p className="text-text-muted text-sm mb-3">Tokens by Model</p>
                  <SimpleBarChart
                    data={usageMetrics.tokens_by_model.slice(0, 5).map((m) => ({
                      label: m.model,
                      value: m.tokens,
                    }))}
                    formatValue={(v) => formatNumber(v)}
                    barColor="bg-yellow-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cost Analysis */}
        <div className="bg-surface rounded-xl p-6 border border-border-subtle lg:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <Activity className="h-5 w-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-text-primary">Cost vs Revenue</h2>
          </div>

          {costMetrics && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div>
                  <p className="text-text-muted text-sm">Gross Revenue</p>
                  <p className="text-2xl font-semibold text-green-500">
                    {formatCurrency(costMetrics.gross_revenue_cents)}
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-sm">Total Cost</p>
                  <p className="text-2xl font-semibold text-red-500">
                    {formatCurrency(costMetrics.total_cost_cents)}
                  </p>
                </div>
                <div>
                  <p className="text-text-muted text-sm">Gross Margin</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    {costMetrics.gross_margin_percent.toFixed(1)}%
                  </p>
                </div>
              </div>

              <div>
                <p className="text-text-muted text-sm mb-3">Cost Breakdown</p>
                <SimpleBarChart
                  data={costMetrics.cost_breakdown.map((c) => ({
                    label: c.category,
                    value: c.amount_cents,
                  }))}
                  formatValue={(v) => formatCurrency(v)}
                  barColor="bg-red-500"
                />
              </div>

              <div>
                <p className="text-text-muted text-sm mb-3">Margins by Type</p>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">LLM Margin</span>
                    <span className="text-text-primary font-medium">
                      {costMetrics.llm_margin_percent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Compute Margin</span>
                    <span className="text-text-primary font-medium">
                      {costMetrics.compute_margin_percent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Gross Margin</span>
                    <span className="text-text-primary font-medium">
                      {costMetrics.gross_margin_percent.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
