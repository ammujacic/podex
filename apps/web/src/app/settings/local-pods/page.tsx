'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  X,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Cpu,
  Activity,
  Terminal,
  Eye,
  EyeOff,
  ExternalLink,
  Laptop,
  Cloud,
  Zap,
  Info,
  Key,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocalPodsStore, selectIsDeleting, selectIsRegenerating } from '@/stores/localPods';
import type { LocalPod, CreateLocalPodRequest } from '@/lib/api';
import { toast } from 'sonner';

// ============================================================================
// STATUS BADGE
// ============================================================================

function StatusBadge({ status }: { status: LocalPod['status'] }) {
  const config = {
    online: { color: 'bg-success/20 text-success', label: 'Online', icon: CheckCircle },
    offline: { color: 'bg-text-muted/20 text-text-muted', label: 'Offline', icon: X },
    busy: { color: 'bg-warning/20 text-warning', label: 'Busy', icon: Activity },
    error: { color: 'bg-error/20 text-error', label: 'Error', icon: AlertCircle },
  };

  const { color, label, icon: Icon } = config[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
        color
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ============================================================================
// TOKEN DISPLAY (shown once after create/regenerate)
// ============================================================================

interface TokenDisplayProps {
  token: string;
  onDismiss: () => void;
}

function TokenDisplay({ token, onDismiss }: TokenDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    toast.success('Token copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
      <div className="flex items-start gap-3">
        <Key className="h-5 w-5 text-warning mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-warning">Save Your Pod Token</h4>
          <p className="text-xs text-warning/80 mt-1">
            This token will only be shown once. Use it to connect your local pod to Podex.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded bg-void border border-warning/30 font-mono text-xs">
              <code className="flex-1 truncate text-text-primary">
                {visible ? token : '••••••••••••••••••••••••••••••••'}
              </code>
              <button
                onClick={() => setVisible(!visible)}
                className="p-1 hover:bg-warning/20 rounded text-warning/80 hover:text-warning"
              >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-2 rounded bg-warning/20 text-warning hover:bg-warning/30 text-xs font-medium"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="mt-3 p-3 rounded bg-void/50 border border-border-subtle">
            <p className="text-xs text-text-secondary font-medium mb-2">Quick Start:</p>
            <code className="text-xs text-text-muted font-mono block">
              podex-local-pod start --token {visible ? token : 'pdx_pod_...'}
            </code>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-warning/20 rounded text-warning/60 hover:text-warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// ADD POD MODAL - Simple name-only form
// ============================================================================

interface AddPodModalProps {
  onSubmit: (data: CreateLocalPodRequest) => Promise<void>;
  onClose: () => void;
  isLoading: boolean;
}

function AddPodModal({ onSubmit, onClose, isLoading }: AddPodModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState(false);

  // Token from store (after creation)
  const { newToken, clearNewToken } = useLocalPodsStore();

  // Copy state for command
  const [copiedCommand, setCopiedCommand] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      await onSubmit({ name: name.trim() });
      setShowComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pod');
    }
  };

  const handleDone = () => {
    clearNewToken();
    onClose();
  };

  const handleClose = () => {
    if (newToken) {
      clearNewToken();
    }
    onClose();
  };

  const handleCopyCommand = async () => {
    if (!newToken) return;
    const command = `podex-local-pod start --token ${newToken.token}`;
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80">
      <div className="w-full max-w-md mx-4 rounded-lg border border-border-default bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-accent-primary" />
            <h3 className="text-lg font-semibold text-text-primary">
              {showComplete ? 'Setup Complete' : 'Add Local Pod'}
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Create form */}
          {!showComplete && (
            <div className="space-y-4">
              {/* Info banner */}
              <div className="p-3 rounded-lg bg-accent-primary/5 border border-accent-primary/20">
                <p className="text-sm text-text-secondary">
                  A local pod lets you run workspaces on your own hardware.{' '}
                  <span className="text-accent-primary font-medium">
                    Free, private, and fully under your control.
                  </span>
                </p>
              </div>

              {error && (
                <div className="p-3 rounded bg-error/10 border border-error/30 text-error text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </div>
              )}

              {/* Pod Name */}
              <div>
                <label className="text-sm font-medium text-text-secondary">Pod Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., My MacBook Pro"
                  className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
                <p className="text-xs text-text-muted mt-1">
                  A friendly name to identify this machine
                </p>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium rounded bg-overlay text-text-secondary hover:text-text-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isLoading || !name.trim()}
                  className="px-4 py-2 text-sm font-medium rounded bg-accent-primary text-void hover:bg-accent-primary/90 disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isLoading ? 'Creating...' : 'Create Pod'}
                </button>
              </div>
            </div>
          )}

          {/* Complete - Show token and setup command */}
          {showComplete && newToken && (
            <div className="space-y-5">
              {/* Success header */}
              <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-success/20 to-success/5 border border-success/30">
                <div className="p-2 rounded-full bg-success/20">
                  <Check className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-base font-semibold text-text-primary">
                    Pod &quot;{name}&quot; created!
                  </p>
                  <p className="text-sm text-text-muted">
                    Run the command below to start your pod.
                  </p>
                </div>
              </div>

              {/* Setup Steps */}
              <div className="space-y-4">
                {/* Step 1: Install */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center">
                    1
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary mb-1">Install the agent</p>
                    <code className="block text-xs text-text-secondary font-mono px-3 py-2 bg-void rounded-lg border border-border-subtle">
                      pip install podex-local-pod
                    </code>
                  </div>
                </div>

                {/* Step 2: Start */}
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold flex items-center justify-center">
                    2
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-text-primary">Start the pod</p>
                      <button
                        onClick={handleCopyCommand}
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-all',
                          copiedCommand
                            ? 'bg-success/20 text-success'
                            : 'bg-overlay hover:bg-accent-primary/20 text-text-muted hover:text-accent-primary'
                        )}
                      >
                        {copiedCommand ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedCommand ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <code className="block text-xs text-accent-primary font-mono px-3 py-2 bg-void rounded-lg border border-accent-primary/30 overflow-x-auto">
                      podex-local-pod start --token {newToken.token}
                    </code>
                    <p className="text-xs text-text-muted mt-2">
                      Your pod will appear as{' '}
                      <span className="text-success font-medium">&quot;Online&quot;</span> once
                      connected!
                    </p>
                  </div>
                </div>
              </div>

              {/* Done button */}
              <div className="flex justify-end pt-2">
                <button
                  onClick={handleDone}
                  className="px-5 py-2.5 text-sm font-medium rounded-lg bg-accent-primary text-void hover:bg-accent-primary/90 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// POD CARD
// ============================================================================

interface PodCardProps {
  pod: LocalPod;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onRegenerateToken: () => void;
}

function PodCard({ pod, isExpanded, onToggleExpand, onDelete, onRegenerateToken }: PodCardProps) {
  const isDeleting = useLocalPodsStore((s) => selectIsDeleting(s, pod.id));
  const isRegenerating = useLocalPodsStore((s) => selectIsRegenerating(s, pod.id));

  const formatDate = (date: string | null) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString();
  };

  const formatMemory = (mb: number | null) => {
    if (!mb) return 'Unknown';
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  const handleDelete = () => {
    if (confirm(`Delete pod "${pod.name}"? This will invalidate the pod token.`)) {
      onDelete();
    }
  };

  const handleRegenerateToken = () => {
    if (
      confirm(`Regenerate token for "${pod.name}"? The old token will stop working immediately.`)
    ) {
      onRegenerateToken();
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border transition-all',
        pod.status === 'online'
          ? 'border-success/30 bg-success/5'
          : pod.status === 'error'
            ? 'border-error/30 bg-error/5'
            : 'border-border-subtle bg-elevated'
      )}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={cn(
              'p-2 rounded-lg',
              pod.status === 'online'
                ? 'bg-success/20 text-success'
                : pod.status === 'error'
                  ? 'bg-error/20 text-error'
                  : 'bg-overlay text-text-muted'
            )}
          >
            <Laptop className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-text-primary">{pod.name}</h4>
              <StatusBadge status={pod.status} />
            </div>

            {/* Quick stats */}
            <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
              {pod.os_info && (
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {pod.os_info}
                </span>
              )}
              {pod.total_cpu_cores && (
                <span className="flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  {pod.total_cpu_cores} cores
                </span>
              )}
              {pod.total_memory_mb && (
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  {formatMemory(pod.total_memory_mb)}
                </span>
              )}
            </div>

            {/* Workspaces */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-text-muted">Workspaces: {pod.current_workspaces}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={onToggleExpand}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Last error */}
        {pod.last_error && (
          <div className="mt-3 p-2 rounded bg-error/10 border border-error/20 text-xs text-error flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {pod.last_error}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border-subtle mt-0">
          <div className="pt-4 space-y-4">
            {/* Details grid */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-text-muted">Architecture</span>
                <p className="text-text-primary font-medium">{pod.architecture || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-text-muted">Token Prefix</span>
                <p className="text-text-primary font-mono">{pod.token_prefix}...</p>
              </div>
              <div>
                <span className="text-text-muted">Last Heartbeat</span>
                <p className="text-text-primary font-medium">
                  {pod.last_heartbeat ? new Date(pod.last_heartbeat).toLocaleString() : 'Never'}
                </p>
              </div>
              <div>
                <span className="text-text-muted">Created</span>
                <p className="text-text-primary font-medium">{formatDate(pod.created_at)}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border-subtle">
              <button
                onClick={handleRegenerateToken}
                disabled={isRegenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-overlay text-text-secondary hover:text-text-primary disabled:opacity-50"
              >
                {isRegenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate Token
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded hover:bg-error/20 text-text-muted hover:text-error disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LocalPodsSettingsPage() {
  const {
    pods,
    isLoading,
    isCreating,
    error,
    newToken,
    loadPods,
    createPod,
    deletePod,
    regenerateToken,
    clearNewToken,
    clearError,
  } = useLocalPodsStore();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [expandedPods, setExpandedPods] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadPods();
  }, [loadPods]);

  const handleCreatePod = async (data: CreateLocalPodRequest) => {
    await createPod(data);
    // Don't close modal - will show completion step with setup command
  };

  const handleModalClose = () => {
    setIsAddModalOpen(false);
    // Refresh pods list in case a pod was created
    loadPods();
  };

  const handleDeletePod = useCallback(
    async (podId: string) => {
      try {
        await deletePod(podId);
        toast.success('Local pod deleted');
      } catch {
        toast.error('Failed to delete pod');
      }
    },
    [deletePod]
  );

  const handleRegenerateToken = useCallback(
    async (podId: string) => {
      try {
        await regenerateToken(podId);
        toast.success('Token regenerated! Save the new token.');
      } catch {
        toast.error('Failed to regenerate token');
      }
    },
    [regenerateToken]
  );

  const toggleExpand = (podId: string) => {
    setExpandedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podId)) {
        next.delete(podId);
      } else {
        next.add(podId);
      }
      return next;
    });
  };

  const onlinePods = pods.filter((p) => p.status === 'online');
  const offlinePods = pods.filter((p) => p.status !== 'online');

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent-primary/10">
            <Server className="h-5 w-5 text-accent-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Local Pods</h2>
            <p className="text-xs text-text-muted">
              Self-hosted compute for faster local development
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-void hover:bg-accent-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Pod
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
          <button onClick={clearError} className="text-error hover:text-error/80">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* New token display */}
      {newToken && (
        <div className="mx-6 mt-4">
          <TokenDisplay token={newToken.token} onDismiss={clearNewToken} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* Info banner */}
            <div className="p-4 rounded-lg bg-info/10 border border-info/30">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-info mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-info">What are Local Pods?</h4>
                  <p className="text-xs text-info/80 mt-1">
                    Local pods let you run workspaces on your own machine. Get faster performance,
                    full GPU access, and keep your code on-premises. Install the agent with{' '}
                    <code className="px-1 py-0.5 rounded bg-info/20 font-mono text-[11px]">
                      pip install podex-local-pod
                    </code>
                  </p>
                  <a
                    href="https://docs.podex.dev/local-pods"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-info hover:underline"
                  >
                    View Documentation
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>

            {/* Empty state */}
            {pods.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="p-4 rounded-full bg-overlay mb-4">
                  <Server className="h-8 w-8 text-text-muted" />
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">No local pods yet</h3>
                <p className="text-sm text-text-muted max-w-md mb-6">
                  Add a local pod to run workspaces on your own machine. You'll get a token to
                  authenticate your machine with Podex.
                </p>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent-primary text-void hover:bg-accent-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  Add Your First Pod
                </button>
              </div>
            )}

            {/* Pod lists */}
            {pods.length > 0 && (
              <>
                {/* Online pods */}
                {onlinePods.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="h-4 w-4 text-success" />
                      <h3 className="text-sm font-medium text-text-primary">
                        Online ({onlinePods.length})
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {onlinePods.map((pod) => (
                        <PodCard
                          key={pod.id}
                          pod={pod}
                          isExpanded={expandedPods.has(pod.id)}
                          onToggleExpand={() => toggleExpand(pod.id)}
                          onDelete={() => handleDeletePod(pod.id)}
                          onRegenerateToken={() => handleRegenerateToken(pod.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Offline pods */}
                {offlinePods.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Cloud className="h-4 w-4 text-text-muted" />
                      <h3 className="text-sm font-medium text-text-primary">
                        Offline ({offlinePods.length})
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {offlinePods.map((pod) => (
                        <PodCard
                          key={pod.id}
                          pod={pod}
                          isExpanded={expandedPods.has(pod.id)}
                          onToggleExpand={() => toggleExpand(pod.id)}
                          onDelete={() => handleDeletePod(pod.id)}
                          onRegenerateToken={() => handleRegenerateToken(pod.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Quick start guide */}
            {pods.length > 0 && (
              <div className="border border-border-subtle rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-elevated border-b border-border-subtle">
                  <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Quick Start
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold">
                      1
                    </span>
                    <div>
                      <p className="text-sm text-text-primary font-medium">Install the agent</p>
                      <code className="text-xs text-text-muted font-mono block mt-1 p-2 rounded bg-void">
                        pip install podex-local-pod
                      </code>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-primary/20 text-accent-primary text-xs font-bold">
                      2
                    </span>
                    <div>
                      <p className="text-sm text-text-primary font-medium">Start the pod</p>
                      <code className="text-xs text-text-muted font-mono block mt-1 p-2 rounded bg-void">
                        podex-local-pod start --token pdx_pod_...
                      </code>
                      <p className="text-xs text-text-muted mt-1">
                        Your pod will appear as{' '}
                        <span className="text-success font-medium">&quot;Online&quot;</span> once
                        connected!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add pod modal */}
      {isAddModalOpen && (
        <AddPodModal onSubmit={handleCreatePod} onClose={handleModalClose} isLoading={isCreating} />
      )}
    </div>
  );
}
