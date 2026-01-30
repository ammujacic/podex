'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { GitMerge, ChevronUp, Loader2 } from 'lucide-react';
import { getSessionChangeSets, type ChangeSetResponse } from '@/lib/api';
import { AggregatedDiffModal } from './AggregatedDiffModal';

interface ReviewChangesButtonProps {
  sessionId: string;
  className?: string;
}

/**
 * Floating button that appears when there are pending changes to review.
 * Shows count of pending changes and opens the aggregated diff modal.
 */
export function ReviewChangesButton({ sessionId, className }: ReviewChangesButtonProps) {
  const [pendingChanges, setPendingChanges] = useState<ChangeSetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const fetchPendingChanges = useCallback(async () => {
    try {
      const changes = await getSessionChangeSets(sessionId, 'pending');
      setPendingChanges(changes);
    } catch (err) {
      console.error('Failed to fetch pending changes:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Fetch pending changes
  useEffect(() => {
    fetchPendingChanges();
    // Poll for changes every 15 seconds (reduced from 5s for performance)
    const interval = setInterval(fetchPendingChanges, 15000);
    return () => clearInterval(interval);
  }, [fetchPendingChanges]);

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    // Refresh changes after modal closes
    fetchPendingChanges();
  };

  const handleChangesApplied = () => {
    fetchPendingChanges();
  };

  // Memoize calculated totals to avoid recalculating on every render
  const { totalFiles, totalAdditions, totalDeletions } = useMemo(
    () => ({
      totalFiles: pendingChanges.reduce((acc, cs) => acc + cs.total_files, 0),
      totalAdditions: pendingChanges.reduce((acc, cs) => acc + cs.total_additions, 0),
      totalDeletions: pendingChanges.reduce((acc, cs) => acc + cs.total_deletions, 0),
    }),
    [pendingChanges]
  );

  // Don't show if no pending changes
  if (!loading && pendingChanges.length === 0) {
    return null;
  }

  return (
    <>
      <div className={cn('fixed bottom-4 right-4 z-40 transition-all duration-300', className)}>
        {isCollapsed ? (
          // Collapsed state - just the icon
          <button
            onClick={() => setIsCollapsed(false)}
            className="p-3 rounded-full bg-accent-primary text-white shadow-lg hover:bg-accent-primary/90 transition-colors"
            title="Review pending changes"
          >
            <GitMerge className="w-5 h-5" />
            {pendingChanges.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                {pendingChanges.length}
              </span>
            )}
          </button>
        ) : (
          // Expanded state - full card
          <div className="bg-surface-primary border border-border-default rounded-lg shadow-xl overflow-hidden w-64">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-accent-primary text-white">
              <div className="flex items-center gap-2">
                <GitMerge className="w-4 h-4" />
                <span className="text-sm font-medium">Pending Changes</span>
              </div>
              <button
                onClick={() => setIsCollapsed(true)}
                className="p-1 hover:bg-white/20 rounded transition-colors"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-3">
              {loading ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : (
                <>
                  {/* Stats */}
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="text-text-muted">
                      {pendingChanges.length} change set{pendingChanges.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">+{totalAdditions}</span>
                      <span className="text-red-400">-{totalDeletions}</span>
                    </div>
                  </div>

                  {/* File list preview */}
                  <div className="space-y-1 mb-3 max-h-32 overflow-y-auto">
                    {pendingChanges.slice(0, 3).map((cs) => (
                      <div
                        key={cs.id}
                        className="text-xs flex items-center justify-between py-1 px-2 rounded bg-surface-secondary"
                      >
                        <span className="text-text-secondary truncate flex-1">{cs.agent_name}</span>
                        <span className="text-text-muted ml-2">
                          {cs.total_files} file{cs.total_files !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ))}
                    {pendingChanges.length > 3 && (
                      <div className="text-xs text-text-muted text-center py-1">
                        +{pendingChanges.length - 3} more
                      </div>
                    )}
                  </div>

                  {/* Review button */}
                  <button
                    onClick={handleOpenModal}
                    className="w-full py-2 px-3 rounded bg-accent-primary hover:bg-accent-primary/90 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <GitMerge className="w-4 h-4" />
                    Review {totalFiles} File{totalFiles !== 1 ? 's' : ''}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <AggregatedDiffModal
        sessionId={sessionId}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onChangesApplied={handleChangesApplied}
      />
    </>
  );
}
