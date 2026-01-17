/**
 * Result displays for orchestrator tools.
 */

import React from 'react';
import { Bot, Users, ListTodo, Clock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const CreateAgentResult = React.memo<ResultComponentProps>(function CreateAgentResult({
  result,
}) {
  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">
          {(result.name as string) || 'Custom Agent'}
        </span>
        <span className="text-xs text-accent-success ml-auto">Created</span>
      </div>
      {result.agent_id && (
        <div className="mt-1 text-xs text-text-muted font-mono">
          ID: {result.agent_id as string}
        </div>
      )}
      {result.tools && Array.isArray(result.tools) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(result.tools as string[]).map((tool) => (
            <span
              key={tool}
              className="px-1.5 py-0.5 rounded bg-elevated text-xs text-text-secondary"
            >
              {tool}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

export const DelegateTaskResult = React.memo<ResultComponentProps>(function DelegateTaskResult({
  result,
}) {
  return (
    <div className="mt-2 p-2 rounded-md bg-accent-primary/10 border border-accent-primary/20">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Task Delegated</span>
        <span className="text-xs text-accent-primary ml-auto">{result.agent_role as string}</span>
      </div>
      <div className="mt-1 text-xs text-text-muted font-mono">
        Task ID: {result.task_id as string}
      </div>
      {result.priority && (
        <span
          className={cn(
            'mt-1 inline-block px-1.5 py-0.5 rounded text-xs',
            result.priority === 'high' && 'bg-accent-error/20 text-accent-error',
            result.priority === 'medium' && 'bg-accent-warning/20 text-accent-warning',
            result.priority === 'low' && 'bg-accent-success/20 text-accent-success'
          )}
        >
          {result.priority as string} priority
        </span>
      )}
    </div>
  );
});

export const TaskStatusResult = React.memo<ResultComponentProps>(function TaskStatusResult({
  result,
}) {
  const status = result.status as string;
  const statusColors: Record<string, string> = {
    completed: 'text-accent-success',
    running: 'text-accent-warning',
    pending: 'text-text-muted',
    failed: 'text-accent-error',
  };

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Task Status</span>
        <span
          className={cn('text-xs ml-auto capitalize', statusColors[status] || 'text-text-muted')}
        >
          {status}
        </span>
      </div>
      <div className="mt-1 text-xs text-text-muted">{result.description as string}</div>
      {result.agent_role && (
        <div className="mt-1 text-xs text-text-secondary">Agent: {result.agent_role as string}</div>
      )}
    </div>
  );
});

export const WaitForTasksResult = React.memo<ResultComponentProps>(function WaitForTasksResult({
  result,
}) {
  const completed = result.completed as number;
  const total = result.total as number;
  const timedOut = (result.timed_out as string[]) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Tasks Completed</span>
        <span
          className={cn(
            'text-xs ml-auto',
            completed === total ? 'text-accent-success' : 'text-accent-warning'
          )}
        >
          {completed}/{total}
        </span>
      </div>
      {timedOut.length > 0 && (
        <div className="mt-1 text-xs text-accent-warning">{timedOut.length} task(s) timed out</div>
      )}
    </div>
  );
});

export const DelegateToAgentResult = React.memo<ResultComponentProps>(
  function DelegateToAgentResult({ result }) {
    return (
      <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent-success" />
          <span className="text-sm font-medium text-text-primary">Agent Response</span>
          {result.tokens_used && (
            <span className="text-xs text-text-muted ml-auto">
              {result.tokens_used as number} tokens
            </span>
          )}
        </div>
        {result.response && (
          <div className="mt-1 text-xs text-text-secondary line-clamp-3">
            {result.response as string}
          </div>
        )}
      </div>
    );
  }
);

export const SynthesizeResultsResult = React.memo<ResultComponentProps>(
  function SynthesizeResultsResult({ result }) {
    const taskCount = result.task_count as number;
    const results = (result.results as Array<Record<string, unknown>>) || [];

    return (
      <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Synthesized Results</span>
          <span className="text-xs text-text-muted ml-auto">{taskCount} tasks</span>
        </div>
        {results.length > 0 && (
          <div className="mt-1 space-y-1">
            {results.slice(0, 3).map((r, i) => (
              <div key={i} className="text-xs text-text-secondary flex items-center gap-1">
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    r.status === 'completed' ? 'bg-accent-success' : 'bg-accent-error'
                  )}
                />
                <span className="truncate">
                  {r.agent_role as string}: {r.description as string}
                </span>
              </div>
            ))}
            {results.length > 3 && (
              <div className="text-xs text-text-muted">+{results.length - 3} more</div>
            )}
          </div>
        )}
      </div>
    );
  }
);
