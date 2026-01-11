'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useProgressStore, type TaskProgress, type ProgressStep } from '@/stores/progress';
import {
  CheckCircle,
  Circle,
  ArrowRight,
  XCircle,
  SkipForward,
  Clock,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Loader2,
} from 'lucide-react';

interface TaskProgressPanelProps {
  agentId: string;
  className?: string;
}

const statusIcons = {
  pending: Circle,
  in_progress: ArrowRight,
  completed: CheckCircle,
  failed: XCircle,
  skipped: SkipForward,
};

const statusColors = {
  pending: 'text-text-muted',
  in_progress: 'text-yellow-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-text-muted opacity-50',
};

/**
 * Panel showing task progress with step indicators.
 */
export function TaskProgressPanel({ agentId, className }: TaskProgressPanelProps) {
  const progressList = useProgressStore((s) => s.getProgress(agentId));
  const { expandedProgressId, setExpanded } = useProgressStore();

  if (progressList.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center py-8 text-center text-text-muted',
          className
        )}
      >
        <ListTodo className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No tasks in progress</p>
        <p className="text-xs mt-1">Task progress will appear here when an agent starts working</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {progressList.map((progress) => (
        <TaskProgressItem
          key={progress.id}
          progress={progress}
          isExpanded={expandedProgressId === progress.id}
          onToggleExpand={() =>
            setExpanded(expandedProgressId === progress.id ? null : progress.id)
          }
        />
      ))}
    </div>
  );
}

interface TaskProgressItemProps {
  progress: TaskProgress;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function TaskProgressItem({ progress, isExpanded, onToggleExpand }: TaskProgressItemProps) {
  const isActive = progress.status === 'in_progress';
  const currentStep =
    progress.currentStepIndex !== null ? progress.steps[progress.currentStepIndex] : null;

  return (
    <div
      className={cn(
        'border border-border-subtle rounded-lg overflow-hidden',
        isActive && 'border-accent-primary/50'
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{progress.title}</p>
          {currentStep && (
            <p className="text-xs text-text-muted truncate">{currentStep.description}</p>
          )}
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            {progress.completedSteps}/{progress.totalSteps}
          </span>
          <ProgressRing percent={progress.progressPercent} size={24} isActive={isActive} />
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-secondary">
        <div
          className={cn(
            'h-full transition-all duration-300',
            progress.status === 'completed' && 'bg-green-500',
            progress.status === 'failed' && 'bg-red-500',
            progress.status === 'in_progress' && 'bg-accent-primary'
          )}
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>

      {/* Steps */}
      {isExpanded && (
        <div className="p-3 bg-surface-secondary/50 space-y-1">
          {progress.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}

          {/* Duration */}
          {progress.completedAt && progress.totalDurationMs !== null && (
            <div className="flex items-center gap-1 text-xs text-text-muted mt-2 pt-2 border-t border-border-subtle">
              <Clock className="w-3 h-3" />
              Total time: {formatDuration(progress.totalDurationMs)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: ProgressStep }) {
  const Icon = statusIcons[step.status];
  const colorClass = statusColors[step.status];
  const isActive = step.status === 'in_progress';

  return (
    <div
      className={cn('flex items-center gap-2 px-2 py-1.5 rounded', isActive && 'bg-yellow-500/10')}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', colorClass, isActive && 'animate-pulse')} />
      <span
        className={cn('text-sm flex-1', step.status === 'skipped' && 'line-through opacity-50')}
      >
        {step.description}
      </span>
      {step.durationMs !== null && (
        <span className="text-xs text-text-muted">{formatDuration(step.durationMs)}</span>
      )}
      {step.elapsedMs !== null && isActive && (
        <span className="text-xs text-yellow-500">{formatDuration(step.elapsedMs)}</span>
      )}
    </div>
  );
}

interface ProgressRingProps {
  percent: number;
  size?: number;
  isActive?: boolean;
}

function ProgressRing({ percent, size = 24, isActive = false }: ProgressRingProps) {
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      className={cn('transform -rotate-90', isActive && 'animate-pulse')}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-border-subtle opacity-30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn(
          'transition-all duration-300',
          percent === 100 ? 'stroke-green-500' : 'stroke-accent-primary'
        )}
      />
    </svg>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Compact inline progress indicator for headers.
 */
export function TaskProgressIndicator({ agentId }: { agentId: string }) {
  const activeProgress = useProgressStore((s) => s.getActiveProgress(agentId));

  if (!activeProgress) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-accent-primary/10">
      <Loader2 className="w-3 h-3 animate-spin text-accent-primary" />
      <span className="text-xs text-accent-primary">
        {activeProgress.completedSteps}/{activeProgress.totalSteps}
      </span>
      <div className="w-16 h-1 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-primary transition-all"
          style={{ width: `${activeProgress.progressPercent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Mini step dots for ultra-compact view.
 */
export function TaskProgressDots({ agentId }: { agentId: string }) {
  const activeProgress = useProgressStore((s) => s.getActiveProgress(agentId));

  if (!activeProgress) return null;

  return (
    <div className="flex items-center gap-0.5">
      {activeProgress.steps.map((step) => (
        <div
          key={step.id}
          className={cn(
            'w-1.5 h-1.5 rounded-full transition-colors',
            step.status === 'completed' && 'bg-green-500',
            step.status === 'in_progress' && 'bg-yellow-500 animate-pulse',
            step.status === 'failed' && 'bg-red-500',
            step.status === 'pending' && 'bg-text-muted opacity-30',
            step.status === 'skipped' && 'bg-text-muted opacity-20'
          )}
          title={step.description}
        />
      ))}
    </div>
  );
}
