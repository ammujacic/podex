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
  Globe,
  Plus,
} from 'lucide-react';
import { useTunnels } from '@/hooks/useTunnels';
import { useSSHTunnel } from '@/hooks/useSSHTunnel';
import { cn } from '@/lib/utils';

interface TunnelWidgetProps {
  workspaceId: string | null;
}

// Simple status badge
function StatusBadge({ status }: { status: string | null }) {
  const isRunning = status === 'running';
  const isStarting = status === 'starting';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium',
        isRunning && 'bg-emerald-500/15 text-emerald-500',
        isStarting && 'bg-amber-500/15 text-amber-500',
        !isRunning && !isStarting && 'bg-text-muted/10 text-text-muted'
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isRunning && 'bg-emerald-500',
          isStarting && 'bg-amber-500 animate-pulse',
          !isRunning && !isStarting && 'bg-text-muted'
        )}
      />
      {status || 'offline'}
    </span>
  );
}

// Copy button with feedback
function CopyButton({
  text: _text,
  copied,
  onCopy,
  size = 'default',
}: {
  text: string;
  copied: boolean;
  onCopy: () => void;
  size?: 'default' | 'small';
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        'rounded-md text-text-muted hover:text-text-primary hover:bg-elevated transition-colors',
        size === 'default' && 'p-1.5',
        size === 'small' && 'p-1'
      )}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <Check className={cn('text-emerald-500', size === 'default' ? 'w-4 h-4' : 'w-3.5 h-3.5')} />
      ) : (
        <Copy className={size === 'default' ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
      )}
    </button>
  );
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
      <div className="h-full flex items-center justify-center px-4 py-8">
        <p className="text-sm text-text-muted text-center">
          Start a session to expose ports and enable SSH.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Errors */}
      {(error || sshError) && (
        <div className="p-3 space-y-2 border-b border-border-subtle">
          {error && (
            <p className="text-xs text-accent-error bg-accent-error/10 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          {sshError && (
            <p className="text-xs text-accent-error bg-accent-error/10 px-3 py-2 rounded-lg">
              {sshError}
            </p>
          )}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* SSH Section */}
        <div className="p-3 border-b border-border-subtle">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-text-muted" />
            <span className="text-xs font-semibold text-text-primary">SSH Access</span>
          </div>

          {sshLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : sshTunnel?.enabled ? (
            <div className="space-y-3">
              {/* Status row */}
              <div className="flex items-center justify-between">
                <StatusBadge status={sshTunnel.status} />
                <button
                  type="button"
                  onClick={disableSSH}
                  disabled={disabling}
                  className="text-xs text-text-muted hover:text-accent-error transition-colors disabled:opacity-50"
                >
                  {disabling ? 'Disabling...' : 'Disable'}
                </button>
              </div>

              {/* Command box */}
              <div className="flex items-center gap-2 bg-elevated rounded-lg px-3 py-2">
                <code className="flex-1 text-xs font-mono text-text-primary truncate">
                  {sshTunnel.connection_string || `ssh podex@${sshTunnel.hostname}`}
                </code>
                <CopyButton
                  text={sshTunnel.connection_string || `ssh podex@${sshTunnel.hostname}`}
                  copied={copied === 'ssh-cmd'}
                  onCopy={() =>
                    copyText(
                      sshTunnel.connection_string || `ssh podex@${sshTunnel.hostname}`,
                      'ssh-cmd'
                    )
                  }
                  size="small"
                />
              </div>

              {/* SSH Config toggle */}
              <button
                type="button"
                onClick={() => setShowSSHConfig(!showSSHConfig)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                {showSSHConfig ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                SSH Config
              </button>

              {showSSHConfig && sshTunnel.ssh_config_snippet && (
                <div className="relative bg-elevated rounded-lg">
                  <pre className="p-3 text-[11px] text-text-muted font-mono overflow-x-auto whitespace-pre">
                    {sshTunnel.ssh_config_snippet}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton
                      text={sshTunnel.ssh_config_snippet}
                      copied={copied === 'ssh-config'}
                      onCopy={() => copyText(sshTunnel.ssh_config_snippet!, 'ssh-config')}
                      size="small"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={enableSSH}
              disabled={enabling}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-border-subtle bg-elevated/50 text-text-secondary hover:bg-elevated hover:border-border-default transition-colors disabled:opacity-50"
            >
              {enabling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Terminal className="w-4 h-4" />
              )}
              <span className="text-sm font-medium">{enabling ? 'Enabling...' : 'Enable SSH'}</span>
            </button>
          )}
        </div>

        {/* Port Tunnels Section */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-text-muted" />
              <span className="text-xs font-semibold text-text-primary">Exposed Ports</span>
            </div>
            {tunnels.length > 0 && (
              <span className="text-xs text-text-muted">{tunnels.length}</span>
            )}
          </div>

          {loading && tunnels.length === 0 ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            </div>
          ) : tunnels.length > 0 ? (
            <div className="space-y-2">
              {tunnels.map((t) => (
                <div key={t.id} className="bg-elevated rounded-lg p-3 space-y-2">
                  {/* Port + Status + Actions */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary font-mono">
                        :{t.port}
                      </span>
                      <StatusBadge status={t.status} />
                    </div>
                    <div className="flex items-center">
                      <CopyButton
                        text={t.public_url}
                        copied={copied === t.public_url}
                        onCopy={() => copyText(t.public_url, t.public_url)}
                        size="small"
                      />
                      <a
                        href={t.public_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface transition-colors"
                        title="Open"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => unexposePort(t.port)}
                        className="p-1 rounded-md text-text-muted hover:text-accent-error hover:bg-accent-error/10 transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* URL */}
                  <a
                    href={t.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-accent-primary hover:underline truncate"
                  >
                    {t.public_url}
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted text-center py-4">No ports exposed yet.</p>
          )}
        </div>
      </div>

      {/* Footer: Expose port input */}
      <div className="shrink-0 p-3 border-t border-border-subtle bg-surface">
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={65535}
            placeholder="Port (e.g. 3000)"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExpose()}
            className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-elevated border border-border-subtle text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/30 transition-colors"
          />
          <button
            type="button"
            onClick={handleExpose}
            disabled={exposing || loading || !portInput.trim()}
            className="h-9 px-4 rounded-lg bg-accent-primary text-white text-sm font-medium hover:bg-accent-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {exposing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Expose
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
