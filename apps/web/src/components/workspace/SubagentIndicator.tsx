'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useSubagentsStore } from '@/stores/subagents';
import { Users, Loader2, CheckCircle, XCircle, Circle } from 'lucide-react';

interface SubagentIndicatorProps {
  agentId: string;
  onClick?: () => void;
  className?: string;
}

const statusIcons = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
};

const statusColors = {
  pending: 'text-text-muted',
  running: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  cancelled: 'text-text-muted',
};

/**
 * Compact indicator showing active subagents for an agent.
 * Displays count and status indicators.
 */
export function SubagentIndicator({ agentId, onClick, className }: SubagentIndicatorProps) {
  const subagents = useSubagentsStore((s) => s.getSubagents(agentId));
  const activeSubagents = useSubagentsStore((s) => s.getActiveSubagents(agentId));

  if (subagents.length === 0) {
    return null;
  }

  const hasActive = activeSubagents.length > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
        hasActive
          ? 'bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20'
          : 'bg-surface-secondary text-text-muted hover:bg-surface-hover',
        className
      )}
      title={`${subagents.length} subagent${subagents.length !== 1 ? 's' : ''} (${activeSubagents.length} active)`}
    >
      <Users className="w-3.5 h-3.5" />
      <span>{subagents.length}</span>
      {hasActive && <Loader2 className="w-3 h-3 animate-spin" />}
    </button>
  );
}

/**
 * Mini status dots for subagents.
 */
export function SubagentStatusDots({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  const subagents = useSubagentsStore((s) => s.getSubagents(agentId));

  if (subagents.length === 0) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {subagents.slice(0, 5).map((sub) => (
        <div
          key={sub.id}
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            sub.status === 'running' && 'bg-yellow-500 animate-pulse',
            sub.status === 'completed' && 'bg-green-500',
            sub.status === 'failed' && 'bg-red-500',
            sub.status === 'pending' && 'bg-text-muted',
            sub.status === 'cancelled' && 'bg-text-muted opacity-50'
          )}
          title={`${sub.name}: ${sub.status}`}
        />
      ))}
      {subagents.length > 5 && (
        <span className="text-[10px] text-text-muted ml-1">+{subagents.length - 5}</span>
      )}
    </div>
  );
}

/**
 * Expanded view of subagent statuses.
 */
export function SubagentStatusList({
  agentId,
  className,
}: {
  agentId: string;
  className?: string;
}) {
  const subagents = useSubagentsStore((s) => s.getSubagents(agentId));

  if (subagents.length === 0) {
    return (
      <div className={cn('text-sm text-text-muted text-center py-2', className)}>No subagents</div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {subagents.map((sub) => {
        const Icon = statusIcons[sub.status];
        const colorClass = statusColors[sub.status];

        return (
          <div
            key={sub.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-hover transition-colors"
          >
            <Icon
              className={cn(
                'w-4 h-4 flex-shrink-0',
                colorClass,
                sub.status === 'running' && 'animate-spin'
              )}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{sub.name}</p>
              <p className="text-xs text-text-muted truncate">{sub.task}</p>
            </div>
            <span className={cn('text-xs', colorClass)}>{sub.status}</span>
          </div>
        );
      })}
    </div>
  );
}
