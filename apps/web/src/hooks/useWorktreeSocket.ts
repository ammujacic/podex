/**
 * React hook for worktree WebSocket events.
 */

import { useEffect, useRef } from 'react';
import { useWorktreesStore, type Worktree } from '@/stores/worktrees';
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
  // Use refs to avoid effect re-runs when store selectors change
  const addWorktreeRef = useRef(useWorktreesStore.getState().addWorktree);
  const updateWorktreeStatusRef = useRef(useWorktreesStore.getState().updateWorktreeStatus);
  const removeWorktreeRef = useRef(useWorktreesStore.getState().removeWorktree);
  const setOperatingRef = useRef(useWorktreesStore.getState().setOperating);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useWorktreesStore.subscribe((state) => {
      addWorktreeRef.current = state.addWorktree;
      updateWorktreeStatusRef.current = state.updateWorktreeStatus;
      removeWorktreeRef.current = state.removeWorktree;
      setOperatingRef.current = state.setOperating;
    });
    return unsubscribe;
  }, []);

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

      addWorktreeRef.current(sessionId, worktree);
    });

    // Handle status changed
    const unsubStatusChanged = onSocketEvent(
      'worktree_status_changed',
      (data: WorktreeStatusChangedEvent) => {
        if (data.session_id !== sessionId) return;
        updateWorktreeStatusRef.current(
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
        updateWorktreeStatusRef.current(sessionId, data.worktree_id, 'conflict');
      }
    );

    // Handle merged
    const unsubMerged = onSocketEvent('worktree_merged', (data: WorktreeMergedEvent) => {
      if (data.session_id !== sessionId) return;

      if (data.merge_result.success) {
        updateWorktreeStatusRef.current(sessionId, data.worktree_id, 'merged');
      } else {
        updateWorktreeStatusRef.current(sessionId, data.worktree_id, 'failed');
      }
      setOperatingRef.current(null);
    });

    // Handle deleted
    const unsubDeleted = onSocketEvent('worktree_deleted', (data: WorktreeDeletedEvent) => {
      if (data.session_id !== sessionId) return;
      removeWorktreeRef.current(sessionId, data.worktree_id);
    });

    return () => {
      unsubCreated();
      unsubStatusChanged();
      unsubConflictDetected();
      unsubMerged();
      unsubDeleted();
    };
  }, [sessionId]);
}
