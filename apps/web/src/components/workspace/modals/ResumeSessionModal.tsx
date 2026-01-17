'use client';

import React, { useState } from 'react';
import { X, Play, Clock, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { resumeWorkspace } from '@/lib/api';

interface ResumeSessionModalProps {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}

/**
 * Modal for resuming a paused workspace session (waking from standby).
 */
export function ResumeSessionModal({ sessionId, workspaceId, onClose }: ResumeSessionModalProps) {
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setWorkspaceStatus } = useSessionStore();

  const handleResume = async () => {
    setIsResuming(true);
    setError(null);

    try {
      const result = await resumeWorkspace(workspaceId);
      setWorkspaceStatus(sessionId, result.status, null);
      onClose();
    } catch (err) {
      console.error('Failed to resume workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setIsResuming(false);
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
        aria-labelledby="resume-session-title"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10"
              aria-hidden="true"
            >
              <Play className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <h2 id="resume-session-title" className="text-lg font-semibold text-text-primary">
                Resume Session
              </h2>
              <p className="text-sm text-text-muted">Wake from standby</p>
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
          <p className="text-sm text-text-secondary mb-4">
            Your session is currently in standby mode. Resuming will restart the Docker container
            and restore your workspace.
          </p>

          <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-4">
            <Clock className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <p className="text-blue-200">This may take 10-30 seconds</p>
              <p className="text-blue-200/70 mt-1">
                The container needs to restart. Please wait while we restore your environment.
              </p>
            </div>
          </div>

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
            disabled={isResuming}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleResume}
            disabled={isResuming}
            className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-2 min-h-[44px]"
          >
            {isResuming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Resuming...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Resume Session
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
