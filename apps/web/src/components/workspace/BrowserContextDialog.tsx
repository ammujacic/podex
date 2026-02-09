'use client';

import React, { useMemo } from 'react';
import {
  X,
  Globe,
  AlertCircle,
  AlertTriangle,
  Info,
  Terminal,
  Network,
  FileCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useBrowserContextStore,
  useIsCaptureEnabled,
  useIsAutoInclude,
  useHasPendingContext,
  estimateContextSize,
  formatContextSize,
  type BrowserContextData,
} from '@/stores/browserContext';

interface BrowserContextDialogProps {
  agentId: string;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dialog for previewing and configuring browser context before sending to an agent.
 * Shows captured console logs, network requests, errors, and HTML snapshot with size estimation.
 */
export function BrowserContextDialog({ agentId, isOpen, onClose }: BrowserContextDialogProps) {
  const captureEnabled = useIsCaptureEnabled(agentId);
  const autoInclude = useIsAutoInclude(agentId);
  const hasPendingContext = useHasPendingContext(agentId);

  const toggleCapture = useBrowserContextStore((s) => s.toggleCapture);
  const toggleAutoInclude = useBrowserContextStore((s) => s.toggleAutoInclude);
  const captureContext = useBrowserContextStore((s) => s.captureContext);
  const setPendingContext = useBrowserContextStore((s) => s.setPendingContext);
  const clearPendingContext = useBrowserContextStore((s) => s.clearPendingContext);
  const getPendingContext = useBrowserContextStore((s) => s.getPendingContext);

  // Get or capture context for preview
  const context = useMemo<BrowserContextData | null>(() => {
    if (hasPendingContext) {
      return getPendingContext(agentId);
    }
    if (captureEnabled) {
      // Capture fresh context for preview
      return captureContext(agentId);
    }
    return null;
  }, [agentId, captureEnabled, hasPendingContext, captureContext, getPendingContext]);

  const contextSize = useMemo(() => {
    if (!context) return 0;
    return estimateContextSize(context);
  }, [context]);

  if (!isOpen) return null;

  const handleCaptureNow = () => {
    const newContext = captureContext(agentId);
    setPendingContext(agentId, newContext);
  };

  const handleClearContext = () => {
    clearPendingContext(agentId);
  };

  const errorCount = context?.errors?.length ?? 0;
  const consoleCount = context?.consoleLogs?.length ?? 0;
  const networkCount = context?.networkRequests?.length ?? 0;
  const hasHtml = !!context?.htmlSnapshot;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-primary">Browser Context</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-elevated text-secondary hover:text-primary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Settings */}
          <div className="flex flex-wrap gap-4 p-3 bg-elevated rounded-lg">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={captureEnabled}
                onChange={() => toggleCapture(agentId)}
                className="rounded border-border bg-surface text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-sm text-primary">Enable capture</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoInclude}
                onChange={() => toggleAutoInclude(agentId)}
                className="rounded border-border bg-surface text-emerald-500 focus:ring-emerald-500"
              />
              <span className="text-sm text-primary">Auto-include with messages</span>
            </label>
          </div>

