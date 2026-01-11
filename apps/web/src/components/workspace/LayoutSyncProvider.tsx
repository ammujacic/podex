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
  } = useLayoutSync({ sessionId, enabled: !!session });

  // Track previous values to detect changes
  const prevViewMode = useRef(session?.viewMode);
  const prevActiveAgentId = useRef(session?.activeAgentId);
  const prevAgents = useRef(session?.agents);
  const prevFilePreviews = useRef(session?.filePreviews);

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

  return <>{children}</>;
}
