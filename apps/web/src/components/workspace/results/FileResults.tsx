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

  // Sort entries: directories first, then files, alphabetically
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return (a.name as string).localeCompare(b.name as string);
  });

  const directories = sortedEntries.filter((e) => e.type === 'directory');
  const files = sortedEntries.filter((e) => e.type !== 'directory');

  return (
    <div className="mt-2 rounded-lg bg-void border border-border-default overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border-default">
        <FolderOpen className="h-4 w-4 text-text-muted" />
        <span className="text-sm font-mono text-text-primary truncate flex-1">{path || '.'}</span>
        <span className="text-xs text-text-muted bg-overlay px-2 py-0.5 rounded-full">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* File tree */}
      {entries.length > 0 && (
        <div className="py-1 max-h-48 overflow-y-auto">
          {sortedEntries.slice(0, 20).map((entry, i) => {
            const isDir = entry.type === 'directory';
            const name = entry.name as string;
            const size = entry.size as number | undefined;

            return (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-elevated transition-colors group"
              >
                {isDir ? (
                  <Folder className="h-4 w-4 text-accent-primary flex-shrink-0" />
                ) : (
                  <File className="h-4 w-4 text-text-primary flex-shrink-0" />
                )}
                <span className="text-sm font-mono truncate flex-1 text-text-primary">
                  {name}
                  {isDir && '/'}
                </span>
                {size !== undefined && !isDir && (
                  <span className="text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatBytes(size)}
                  </span>
                )}
              </div>
            );
          })}
          {entries.length > 20 && (
            <div className="px-3 py-2 text-xs text-text-muted border-t border-border-default">
              +{entries.length - 20} more items
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <div className="px-3 py-4 text-center text-sm text-text-muted">Empty directory</div>
      )}

      {/* Footer summary */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-elevated border-t border-border-default text-xs text-text-muted">
          {directories.length > 0 && (
            <span className="flex items-center gap-1">
              <Folder className="h-3 w-3 text-accent-primary" />
              {directories.length} {directories.length === 1 ? 'folder' : 'folders'}
            </span>
          )}
          {files.length > 0 && (
            <span className="flex items-center gap-1">
              <File className="h-3 w-3" />
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export const SearchCodeResult = React.memo<ResultComponentProps>(function SearchCodeResult({
  result,
}) {
  // Backend returns "pattern" but some tools may return "query"
  const query = (result.query || result.pattern) as string;
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
