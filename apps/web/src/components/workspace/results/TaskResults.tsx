/**
 * Result displays for task tools.
 */

import React from 'react';
import { ListTodo } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const CreateTaskResult = React.memo<ResultComponentProps>(function CreateTaskResult({
  result,
}) {
  const taskId = result.task_id as string;
  const agentRole = result.agent_role as string;
  const priority = result.priority as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-primary/10 border border-accent-primary/20">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Task Created</span>
        <span className="text-xs text-accent-primary ml-auto">{agentRole}</span>
      </div>
      <div className="mt-1 text-xs text-text-muted font-mono">ID: {taskId}</div>
      {priority && (
        <span
          className={cn(
            'mt-1 inline-block px-1.5 py-0.5 rounded text-xs',
            priority === 'high' && 'bg-accent-error/20 text-accent-error',
            priority === 'medium' && 'bg-accent-warning/20 text-accent-warning',
            priority === 'low' && 'bg-accent-success/20 text-accent-success'
          )}
        >
          {priority} priority
        </span>
      )}
    </div>
  );
});

export const TaskStatsResult = React.memo<ResultComponentProps>(function TaskStatsResult({
  result,
}) {
  const pending = result.pending as number;
  const active = result.active as number;
  const completed = result.completed as number;
  const failed = result.failed as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Task Stats</span>
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        <span className="text-text-muted">{pending} pending</span>
        <span className="text-accent-warning">{active} active</span>
        <span className="text-accent-success">{completed} done</span>
        <span className="text-accent-error">{failed} failed</span>
      </div>
    </div>
  );
});
