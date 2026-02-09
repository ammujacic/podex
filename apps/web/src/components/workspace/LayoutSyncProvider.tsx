'use client';

import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/stores/session';
import { useLayoutSync } from '@/hooks/useLayoutSync';

interface LayoutSyncProviderProps {
  sessionId: string;
  children: React.ReactNode;
}

/**
 * Provider component that automatically syncs layout changes to the server
 * and other connected clients.
 *
 * Wrap your workspace/session view with this component to enable layout sync.
 */
export function LayoutSyncProvider({ sessionId, children }: LayoutSyncProviderProps) {
  const { sessions } = useSessionStore();
  const session = sessions[sessionId];

  const {
    syncViewMode,
    syncActiveAgent,
    syncAgentGridSpan,
    syncAgentPosition,
    syncFilePreviewLayout,
    syncEditorGridCard,
    syncEditorGridSpan,
    syncEditorFreeformPosition,
  } = useLayoutSync({ sessionId, enabled: !!session });

  // Track previous values to detect changes
  const prevViewMode = useRef(session?.viewMode);
  const prevActiveAgentId = useRef(session?.activeAgentId);
  const prevAgents = useRef(session?.agents);
  const prevFilePreviews = useRef(session?.filePreviews);
  const prevEditorGridCardId = useRef<string | null | undefined>(undefined);
  const prevEditorGridSpan = useRef(session?.editorGridSpan);
  const prevEditorFreeformPosition = useRef(session?.editorFreeformPosition);
  const hasInitialSynced = useRef(false);

  // Sync view mode changes
  useEffect(() => {
    if (!session) return;
    if (prevViewMode.current !== session.viewMode) {
      syncViewMode(session.viewMode);
      prevViewMode.current = session.viewMode;
    }
  }, [session?.viewMode, syncViewMode, session]);

  // Sync active agent changes
  useEffect(() => {
    if (!session) return;
    if (prevActiveAgentId.current !== session.activeAgentId) {
      syncActiveAgent(session.activeAgentId);
      prevActiveAgentId.current = session.activeAgentId;
    }
  }, [session?.activeAgentId, syncActiveAgent, session]);

  // Sync agent layout changes (gridSpan, position)
  useEffect(() => {
    if (!session?.agents) return;

    const prevAgentsMap = new Map((prevAgents.current || []).map((a) => [a.id, a]));

    for (const agent of session.agents) {
      const prevAgent = prevAgentsMap.get(agent.id);
      if (!prevAgent) continue;

      // Check gridSpan changes
      if (
        agent.gridSpan &&
        (prevAgent.gridSpan?.colSpan !== agent.gridSpan.colSpan ||
          prevAgent.gridSpan?.rowSpan !== agent.gridSpan.rowSpan)
      ) {
        syncAgentGridSpan(agent.id, agent.gridSpan);
      }

      // Check position changes
      if (
        agent.position &&
        prevAgent.position &&
        (prevAgent.position.x !== agent.position.x ||
          prevAgent.position.y !== agent.position.y ||
          prevAgent.position.width !== agent.position.width ||
          prevAgent.position.height !== agent.position.height)
      ) {
        syncAgentPosition(agent.id, agent.position);
      }
    }

    prevAgents.current = session.agents;
  }, [session?.agents, syncAgentGridSpan, syncAgentPosition]);

  // Sync file preview layout changes
  useEffect(() => {
    if (!session?.filePreviews) return;

    const prevPreviewsMap = new Map((prevFilePreviews.current || []).map((p) => [p.id, p]));

    for (const preview of session.filePreviews) {
      const prevPreview = prevPreviewsMap.get(preview.id);

      // New preview - sync it
      if (!prevPreview) {
        syncFilePreviewLayout(preview.id, {
          gridSpan: preview.gridSpan,
          docked: preview.docked,
          pinned: preview.pinned,
          path: preview.path,
        });
        continue;
      }

      // Check for changes
      const gridSpanChanged =
        preview.gridSpan &&
        (prevPreview.gridSpan?.colSpan !== preview.gridSpan.colSpan ||
          prevPreview.gridSpan?.rowSpan !== preview.gridSpan.rowSpan);
      const dockedChanged = prevPreview.docked !== preview.docked;
      const pinnedChanged = prevPreview.pinned !== preview.pinned;

      if (gridSpanChanged || dockedChanged || pinnedChanged) {
        syncFilePreviewLayout(preview.id, {
          gridSpan: gridSpanChanged ? preview.gridSpan : undefined,
          docked: dockedChanged ? preview.docked : undefined,
          pinned: pinnedChanged ? preview.pinned : undefined,
        });
      }
    }

    prevFilePreviews.current = session.filePreviews;
  }, [session?.filePreviews, syncFilePreviewLayout]);

  // Sync editor grid card changes
  useEffect(() => {
    if (!session) return;

    // Initial sync on mount - sync existing editor to server if present
    if (!hasInitialSynced.current && session.editorGridCardId) {
      syncEditorGridCard(session.editorGridCardId);
      if (session.editorGridSpan) {
        syncEditorGridSpan(session.editorGridSpan);
      }
      if (session.editorFreeformPosition) {
        syncEditorFreeformPosition(session.editorFreeformPosition);
      }
      hasInitialSynced.current = true;
      prevEditorGridCardId.current = session.editorGridCardId;
      prevEditorGridSpan.current = session.editorGridSpan;
      prevEditorFreeformPosition.current = session.editorFreeformPosition;
      return;
    }

    // Sync editor grid card ID (created/removed)
    if (prevEditorGridCardId.current !== session.editorGridCardId) {
      syncEditorGridCard(session.editorGridCardId ?? null);
      prevEditorGridCardId.current = session.editorGridCardId;
    }

    // Sync editor grid span changes
    if (
      session.editorGridSpan &&
      (prevEditorGridSpan.current?.colSpan !== session.editorGridSpan.colSpan ||
        prevEditorGridSpan.current?.rowSpan !== session.editorGridSpan.rowSpan)
    ) {
      syncEditorGridSpan(session.editorGridSpan);
      prevEditorGridSpan.current = session.editorGridSpan;
    }

    // Sync editor freeform position changes
    if (
      session.editorFreeformPosition &&
      prevEditorFreeformPosition.current &&
      (prevEditorFreeformPosition.current.x !== session.editorFreeformPosition.x ||
        prevEditorFreeformPosition.current.y !== session.editorFreeformPosition.y ||
        prevEditorFreeformPosition.current.width !== session.editorFreeformPosition.width ||
        prevEditorFreeformPosition.current.height !== session.editorFreeformPosition.height)
    ) {
      syncEditorFreeformPosition(session.editorFreeformPosition);
      prevEditorFreeformPosition.current = session.editorFreeformPosition;
    }
  }, [
    session?.editorGridCardId,
    session?.editorGridSpan,
    session?.editorFreeformPosition,
    syncEditorGridCard,
    syncEditorGridSpan,
    syncEditorFreeformPosition,
    session,
  ]);

  return <>{children}</>;
}
