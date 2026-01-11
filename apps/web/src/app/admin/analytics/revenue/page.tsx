'use client';

import { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, TrendingDown, CreditCard, Coins, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
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

export default function RevenueAnalytics() {
  const [days, setDays] = useState(30);
  const { revenueMetrics, analyticsLoading, fetchRevenueMetrics, error } = useAdminStore();

  useEffect(() => {
    fetchRevenueMetrics(days);
  }, [days, fetchRevenueMetrics]);

  if (analyticsLoading && !revenueMetrics) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Revenue Analytics</h1>
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

  const mrrGrowthPositive = (revenueMetrics?.mrr_growth_percent ?? 0) >= 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Revenue Analytics</h1>
          <p className="text-text-muted mt-1">Detailed revenue metrics and trends</p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-8 flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Error loading revenue metrics: {error}
        </div>
      )}

      {revenueMetrics && (
        <div className="space-y-8">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-5 w-5 text-green-500" />
                <span className="text-text-muted text-sm">Monthly Recurring Revenue</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {formatCurrency(revenueMetrics.mrr_cents)}
              </p>
              <div className="flex items-center gap-1 mt-2">
                {mrrGrowthPositive ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
                <span className={mrrGrowthPositive ? 'text-green-500' : 'text-red-500'}>
                  {revenueMetrics.mrr_growth_percent >= 0 ? '+' : ''}
                  {revenueMetrics.mrr_growth_percent.toFixed(1)}%
                </span>
                <span className="text-text-muted text-sm">vs previous period</span>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-5 w-5 text-blue-500" />
                <span className="text-text-muted text-sm">Annual Recurring Revenue</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {formatCurrency(revenueMetrics.arr_cents)}
              </p>
              <p className="text-text-muted text-sm mt-2">Based on current MRR</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard className="h-5 w-5 text-purple-500" />
                <span className="text-text-muted text-sm">Average Revenue Per User</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {formatCurrency(revenueMetrics.arpu_cents)}
              </p>
              <p className="text-text-muted text-sm mt-2">Per paying customer</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Coins className="h-5 w-5 text-yellow-500" />
                <span className="text-text-muted text-sm">Lifetime Value</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {formatCurrency(revenueMetrics.ltv_cents)}
              </p>
              <p className="text-text-muted text-sm mt-2">Estimated customer LTV</p>
            </div>
          </div>

          {/* Revenue Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Revenue Sources</h2>
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-elevated rounded-lg p-4">
                    <p className="text-text-muted text-xs mb-1">Subscriptions</p>
                    <p className="text-xl font-semibold text-text-primary">
                      {formatCurrency(revenueMetrics.subscription_revenue_cents)}
                    </p>
                  </div>
                  <div className="bg-elevated rounded-lg p-4">
                    <p className="text-text-muted text-xs mb-1">Credits</p>
                    <p className="text-xl font-semibold text-text-primary">
                      {formatCurrency(revenueMetrics.credit_revenue_cents)}
                    </p>
                  </div>
                  <div className="bg-elevated rounded-lg p-4">
                    <p className="text-text-muted text-xs mb-1">Overage</p>
                    <p className="text-xl font-semibold text-text-primary">
                      {formatCurrency(revenueMetrics.overage_revenue_cents)}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-text-muted text-sm mb-3">Revenue Distribution</p>
                  <SimpleBarChart
                    data={[
                      { label: 'Subscriptions', value: revenueMetrics.subscription_revenue_cents },
                      { label: 'Credits', value: revenueMetrics.credit_revenue_cents },
                      { label: 'Overage', value: revenueMetrics.overage_revenue_cents },
                    ]}
                    formatValue={(v) => formatCurrency(v)}
                    barColor="bg-green-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Revenue by Plan</h2>
              {revenueMetrics.revenue_by_plan.length > 0 ? (
                <SimpleBarChart
                  data={revenueMetrics.revenue_by_plan.map((p) => ({
                    label: `${p.plan} (${p.subscribers} subscribers)`,
                    value: p.mrr_cents,
                  }))}
                  formatValue={(v) => formatCurrency(v)}
                  barColor="bg-accent-primary"
                />
              ) : (
                <p className="text-text-muted">No plan revenue data available</p>
              )}
            </div>
          </div>

          {/* Retention Metrics */}
          <div className="bg-surface rounded-xl p-6 border border-border-subtle">
            <h2 className="text-lg font-semibold text-text-primary mb-6">Revenue Health</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Net Revenue Retention</p>
                <p className="text-4xl font-bold text-text-primary">
                  {revenueMetrics.nrr_percent.toFixed(0)}%
                </p>
                <p className="text-text-muted text-xs mt-2">
                  {revenueMetrics.nrr_percent >= 100 ? 'Healthy expansion' : 'Room for improvement'}
                </p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">MRR Growth</p>
                <p
                  className={cn(
                    'text-4xl font-bold',
                    mrrGrowthPositive ? 'text-green-500' : 'text-red-500'
                  )}
                >
                  {revenueMetrics.mrr_growth_percent >= 0 ? '+' : ''}
                  {revenueMetrics.mrr_growth_percent.toFixed(1)}%
                </p>
                <p className="text-text-muted text-xs mt-2">Period over period</p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Previous MRR</p>
                <p className="text-4xl font-bold text-text-primary">
                  {formatCurrency(revenueMetrics.mrr_previous_cents)}
                </p>
                <p className="text-text-muted text-xs mt-2">Last period comparison</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
