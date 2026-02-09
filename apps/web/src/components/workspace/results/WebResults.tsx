/**
 * Result displays for web tools.
 */

import React from 'react';
import { Globe, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const FetchUrlResult = React.memo<ResultComponentProps>(function FetchUrlResult({ result }) {
  const url = result.url as string;
  const title = result.title as string;
  const statusCode = result.status_code as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {title || 'Fetched URL'}
        </span>
        <span
          className={cn(
            'text-xs',
            statusCode === 200 ? 'text-accent-success' : 'text-accent-warning'
          )}
        >
          {statusCode}
        </span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-text-muted hover:text-accent-primary truncate block"
        >
          {url}
        </a>
      )}
    </div>
  );
});

export const SearchWebResult = React.memo<ResultComponentProps>(function SearchWebResult({
  result,
}) {
  const query = result.query as string;
  const results = (result.results as Array<Record<string, unknown>>) || [];
  const numResults = result.num_results as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Search: &quot;{query}&quot;</span>
        <span className="text-xs text-text-muted ml-auto">{numResults} results</span>
      </div>
      {results.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className="text-xs">
              <a
                href={r.url as string}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary hover:underline font-medium"
              >
                {r.title as string}
              </a>
              <div className="text-text-muted truncate">{r.snippet as string}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const ScreenshotResult = React.memo<ResultComponentProps>(function ScreenshotResult({
  result,
}) {
  const url = result.url as string;
  const title = result.title as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Screenshot captured</span>
      </div>
      {title && <div className="mt-1 text-xs text-text-secondary">{title}</div>}
      {url && <div className="mt-1 text-xs text-text-muted truncate">{url}</div>}
    </div>
  );
});
