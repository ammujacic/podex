'use client';

import React, { useState } from 'react';
import { X, Pause, AlertTriangle, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { pauseWorkspace } from '@/lib/api';

interface PauseSessionModalProps {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}

/**
 * Modal for pausing a workspace session (entering standby mode).
 */
export function PauseSessionModal({ sessionId, workspaceId, onClose }: PauseSessionModalProps) {
  const [isPausing, setIsPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setWorkspaceStatus } = useSessionStore();

  const handlePause = async () => {
    setIsPausing(true);
    setError(null);

    try {
      const result = await pauseWorkspace(workspaceId);
      setWorkspaceStatus(sessionId, result.status, result.standby_at);
      onClose();
    } catch (err) {
      console.error('Failed to pause workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to pause session');
    } finally {
      setIsPausing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-session-title"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10"
              aria-hidden="true"
            >
              <Pause className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <h2 id="pause-session-title" className="text-lg font-semibold text-text-primary">
                Pause Session
              </h2>
              <p className="text-sm text-text-muted">Enter standby mode</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20 mb-4">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="text-yellow-200 font-medium">Pausing will stop your workspace</p>
              <p className="text-yellow-200/70 mt-1">
                The Docker container will be stopped to save resources. Resuming typically takes
                10-30 seconds.
              </p>
            </div>
          </div>

          <p className="text-sm text-text-secondary mb-4">
            Your files and state will be preserved. You can resume the session at any time from the
            dashboard or command palette.
          </p>

          {error && (
            <div
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4"
              role="alert"
              aria-live="polite"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            onClick={onClose}
            disabled={isPausing}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handlePause}
            disabled={isPausing}
            className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2 min-h-[44px]"
          >
            {isPausing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Pausing...
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" aria-hidden="true" />
                Pause Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
