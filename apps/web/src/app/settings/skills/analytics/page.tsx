'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  CheckCircle,
  XCircle,
  Zap,
  Activity,
  ArrowUp,
  ArrowDown,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SkillAnalytics {
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  average_duration_ms: number;
  total_skills: number;
  executions_by_skill: Array<{
    skill_slug: string;
    skill_name: string;
    count: number;
    successful: number;
    average_duration_ms: number;
  }>;
  recent_executions: Array<{
    id: string;
    skill_slug: string;
    skill_type: string;
    success: boolean;
    duration_ms: number;
    executed_at: string;
  }>;
}

interface TimelineData {
  timeline: Array<{
    date: string;
    total: number;
    successful: number;
    failed: number;
  }>;
  period_start: string;
  period_end: string;
}

interface TrendData {
  trends: Array<{
    skill_slug: string;
    skill_name: string;
    current_count: number;
    previous_count: number;
    change_percent: number;
  }>;
  period: string;
}

export default function SkillAnalyticsPage() {
  const [analytics, setAnalytics] = useState<SkillAnalytics | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, trendPeriod]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [analyticsRes, timelineRes, trendsRes] = await Promise.all([
        fetch(`/api/v1/skills/analytics?days=${days}`, { credentials: 'include' }),
        fetch(`/api/v1/skills/analytics/timeline?days=${days}`, { credentials: 'include' }),
        fetch(`/api/v1/skills/analytics/trends?period=${trendPeriod}`, {
          credentials: 'include',
        }),
      ]);

      if (analyticsRes.ok) {
        setAnalytics(await analyticsRes.json());
      }
      if (timelineRes.ok) {
        setTimeline(await timelineRes.json());
      }
      if (trendsRes.ok) {
        setTrends(await trendsRes.json());
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Skill Analytics</h1>
          <p className="text-text-muted mt-1">Track your skill usage and performance</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 bg-surface border border-border-subtle rounded-lg text-sm text-text-primary focus:border-accent-primary outline-none"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Executions"
            value={analytics.total_executions}
            icon={<Zap className="h-5 w-5" />}
            color="blue"
          />
          <StatCard
            label="Success Rate"
            value={`${analytics.success_rate}%`}
            icon={<CheckCircle className="h-5 w-5" />}
            color="green"
          />
          <StatCard
            label="Avg Duration"
            value={`${Math.round(analytics.average_duration_ms / 1000)}s`}
            icon={<Clock className="h-5 w-5" />}
            color="purple"
          />
          <StatCard
            label="Total Skills"
            value={analytics.total_skills}
            icon={<Activity className="h-5 w-5" />}
            color="orange"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Timeline Chart */}
        {timeline && (
          <div className="bg-surface rounded-xl border border-border-subtle p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Execution Timeline</h3>
            <div className="h-48">
              <SimpleBarChart data={timeline.timeline} />
            </div>
          </div>
        )}

        {/* Success/Failure Breakdown */}
        {analytics && (
          <div className="bg-surface rounded-xl border border-border-subtle p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Success Rate</h3>
            <div className="flex items-center justify-center h-48">
              <div className="relative w-32 h-32">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="12"
                    className="text-red-500/20"
                  />
                  <circle
                    cx="64"
                    cy="64"
                    r="56"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="12"
                    strokeDasharray={`${(analytics.success_rate / 100) * 352} 352`}
                    className="text-green-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-text-primary">
                    {analytics.success_rate}%
                  </span>
                </div>
              </div>
              <div className="ml-8 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm text-text-secondary">
                    Successful: {analytics.successful_executions}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm text-text-secondary">
                    Failed: {analytics.failed_executions}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Top Skills */}
        {analytics && analytics.executions_by_skill.length > 0 && (
          <div className="bg-surface rounded-xl border border-border-subtle p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Top Skills</h3>
            <div className="space-y-3">
              {analytics.executions_by_skill.slice(0, 5).map((skill, index) => (
                <div key={skill.skill_slug} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-overlay flex items-center justify-center text-xs font-medium text-text-muted">
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {skill.skill_name}
                      </span>
                      <span className="text-sm text-text-muted">{skill.count} runs</span>
                    </div>
                    <div className="mt-1 h-2 bg-overlay rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-primary rounded-full"
                        style={{
                          width: `${(skill.count / (analytics.executions_by_skill[0]?.count ?? 1)) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trends */}
        {trends && trends.trends.length > 0 && (
          <div className="bg-surface rounded-xl border border-border-subtle p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Usage Trends</h3>
              <select
                value={trendPeriod}
                onChange={(e) => setTrendPeriod(e.target.value as typeof trendPeriod)}
                className="px-2 py-1 bg-overlay border border-border-subtle rounded text-xs text-text-primary"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="space-y-2">
              {trends.trends.slice(0, 5).map((trend) => (
                <div
                  key={trend.skill_slug}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-overlay"
                >
                  <span className="text-sm text-text-primary">{trend.skill_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-text-muted">{trend.current_count}</span>
                    <div
                      className={cn(
                        'flex items-center gap-1 text-xs',
                        trend.change_percent > 0 && 'text-green-400',
                        trend.change_percent < 0 && 'text-red-400',
                        trend.change_percent === 0 && 'text-text-muted'
                      )}
                    >
                      {trend.change_percent > 0 ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : trend.change_percent < 0 ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                      {Math.abs(trend.change_percent)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Executions */}
      {analytics && analytics.recent_executions.length > 0 && (
        <div className="bg-surface rounded-xl border border-border-subtle p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Recent Executions</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider">
                  <th className="pb-3">Skill</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Status</th>
                  <th className="pb-3">Duration</th>
                  <th className="pb-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {analytics.recent_executions.map((exec) => (
                  <tr key={exec.id}>
                    <td className="py-3">
                      <span className="text-sm font-medium text-text-primary">
                        {exec.skill_slug}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded text-xs',
                          exec.skill_type === 'system'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-purple-500/10 text-purple-400'
                        )}
                      >
                        {exec.skill_type}
                      </span>
                    </td>
                    <td className="py-3">
                      {exec.success ? (
                        <span className="flex items-center gap-1 text-green-400 text-sm">
                          <CheckCircle className="h-4 w-4" />
                          Success
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400 text-sm">
                          <XCircle className="h-4 w-4" />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-sm text-text-muted">
                      {(exec.duration_ms / 1000).toFixed(1)}s
                    </td>
                    <td className="py-3 text-sm text-text-muted">
                      {formatDistanceToNow(new Date(exec.executed_at), { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {analytics && analytics.total_executions === 0 && (
        <div className="text-center py-12 bg-surface rounded-xl border border-border-subtle">
          <BarChart3 className="h-12 w-12 text-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-primary">No Skill Executions Yet</h3>
          <p className="text-text-muted mt-1">
            Start using skills to see analytics and performance data.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    purple: 'bg-purple-500/10 text-purple-400',
    orange: 'bg-orange-500/10 text-orange-400',
  };

  return (
    <div className="bg-surface rounded-xl border border-border-subtle p-4">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>{icon}</div>
        <div>
          <p className="text-sm text-text-muted">{label}</p>
          <p className="text-2xl font-semibold text-text-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SimpleBarChart({
  data,
}: {
  data: Array<{ date: string; total: number; successful: number; failed: number }>;
}) {
  const maxValue = Math.max(...data.map((d) => d.total), 1);
  const visibleData = data.slice(-14); // Show last 14 days

  return (
    <div className="flex items-end justify-between h-full gap-1">
      {visibleData.map((day) => (
        <div
          key={day.date}
          className="flex-1 flex flex-col items-center gap-1"
          title={`${day.date}: ${day.total} total (${day.successful} success, ${day.failed} failed)`}
        >
          <div
            className="w-full bg-accent-primary/80 rounded-t"
            style={{ height: `${(day.total / maxValue) * 100}%`, minHeight: day.total > 0 ? 4 : 0 }}
          />
          <span className="text-[10px] text-text-muted rotate-45 origin-left whitespace-nowrap">
            {new Date(day.date).getDate()}
          </span>
        </div>
      ))}
    </div>
  );
}
