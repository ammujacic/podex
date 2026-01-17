'use client';

import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { FileCode, FilePlus, FileX, FileEdit } from 'lucide-react';
import { onSocketEvent, type FileChangeEvent } from '@/lib/socket';
import { useAgentAttention } from '@/hooks/useAgentAttention';
import { useEditorStore } from '@/stores/editor';
import { getLanguageFromPath } from '@/stores/sessionTypes';

interface UseFileChangeNotificationsOptions {
  sessionId: string;
  enabled?: boolean;
  onFileChange?: (event: FileChangeEvent) => void;
}

/**
 * Hook to show toast notifications when files are changed by agents or other users.
 *
 * @example
 * useFileChangeNotifications({
 *   sessionId: 'abc-123',
 *   onFileChange: (event) => {
 *     // Optionally refresh file tree or update UI
 *   },
 * });
 */
export function useFileChangeNotifications({
  sessionId,
  enabled = true,
  onFileChange,
}: UseFileChangeNotificationsOptions) {
  const handleFileChange = useCallback(
    (event: FileChangeEvent) => {
      // Only handle events for this session
      if (event.session_id !== sessionId) return;

      const fileName = event.file_path.split('/').pop() || event.file_path;
      const changedBy = event.changed_by === 'agent' ? 'Agent' : event.changed_by;

      // Show toast based on change type
      switch (event.change_type) {
        case 'created':
          toast.success(`${changedBy} created ${fileName}`, {
            description: event.file_path,
            icon: <FilePlus className="h-4 w-4" />,
            action: {
              label: 'View',
              onClick: () => {
                // Open the file in editor
                useEditorStore.getState().openTab({
                  path: event.file_path,
                  name: fileName,
                  language: getLanguageFromPath(event.file_path),
                  isPreview: true,
                  paneId: 'main', // Default to main pane
                  isDirty: false,
                });
              },
            },
          });
          break;

        case 'modified':
          toast.info(`${changedBy} modified ${fileName}`, {
            description: event.file_path,
            icon: <FileEdit className="h-4 w-4" />,
            action: {
              label: 'View',
              onClick: () => {
                // Open the file in editor
                useEditorStore.getState().openTab({
                  path: event.file_path,
                  name: fileName,
                  language: getLanguageFromPath(event.file_path),
                  isPreview: true,
                  paneId: 'main', // Default to main pane
                  isDirty: false,
                });
              },
            },
          });
          break;

        case 'deleted':
          toast.warning(`${changedBy} deleted ${fileName}`, {
            description: event.file_path,
            icon: <FileX className="h-4 w-4" />,
          });
          break;

        default:
          toast(`File changed: ${fileName}`, {
            description: `${event.change_type} by ${changedBy}`,
            icon: <FileCode className="h-4 w-4" />,
          });
      }

      // Call optional callback
      onFileChange?.(event);
    },
    [sessionId, onFileChange]
  );

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to file change events
    const unsubscribe = onSocketEvent('file_change', handleFileChange);

    return () => {
      unsubscribe();
    };
  }, [enabled, handleFileChange]);
}

/**
 * Hook to show toast notifications for agent status changes.
 */
export function useAgentStatusNotifications({
  sessionId,
  enabled = true,
}: {
  sessionId: string;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = onSocketEvent('agent_status', (event) => {
      if (event.session_id !== sessionId) return;

      if (event.status === 'error' && event.error) {
        toast.error(`Agent error`, {
          description: event.error,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, sessionId]);
}

/**
 * Combined hook for all workspace notifications.
 * Includes file changes, agent status, and agent attention notifications.
 */
export function useWorkspaceNotifications({
  sessionId,
  enabled = true,
  onFileChange,
}: UseFileChangeNotificationsOptions) {
  useFileChangeNotifications({ sessionId, enabled, onFileChange });
  useAgentStatusNotifications({ sessionId, enabled });
  useAgentAttention({ sessionId, enabled, showToasts: true, useTTS: true });
}
