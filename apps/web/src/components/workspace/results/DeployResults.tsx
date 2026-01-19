/**
 * Result displays for deploy tools.
 */

import React from 'react';
import { Rocket, Play, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const DeployPreviewResult = React.memo<ResultComponentProps>(function DeployPreviewResult({
  result,
}) {
  const url = result.url as string;
  const status = result.status as string;
  const previewId = result.preview_id as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Rocket className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Preview Deployed</span>
        <span className="text-xs text-accent-success ml-auto capitalize">{status}</span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-accent-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          {url}
        </a>
      )}
      {previewId && <div className="mt-1 text-xs text-text-muted font-mono">ID: {previewId}</div>}
    </div>
  );
});

export const PreviewStatusResult = React.memo<ResultComponentProps>(function PreviewStatusResult({
  result,
}) {
  const preview = result.preview as Record<string, unknown>;
  const status = preview?.status as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Rocket className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Preview Status</span>
        <span
          className={cn(
            'text-xs ml-auto capitalize',
            status === 'running' && 'text-accent-success',
            status === 'stopped' && 'text-text-muted',
            status === 'error' && 'text-accent-error'
          )}
        >
          {status}
        </span>
      </div>
    </div>
  );
});

export const E2ETestsResult = React.memo<ResultComponentProps>(function E2ETestsResult({ result }) {
  const summary = result.summary as Record<string, unknown>;
  const allPassed = result.all_passed as boolean;

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md',
        allPassed
          ? 'bg-accent-success/10 border border-accent-success/20'
          : 'bg-accent-error/10 border border-accent-error/20'
      )}
    >
      <div className="flex items-center gap-2">
        <Play className={cn('h-4 w-4', allPassed ? 'text-accent-success' : 'text-accent-error')} />
        <span className="text-sm font-medium text-text-primary">E2E Tests</span>
        <span
          className={cn('text-xs ml-auto', allPassed ? 'text-accent-success' : 'text-accent-error')}
        >
          {allPassed ? 'All Passed' : 'Failed'}
        </span>
      </div>
      {summary && (
        <div className="mt-1 flex gap-3 text-xs">
          <span className="text-accent-success">{summary.passed as number} passed</span>
          <span className="text-accent-error">{summary.failed as number} failed</span>
          <span className="text-text-muted">{summary.skipped as number} skipped</span>
        </div>
      )}
    </div>
  );
});
