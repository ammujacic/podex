'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import {
  CreateAgentModal,
  MCPSettingsModal,
  WorkspaceScalingModal,
  ExtensionMarketplaceModal,
  NewPathModal,
  OpenClawInstallWizardModal,
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
  const { activeModal, modalData, closeModal } = useUIStore();
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
      {activeModal === 'mcp-settings' && <MCPSettingsModal onClose={closeModal} />}
      {activeModal === 'extensions-marketplace' && (
        <ExtensionMarketplaceModal onClose={closeModal} workspaceId={workspaceId} />
      )}
      {activeModal === 'workspace-scaling' && workspaceId && (
        <WorkspaceScalingModal
          sessionId={sessionId}
          workspaceId={workspaceId}
          currentTier={workspaceTier}
          onClose={closeModal}
        />
      )}
      {(activeModal === 'new-file' || activeModal === 'new-folder') && (
        <NewPathModal
          sessionId={sessionId}
          mode={activeModal === 'new-file' ? 'file' : 'folder'}
          initialPath={
            typeof modalData?.initialPath === 'string' ? (modalData.initialPath as string) : ''
          }
          onClose={closeModal}
        />
      )}
      {activeModal === 'openclaw-wizard' && (
        <OpenClawInstallWizardModal
          sessionId={sessionId}
          workspaceId={workspaceId ?? null}
          localPodId={currentSession?.localPodId ?? null}
          onClose={closeModal}
        />
      )}
    </>
  );
}
