'use client';

import { useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  UserMinus,
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore } from '@/stores/admin';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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

interface DailySignupsChartProps {
  data: Array<{ date: string; signups: number }>;
}

function DailySignupsChart({ data }: DailySignupsChartProps) {
  const maxSignups = Math.max(...data.map((d) => d.signups));

  return (
    <div className="h-48 flex items-end gap-1">
      {data.map((item, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-green-500 rounded-t transition-all hover:bg-green-400"
            style={{
              height: `${maxSignups > 0 ? (item.signups / maxSignups) * 100 : 0}%`,
              minHeight: item.signups > 0 ? '4px' : '0',
            }}
            title={`${item.date}: ${item.signups} signups`}
          />
        </div>
      ))}
    </div>
  );
}

interface RetentionBarProps {
  label: string;
  value: number;
  color: string;
}

function RetentionBar({ label, value, color }: RetentionBarProps) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary font-medium">{value.toFixed(1)}%</span>
      </div>
      <div className="h-3 bg-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export default function GrowthAnalytics() {
  useDocumentTitle('User Growth');
  const [days, setDays] = useState(30);
  const { userGrowthMetrics, analyticsLoading, fetchUserGrowthMetrics, error } = useAdminStore();

  useEffect(() => {
    fetchUserGrowthMetrics(days);
  }, [days, fetchUserGrowthMetrics]);

  if (analyticsLoading && !userGrowthMetrics) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-text-primary mb-8">User Growth</h1>
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

  const growthPositive = (userGrowthMetrics?.signup_growth_percent ?? 0) >= 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">User Growth</h1>
          <p className="text-text-muted mt-1">User acquisition and retention metrics</p>
        </div>
        <DateRangeSelector value={days} onChange={setDays} />
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-8 flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Error loading growth metrics: {error}
        </div>
      )}

      {userGrowthMetrics && (
        <div className="space-y-8">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <UserPlus className="h-5 w-5 text-green-500" />
                <span className="text-text-muted text-sm">New Signups</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {userGrowthMetrics.total_signups_30d}
              </p>
              <div className="flex items-center gap-1 mt-2">
                {growthPositive ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
                <span className={growthPositive ? 'text-green-500' : 'text-red-500'}>
                  {userGrowthMetrics.signup_growth_percent >= 0 ? '+' : ''}
                  {userGrowthMetrics.signup_growth_percent.toFixed(1)}%
                </span>
                <span className="text-text-muted text-sm">vs previous</span>
              </div>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <UserMinus className="h-5 w-5 text-red-500" />
                <span className="text-text-muted text-sm">Churned Users</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {userGrowthMetrics.churned_users_30d}
              </p>
              <p className="text-text-muted text-sm mt-2">Last 30 days</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-5 w-5 text-blue-500" />
                <span className="text-text-muted text-sm">Churn Rate</span>
              </div>
              <p
                className={cn(
                  'text-3xl font-semibold',
                  userGrowthMetrics.churn_rate > 5 ? 'text-red-500' : 'text-text-primary'
                )}
              >
                {userGrowthMetrics.churn_rate.toFixed(1)}%
              </p>
              <p className="text-text-muted text-sm mt-2">Monthly churn</p>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <div className="flex items-center gap-2 mb-4">
                <Target className="h-5 w-5 text-purple-500" />
                <span className="text-text-muted text-sm">Activation Rate</span>
              </div>
              <p className="text-3xl font-semibold text-text-primary">
                {userGrowthMetrics.activation_rate.toFixed(1)}%
              </p>
              <p className="text-text-muted text-sm mt-2">Users who completed onboarding</p>
            </div>
          </div>

          {/* Daily Signups Chart */}
          {userGrowthMetrics.daily_signups.length > 0 && (
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Daily Signups</h2>
              <DailySignupsChart data={userGrowthMetrics.daily_signups} />
              <div className="flex justify-between text-xs text-text-muted mt-2">
                <span>{userGrowthMetrics.daily_signups[0]?.date}</span>
                <span>
                  {
                    userGrowthMetrics.daily_signups[userGrowthMetrics.daily_signups.length - 1]
                      ?.date
                  }
                </span>
              </div>
            </div>
          )}

          {/* Retention Metrics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">User Retention</h2>
              <div className="space-y-6">
                <RetentionBar
                  label="Day 1 Retention"
                  value={userGrowthMetrics.day_1_retention}
                  color="bg-green-500"
                />
                <RetentionBar
                  label="Day 7 Retention"
                  value={userGrowthMetrics.day_7_retention}
                  color="bg-blue-500"
                />
                <RetentionBar
                  label="Day 30 Retention"
                  value={userGrowthMetrics.day_30_retention}
                  color="bg-purple-500"
                />
              </div>
            </div>

            <div className="bg-surface rounded-xl p-6 border border-border-subtle">
              <h2 className="text-lg font-semibold text-text-primary mb-6">Growth Summary</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-elevated rounded-lg">
                  <span className="text-text-secondary">Net User Growth</span>
                  <span
                    className={cn(
                      'text-xl font-semibold',
                      userGrowthMetrics.total_signups_30d - userGrowthMetrics.churned_users_30d >= 0
                        ? 'text-green-500'
                        : 'text-red-500'
                    )}
                  >
                    {userGrowthMetrics.total_signups_30d - userGrowthMetrics.churned_users_30d >= 0
                      ? '+'
                      : ''}
                    {userGrowthMetrics.total_signups_30d - userGrowthMetrics.churned_users_30d}
                  </span>
                </div>

                <div className="flex justify-between items-center p-4 bg-elevated rounded-lg">
                  <span className="text-text-secondary">Avg Daily Signups</span>
                  <span className="text-xl font-semibold text-text-primary">
                    {(userGrowthMetrics.total_signups_30d / 30).toFixed(1)}
                  </span>
                </div>

                <div className="flex justify-between items-center p-4 bg-elevated rounded-lg">
                  <span className="text-text-secondary">Retention Score</span>
                  <span
                    className={cn(
                      'text-xl font-semibold',
                      userGrowthMetrics.day_30_retention >= 20
                        ? 'text-green-500'
                        : 'text-yellow-500'
                    )}
                  >
                    {(
                      (userGrowthMetrics.day_1_retention +
                        userGrowthMetrics.day_7_retention +
                        userGrowthMetrics.day_30_retention) /
                      3
                    ).toFixed(1)}
                    %
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Retention Cohort Overview */}
          <div className="bg-surface rounded-xl p-6 border border-border-subtle">
            <h2 className="text-lg font-semibold text-text-primary mb-6">Retention Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Day 1</p>
                <p className="text-4xl font-bold text-green-500">
                  {userGrowthMetrics.day_1_retention.toFixed(0)}%
                </p>
                <p className="text-text-muted text-xs mt-2">Return next day</p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Day 7</p>
                <p className="text-4xl font-bold text-blue-500">
                  {userGrowthMetrics.day_7_retention.toFixed(0)}%
                </p>
                <p className="text-text-muted text-xs mt-2">Return within week</p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Day 30</p>
                <p className="text-4xl font-bold text-purple-500">
                  {userGrowthMetrics.day_30_retention.toFixed(0)}%
                </p>
                <p className="text-text-muted text-xs mt-2">Return within month</p>
              </div>

              <div className="text-center p-6 bg-elevated rounded-xl">
                <p className="text-text-muted text-sm mb-2">Activation</p>
                <p className="text-4xl font-bold text-yellow-500">
                  {userGrowthMetrics.activation_rate.toFixed(0)}%
                </p>
                <p className="text-text-muted text-xs mt-2">Completed setup</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
