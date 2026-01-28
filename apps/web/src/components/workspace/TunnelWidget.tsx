'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { useTunnels } from '@/hooks/useTunnels';
import { cn } from '@/lib/utils';

interface TunnelWidgetProps {
  workspaceId: string | null;
}

export function TunnelWidget({ workspaceId }: TunnelWidgetProps) {
  const { tunnels, loading, error, exposePort, unexposePort } = useTunnels(workspaceId);
  const [portInput, setPortInput] = useState('');
  const [exposing, setExposing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleExpose = async () => {
    const port = parseInt(portInput, 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) return;
    setExposing(true);
    try {
      await exposePort(port);
      setPortInput('');
    } finally {
      setExposing(false);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">
        No workspace yet. Start a session to expose ports.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-accent-error">{error}</div>
      )}

      {tunnels.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Public URLs
          </h3>
          {tunnels.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-overlay/50 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-muted">Port {t.port}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    t.status === 'running'
                      ? 'bg-green-500/15 text-accent-success'
                      : t.status === 'starting'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-text-muted/20 text-text-muted'
                  )}
                >
                  {t.status}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={t.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-sm text-accent-primary hover:underline"
                >
                  {t.public_url}
                </a>
                <button
                  type="button"
                  onClick={() => copyUrl(t.public_url)}
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-overlay hover:text-text-primary"
                  title="Copy"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <a
                  href={t.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-overlay hover:text-text-primary"
                  title="Open"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => unexposePort(t.port)}
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-accent-error"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {copied === t.public_url && (
                <span className="text-xs text-accent-success">Copied</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && <p className="text-sm text-text-muted">No ports exposed. Add one below.</p>
      )}

      <div className="space-y-2 border-t border-border-subtle pt-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Expose port</h3>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={65535}
            placeholder="e.g. 8080"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExpose()}
            className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
          <button
            type="button"
            onClick={handleExpose}
            disabled={exposing || loading || !portInput.trim()}
            className="rounded-lg bg-accent-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {exposing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Expose'}
          </button>
        </div>
      </div>

      {loading && tunnels.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      )}
    </div>
  );
}
