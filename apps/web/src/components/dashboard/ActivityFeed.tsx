'use client';

import { formatDistanceToNow } from 'date-fns';
import { Bot, Check, FileCode, GitBranch, GitCommit, Play, Terminal, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActivityItemSkeleton } from '@/components/ui/Skeleton';
import { NoActivityEmpty } from '@/components/ui/EmptyStates';

interface ActivityItem {
  id: string;
  type:
    | 'session_created'
    | 'agent_message'
    | 'file_edited'
    | 'commit'
    | 'branch_created'
    | 'test_run'
    | 'command_executed'
    | 'task_completed';
  title: string;
  description?: string;
  timestamp: Date;
  sessionId?: string;
  sessionName?: string;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  isLoading?: boolean;
  onActivityClick?: (activity: ActivityItem) => void;
}

const activityIcons: Record<ActivityItem['type'], React.ReactNode> = {
  session_created: <Zap className="w-4 h-4 text-accent-primary" />,
  agent_message: <Bot className="w-4 h-4 text-accent-secondary" />,
  file_edited: <FileCode className="w-4 h-4 text-accent-warning" />,
  commit: <GitCommit className="w-4 h-4 text-accent-success" />,
  branch_created: <GitBranch className="w-4 h-4 text-agent-4" />,
  test_run: <Play className="w-4 h-4 text-agent-5" />,
  command_executed: <Terminal className="w-4 h-4 text-text-secondary" />,
  task_completed: <Check className="w-4 h-4 text-accent-success" />,
};

export function ActivityFeed({ activities, isLoading, onActivityClick }: ActivityFeedProps) {
  if (isLoading) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <h3 className="text-lg font-medium text-text-primary mb-4">Recent Activity</h3>
        <div className="space-y-4">
          <ActivityItemSkeleton />
          <ActivityItemSkeleton />
          <ActivityItemSkeleton />
          <ActivityItemSkeleton />
        </div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <h3 className="text-lg font-medium text-text-primary mb-4">Recent Activity</h3>
        <NoActivityEmpty />
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border-default rounded-xl p-5">
      <h3 className="text-lg font-medium text-text-primary mb-4">Recent Activity</h3>
      <div className="space-y-1">
        {activities.map((activity, index) => (
          <ActivityRow
            key={activity.id}
            activity={activity}
            isLast={index === activities.length - 1}
            onClick={() => onActivityClick?.(activity)}
          />
        ))}
      </div>
    </div>
  );
}

interface ActivityRowProps {
  activity: ActivityItem;
  isLast: boolean;
  onClick?: () => void;
}

function ActivityRow({ activity, isLast, onClick }: ActivityRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-lg text-left',
        'hover:bg-overlay transition-colors',
        onClick && 'cursor-pointer'
      )}
    >
      {/* Timeline */}
      <div className="relative flex flex-col items-center">
        <div className="w-8 h-8 rounded-lg bg-elevated flex items-center justify-center flex-shrink-0">
          {activityIcons[activity.type]}
        </div>
        {!isLast && (
          <div className="w-px h-full bg-border-subtle absolute top-10 left-1/2 -translate-x-1/2" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        <p className="text-sm text-text-primary">
          {activity.title}
          {activity.sessionName && (
            <span className="text-text-muted"> in {activity.sessionName}</span>
          )}
        </p>
        {activity.description && (
          <p className="text-sm text-text-muted mt-0.5 truncate">{activity.description}</p>
        )}
        <p className="text-xs text-text-muted mt-1">
          {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
        </p>
      </div>
    </button>
  );
}

// Usage chart component
interface UsageChartProps {
  data: Array<{
    date: string;
    tokens: number;
  }>;
  isLoading?: boolean;
}

export function UsageChart({ data, isLoading }: UsageChartProps) {
  if (isLoading) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <div className="h-4 w-48 bg-elevated rounded mb-4 animate-pulse" />
        <div className="h-32 bg-elevated rounded animate-pulse" />
      </div>
    );
  }

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div className="bg-surface border border-border-default rounded-xl p-5">
      <h3 className="text-lg font-medium text-text-primary mb-4">Token Usage (14 days)</h3>
      <div className="flex items-end gap-1 h-32">
        {data.map((item, index) => {
          const height = (item.tokens / maxTokens) * 100;
          return (
            <div key={item.date} className="flex-1 flex flex-col items-center group">
              <div className="relative w-full">
                <div
                  className={cn(
                    'w-full bg-accent-primary/20 rounded-t transition-all',
                    'group-hover:bg-accent-primary/40'
                  )}
                  style={{ height: `${Math.max(height, 4)}%` }}
                />
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="bg-overlay px-2 py-1 rounded text-xs whitespace-nowrap">
                    <p className="font-medium text-text-primary">
                      {item.tokens.toLocaleString()} tokens
                    </p>
                    <p className="text-text-muted">{item.date}</p>
                  </div>
                </div>
              </div>
              {index % 2 === 0 && (
                <span className="text-2xs text-text-muted mt-1 hidden sm:block">
                  {item.date.split('/')[1]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
