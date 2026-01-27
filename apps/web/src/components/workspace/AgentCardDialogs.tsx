'use client';

import React from 'react';
import type { Agent } from '@/stores/session';
import type { ThinkingConfig } from '@podex/shared';
import { ConfirmDialog, PromptDialog } from '@/components/ui/Dialogs';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';
import { AgentModeSelector } from './AgentModeSelector';
import { CompactionDialog } from './CompactionDialog';
import { ThinkingConfigDialog } from './ThinkingConfigDialog';

interface AgentCardDialogsProps {
  agent: Agent;
  sessionId: string;
  currentModelDisplayName: string;

  // Dialog states
  voiceSettingsOpen: boolean;
  modeSettingsOpen: boolean;
  compactionDialogOpen: boolean;
  deleteDialogOpen: boolean;
  renameDialogOpen: boolean;
  thinkingDialogOpen: boolean;

  // Dialog handlers
  onVoiceSettingsOpenChange: (open: boolean) => void;
  onModeSettingsOpenChange: (open: boolean) => void;
  onCompactionDialogClose: () => void;
  onDeleteDialogClose: () => void;
  onRenameDialogClose: () => void;
  onThinkingDialogOpenChange: (open: boolean) => void;

  // Actions
  onCompact: (options?: {
    customInstructions?: string;
    preserveRecentMessages?: number;
  }) => Promise<void>;
  onDeleteConfirm: () => Promise<void>;
  onRenameConfirm: (newName: string) => Promise<void>;
  onModeUpdate: (mode: Agent['mode'], allowlist?: string[]) => void;
  onSaveThinkingConfig: (config: ThinkingConfig) => void;
}

/**
 * All dialogs for AgentCard extracted into a single component.
 * Reduces complexity in the main AgentCard component.
 */
export const AgentCardDialogs = React.memo<AgentCardDialogsProps>(function AgentCardDialogs({
  agent,
  sessionId,
  currentModelDisplayName,
  voiceSettingsOpen,
  modeSettingsOpen,
  compactionDialogOpen,
  deleteDialogOpen,
  renameDialogOpen,
  thinkingDialogOpen,
  onVoiceSettingsOpenChange,
  onModeSettingsOpenChange,
  onCompactionDialogClose,
  onDeleteDialogClose,
  onRenameDialogClose,
  onThinkingDialogOpenChange,
  onCompact,
  onDeleteConfirm,
  onRenameConfirm,
  onModeUpdate,
  onSaveThinkingConfig,
}) {
  return (
    <>
      {voiceSettingsOpen && (
        <VoiceSettingsDialog
          onOpenChange={onVoiceSettingsOpenChange}
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}

      {modeSettingsOpen && (
        <AgentModeSelector
          onOpenChange={onModeSettingsOpenChange}
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
          currentMode={agent.mode || 'ask'}
          currentAllowlist={agent.commandAllowlist}
          onModeUpdate={onModeUpdate}
        />
      )}

      {compactionDialogOpen && (
        <CompactionDialog
          agentId={agent.id}
          agentName={agent.name}
          sessionId={sessionId}
          onClose={onCompactionDialogClose}
          onCompact={onCompact}
        />
      )}

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteDialogClose}
      />

      <PromptDialog
        isOpen={renameDialogOpen}
        title="Rename Agent"
        message="Enter a new name for this agent:"
        defaultValue={agent.name}
        placeholder="Agent name"
        onConfirm={onRenameConfirm}
        onCancel={onRenameDialogClose}
      />

      <ThinkingConfigDialog
        open={thinkingDialogOpen}
        onOpenChange={onThinkingDialogOpenChange}
        config={agent.thinkingConfig}
        onSave={onSaveThinkingConfig}
        modelName={currentModelDisplayName}
      />
    </>
  );
});
