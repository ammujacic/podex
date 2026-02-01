'use client';

import { useEffect, useState } from 'react';
import {
  Users,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  UserCheck,
  Server,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AreaChart, CircularGauge, ServerStatusCard } from '@/components/charts';

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

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  icon: React.ElementType;
  iconColor?: string;
}

function MetricCard({
  title,
  value,
  subtitle,
  change,
  icon: Icon,
  iconColor = 'text-accent-primary',
}: MetricCardProps) {
  const hasChange = change !== undefined && change !== 0;
  const isPositive = (change ?? 0) > 0;

  return (
    <div className="bg-surface rounded-xl p-5 border border-border-subtle">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-text-muted text-sm">{title}</p>
          <p className="text-2xl font-semibold text-text-primary mt-1">{value}</p>
          {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
          {hasChange && (
            <div
              className={cn(
                'flex items-center gap-1 mt-2 text-sm',
                isPositive ? 'text-emerald-500' : 'text-red-500'
              )}
            >
              {isPositive ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              <span>
                {isPositive ? '+' : ''}
                {change?.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <div className={cn('p-2.5 rounded-lg bg-opacity-10', iconColor.replace('text-', 'bg-'))}>
          <Icon className={cn('h-5 w-5', iconColor)} />
        </div>
      </div>
    </div>
  );
}

type DateRange = 7 | 30 | 90;

function DateRangeSelector({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
}) {
  const options: DateRange[] = [7, 30, 90];

  return (
    <div className="flex items-center gap-1 bg-elevated rounded-lg p-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'px-3 py-1.5 text-sm rounded-md transition-colors',
            value === opt
              ? 'bg-surface text-text-primary font-medium'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {opt}d
        </button>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  useDocumentTitle('Admin Dashboard');
  const [dateRange, setDateRange] = useState<DateRange>(30);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    dashboard,
    dashboardLoading,
    usageMetrics,
    userGrowthMetrics,
    clusterStatus,
    fetchDashboard,
    fetchUsageMetrics,
    fetchUserGrowthMetrics,
    fetchClusterStatus,
    error,
  } = useAdminStore();

  useEffect(() => {
    fetchDashboard();
    fetchClusterStatus();
  }, [fetchDashboard, fetchClusterStatus]);

  useEffect(() => {
    fetchUsageMetrics(dateRange);
    fetchUserGrowthMetrics(dateRange);
  }, [dateRange, fetchUsageMetrics, fetchUserGrowthMetrics]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      fetchDashboard(),
      fetchUsageMetrics(dateRange),
      fetchUserGrowthMetrics(dateRange),
      fetchClusterStatus(),
    ]);
    setIsRefreshing(false);
  };

  if (dashboardLoading && !dashboard) {
    return (
      <div className="px-8 py-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl p-5 border border-border-subtle animate-pulse"
            >
              <div className="h-4 bg-elevated rounded w-20 mb-2" />
              <div className="h-8 bg-elevated rounded w-32" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {[...Array(2)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl p-6 border border-border-subtle animate-pulse h-80"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-8 py-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Dashboard</h1>
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg">
          Error loading dashboard: {error}
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  // Transform data for charts
  const usageChartData =
    usageMetrics?.daily_usage.map((d) => ({
      date: d.date,
      value: d.tokens,
    })) || [];

  const signupsChartData =
    userGrowthMetrics?.daily_signups.map((d) => ({
      date: d.date,
      value: d.signups,
    })) || [];

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Dashboard Overview</h1>
          <p className="text-text-muted mt-1">Platform metrics and server health</p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeSelector value={dateRange} onChange={setDateRange} />
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-lg bg-elevated hover:bg-surface border border-border-subtle transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-4 w-4 text-text-muted', isRefreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Users"
          value={formatNumber(dashboard.total_users)}
          subtitle={`${formatNumber(dashboard.active_users_30d)} active in 30d`}
          change={dashboard.user_growth_percent}
          icon={Users}
          iconColor="text-blue-500"
        />
        <MetricCard
          title="Monthly Revenue"
          value={formatCurrency(dashboard.mrr_cents)}
          subtitle={`${formatCurrency(dashboard.arr_cents)} ARR`}
          change={dashboard.mrr_growth_percent}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <MetricCard
          title="Active Sessions"
          value={dashboard.active_sessions}
          subtitle={`${dashboard.sessions_today} today`}
          icon={Activity}
          iconColor="text-purple-500"
        />
        <MetricCard
          title="Paying Customers"
          value={dashboard.paying_customers}
          subtitle={`${dashboard.conversion_rate.toFixed(1)}% conversion`}
          icon={UserCheck}
          iconColor="text-orange-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <AreaChart
          title="Token Usage"
          subtitle={`Last ${dateRange} days`}
          data={usageChartData}
          color="#8B5CF6"
          height={180}
          formatValue={formatNumber}
        />
        <AreaChart
          title="User Signups"
          subtitle={`Last ${dateRange} days`}
          data={signupsChartData}
          color="#06B6D4"
          height={180}
        />
      </div>

      {/* Server Infrastructure */}
      <div className="bg-surface rounded-xl p-6 border border-border-subtle">
        <div className="flex items-center gap-2 mb-6">
          <Server className="h-5 w-5 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">Server Infrastructure</h2>
          {clusterStatus && (
            <span className="ml-auto text-sm text-text-muted">
              {clusterStatus.healthy_servers}/{clusterStatus.total_servers} healthy
            </span>
          )}
        </div>

        {clusterStatus ? (
          <>
            {/* Cluster Overview Gauges */}
            <div className="flex flex-wrap justify-center gap-8 mb-8 pb-6 border-b border-border-subtle">
              <CircularGauge
                value={clusterStatus.cpu_utilization}
                label="CPU"
                sublabel={`${clusterStatus.used_cpu.toFixed(1)}/${clusterStatus.total_cpu} cores`}
                size="md"
              />
              <CircularGauge
                value={clusterStatus.memory_utilization}
                label="Memory"
                sublabel={`${(clusterStatus.used_memory_mb / 1024).toFixed(1)}/${(clusterStatus.total_memory_mb / 1024).toFixed(1)} GB`}
                size="md"
              />
              <CircularGauge
                value={clusterStatus.total_workspaces}
                max={50}
                label="Workspaces"
                sublabel="active"
                size="md"
                showPercentage={false}
              />
            </div>

            {/* Server Cards */}
            {clusterStatus.servers.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {clusterStatus.servers.map((server) => (
                  <ServerStatusCard key={server.server_id} server={server} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-text-muted">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No servers registered</p>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 text-text-muted animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
