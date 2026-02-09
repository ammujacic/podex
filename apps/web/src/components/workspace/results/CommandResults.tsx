/**
 * Result displays for command tools.
 */

import React from 'react';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const RunCommandResult = React.memo<ResultComponentProps>(function RunCommandResult({
  result,
}) {
  const command = result.command as string;
  const exitCode = result.exit_code as number;
  const stdout = result.stdout as string;
  const stderr = result.stderr as string;
  const success = exitCode === 0;

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md',
        success
          ? 'bg-elevated border border-border-subtle'
          : 'bg-accent-error/10 border border-accent-error/20'
      )}
    >
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-text-secondary" />
        <code className="text-xs text-text-primary font-mono truncate flex-1">{command}</code>
        <span className={cn('text-xs', success ? 'text-accent-success' : 'text-accent-error')}>
          Exit {exitCode}
        </span>
      </div>
      {(stdout || stderr) && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View output
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-32 overflow-y-auto font-mono">
            {stdout || stderr}
          </pre>
        </details>
      )}
    </div>
  );
});
