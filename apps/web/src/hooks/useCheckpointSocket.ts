/**
 * React hook for checkpoint WebSocket events.
 */

import { useEffect, useRef } from 'react';
import { useCheckpointsStore, type Checkpoint } from '@/stores/checkpoints';
import { onSocketEvent } from '@/lib/socket';

// WebSocket event types for checkpoints
interface CheckpointCreatedEvent {
  session_id: string;
  checkpoint: {
    id: string;
    checkpoint_number: number;
    description: string | null;
    action_type: string;
    agent_id: string;
    status: string;
    created_at: string;
    files: Array<{
      path: string;
      change_type: 'create' | 'modify' | 'delete';
      lines_added: number;
      lines_removed: number;
    }>;
    file_count: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
}

interface CheckpointRestoredEvent {
  session_id: string;
  checkpoint_id: string;
  files_restored: number;
}

interface CheckpointRestoreStartedEvent {
  session_id: string;
  checkpoint_id: string;
}

interface UseCheckpointSocketOptions {
  sessionId: string;
}

/**
 * Hook to listen for checkpoint WebSocket events and update store.
 */
export function useCheckpointSocket({ sessionId }: UseCheckpointSocketOptions) {
  // Use refs to avoid effect re-runs when store selectors change
  const addCheckpointRef = useRef(useCheckpointsStore.getState().addCheckpoint);
  const updateCheckpointStatusRef = useRef(useCheckpointsStore.getState().updateCheckpointStatus);
  const setRestoringRef = useRef(useCheckpointsStore.getState().setRestoring);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useCheckpointsStore.subscribe((state) => {
      addCheckpointRef.current = state.addCheckpoint;
      updateCheckpointStatusRef.current = state.updateCheckpointStatus;
      setRestoringRef.current = state.setRestoring;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    // Handle checkpoint created
    const unsubCreated = onSocketEvent('checkpoint_created', (data: CheckpointCreatedEvent) => {
      if (data.session_id !== sessionId) return;

      const checkpoint: Checkpoint = {
        id: data.checkpoint.id,
        checkpointNumber: data.checkpoint.checkpoint_number,
        description: data.checkpoint.description,
        actionType: data.checkpoint.action_type,
        agentId: data.checkpoint.agent_id,
        status: data.checkpoint.status as Checkpoint['status'],
        createdAt: new Date(data.checkpoint.created_at),
        files: data.checkpoint.files.map((f) => ({
          path: f.path,
          changeType: f.change_type,
          linesAdded: f.lines_added,
          linesRemoved: f.lines_removed,
        })),
        fileCount: data.checkpoint.file_count,
        totalLinesAdded: data.checkpoint.total_lines_added,
        totalLinesRemoved: data.checkpoint.total_lines_removed,
      };

      addCheckpointRef.current(sessionId, checkpoint);
    });

    // Handle restore started
    const unsubRestoreStarted = onSocketEvent(
      'checkpoint_restore_started',
      (data: CheckpointRestoreStartedEvent) => {
        if (data.session_id !== sessionId) return;
        setRestoringRef.current(data.checkpoint_id);
      }
    );

    // Handle restore completed
    const unsubRestored = onSocketEvent(
      'checkpoint_restore_completed',
      (data: CheckpointRestoredEvent) => {
        if (data.session_id !== sessionId) return;

        updateCheckpointStatusRef.current(sessionId, data.checkpoint_id, 'restored');
        setRestoringRef.current(null);
      }
    );

    return () => {
      unsubCreated();
      unsubRestoreStarted();
      unsubRestored();
    };
  }, [sessionId]);
}
