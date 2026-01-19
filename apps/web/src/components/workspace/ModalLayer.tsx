'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import {
  CreateAgentModal,
  PauseSessionModal,
  StandbySettingsModal,
  MCPSettingsModal,
  WorkspaceScalingModal,
} from './modals';
import type { WorkspaceTier } from '@podex/shared';

interface ModalLayerProps {
  sessionId: string;
}

/**
 * Modal orchestrator component.
 * Renders the appropriate modal based on the active modal state.
 * Handles global keyboard shortcuts (Escape to close).
 */
export function ModalLayer({ sessionId }: ModalLayerProps) {
  const { activeModal, closeModal } = useUIStore();
  const { sessions } = useSessionStore();
  const currentSession = sessions[sessionId];

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeModal) {
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, closeModal]);

  if (!activeModal) return null;

  const workspaceId = currentSession?.workspaceId;
  const workspaceTier = (currentSession?.workspaceTier || 'starter') as WorkspaceTier;

  return (
    <>
      {activeModal === 'create-agent' && (
        <CreateAgentModal sessionId={sessionId} onClose={closeModal} />
      )}
      {activeModal === 'pause-session' && workspaceId && (
        <PauseSessionModal sessionId={sessionId} workspaceId={workspaceId} onClose={closeModal} />
      )}
      {activeModal === 'standby-settings' && (
        <StandbySettingsModal sessionId={sessionId} onClose={closeModal} />
      )}
      {activeModal === 'mcp-settings' && <MCPSettingsModal onClose={closeModal} />}
      {activeModal === 'workspace-scaling' && workspaceId && (
        <WorkspaceScalingModal
          sessionId={sessionId}
          workspaceId={workspaceId}
          currentTier={workspaceTier}
          onClose={closeModal}
        />
      )}
    </>
  );
}
