'use client';

import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionStore, type GridSpan, type AgentPosition } from '@/stores/session';
import { useAuthStore } from '@/stores/auth';
import {
  getSessionLayout,
  updateSessionLayout,
  updateAgentLayout as apiUpdateAgentLayout,
  updateFilePreviewLayout as apiUpdateFilePreviewLayout,
  updateEditorLayout as apiUpdateEditorLayout,
  type SessionLayoutState,
  type FilePreviewLayoutState,
  type EditorLayoutState,
} from '@/lib/api';
import { onSocketEvent, emitLayoutChange, type LayoutChangeEvent } from '@/lib/socket';

// Generate a unique device ID for this browser session
const getDeviceId = (): string => {
  if (typeof window === 'undefined') return 'server';
  let deviceId = sessionStorage.getItem('podex_device_id');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('podex_device_id', deviceId);
  }
  return deviceId;
};

// Debounce helper
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Convert frontend GridSpan to API format
function toApiGridSpan(span: GridSpan) {
  return { col_span: span.colSpan, row_span: span.rowSpan };
}

// Convert API GridSpan to frontend format
function fromApiGridSpan(span: { col_span: number; row_span: number }): GridSpan {
  return { colSpan: span.col_span, rowSpan: span.row_span };
}

// Convert frontend position to API format
function toApiPosition(pos: AgentPosition) {
  return {
    x: pos.x,
    y: pos.y,
    width: pos.width,
    height: pos.height,
    z_index: pos.zIndex,
  };
}

// Convert API position to frontend format
function fromApiPosition(pos: {
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
}): AgentPosition {
  return {
    x: pos.x,
    y: pos.y,
    width: pos.width,
    height: pos.height,
    zIndex: pos.z_index,
  };
}

interface UseLayoutSyncOptions {
  sessionId: string;
  enabled?: boolean;
}

