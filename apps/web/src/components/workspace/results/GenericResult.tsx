/**
 * Generic result displays for simple/unknown results.
 */

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn, getFriendlyToolName } from '@/lib/utils';
import type { ToolResult } from './types';

interface SimpleResultProps {
  result: unknown;
}

/**
 * Simple result display for unparseable results.
 */
export const SimpleResult = React.memo<SimpleResultProps>(function SimpleResult({ result }) {
  const str = String(result);
  if (str.length > 200) {
    return (
      <details className="mt-1">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
          View result
        </summary>
        <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
          {str}
        </pre>
      </details>
    );
  }
  return (
    <div className="mt-1 pl-4 text-text-muted text-xs whitespace-pre-wrap break-words">{str}</div>
  );
});

interface GenericSuccessResultProps {
  result: ToolResult;
  toolName: string;
}

/**
 * Generic success/failure result for unknown tools.
 */
export const GenericSuccessResult = React.memo<GenericSuccessResultProps>(
  function GenericSuccessResult({ result, toolName }) {
    const success = result.success as boolean;
    const message = (result.message as string) || (result.error as string);
    const friendlyName = getFriendlyToolName(toolName);

    return (
      <div
        className={cn(
          'mt-2 p-2 rounded-md text-xs',
          success
            ? 'bg-accent-success/10 border border-accent-success/20'
            : 'bg-accent-error/10 border border-accent-error/20'
        )}
      >
        <div className="flex items-center gap-2">
          {success ? (
            <CheckCircle2 className="h-4 w-4 text-accent-success" />
          ) : (
            <XCircle className="h-4 w-4 text-accent-error" />
          )}
          <span className="font-medium text-text-primary">{friendlyName}</span>
          <span className={cn('ml-auto', success ? 'text-accent-success' : 'text-accent-error')}>
            {success ? 'Success' : 'Failed'}
          </span>
        </div>
        {message && (
          <div className="mt-1 text-text-muted whitespace-pre-wrap break-words">{message}</div>
        )}
      </div>
    );
  }
);
