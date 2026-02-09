/**
 * React hook for worktree WebSocket events.
 */

import { useEffect } from 'react';
import { useWorktreesStore, type Worktree } from '@/stores/worktrees';
import { useStoreCallbacks } from './useStoreCallbacks';
import { onSocketEvent } from '@/lib/socket';

// WebSocket event types for worktrees
interface WorktreeCreatedEvent {
  session_id: string;
  worktree: {
    id: string;
    agent_id: string;
    session_id: string;
    worktree_path: string;
    branch_name: string;
    status: string;
    created_at: string;
  };
}

interface WorktreeStatusChangedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  old_status: string;
  new_status: string;
}

interface WorktreeConflictDetectedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  conflicting_files: string[];
}

interface WorktreeMergedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  merge_result: {
    success: boolean;
    message: string;
  };
}

interface WorktreeDeletedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
}

interface UseWorktreeSocketOptions {
  sessionId: string;
}

/**
 * Hook to listen for worktree WebSocket events and update store.
 */
export function useWorktreeSocket({ sessionId }: UseWorktreeSocketOptions) {
  // Get store methods directly - Zustand selectors are stable
  const addWorktree = useWorktreesStore((state) => state.addWorktree);
  const updateWorktreeStatus = useWorktreesStore((state) => state.updateWorktreeStatus);
  const removeWorktree = useWorktreesStore((state) => state.removeWorktree);
  const setOperating = useWorktreesStore((state) => state.setOperating);

  // Use stable ref for callbacks to avoid re-running effects
  const callbacksRef = useStoreCallbacks({
    addWorktree,
    updateWorktreeStatus,
    removeWorktree,
    setOperating,
  });

  useEffect(() => {
    if (!sessionId) return;

    // Handle worktree created
    const unsubCreated = onSocketEvent('worktree_created', (data: WorktreeCreatedEvent) => {
      if (data.session_id !== sessionId) return;

      const worktree: Worktree = {
        id: data.worktree.id,
        agentId: data.worktree.agent_id,
        sessionId: data.worktree.session_id,
        worktreePath: data.worktree.worktree_path,
        branchName: data.worktree.branch_name,
        status: data.worktree.status as Worktree['status'],
        createdAt: new Date(data.worktree.created_at),
        mergedAt: null,
      };

      callbacksRef.current.addWorktree(sessionId, worktree);
    });

    // Handle status changed
    const unsubStatusChanged = onSocketEvent(
      'worktree_status_changed',
      (data: WorktreeStatusChangedEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.updateWorktreeStatus(
          sessionId,
          data.worktree_id,
          data.new_status as Worktree['status']
        );
      }
    );

    // Handle conflict detected
    const unsubConflictDetected = onSocketEvent(
      'worktree_conflict_detected',
      (data: WorktreeConflictDetectedEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.updateWorktreeStatus(sessionId, data.worktree_id, 'conflict');
      }
    );

    // Handle merged
    const unsubMerged = onSocketEvent('worktree_merged', (data: WorktreeMergedEvent) => {
      if (data.session_id !== sessionId) return;

      if (data.merge_result.success) {
        callbacksRef.current.updateWorktreeStatus(sessionId, data.worktree_id, 'merged');
      } else {
        callbacksRef.current.updateWorktreeStatus(sessionId, data.worktree_id, 'failed');
      }
      callbacksRef.current.setOperating(null);
    });

    // Handle deleted
    const unsubDeleted = onSocketEvent('worktree_deleted', (data: WorktreeDeletedEvent) => {
      if (data.session_id !== sessionId) return;
      callbacksRef.current.removeWorktree(sessionId, data.worktree_id);
    });

    return () => {
      unsubCreated();
      unsubStatusChanged();
      unsubConflictDetected();
      unsubMerged();
      unsubDeleted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
}
