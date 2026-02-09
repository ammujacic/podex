'use client';

import { GitBranch, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Worktree } from '@/stores/worktrees';

interface WorktreeStatusProps {
  worktree?: Worktree;
  className?: string;
}

const statusConfig = {
  creating: {
    label: 'Creating',
    icon: Loader2,
    color: 'bg-blue-500/20 text-blue-400',
    animate: true,
  },
  active: {
    label: 'Active',
    icon: GitBranch,
    color: 'bg-green-500/20 text-green-400',
    animate: false,
  },
  merging: {
    label: 'Merging',
    icon: Loader2,
    color: 'bg-yellow-500/20 text-yellow-400',
    animate: true,
  },
  merged: {
    label: 'Merged',
    icon: Check,
    color: 'bg-green-500/20 text-green-400',
    animate: false,
  },
  conflict: {
    label: 'Conflict',
    icon: AlertTriangle,
    color: 'bg-red-500/20 text-red-400',
    animate: true,
  },
  cleanup: {
    label: 'Cleanup',
    icon: Loader2,
    color: 'bg-purple-500/20 text-purple-400',
    animate: true,
  },
  deleted: {
    label: 'Deleted',
    icon: GitBranch,
    color: 'bg-text-muted text-text-muted',
    animate: false,
  },
  failed: {
    label: 'Failed',
    icon: AlertTriangle,
    color: 'bg-red-500/20 text-red-400',
    animate: false,
  },
};

/**
 * Displays the worktree status badge for an agent.
 * Shows branch info and current status.
 */
export function WorktreeStatus({ worktree, className }: WorktreeStatusProps) {
  if (!worktree) return null;

  const config = statusConfig[worktree.status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.color,
        config.animate && 'animate-pulse',
        className
      )}
      title={`Worktree: ${worktree.branchName}\nStatus: ${config.label}\nPath: ${worktree.worktreePath}`}
    >
      <Icon className={cn('h-3 w-3', config.animate && 'animate-spin')} />
      {config.label}
    </span>
  );
}