          {/* Context Preview */}
          {context ? (
            <>
              {/* URL and Metadata */}
              <div className="p-3 bg-elevated rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary">URL:</span>
                  <span className="text-primary font-mono truncate">{context.url}</span>
                </div>
                {context.metadata?.viewportSize && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-secondary">Viewport:</span>
                    <span className="text-primary">
                      {context.metadata.viewportSize.width}x{context.metadata.viewportSize.height}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary">Captured:</span>
                  <span className="text-primary">
                    {new Date(context.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Summary Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard
                  icon={<AlertCircle className="h-4 w-4" />}
                  label="Errors"
                  count={errorCount}
                  color={errorCount > 0 ? 'text-red-400' : 'text-secondary'}
                />
                <StatCard
                  icon={<Terminal className="h-4 w-4" />}
                  label="Console"
                  count={consoleCount}
                  color="text-secondary"
                />
                <StatCard
                  icon={<Network className="h-4 w-4" />}
                  label="Network"
                  count={networkCount}
                  color="text-secondary"
                />
                <StatCard
                  icon={<FileCode className="h-4 w-4" />}
                  label="HTML"
                  count={hasHtml ? 1 : 0}
                  color="text-secondary"
                />
              </div>

              {/* Errors Section */}
              {errorCount > 0 && (
                <ContextSection
                  title="JavaScript Errors"
                  icon={<AlertCircle className="h-4 w-4 text-red-400" />}
                >
                  <div className="space-y-2">
                    {context.errors.slice(0, 5).map((error, idx) => (
                      <div key={idx} className="p-2 bg-red-500/10 rounded border border-red-500/20">
                        <div className="text-sm text-red-400 font-medium">{error.type}</div>
                        <div className="text-sm text-primary truncate">{error.message}</div>
                        {error.stack && (
                          <pre className="mt-1 text-xs text-secondary overflow-x-auto max-h-20">
                            {error.stack.split('\n').slice(0, 3).join('\n')}
                          </pre>
                        )}
                      </div>
                    ))}
                    {errorCount > 5 && (
                      <div className="text-xs text-secondary text-center">
                        +{errorCount - 5} more errors
                      </div>
                    )}
                  </div>
                </ContextSection>
              )}

              {/* Console Section */}
              {consoleCount > 0 && (
                <ContextSection
                  title="Console Logs"
                  icon={<Terminal className="h-4 w-4 text-blue-400" />}
                >
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {context.consoleLogs.slice(0, 20).map((log, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'flex items-start gap-2 text-xs p-1 rounded',
                          log.level === 'error' && 'bg-red-500/10',
                          log.level === 'warn' && 'bg-yellow-500/10'
                        )}
                      >
                        <ConsoleIcon level={log.level} />
                        <span className="text-primary truncate flex-1">{log.message}</span>
                      </div>
                    ))}
                    {consoleCount > 20 && (
                      <div className="text-xs text-secondary text-center py-1">
                        +{consoleCount - 20} more entries
                      </div>
                    )}
                  </div>
                </ContextSection>
              )}

              {/* Network Section */}
              {networkCount > 0 && (
                <ContextSection
                  title="Network Requests"
                  icon={<Network className="h-4 w-4 text-purple-400" />}
                >
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {context.networkRequests.slice(0, 15).map((req, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs p-1 rounded hover:bg-surface"
                      >
                        <StatusBadge status={req.status} />
                        <span className="font-mono text-secondary w-12">{req.method}</span>
                        <span className="text-primary truncate flex-1">{req.url}</span>
                        {req.duration && <span className="text-secondary">{req.duration}ms</span>}
                      </div>
                    ))}
                    {networkCount > 15 && (
                      <div className="text-xs text-secondary text-center py-1">
                        +{networkCount - 15} more requests
                      </div>
                    )}
                  </div>
                </ContextSection>
              )}

              {/* HTML Preview */}
              {hasHtml && (
                <ContextSection
                  title="HTML Snapshot"
                  icon={<FileCode className="h-4 w-4 text-cyan-400" />}
                >
                  <div className="text-xs text-secondary">
                    {context.htmlSnapshot!.length.toLocaleString()} characters captured
                  </div>
                </ContextSection>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Globe className="h-12 w-12 text-secondary/30 mb-3" />
              <p className="text-secondary mb-2">No browser context captured</p>
              <p className="text-xs text-secondary/70">
                Enable capture and click &quot;Capture Now&quot; to collect browser state
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-elevated/50">
          <div className="text-sm text-secondary">
            {context && (
              <>
                Context size:{' '}
                <span className="text-primary font-medium">{formatContextSize(contextSize)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasPendingContext && (
              <button
                onClick={handleClearContext}
                className="px-3 py-1.5 text-sm text-secondary hover:text-primary hover:bg-surface rounded transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleCaptureNow}
              disabled={!captureEnabled}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                captureEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'bg-elevated text-secondary cursor-not-allowed'
              )}
            >
              Capture Now
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-surface hover:bg-elevated text-primary rounded transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-elevated rounded">
      <span className={color}>{icon}</span>
      <div>
        <div className={cn('text-lg font-semibold', color)}>{count}</div>
        <div className="text-xs text-secondary">{label}</div>
      </div>
    </div>
  );
}

function ContextSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border">
        {icon}
        <span className="text-sm font-medium text-primary">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function ConsoleIcon({ level }: { level: string }) {
  switch (level) {
    case 'error':
      return <AlertCircle className="h-3 w-3 text-red-400 flex-shrink-0" />;
    case 'warn':
      return <AlertTriangle className="h-3 w-3 text-yellow-400 flex-shrink-0" />;
    case 'info':
      return <Info className="h-3 w-3 text-blue-400 flex-shrink-0" />;
    default:
      return <Terminal className="h-3 w-3 text-secondary flex-shrink-0" />;
  }
}

function StatusBadge({ status }: { status: number }) {
  const getStatusColor = () => {
    if (status === 0) return 'bg-gray-500/20 text-gray-400';
    if (status >= 200 && status < 300) return 'bg-green-500/20 text-green-400';
    if (status >= 300 && status < 400) return 'bg-blue-500/20 text-blue-400';
    if (status >= 400 && status < 500) return 'bg-orange-500/20 text-orange-400';
    return 'bg-red-500/20 text-red-400';
  };

  return (
    <span className={cn('px-1.5 py-0.5 rounded text-xs font-mono', getStatusColor())}>
      {status || '---'}
    </span>
  );
}

export default BrowserContextDialog;
