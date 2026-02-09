'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, X, Loader2 } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { startWorkspace } from '@/lib/api';

interface WorkspaceErrorBannerProps {
  sessionId: string;
  onRetry?: () => void;
}

/**
 * Banner displayed when the workspace container is unavailable.
 * Shows when API calls fail with 503/500/404 errors indicating the
 * workspace container is not responding or doesn't exist.
 */
export function WorkspaceErrorBanner({ sessionId, onRetry }: WorkspaceErrorBannerProps) {
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const setWorkspaceError = useSessionStore((state) => state.setWorkspaceError);
  const setWorkspaceStatus = useSessionStore((state) => state.setWorkspaceStatus);
  const [isRecreating, setIsRecreating] = useState(false);
  const [recreateError, setRecreateError] = useState<string | null>(null);

  const error = session?.workspaceError;
  const workspaceId = session?.workspaceId;

  if (!error) return null;

  const handleDismiss = () => {
    setWorkspaceError(sessionId, null);
    setRecreateError(null);
  };

  const handleRetry = () => {
    setWorkspaceError(sessionId, null);
    setRecreateError(null);
    onRetry?.();
  };

  const handleRecreate = async () => {
    if (!workspaceId || isRecreating) return;

    setIsRecreating(true);
    setRecreateError(null);

    try {
      const result = await startWorkspace(workspaceId);
      // Success - clear error and update status
      setWorkspaceError(sessionId, null);
      setWorkspaceStatus(sessionId, result.status as 'running' | 'pending');
      // Trigger retry to reload data
      onRetry?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to recreate workspace';
      setRecreateError(message);
    } finally {
      setIsRecreating(false);
    }
  };

  return (
    <div className="bg-accent-error/10 border border-accent-error/30 rounded-lg px-4 py-3 mx-4 mt-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-accent-error flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-accent-error">Workspace Unavailable</p>
          <p className="text-sm text-text-muted mt-1">{error}</p>
          {recreateError && <p className="text-sm text-accent-error mt-1">{recreateError}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {workspaceId && (
            <button
              onClick={handleRecreate}
              disabled={isRecreating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              {isRecreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              {isRecreating ? 'Recreating...' : 'Recreate'}
            </button>
          )}
          {onRetry && (
            <button
              onClick={handleRetry}
              disabled={isRecreating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50 rounded-md transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          )}
          <button
            onClick={handleDismiss}
            disabled={isRecreating}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-50 rounded-md transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
