/**
 * Result displays for file tools.
 */

import React from 'react';
import { FileText, Download, FolderOpen, Folder, File, Search } from 'lucide-react';
import type { ResultComponentProps } from './types';
import { formatBytes } from './helpers';

export const ReadFileResult = React.memo<ResultComponentProps>(function ReadFileResult({ result }) {
  const path = result.path as string;
  const size = result.size as number;
  const content = result.content as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {path?.split('/').pop()}
        </span>
        {size && <span className="text-xs text-text-muted">{formatBytes(size)}</span>}
      </div>
      {path && <div className="mt-1 text-xs text-text-muted font-mono truncate">{path}</div>}
      {content && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View content
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-32 overflow-y-auto">
            {content.slice(0, 1000)}
            {content.length > 1000 ? '...' : ''}
          </pre>
        </details>
      )}
    </div>
  );
});

export const WriteFileResult = React.memo<ResultComponentProps>(function WriteFileResult({
  result,
}) {
  const path = result.path as string;
  const size = result.size as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {path?.split('/').pop()}
        </span>
        <span className="text-xs text-accent-success">Written</span>
      </div>
      {path && <div className="mt-1 text-xs text-text-muted font-mono truncate">{path}</div>}
      {size && <div className="mt-1 text-xs text-text-secondary">{formatBytes(size)}</div>}
    </div>
  );
});

export const ListDirectoryResult = React.memo<ResultComponentProps>(function ListDirectoryResult({
  result,
}) {
  const path = result.path as string;
  const entries = (result.entries as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-accent-warning" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">{path}</span>
        <span className="text-xs text-text-muted">{count} items</span>
      </div>
      {entries.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
          {entries.slice(0, 10).map((entry, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              {entry.type === 'directory' ? (
                <Folder className="h-3 w-3 text-accent-warning" />
              ) : (
                <File className="h-3 w-3 text-text-muted" />
              )}
              <span className="text-text-secondary truncate">{entry.name as string}</span>
            </div>
          ))}
          {entries.length > 10 && (
            <div className="text-xs text-text-muted">+{entries.length - 10} more</div>
          )}
        </div>
      )}
    </div>
  );
});

export const SearchCodeResult = React.memo<ResultComponentProps>(function SearchCodeResult({
  result,
}) {
  const query = result.query as string;
  const results = (result.results as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Search: &quot;{query}&quot;</span>
        <span className="text-xs text-text-muted ml-auto">{count} results</span>
      </div>
      {results.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {results.slice(0, 5).map((r, i) => (
            <div key={i} className="text-xs">
              <span className="text-accent-primary font-mono">
                {r.file as string}:{r.line as number}
              </span>
              <div className="text-text-muted truncate pl-2">{r.content as string}</div>
            </div>
          ))}
          {results.length > 5 && (
            <div className="text-xs text-text-muted">+{results.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
});
