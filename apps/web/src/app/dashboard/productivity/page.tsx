'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Clock,
  Code,
  GitCommit,
  MessageSquare,
  TrendingUp,
  Flame,
  Zap,
  RefreshCw,
  Calendar,
  FileCode,
  CheckCircle,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductivitySummary {
  period_start: string;
  period_end: string;
  total_days: number;
  active_days: number;
  total_lines_written: number;
  total_lines_deleted: number;
  net_lines: number;
  total_files_modified: number;
  total_commits: number;
  total_agent_messages: number;
  total_suggestions_accepted: number;
  total_suggestions_rejected: number;
  acceptance_rate: number;
  total_tasks_completed: number;
  total_active_minutes: number;
  total_coding_minutes: number;
  total_time_saved_minutes: number;
  time_saved_hours: number;
  avg_lines_per_day: number;
  avg_coding_minutes_per_day: number;
  avg_agent_messages_per_day: number;
  current_streak: number;
  longest_streak: number;
  top_languages: Record<string, number>;
  top_agent_usage: Record<string, number>;
}

interface ProductivityTrends {
  dates: string[];
  lines_written: number[];
  coding_minutes: number[];
  agent_messages: number[];
  time_saved: number[];
  commits: number[];
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  trend?: { value: number; isUp: boolean };
}) {
  return (
    <div className="bg-surface rounded-xl border border-border-subtle p-5">
      <div className="flex items-start justify-between">
        <div className={cn('p-2.5 rounded-lg', color)}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs',
              trend.isUp ? 'text-green-500' : 'text-red-500'
            )}
          >
            <TrendingUp className={cn('h-3 w-3', !trend.isUp && 'rotate-180')} />
            {trend.value}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <p className="text-3xl font-bold text-text-primary">{value}</p>
        <p className="text-text-muted text-sm mt-1">{title}</p>
        {subtitle && <p className="text-text-muted text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function MiniChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  const height = 40;

  return (
    <div className="flex items-end gap-0.5 h-10">
      {data.slice(-14).map((value, i) => (
        <div
          key={i}
          className={cn('w-2 rounded-t transition-all', color)}
          style={{
            height: `${(value / max) * height}px`,
            minHeight: value > 0 ? '2px' : '0px',
          }}
        />
      ))}
    </div>
  );
}

