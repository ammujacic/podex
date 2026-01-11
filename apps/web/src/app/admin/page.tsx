'use client';

import { useEffect } from 'react';
import {
  Users,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Zap,
  HardDrive,
  UserCheck,
  Percent,
} from 'lucide-react';
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
    <div className="bg-surface rounded-xl p-6 border border-border-subtle">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-text-muted text-sm">{title}</p>
          <p className="text-2xl font-semibold text-text-primary mt-1">{value}</p>
          {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
          {hasChange && (
            <div
              className={cn(
                'flex items-center gap-1 mt-2 text-sm',
                isPositive ? 'text-green-500' : 'text-red-500'
              )}
            >
              {isPositive ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              <span>
                {isPositive ? '+' : ''}
                {change?.toFixed(1)}%
              </span>
              <span className="text-text-muted">vs last period</span>
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-lg bg-opacity-10', iconColor.replace('text-', 'bg-'))}>
          <Icon className={cn('h-6 w-6', iconColor)} />
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { dashboard, dashboardLoading, fetchDashboard, error } = useAdminStore();

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (dashboardLoading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">Dashboard</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl p-6 border border-border-subtle animate-pulse"
            >
              <div className="h-4 bg-elevated rounded w-20 mb-2" />
              <div className="h-8 bg-elevated rounded w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
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

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Dashboard Overview</h1>
        <p className="text-text-muted mt-1">Welcome to the Podex Admin Panel</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricCard
          title="Total Users"
          value={formatNumber(dashboard.total_users)}
          subtitle={`${formatNumber(dashboard.active_users_30d)} active in 30d`}
          change={dashboard.user_growth_percent}
          icon={Users}
          iconColor="text-blue-500"
        />
        <MetricCard
          title="Monthly Recurring Revenue"
          value={formatCurrency(dashboard.mrr_cents)}
          subtitle={`${formatCurrency(dashboard.arr_cents)} ARR`}
          change={dashboard.mrr_growth_percent}
          icon={DollarSign}
          iconColor="text-green-500"
        />
        <MetricCard
          title="Active Sessions"
          value={dashboard.active_sessions}
          subtitle={`${dashboard.sessions_today} today, ${formatNumber(dashboard.total_sessions)} total`}
          icon={Activity}
          iconColor="text-purple-500"
        />
        <MetricCard
          title="Paying Customers"
          value={dashboard.paying_customers}
          subtitle={`${dashboard.conversion_rate.toFixed(1)}% conversion rate`}
          icon={UserCheck}
          iconColor="text-orange-500"
        />
      </div>

      {/* Usage Metrics */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Usage (Last 30 Days)</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            title="Tokens Used"
            value={formatNumber(dashboard.total_tokens_30d)}
            icon={Zap}
            iconColor="text-yellow-500"
          />
          <MetricCard
            title="Compute Hours"
            value={dashboard.total_compute_hours_30d.toFixed(1)}
            icon={Activity}
            iconColor="text-cyan-500"
          />
          <MetricCard
            title="Storage Used"
            value={`${dashboard.total_storage_gb.toFixed(1)} GB`}
            icon={HardDrive}
            iconColor="text-indigo-500"
          />
        </div>
      </div>

      {/* Health Metrics */}
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Platform Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            title="New Users (30d)"
            value={formatNumber(dashboard.new_users_30d)}
            change={dashboard.user_growth_percent}
            icon={TrendingUp}
            iconColor="text-emerald-500"
          />
          <MetricCard
            title="Conversion Rate"
            value={`${dashboard.conversion_rate.toFixed(1)}%`}
            icon={Percent}
            iconColor="text-pink-500"
          />
          <MetricCard
            title="Churn Rate (30d)"
            value={`${dashboard.churn_rate_30d.toFixed(1)}%`}
            icon={TrendingDown}
            iconColor="text-red-500"
          />
        </div>
      </div>
    </div>
  );
}
