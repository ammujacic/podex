'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileEdit,
  GitBranch,
  Loader2,
  Play,
  Terminal,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlanStep {
  order: number;
  action_type: string;
  description: string;
  confidence: number;
}

interface PlanResult {
  success: boolean;
  plan_id?: string;
  title?: string;
  description?: string;
  steps?: PlanStep[];
  confidence_score?: number;
  status?: string;
  auto_execute?: boolean;
  error?: string;
}

interface PlanResultDisplayProps {
  result: PlanResult;
  onApprove?: () => void;
  onReject?: () => void;
  isExecuting?: boolean;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  file_write: <FileEdit className="h-3.5 w-3.5" />,
  file_read: <FileEdit className="h-3.5 w-3.5" />,
  command_run: <Terminal className="h-3.5 w-3.5" />,
  git_commit: <GitBranch className="h-3.5 w-3.5" />,
  git_branch: <GitBranch className="h-3.5 w-3.5" />,
  git_push: <GitBranch className="h-3.5 w-3.5" />,
};

const ACTION_COLORS: Record<string, string> = {
  file_write: 'text-blue-400 bg-blue-500/10',
  file_read: 'text-cyan-400 bg-cyan-500/10',
  command_run: 'text-yellow-400 bg-yellow-500/10',
  git_commit: 'text-purple-400 bg-purple-500/10',
  git_branch: 'text-purple-400 bg-purple-500/10',
  git_push: 'text-purple-400 bg-purple-500/10',
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const color =
    percent >= 80
      ? 'text-green-400 bg-green-500/10'
      : percent >= 60
        ? 'text-yellow-400 bg-yellow-500/10'
        : 'text-red-400 bg-red-500/10';

  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', color)}>{percent}%</span>
  );
}

function StepItem({ step, index }: { step: PlanStep; index: number }) {
  const icon = ACTION_ICONS[step.action_type] || <Circle className="h-3.5 w-3.5" />;
  const colorClass = ACTION_COLORS[step.action_type] || 'text-text-muted bg-elevated';

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted font-mono w-4">{index + 1}</span>
        <div className={cn('rounded-md p-1.5', colorClass)}>{icon}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary capitalize">
            {step.action_type.replace(/_/g, ' ')}
          </span>
          <ConfidenceBadge confidence={step.confidence} />
        </div>
        <p className="text-sm text-text-primary mt-0.5">{step.description}</p>
      </div>
    </div>
  );
}

export function PlanResultDisplay({
  result,
  onApprove,
  onReject,
  isExecuting = false,
}: PlanResultDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!result.success) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
        <div className="flex items-center gap-2 text-red-400">
          <XCircle className="h-4 w-4" />
          <span className="text-sm font-medium">Plan creation failed</span>
        </div>
        {result.error && <p className="mt-1 text-xs text-text-muted">{result.error}</p>}
      </div>
    );
  }

  const isPending = result.status === 'pending_approval';
  const isApproved = result.status === 'approved';
  const isAutoExecute = result.auto_execute;

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        isPending && 'border-blue-500/30 bg-blue-500/5',
        isApproved && 'border-green-500/30 bg-green-500/5',
        !isPending && !isApproved && 'border-border-default bg-elevated'
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-overlay/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <button className="text-text-muted hover:text-text-secondary">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-text-primary truncate">{result.title}</h4>
            {result.confidence_score !== undefined && (
              <ConfidenceBadge confidence={result.confidence_score} />
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{result.description}</p>
        </div>

        {/* Status badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium',
            isPending && 'bg-blue-500/20 text-blue-400',
            isApproved && 'bg-green-500/20 text-green-400',
            isAutoExecute && 'bg-green-500/20 text-green-400'
          )}
        >
          {isExecuting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Executing
            </>
          ) : isAutoExecute ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Auto-approved
            </>
          ) : isApproved ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Approved
            </>
          ) : isPending ? (
            <>
              <Circle className="h-3 w-3" />
              Pending
            </>
          ) : (
            result.status
          )}
        </div>
      </div>

      {/* Steps */}
      {isExpanded && result.steps && result.steps.length > 0 && (
        <div className="border-t border-border-subtle px-3 py-2 space-y-1">
          <div className="text-xs text-text-muted font-medium mb-2">
            {result.steps.length} step{result.steps.length !== 1 ? 's' : ''}
          </div>
          {result.steps.map((step, idx) => (
            <StepItem key={step.order} step={step} index={idx} />
          ))}
        </div>
      )}

      {/* Actions for pending approval */}
      {isPending && !isAutoExecute && onApprove && onReject && (
        <div className="border-t border-border-subtle p-3 flex items-center justify-end gap-2">
          <button
            onClick={onReject}
            className="rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-text-secondary hover:bg-overlay transition-colors"
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            Approve & Execute
          </button>
        </div>
      )}
    </div>
  );
}