function LanguageBar({ languages }: { languages: Record<string, number> }) {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500', 'bg-pink-500'];

  return (
    <div className="space-y-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-elevated">
        {Object.entries(languages).map(([lang, lines], i) => (
          <div
            key={lang}
            className={cn(colors[i % colors.length], 'transition-all')}
            style={{ width: `${(lines / total) * 100}%` }}
            title={`${lang}: ${lines} lines`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {Object.entries(languages).map(([lang, lines], i) => (
          <div key={lang} className="flex items-center gap-1.5 text-xs">
            <div className={cn('w-2 h-2 rounded-full', colors[i % colors.length])} />
            <span className="text-text-secondary">{lang}</span>
            <span className="text-text-muted">{((lines / total) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StreakDisplay({ current, longest }: { current: number; longest: number }) {
  return (
    <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl border border-orange-500/30 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="h-5 w-5 text-orange-500" />
        <span className="text-text-primary font-medium">Coding Streak</span>
      </div>
      <div className="flex items-end gap-6">
        <div>
          <p className="text-4xl font-bold text-orange-500">{current}</p>
          <p className="text-text-muted text-sm">Current streak</p>
        </div>
        <div className="text-text-muted">
          <p className="text-lg font-medium text-text-secondary">{longest}</p>
          <p className="text-xs">Longest</p>
        </div>
      </div>
      {current > 0 && (
        <p className="text-orange-400/80 text-sm mt-3">
          {current >= 7 ? "You're on fire! Keep it up!" : 'Building momentum!'}
        </p>
      )}
    </div>
  );
}

function AcceptanceRing({ rate }: { rate: number }) {
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (rate / 100) * circumference;

  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 transform -rotate-90">
        <circle
          cx="56"
          cy="56"
          r="45"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-elevated"
        />
        <circle
          cx="56"
          cy="56"
          r="45"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="text-green-500 transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold text-text-primary">{rate}%</span>
      </div>
    </div>
  );
}

export default function ProductivityDashboard() {
  const [summary, setSummary] = useState<ProductivitySummary | null>(null);
  const [trends, setTrends] = useState<ProductivityTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, trendsRes] = await Promise.all([
        fetch(`/api/productivity/summary?days=${days}`, { credentials: 'include' }),
        fetch(`/api/productivity/trends?days=${days}`, { credentials: 'include' }),
      ]);

      if (!summaryRes.ok || !trendsRes.ok) {
        throw new Error('Failed to fetch productivity data');
      }

      setSummary(await summaryRes.json());
      setTrends(await trendsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg">{error}</div>
      </div>
    );
  }

  if (!summary || !trends) return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-3">
            <Activity className="h-7 w-7 text-accent-primary" />
            Productivity Dashboard
          </h1>
          <p className="text-text-muted mt-1">Track your coding activity and AI assistant usage</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="appearance-none pl-3 pr-8 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary text-sm cursor-pointer"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-elevated border border-border-subtle text-text-muted hover:text-text-primary"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Time Saved"
          value={`${summary.time_saved_hours}h`}
          subtitle="By using AI"
          icon={Zap}
          color="bg-yellow-500/20 text-yellow-400"
        />
        <StatCard
          title="Lines Written"
          value={summary.total_lines_written.toLocaleString()}
          subtitle={`${summary.avg_lines_per_day.toFixed(0)} per day`}
          icon={Code}
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          title="Coding Time"
          value={formatDuration(summary.total_coding_minutes)}
          subtitle={`${summary.active_days} active days`}
          icon={Clock}
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          title="Agent Messages"
          value={summary.total_agent_messages.toLocaleString()}
          subtitle={`${summary.avg_agent_messages_per_day.toFixed(0)} per day`}
          icon={MessageSquare}
          color="bg-purple-500/20 text-purple-400"
        />
      </div>

      {/* Second Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Streak Card */}
        <StreakDisplay current={summary.current_streak} longest={summary.longest_streak} />

        {/* Agent Acceptance Card */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">AI Suggestions</h3>
          <div className="flex items-center gap-6">
            <AcceptanceRing rate={summary.acceptance_rate} />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-text-secondary text-sm">
                  {summary.total_suggestions_accepted} accepted
                </span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-text-secondary text-sm">
                  {summary.total_suggestions_rejected} rejected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-blue-500" />
                <span className="text-text-secondary text-sm">
                  {summary.total_tasks_completed} tasks completed
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Git Activity */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">Git Activity</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitCommit className="h-4 w-4 text-text-muted" />
                <span className="text-text-secondary text-sm">Commits</span>
              </div>
              <span className="text-text-primary font-medium">{summary.total_commits}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-text-muted" />
                <span className="text-text-secondary text-sm">Files Modified</span>
              </div>
              <span className="text-text-primary font-medium">{summary.total_files_modified}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="h-4 w-4 text-green-500" />
                <span className="text-text-secondary text-sm">Net Lines</span>
              </div>
              <span
                className={cn(
                  'font-medium',
                  summary.net_lines >= 0 ? 'text-green-500' : 'text-red-500'
                )}
              >
                {summary.net_lines >= 0 ? '+' : ''}
                {summary.net_lines.toLocaleString()}
              </span>
            </div>
            <MiniChart data={trends.commits} color="bg-accent-primary" />
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Coding Activity Chart */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">Coding Activity</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Lines of code over time</span>
              <span className="text-text-secondary">
                {summary.total_lines_written.toLocaleString()} total
              </span>
            </div>
            <div className="h-32 flex items-end gap-1">
              {trends.lines_written.map((value, i) => {
                const max = Math.max(...trends.lines_written, 1);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-blue-500/50 hover:bg-blue-500 rounded-t transition-colors cursor-pointer"
                    style={{
                      height: `${(value / max) * 100}%`,
                      minHeight: value > 0 ? '2px' : '0px',
                    }}
                    title={`${trends.dates[i]}: ${value} lines`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-text-muted">
              <span>{trends.dates[0]?.split('-').slice(1).join('/')}</span>
              <span>{trends.dates[trends.dates.length - 1]?.split('-').slice(1).join('/')}</span>
            </div>
          </div>
        </div>

        {/* Time Saved Chart */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">Time Saved by AI</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Minutes saved each day</span>
              <span className="text-text-secondary">{summary.time_saved_hours} hours total</span>
            </div>
            <div className="h-32 flex items-end gap-1">
              {trends.time_saved.map((value, i) => {
                const max = Math.max(...trends.time_saved, 1);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-yellow-500/50 hover:bg-yellow-500 rounded-t transition-colors cursor-pointer"
                    style={{
                      height: `${(value / max) * 100}%`,
                      minHeight: value > 0 ? '2px' : '0px',
                    }}
                    title={`${trends.dates[i]}: ${value} min`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-text-muted">
              <span>{trends.dates[0]?.split('-').slice(1).join('/')}</span>
              <span>{trends.dates[trends.dates.length - 1]?.split('-').slice(1).join('/')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Language Breakdown */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">Language Breakdown</h3>
          {Object.keys(summary.top_languages).length > 0 ? (
            <LanguageBar languages={summary.top_languages} />
          ) : (
            <p className="text-text-muted text-sm">No language data available yet</p>
          )}
        </div>

        {/* Agent Usage Breakdown */}
        <div className="bg-surface rounded-xl border border-border-subtle p-5">
          <h3 className="text-text-primary font-medium mb-4">Agent Usage</h3>
          {Object.keys(summary.top_agent_usage).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(summary.top_agent_usage).map(([agent, count]) => {
                const max = Math.max(...Object.values(summary.top_agent_usage));
                return (
                  <div key={agent} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-text-secondary capitalize">
                        {agent.replace('_', ' ')}
                      </span>
                      <span className="text-text-muted">{count}</span>
                    </div>
                    <div className="h-2 bg-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-text-muted text-sm">No agent usage data available yet</p>
          )}
        </div>
      </div>

      {/* Activity Calendar hint */}
      <div className="bg-elevated rounded-xl border border-border-subtle p-4 text-center">
        <Calendar className="h-5 w-5 mx-auto text-text-muted mb-2" />
        <p className="text-text-muted text-sm">Activity heatmap coming soon</p>
      </div>
    </div>
  );
}