export function useLayoutSync({ sessionId, enabled = true }: UseLayoutSyncOptions) {
  const { user } = useAuthStore();
  const {
    sessions,
    setViewMode,
    setActiveAgent,
    updateAgentGridSpan,
    updateAgentPosition,
    updateFilePreviewGridSpan,
    dockFilePreview,
    pinFilePreview,
    createEditorGridCard,
    removeEditorGridCard,
    updateEditorGridSpan,
    updateEditorFreeformPosition,
  } = useSessionStore();

  const session = sessions[sessionId];
  const deviceId = useRef(getDeviceId());
  const isApplyingRemote = useRef(false);
  const lastSyncedLayout = useRef<SessionLayoutState | null>(null);

  // Load layout from server on mount
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const loadLayout = async () => {
      try {
        const serverLayout = await getSessionLayout(sessionId);
        lastSyncedLayout.current = serverLayout;

        // Apply server layout to local state
        isApplyingRemote.current = true;

        // Apply view mode
        if (serverLayout.view_mode) {
          setViewMode(sessionId, serverLayout.view_mode as 'grid' | 'focus' | 'freeform');
        }

        // Apply active agent
        if (serverLayout.active_agent_id) {
          setActiveAgent(sessionId, serverLayout.active_agent_id);
        }

        // Apply agent layouts
        for (const [agentId, layout] of Object.entries(serverLayout.agent_layouts)) {
          if (layout.grid_span) {
            updateAgentGridSpan(sessionId, agentId, fromApiGridSpan(layout.grid_span));
          }
          if (layout.position) {
            updateAgentPosition(sessionId, agentId, fromApiPosition(layout.position));
          }
        }

        // Apply file preview layouts
        for (const [previewId, layout] of Object.entries(serverLayout.file_preview_layouts)) {
          // Check if preview exists
          const existingPreview = session?.filePreviews.find((p) => p.id === previewId);
          if (existingPreview) {
            if (layout.grid_span) {
              updateFilePreviewGridSpan(sessionId, previewId, fromApiGridSpan(layout.grid_span));
            }
            if (layout.docked !== undefined) {
              dockFilePreview(sessionId, previewId, layout.docked);
            }
            if (layout.pinned !== undefined) {
              pinFilePreview(sessionId, previewId, layout.pinned);
            }
          }
        }

        isApplyingRemote.current = false;

        // Apply editor grid card layout
        // Re-fetch session from store to get latest state (closure may be stale)
        const currentSession = useSessionStore.getState().sessions[sessionId];
        if (serverLayout.editor_grid_card_id) {
          // Server has editor - apply to local state
          if (!currentSession?.editorGridCardId) {
            isApplyingRemote.current = true;
            createEditorGridCard(sessionId);
            isApplyingRemote.current = false;
          }
          if (serverLayout.editor_grid_span) {
            isApplyingRemote.current = true;
            updateEditorGridSpan(sessionId, fromApiGridSpan(serverLayout.editor_grid_span));
            isApplyingRemote.current = false;
          }
          if (serverLayout.editor_freeform_position) {
            isApplyingRemote.current = true;
            updateEditorFreeformPosition(
              sessionId,
              fromApiPosition(serverLayout.editor_freeform_position)
            );
            isApplyingRemote.current = false;
          }
        } else if (currentSession?.editorGridCardId) {
          // Local has editor but server doesn't - sync local to server
          const payload: Partial<EditorLayoutState> = {
            editor_grid_card_id: currentSession.editorGridCardId,
          };
          if (currentSession.editorGridSpan) {
            payload.editor_grid_span = toApiGridSpan(currentSession.editorGridSpan);
          }
          if (currentSession.editorFreeformPosition) {
            payload.editor_freeform_position = toApiPosition(currentSession.editorFreeformPosition);
          }
          // Sync to server immediately (not debounced for initial sync)
          apiUpdateEditorLayout(sessionId, payload).catch(console.error);
        }
      } catch (error) {
        // Silently fail on connection errors - we'll work with local state
        const err = error as Error & { status?: number };
        if (err.status === 503) {
          console.warn('[LayoutSync] API server unavailable, using local state');
        } else {
          console.error('[LayoutSync] Failed to load layout from server:', error);
        }
        isApplyingRemote.current = false;
      }
    };

    loadLayout();
    // Only run on mount and when sessionId changes - NOT when session data changes
    // to avoid infinite loops when applying remote layout changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId]);

  // Debounced save to server
  const saveLayoutToServer = useRef(
    debounce(async (layout: Partial<SessionLayoutState>, sessId: string) => {
      try {
        await updateSessionLayout(sessId, layout);
      } catch (error) {
        console.error('[LayoutSync] Failed to save layout:', error);
      }
    }, 500)
  ).current;

  const saveLayout = useCallback(
    (layout: Partial<SessionLayoutState>) => {
      saveLayoutToServer(layout, sessionId);
    },
    [sessionId, saveLayoutToServer]
  );

  // Emit layout change via WebSocket
  const emitChange = useCallback(
    (type: LayoutChangeEvent['type'], payload: Record<string, unknown>) => {
      if (!user || isApplyingRemote.current) return;

      emitLayoutChange({
        session_id: sessionId,
        user_id: user.id,
        device_id: deviceId.current,
        type,
        payload,
      });
    },
    [sessionId, user]
  );

  // Listen for remote layout changes
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const unsubscribe = onSocketEvent('layout:change', (event: LayoutChangeEvent) => {
      // Ignore our own events
      if (event.sender_device === deviceId.current) return;
      if (event.session_id !== sessionId) return;

      isApplyingRemote.current = true;

      try {
        switch (event.type) {
          case 'view_mode':
            setViewMode(sessionId, event.payload.view_mode as 'grid' | 'focus' | 'freeform');
            break;

          case 'active_agent':
            setActiveAgent(sessionId, event.payload.agent_id as string | null);
            break;

          case 'agent_layout': {
            const { agent_id, grid_span, position } = event.payload as {
              agent_id: string;
              grid_span?: { col_span: number; row_span: number };
              position?: { x: number; y: number; width: number; height: number; z_index: number };
            };
            if (grid_span) {
              updateAgentGridSpan(sessionId, agent_id, fromApiGridSpan(grid_span));
            }
            if (position) {
              updateAgentPosition(sessionId, agent_id, fromApiPosition(position));
            }
            break;
          }

          case 'file_preview_layout': {
            const { preview_id, grid_span, docked, pinned } = event.payload as {
              preview_id: string;
              grid_span?: { col_span: number; row_span: number };
              docked?: boolean;
              pinned?: boolean;
            };
            if (grid_span) {
              updateFilePreviewGridSpan(sessionId, preview_id, fromApiGridSpan(grid_span));
            }
            if (docked !== undefined) {
              dockFilePreview(sessionId, preview_id, docked);
            }
            if (pinned !== undefined) {
              pinFilePreview(sessionId, preview_id, pinned);
            }
            break;
          }

          case 'editor_layout': {
            const { editor_grid_card_id, grid_span, position } = event.payload as {
              editor_grid_card_id?: string | null;
              grid_span?: { col_span: number; row_span: number };
              position?: { x: number; y: number; width: number; height: number; z_index: number };
            };
            if (editor_grid_card_id !== undefined) {
              if (editor_grid_card_id && !session?.editorGridCardId) {
                createEditorGridCard(sessionId);
              } else if (!editor_grid_card_id && session?.editorGridCardId) {
                removeEditorGridCard(sessionId);
              }
            }
            if (grid_span) {
              updateEditorGridSpan(sessionId, fromApiGridSpan(grid_span));
            }
            if (position) {
              updateEditorFreeformPosition(sessionId, fromApiPosition(position));
            }
            break;
          }

          case 'full_sync': {
            // Full layout sync - reload from server
            getSessionLayout(sessionId).then((serverLayout) => {
              // Apply all layout state
              if (serverLayout.view_mode) {
                setViewMode(sessionId, serverLayout.view_mode as 'grid' | 'focus' | 'freeform');
              }
              if (serverLayout.active_agent_id) {
                setActiveAgent(sessionId, serverLayout.active_agent_id);
              }
            });
            break;
          }
        }
      } finally {
        isApplyingRemote.current = false;
      }
    });

    return unsubscribe;
  }, [
    enabled,
    sessionId,
    setViewMode,
    setActiveAgent,
    updateAgentGridSpan,
    updateAgentPosition,
    updateFilePreviewGridSpan,
    dockFilePreview,
    pinFilePreview,
    createEditorGridCard,
    removeEditorGridCard,
    updateEditorGridSpan,
    updateEditorFreeformPosition,
  ]);

  // Sync functions to call from components
  const syncViewMode = useCallback(
    (viewMode: 'grid' | 'focus' | 'freeform') => {
      if (isApplyingRemote.current) return;
      saveLayout({ view_mode: viewMode });
      emitChange('view_mode', { view_mode: viewMode });
    },
    [saveLayout, emitChange]
  );

  const syncActiveAgent = useCallback(
    (agentId: string | null) => {
      if (isApplyingRemote.current) return;
      saveLayout({ active_agent_id: agentId });
      emitChange('active_agent', { agent_id: agentId });
    },
    [saveLayout, emitChange]
  );

  // Keep a ref to the current sessionId so debounced functions can access it
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Debounced API calls for resize operations (300ms delay)
  const debouncedApiUpdateAgentLayout = useMemo(
    () =>
      debounce((agentId: string, data: Parameters<typeof apiUpdateAgentLayout>[2]) => {
        apiUpdateAgentLayout(sessionIdRef.current, agentId, data).catch(console.error);
      }, 300),
    []
  );

  const debouncedApiUpdateFilePreviewLayout = useMemo(
    () =>
      debounce(
        (previewId: string, payload: Partial<FilePreviewLayoutState> & Record<string, unknown>) => {
          apiUpdateFilePreviewLayout(sessionIdRef.current, previewId, payload).catch(console.error);
        },
        300
      ),
    []
  );

  const syncAgentGridSpan = useCallback(
    (agentId: string, gridSpan: GridSpan) => {
      if (isApplyingRemote.current) return;
      const apiSpan = toApiGridSpan(gridSpan);
      // Use debounced API call to prevent rate limiting during resize
      debouncedApiUpdateAgentLayout(agentId, { grid_span: apiSpan });
      emitChange('agent_layout', { agent_id: agentId, grid_span: apiSpan });
    },
    [emitChange, debouncedApiUpdateAgentLayout]
  );

  const syncAgentPosition = useCallback(
    (agentId: string, position: AgentPosition) => {
      if (isApplyingRemote.current) return;
      const apiPos = toApiPosition(position);
      // Use debounced API call to prevent rate limiting during drag
      debouncedApiUpdateAgentLayout(agentId, { position: apiPos });
      emitChange('agent_layout', { agent_id: agentId, position: apiPos });
    },
    [emitChange, debouncedApiUpdateAgentLayout]
  );

  const syncFilePreviewLayout = useCallback(
    (
      previewId: string,
      updates: { gridSpan?: GridSpan; docked?: boolean; pinned?: boolean; path?: string }
    ) => {
      if (isApplyingRemote.current) return;
      const payload: Partial<FilePreviewLayoutState> & Record<string, unknown> = {
        preview_id: previewId,
      };
      if (updates.gridSpan) {
        payload.grid_span = toApiGridSpan(updates.gridSpan);
      }
      if (updates.docked !== undefined) {
        payload.docked = updates.docked;
      }
      if (updates.pinned !== undefined) {
        payload.pinned = updates.pinned;
      }
      if (updates.path) {
        payload.path = updates.path;
      }
      // Use debounced API call to prevent rate limiting during resize
      debouncedApiUpdateFilePreviewLayout(previewId, payload);
      emitChange('file_preview_layout', payload);
    },
    [emitChange, debouncedApiUpdateFilePreviewLayout]
  );

  // Debounced API call for editor layout updates
  const debouncedApiUpdateEditorLayout = useMemo(
    () =>
      debounce((payload: Partial<EditorLayoutState>) => {
        apiUpdateEditorLayout(sessionIdRef.current, payload).catch(console.error);
      }, 300),
    []
  );

  const syncEditorGridCard = useCallback(
    (editorGridCardId: string | null) => {
      if (isApplyingRemote.current) return;
      const payload = { editor_grid_card_id: editorGridCardId };
      debouncedApiUpdateEditorLayout(payload);
      emitChange('editor_layout', payload);
    },
    [emitChange, debouncedApiUpdateEditorLayout]
  );

  const syncEditorGridSpan = useCallback(
    (gridSpan: GridSpan) => {
      if (isApplyingRemote.current) return;
      const apiSpan = toApiGridSpan(gridSpan);
      const payload = { editor_grid_span: apiSpan };
      debouncedApiUpdateEditorLayout(payload);
      emitChange('editor_layout', { grid_span: apiSpan });
    },
    [emitChange, debouncedApiUpdateEditorLayout]
  );

  const syncEditorFreeformPosition = useCallback(
    (position: AgentPosition) => {
      if (isApplyingRemote.current) return;
      const apiPos = toApiPosition(position);
      const payload = { editor_freeform_position: apiPos };
      debouncedApiUpdateEditorLayout(payload);
      emitChange('editor_layout', { position: apiPos });
    },
    [emitChange, debouncedApiUpdateEditorLayout]
  );

  return {
    syncViewMode,
    syncActiveAgent,
    syncAgentGridSpan,
    syncAgentPosition,
    syncFilePreviewLayout,
    syncEditorGridCard,
    syncEditorGridSpan,
    syncEditorFreeformPosition,
    isApplyingRemote: isApplyingRemote.current,
  };
}
