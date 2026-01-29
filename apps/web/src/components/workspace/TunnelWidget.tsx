'use client';

import { useState } from 'react';
import {
  Copy,
  ExternalLink,
  Loader2,
  Trash2,
  Terminal,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTunnels } from '@/hooks/useTunnels';
import { useSSHTunnel } from '@/hooks/useSSHTunnel';
import { cn } from '@/lib/utils';

interface TunnelWidgetProps {
  workspaceId: string | null;
}

export function TunnelWidget({ workspaceId }: TunnelWidgetProps) {
  const { tunnels, loading, error, exposePort, unexposePort } = useTunnels(workspaceId);
  const {
    sshTunnel,
    loading: sshLoading,
    error: sshError,
    enable: enableSSH,
    disable: disableSSH,
    enabling,
    disabling,
  } = useSSHTunnel(workspaceId);
  const [portInput, setPortInput] = useState('');
  const [exposing, setExposing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSSHConfig, setShowSSHConfig] = useState(false);

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

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!workspaceId) {
    return (
      <div className="h-full flex items-center justify-center px-4 py-6 text-center">
        <p className="text-sm text-text-muted">
          No workspace yet. Start a session to expose ports.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 overflow-auto">
      {/* Error messages */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-accent-error">
          <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-accent-error" />
          <p className="flex-1">{error}</p>
        </div>
      )}
      {sshError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-accent-error">
          <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-accent-error" />
          <p className="flex-1">{sshError}</p>
        </div>
      )}

      {/* VS Code Remote-SSH Section */}
      <div className="space-y-3 border-b border-border-subtle pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-text-muted" />
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                VS Code Remote-SSH
              </h3>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Connect via SSH from your local VS Code.
              </p>
            </div>
          </div>
        </div>

        {sshLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        ) : sshTunnel?.enabled ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-overlay/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-primary">SSH Tunnel</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    sshTunnel.status === 'running'
                      ? 'bg-green-500/10 text-accent-success'
                      : sshTunnel.status === 'starting'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-text-muted/15 text-text-muted'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      sshTunnel.status === 'running'
                        ? 'bg-accent-success'
                        : sshTunnel.status === 'starting'
                          ? 'bg-amber-500'
                          : 'bg-text-muted'
                    )}
                  />
                  {sshTunnel.status || 'enabled'}
                </span>
              </div>

              {/* Connection command */}
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate text-xs text-text-secondary font-mono bg-surface px-2 py-1 rounded">
                  {sshTunnel.connection_string || `ssh podex@${sshTunnel.hostname}`}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      sshTunnel.connection_string || `ssh podex@${sshTunnel.hostname}`,
                      'ssh-cmd'
                    )
                  }
                  className="shrink-0 rounded p-1 text-text-muted hover:bg-overlay hover:text-text-primary"
                  title="Copy command"
                >
                  {copied === 'ssh-cmd' ? (
                    <Check className="h-4 w-4 text-accent-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* SSH Config toggle */}
              <button
                type="button"
                onClick={() => setShowSSHConfig(!showSSHConfig)}
                className="flex items-center gap-1 text-xs text-accent-primary hover:underline"
              >
                {showSSHConfig ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                SSH Config
              </button>

              {showSSHConfig && sshTunnel.ssh_config_snippet && (
                <div className="relative">
                  <pre className="text-[10px] text-text-muted font-mono bg-surface p-2 rounded overflow-x-auto whitespace-pre">
                    {sshTunnel.ssh_config_snippet}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copyText(sshTunnel.ssh_config_snippet!, 'ssh-config')}
                    className="absolute top-1 right-1 rounded p-1 text-text-muted hover:bg-overlay hover:text-text-primary"
                    title="Copy config"
                  >
                    {copied === 'ssh-config' ? (
                      <Check className="h-3 w-3 text-accent-success" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
              )}

              {/* Disable button */}
              <button
                type="button"
                onClick={disableSSH}
                disabled={disabling}
                className="mt-1 flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs text-accent-error hover:bg-red-500/10 disabled:opacity-50"
              >
                {disabling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Disable SSH
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-subtle/70 bg-surface-hover/40 px-3 py-4 text-center">
            <p className="text-sm font-medium text-text-secondary">SSH not enabled</p>
            <p className="mt-1 text-xs text-text-muted">
              Enable SSH to connect with VS Code Remote-SSH.
            </p>
            <button
              type="button"
              onClick={enableSSH}
              disabled={enabling}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
            >
              {enabling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <Terminal className="h-4 w-4" />
                  Enable SSH
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* HTTP Port Tunnels Section */}
      {tunnels.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Public URLs
              </h3>
              <p className="mt-0.5 text-xs text-text-tertiary">
                Secure links to your local services.
              </p>
            </div>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-muted">
              {tunnels.length} {tunnels.length === 1 ? 'tunnel' : 'tunnels'}
            </span>
          </div>
          {tunnels.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-overlay/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-text-primary">Port {t.port}</span>
                  <span className="text-[11px] text-text-tertiary truncate">
                    {t.public_url.replace(/^https?:\/\//, '')}
                  </span>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                    t.status === 'running'
                      ? 'bg-green-500/10 text-accent-success'
                      : t.status === 'starting'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-text-muted/15 text-text-muted'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      t.status === 'running'
                        ? 'bg-accent-success'
                        : t.status === 'starting'
                          ? 'bg-amber-500'
                          : 'bg-text-muted'
                    )}
                  />
                  {t.status}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
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
                <span className="text-xs text-accent-success">Copied to clipboard</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="rounded-lg border border-dashed border-border-subtle/70 bg-surface-hover/40 px-3 py-4 text-center">
            <p className="text-sm font-medium text-text-secondary">No ports exposed</p>
            <p className="mt-1 text-xs text-text-muted">
              Expose a port below to create a shareable HTTPS URL for a local service.
            </p>
          </div>
        )
      )}

      <div className="space-y-2 border-t border-border-subtle pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Expose port
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary">
              Start your dev server, then publish it with one click.
            </p>
          </div>
        </div>
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
            className="inline-flex items-center justify-center rounded-lg bg-accent-primary px-3 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
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
