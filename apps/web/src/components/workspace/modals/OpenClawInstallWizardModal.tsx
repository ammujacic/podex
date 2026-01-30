'use client';

import React, { useState } from 'react';
import {
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Copy,
  ExternalLink,
  AlertTriangle,
  Bot,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  runWorkspaceCommand,
  exposePort,
  type WorkspaceExecResponse,
  type TunnelItem,
} from '@/lib/api';

const OPENCLAW_GATEWAY_PORT = 18789;
const DISCORD_DEV_PORTAL = 'https://discord.com/developers/applications';

interface OpenClawInstallWizardModalProps {
  sessionId: string;
  workspaceId: string | null;
  localPodId: string | null;
  onClose: () => void;
}

type Step = 'welcome' | 'install' | 'expose' | 'discord' | 'done';

const STEPS: Step[] = ['welcome', 'install', 'expose', 'discord', 'done'];

export function OpenClawInstallWizardModal({
  sessionId: _sessionId,
  workspaceId,
  localPodId: _localPodId,
  onClose,
}: OpenClawInstallWizardModalProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [installOutput, setInstallOutput] = useState<WorkspaceExecResponse | null>(null);
  const [installLoading, setInstallLoading] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState<TunnelItem | null>(null);
  const [exposeLoading, setExposeLoading] = useState(false);
  const [exposeError, setExposeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const hasWorkspace = !!workspaceId;

  const handleInstall = async () => {
    if (!workspaceId) return;
    setInstallLoading(true);
    setInstallError(null);
    try {
      const res = await runWorkspaceCommand(workspaceId, {
        command: 'npm install -g openclaw@latest',
        timeout: 300,
      });
      setInstallOutput(res);
      if (res.exit_code !== 0) {
        setInstallError(res.stderr || `Exit code ${res.exit_code}`);
      }
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : 'Install failed');
      setInstallOutput(null);
    } finally {
      setInstallLoading(false);
    }
  };

  const handleExpose = async () => {
    if (!workspaceId) return;
    setExposeLoading(true);
    setExposeError(null);
    try {
      const t = await exposePort(workspaceId, OPENCLAW_GATEWAY_PORT);
      setTunnel(t);
    } catch (e) {
      setExposeError(e instanceof Error ? e.message : 'Expose failed');
    } finally {
      setExposeLoading(false);
    }
  };

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

  const next = () => {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1]!);
    else onClose();
  };

  const back = () => {
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]!);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="openclaw-wizard-title"
        className="relative w-full max-w-lg rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Bot className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="openclaw-wizard-title" className="text-lg font-semibold text-text-primary">
                Install OpenClaw
              </h2>
              <p className="text-sm text-text-muted">
                Step {stepIndex + 1} of {STEPS.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-1 border-b border-border-subtle px-6 py-3">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i <= stepIndex ? 'bg-accent-primary' : 'bg-overlay'
              )}
              aria-label={`Step ${i + 1}: ${s}`}
            />
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {step === 'welcome' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Connect OpenClaw to Discord, Slack, and more. This wizard will install OpenClaw in
                your workspace, expose its gateway via a public URL, and guide you through Discord
                setup.
              </p>
              <ul className="space-y-2 text-sm text-text-muted">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-success" />
                  Running workspace (required for tunnels)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-success" />
                  Node.js 22+ in the workspace
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-success" />A Discord application (we'll walk
                  you through it)
                </li>
              </ul>
              {!hasWorkspace && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  No workspace yet. Start a session with a workspace first.
                </div>
              )}
            </div>
          )}

          {step === 'install' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Install OpenClaw globally in the workspace. This may take a minute.
              </p>
              {!installOutput ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleInstall}
                    disabled={installLoading || !workspaceId}
                    className="flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
                  >
                    {installLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Installing…
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4" />
                        Install OpenClaw
                      </>
                    )}
                  </button>
                  {installError && (
                    <pre className="max-h-40 overflow-auto rounded-lg bg-overlay px-3 py-2 text-xs text-accent-error">
                      {installError}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-accent-success">
                    <Check className="h-4 w-4" />
                    OpenClaw installed. Exit code: {installOutput.exit_code}
                  </div>
                  {(installOutput.stdout || installOutput.stderr) && (
                    <pre className="max-h-40 overflow-auto rounded-lg bg-overlay px-3 py-2 text-xs text-text-muted">
                      {installOutput.stdout || installOutput.stderr}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'expose' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Expose OpenClaw's gateway (port {OPENCLAW_GATEWAY_PORT}) so Discord can reach it.
              </p>
              {!tunnel ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleExpose}
                    disabled={exposeLoading || !workspaceId}
                    className="flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50"
                  >
                    {exposeLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Exposing…
                      </>
                    ) : (
                      <>
                        <Globe className="h-4 w-4" />
                        Expose port {OPENCLAW_GATEWAY_PORT}
                      </>
                    )}
                  </button>
                  {exposeError && <p className="text-sm text-accent-error">{exposeError}</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-accent-success">
                    <Check className="h-4 w-4" />
                    Public URL ready
                  </div>
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
                    {copied && <span className="text-xs text-accent-success">Copied</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 'discord' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                Use this URL as your Discord app’s <strong>Interactions Endpoint URL</strong>.
              </p>
              {tunnel && (
                <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-overlay/50 px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-sm">{tunnel.public_url}</code>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="shrink-0 rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              )}
              <ol className="list-inside list-decimal space-y-2 text-sm text-text-muted">
                <li>
                  Open{' '}
                  <a
                    href={DISCORD_DEV_PORTAL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent-primary hover:underline"
                  >
                    Discord Developer Portal
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Create an application (or use an existing one) and add a Bot.</li>
                <li>
                  Under <strong>Bot</strong> → <strong>Interactions Endpoint URL</strong>, set the
                  URL above.
                </li>
                <li>Copy the Bot Token and use it in OpenClaw config (~/.openclaw/config.json).</li>
              </ol>
              <p className="text-sm text-text-muted">
                Then run{' '}
                <code className="rounded bg-overlay px-1 py-0.5">
                  openclaw onboard --install-daemon
                </code>{' '}
                and <code className="rounded bg-overlay px-1 py-0.5">openclaw gateway</code> in your
                workspace terminal.
              </p>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-accent-success">
                <Check className="h-5 w-5" />
                <span className="font-medium">Setup complete</span>
              </div>
              <p className="text-sm text-text-secondary">
                Run <code className="rounded bg-overlay px-1 py-0.5">openclaw gateway</code> in the
                workspace terminal to start the bot. Keep the terminal open. Use the Tunnels panel
                to manage the public URL.
              </p>
              {tunnel && (
                <a
                  href={tunnel.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-accent-primary hover:underline"
                >
                  {tunnel.public_url}
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between border-t border-border-subtle px-6 py-4">
          <button
            type="button"
            onClick={stepIndex > 0 ? back : onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary"
          >
            {stepIndex > 0 ? (
              <>
                <ChevronLeft className="mr-1 inline h-4 w-4" />
                Back
              </>
            ) : (
              'Cancel'
            )}
          </button>
          <button
            type="button"
            onClick={next}
            disabled={
              (step === 'welcome' && !hasWorkspace) ||
              (step === 'install' && (!installOutput || installOutput.exit_code !== 0)) ||
              (step === 'expose' && !tunnel)
            }
            className="flex items-center gap-1 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 'done' ? 'Close' : 'Next'}
            {step !== 'done' && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
