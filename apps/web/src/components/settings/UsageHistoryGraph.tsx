'use client';

import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCostStore, type DailyUsage, formatCost } from '@/stores/cost';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  Zap,
  BarChart2,
} from 'lucide-react';

interface UsageHistoryGraphProps {
  className?: string;
  dailyUsage?: DailyUsage[];
  days?: number;
}

export function UsageHistoryGraph({
  className,
  dailyUsage: propDailyUsage,
  days = 30,
}: UsageHistoryGraphProps) {
  const storeDailyUsage = useCostStore((state) => state.dailyUsage);
  const dailyUsage = propDailyUsage || storeDailyUsage;

  const [hoveredDay, setHoveredDay] = useState<DailyUsage | null>(null);
  const [viewMode, setViewMode] = useState<'cost' | 'tokens' | 'calls'>('cost');

  // Calculate stats
  const stats = useMemo(() => {
    if (dailyUsage.length === 0) {
      return {
        totalCost: 0,
        avgDaily: 0,
        maxDay: null as DailyUsage | null,
        minDay: null as DailyUsage | null,
        trend: 0,
      };
    }

    const totalCost = dailyUsage.reduce((sum, d) => sum + d.totalCost, 0);
    const avgDaily = totalCost / dailyUsage.length;

    const sortedByCost = [...dailyUsage].sort((a, b) => b.totalCost - a.totalCost);
    const maxDay = sortedByCost[0];
    const minDay = sortedByCost[sortedByCost.length - 1];

    // Calculate trend (comparing last 7 days to previous 7 days)
    const recentDays = dailyUsage.slice(-7);
    const previousDays = dailyUsage.slice(-14, -7);

    const recentAvg =
      recentDays.length > 0
        ? recentDays.reduce((sum, d) => sum + d.totalCost, 0) / recentDays.length
        : 0;
    const previousAvg =
      previousDays.length > 0
        ? previousDays.reduce((sum, d) => sum + d.totalCost, 0) / previousDays.length
        : 0;

    const trend = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

    return { totalCost, avgDaily, maxDay, minDay, trend };
  }, [dailyUsage]);

  // Calculate bar heights
  const maxValue = useMemo(() => {
    if (dailyUsage.length === 0) return 1;

    switch (viewMode) {
      case 'cost':
        return Math.max(...dailyUsage.map((d) => d.totalCost));
      case 'tokens':
        return Math.max(...dailyUsage.map((d) => d.totalTokens));
      case 'calls':
        return Math.max(...dailyUsage.map((d) => d.callCount));
    }
  }, [dailyUsage, viewMode]);

  const getValue = (day: DailyUsage): number => {
    switch (viewMode) {
      case 'cost':
        return day.totalCost;
      case 'tokens':
        return day.totalTokens;
      case 'calls':
        return day.callCount;
    }
  };

  const formatValue = (value: number): string => {
    switch (viewMode) {
      case 'cost':
        return formatCost(value);
      case 'tokens':
        return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toString();
      case 'calls':
        return value.toString();
    }
  };

  if (dailyUsage.length === 0) {
    return (
      <div className={cn('p-8 text-center', className)}>
        <BarChart3 className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-50" />
        <p className="text-text-muted">No usage data available</p>
        <p className="text-sm text-text-muted mt-1">
          Start using the platform to see your usage history
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label={`Total (${days} days)`}
          value={formatCost(stats.totalCost)}
          icon={<DollarSign className="w-4 h-4" />}
        />
        <StatCard
          label="Daily Average"
          value={formatCost(stats.avgDaily)}
          icon={<BarChart2 className="w-4 h-4" />}
        />
        <StatCard
          label="Peak Day"
          value={stats.maxDay ? formatCost(stats.maxDay.totalCost) : '-'}
          subtitle={stats.maxDay?.date}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard
          label="Weekly Trend"
          value={`${stats.trend >= 0 ? '+' : ''}${stats.trend.toFixed(1)}%`}
          icon={
            stats.trend >= 0 ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )
          }
          valueColor={
            stats.trend > 10 ? 'text-red-500' : stats.trend < -10 ? 'text-green-500' : undefined
          }
        />
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent-primary" />
          Daily Usage
        </h3>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-surface-secondary">
          <ViewModeButton
            active={viewMode === 'cost'}
            onClick={() => setViewMode('cost')}
            icon={<DollarSign className="w-3.5 h-3.5" />}
            label="Cost"
          />
          <ViewModeButton
            active={viewMode === 'tokens'}
            onClick={() => setViewMode('tokens')}
            icon={<Zap className="w-3.5 h-3.5" />}
            label="Tokens"
          />
          <ViewModeButton
            active={viewMode === 'calls'}
            onClick={() => setViewMode('calls')}
            icon={<BarChart3 className="w-3.5 h-3.5" />}
            label="Calls"
          />
        </div>
      </div>

      {/* Graph */}
      <div className="relative">
        {/* Tooltip */}
        {hoveredDay && (
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-2 bg-surface-primary border border-border-subtle rounded-lg shadow-lg z-10 pointer-events-none">
            <p className="text-xs text-text-muted">{formatDate(hoveredDay.date)}</p>
            <p className="text-sm font-medium font-mono">{formatValue(getValue(hoveredDay))}</p>
          </div>
        )}

        {/* Bar Chart */}
        <div className="h-48 flex items-end gap-1">
          {dailyUsage.map((day, i) => {
            const value = getValue(day);
            const height = maxValue > 0 ? (value / maxValue) * 100 : 0;
            const isHovered = hoveredDay?.date === day.date;

            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center"
                onMouseEnter={() => setHoveredDay(day)}
                onMouseLeave={() => setHoveredDay(null)}
              >
                <div
                  className={cn(
                    'w-full rounded-t transition-all cursor-pointer',
                    isHovered
                      ? 'bg-accent-primary'
                      : i === dailyUsage.length - 1
                        ? 'bg-accent-primary/70'
                        : 'bg-surface-secondary hover:bg-surface-hover'
                  )}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div className="flex justify-between mt-2 text-xs text-text-muted">
          <span>{formatDateShort(dailyUsage[0]?.date)}</span>
          <span>{formatDateShort(dailyUsage[Math.floor(dailyUsage.length / 2)]?.date)}</span>
          <span>{formatDateShort(dailyUsage[dailyUsage.length - 1]?.date)}</span>
        </div>
      </div>

      {/* Recent Days Table */}
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        <div className="px-4 py-2 bg-surface-secondary text-sm font-medium">Recent Activity</div>
        <div className="divide-y divide-border-subtle max-h-48 overflow-y-auto">
          {dailyUsage
            .slice(-7)
            .reverse()
            .map((day) => (
              <div
                key={day.date}
                className="px-4 py-2 flex items-center justify-between text-sm hover:bg-surface-hover"
              >
                <span className="text-text-secondary">{formatDate(day.date)}</span>
                <div className="flex items-center gap-4">
                  <span className="text-text-muted">
                    {day.callCount} calls · {formatTokens(day.totalTokens)}
                  </span>
                  <span className="font-mono font-medium">{formatCost(day.totalCost)}</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  valueColor?: string;
}

function StatCard({ label, value, subtitle, icon, valueColor }: StatCardProps) {
  return (
    <div className="p-4 rounded-lg bg-surface-secondary">
      <div className="flex items-center gap-2 text-text-muted mb-2">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn('text-xl font-bold font-mono', valueColor)}>{value}</p>
      {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

interface ViewModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function ViewModeButton({ active, onClick, icon, label }: ViewModeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
        active ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-primary'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateShort(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M tokens`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K tokens`;
  return `${tokens} tokens`;
}

export default UsageHistoryGraph;
