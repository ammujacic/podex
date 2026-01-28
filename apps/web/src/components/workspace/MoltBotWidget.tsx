'use client';

import { useState } from 'react';
import {
  Bot,
  Copy,
  ExternalLink,
  Loader2,
  AlertTriangle,
  MessageCircle,
  Play,
  Unplug,
} from 'lucide-react';
import { useTunnels } from '@/hooks/useTunnels';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';

const MOLTBOT_GATEWAY_PORT = 18789;
const DISCORD_DEV_PORTAL = 'https://discord.com/developers/applications';

interface MoltBotWidgetProps {
  workspaceId: string | null;
  localPodId: string | null;
}

export function MoltBotWidget({ workspaceId, localPodId }: MoltBotWidgetProps) {
  const openModal = useUIStore((s) => s.openModal);
  const sendTerminalCommand = useUIStore((s) => s.sendTerminalCommand);
  const { tunnels, loading, error, unexposePort, refetch } = useTunnels(workspaceId);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const tunnel = tunnels.find((t) => t.port === MOLTBOT_GATEWAY_PORT);
  const isLocalPod = !!localPodId;
  const hasWorkspace = !!workspaceId;
  const canSetup = isLocalPod && hasWorkspace;
  const connected = !!tunnel;

  const copyUrl = async () => {
    if (!tunnel?.public_url) return;
    try {
      await navigator.clipboard.writeText(tunnel.public_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleDisconnect = async () => {
    if (!workspaceId) return;
    setDisconnecting(true);
    try {
      await unexposePort(MOLTBOT_GATEWAY_PORT);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRunGateway = () => {
    sendTerminalCommand('moltbot gateway');
  };

  if (!canSetup) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
            <MessageCircle className="h-5 w-5 text-accent-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">MoltBot (ClawdBot)</h3>
            <p className="text-xs text-text-muted">Connect to Discord, Slack & more</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          MoltBot needs a workspace on a <strong>local pod</strong> for tunnels. Start a session
          with a local pod, then return here to set it up.
        </p>
        {!hasWorkspace && (
          <p className="text-xs text-text-muted">
            No workspace yet. Start a session with a workspace first.
          </p>
        )}
      </div>
    );
  }

  if (loading && !connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        <p className="text-sm text-text-muted">Checking MoltBot…</p>
      </div>
    );
  }

  if (error && !connected) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
            <MessageCircle className="h-5 w-5 text-accent-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">MoltBot</h3>
            <p className="text-xs text-text-muted">Connect to Discord, Slack & more</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-accent-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
            <MessageCircle className="h-5 w-5 text-accent-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary">MoltBot (ClawdBot)</h3>
            <p className="text-xs text-text-muted">Connect to Discord, Slack & more</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          Install MoltBot, expose its gateway, and connect Discord in a few steps.
        </p>
        <button
          type="button"
          onClick={() => openModal('moltbot-wizard')}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent-primary px-4 py-3 text-sm font-medium text-white hover:bg-accent-primary/90"
        >
          <Bot className="h-4 w-4" />
          Get started
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
          <MessageCircle className="h-5 w-5 text-accent-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text-primary">MoltBot</h3>
          <div className="flex items-center gap-1.5 text-xs text-text-muted">
            <span
              className={cn(
                'inline-flex h-1.5 w-1.5 rounded-full',
                tunnel.status === 'running' ? 'bg-accent-success' : 'bg-amber-500'
              )}
            />
            Tunnel active
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Public URL</p>
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-overlay/50 px-3 py-2">
          <a
            href={tunnel.public_url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm text-accent-primary hover:underline"
          >
            {tunnel.public_url}
          </a>
          <button
            type="button"
            onClick={copyUrl}
            className="shrink-0 rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
            title="Copy"
          >
            <Copy className="h-4 w-4" />
          </button>
          <a
            href={tunnel.public_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
            title="Open"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        {copied && <span className="text-xs text-accent-success">Copied</span>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Controls</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleRunGateway}
            className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-overlay"
          >
            <Play className="h-4 w-4 text-accent-success" />
            Run gateway in terminal
          </button>
          <a
            href={DISCORD_DEV_PORTAL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary"
          >
            <ExternalLink className="h-4 w-4" />
            Discord Developer Portal
          </a>
        </div>
      </div>

      <div className="border-t border-border-subtle pt-4">
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text-muted hover:bg-red-500/10 hover:text-accent-error disabled:opacity-50"
        >
          {disconnecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          Disconnect
        </button>
        <p className="mt-2 text-xs text-text-muted">
          Stops the tunnel. Stop the gateway in the terminal (Ctrl+C) if it&apos;s running.
        </p>
      </div>
    </div>
  );
}
