/**
 * Result displays for memory tools.
 */

import React from 'react';
import { Brain } from 'lucide-react';
import type { ResultComponentProps } from './types';

export const StoreMemoryResult = React.memo<ResultComponentProps>(function StoreMemoryResult({
  result,
}) {
  const memoryType = result.memory_type as string;
  const memoryId = result.memory_id as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Memory Stored</span>
        <span className="text-xs text-accent-primary ml-auto capitalize">{memoryType}</span>
      </div>
      {memoryId && <div className="mt-1 text-xs text-text-muted font-mono">ID: {memoryId}</div>}
    </div>
  );
});

export const RecallMemoryResult = React.memo<ResultComponentProps>(function RecallMemoryResult({
  result,
}) {
  const query = result.query as string;
  const memories = (result.memories as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Recalled: &quot;{query}&quot;</span>
        <span className="text-xs text-text-muted ml-auto">{count} found</span>
      </div>
      {memories.length > 0 && (
        <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
          {memories.slice(0, 3).map((m, i) => (
            <div key={i} className="text-xs text-text-secondary truncate">
              <span className="text-accent-primary">[{m.type as string}]</span>{' '}
              {m.content as string}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
