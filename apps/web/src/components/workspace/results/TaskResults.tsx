/**
 * Result displays for task tools.
 */

import React from 'react';
import { ListTodo, Circle, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/**
 * Displays TodoWrite tool results as a nicely formatted todo list.
 */
export const TodoWriteResult = React.memo<ResultComponentProps>(function TodoWriteResult({
  result,
}) {
  const todos = (result.todos as TodoItem[]) || [];

  if (todos.length === 0) {
    return (
      <div className="p-2 rounded-md bg-surface border border-border-default">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-text-muted" />
          <span className="text-sm text-text-muted">No tasks</span>
        </div>
      </div>
    );
  }

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;

  return (
    <div className="p-3 rounded-md bg-surface border border-border-default">
      {/* Header with stats */}
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border-default">
        <ListTodo className="h-5 w-5 text-accent-primary" />
        <span className="text-sm font-semibold text-text-primary">Tasks</span>
        <span className="text-xs font-medium text-text-secondary ml-auto bg-elevated px-2 py-0.5 rounded">
          {completedCount}/{todos.length} done
        </span>
      </div>

      {/* Todo list */}
      <div className="space-y-2">
        {todos.map((todo, index) => (
          <div
            key={index}
            className={cn(
              'flex items-start gap-3 text-sm py-2 px-2.5 rounded-md border',
              todo.status === 'completed' && 'bg-green-500/5 border-green-500/20',
              todo.status === 'in_progress' && 'bg-yellow-500/10 border-yellow-500/30',
              todo.status === 'pending' && 'bg-elevated border-border-subtle'
            )}
          >
            {/* Status icon */}
            {todo.status === 'completed' && (
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            )}
            {todo.status === 'in_progress' && (
              <Loader2 className="h-5 w-5 text-yellow-400 shrink-0 animate-spin" />
            )}
            {todo.status === 'pending' && <Circle className="h-5 w-5 text-text-muted shrink-0" />}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <span
                className={cn(
                  'leading-relaxed',
                  todo.status === 'completed' && 'text-text-muted line-through',
                  todo.status === 'in_progress' && 'text-text-primary font-medium',
                  todo.status === 'pending' && 'text-text-secondary'
                )}
              >
                {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      {inProgressCount > 0 && (
        <div className="mt-3 pt-2 border-t border-border-default">
          <div className="flex items-center gap-2 text-xs font-medium text-yellow-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>
              {inProgressCount} task{inProgressCount > 1 ? 's' : ''} in progress
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

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
