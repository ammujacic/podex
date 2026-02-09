'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Bell,
  ChevronDown,
  ClipboardList,
  HelpCircle,
  Loader2,
  Pencil,
  Shield,
  Trash2,
  Volume2,
  Zap,
  MoreVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { type Agent, type AgentMode, type AgentRole, useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import {
  getAvailableModels,
  getUserProviderModels,
  updateAgentSettings,
  deleteAgent as deleteAgentApi,
  compactAgentContext,
  attachConversation,
  detachConversation,
  createConversation,
  type PublicModel,
  type UserProviderModel,
} from '@/lib/api';
import { PromptDialog } from '@/components/ui/Dialogs';
import { ContextUsageRing } from './ContextUsageRing';
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet';
import { ModelSelector } from '@/components/model-selector';
import { RoleDropdown } from './RoleDropdown';
import { SessionDropdown } from './SessionDropdown';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';

interface MobileAgentToolbarProps {
  sessionId: string;
  agent: Agent;
}

// Mode configuration
const MODE_CONFIG: Record<
  AgentMode,
  { label: string; description: string; icon: typeof HelpCircle; color: string }
> = {
  ask: {
    label: 'Ask',
    description: 'Ask for confirmation before making changes',
    icon: HelpCircle,
    color: 'text-blue-400',
  },
  auto: {
    label: 'Auto',
    description: 'Automatically execute safe actions',
    icon: Zap,
    color: 'text-green-400',
  },
  plan: {
    label: 'Plan',
    description: 'Read-only planning mode',
    icon: ClipboardList,
    color: 'text-purple-400',
  },
  sovereign: {
    label: 'Sovereign',
    description: 'Full autonomous control',
    icon: Shield,
    color: 'text-red-400',
  },
};

export function MobileAgentToolbar({ sessionId, agent }: MobileAgentToolbarProps) {
  // Sheet visibility states
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Loading states
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  // Dialog states
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);

  // Models
  const [publicModels, setPublicModels] = useState<PublicModel[]>([]);
  const [userModels, setUserModels] = useState<UserProviderModel[]>([]);

  const {
    sessions,
    updateAgent,
    attachConversationToAgent,
    detachConversationFromAgent,
    handleConversationEvent,
  } = useSessionStore();
  const session = sessions[sessionId];

  // Get current conversation for the agent
  const currentConversation = useMemo(() => {
    if (!agent.conversationSessionId || !session?.conversationSessions) return null;
    return session.conversationSessions.find((c) => c.id === agent.conversationSessionId) ?? null;
  }, [agent.conversationSessionId, session?.conversationSessions]);

  // Attention state
  const {
    getAttentionsForAgent,
    getHighestPriorityAttention,
    getUnreadCountForAgent,
    hasUnreadForAgent,
    openPanel,
  } = useAttentionStore();
  const agentAttentions = getAttentionsForAgent(sessionId, agent.id);
  const highestPriorityAttention = getHighestPriorityAttention(sessionId, agent.id);
  const hasAttention = agentAttentions.length > 0;
  const unreadCount = getUnreadCountForAgent(sessionId, agent.id);
  const hasUnread = hasUnreadForAgent(sessionId, agent.id);

  // Load models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const [pub, user] = await Promise.all([getAvailableModels(), getUserProviderModels()]);
        setPublicModels(pub);
        setUserModels(user);
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    };
    loadModels();
  }, []);

  // Find current model info (platform or user API)
  const currentModelInfo = useMemo(() => {
    const pubModel = publicModels.find((m) => m.model_id === agent.model);
    if (pubModel) return pubModel;
    const userModel = userModels.find((m) => m.model_id === agent.model);
    if (userModel) return userModel;
    return null;
  }, [publicModels, userModels, agent.model]);

  const currentModeConfig = MODE_CONFIG[agent.mode] || MODE_CONFIG.ask;

  // Handlers
  const handleChangeModel = useCallback(
    async (modelId: string) => {
      setShowModelMenu(false);
      // Clear modelDisplayName so we use the display_name from the model lookup
      updateAgent(sessionId, agent.id, { model: modelId, modelDisplayName: undefined });
      try {
        await updateAgentSettings(sessionId, agent.id, { model: modelId });
        const pub = publicModels.find((m) => m.model_id === modelId);
        const user = userModels.find((m) => m.model_id === modelId);
        const label = pub?.display_name || user?.display_name || modelId;
        toast.success(`Model changed to ${label}`);
      } catch (err) {
        console.error('Failed to change model:', err);
        toast.error('Failed to change model');
      }
    },
    [sessionId, agent.id, updateAgent, publicModels, userModels]
  );

  const handleChangeMode = useCallback(
    (mode: AgentMode) => {
      setShowModeMenu(false);
      updateAgent(sessionId, agent.id, { mode });
      toast.success(`Mode changed to ${MODE_CONFIG[mode].label}`);
    },
    [sessionId, agent.id, updateAgent]
  );

  const handleRoleChange = useCallback(
    (role: AgentRole) => {
      updateAgent(sessionId, agent.id, { role });
      toast.success(`Role changed to ${role}`);
      // TODO: Persist role change to backend when API supports it
    },
    [sessionId, agent.id, updateAgent]
  );

  const handleAttachSession = useCallback(
    async (conversationId: string) => {
      try {
        // Optimistically update local state
        attachConversationToAgent(sessionId, conversationId, agent.id);
        // Persist to backend
        await attachConversation(sessionId, conversationId, agent.id);
        toast.success('Session attached');
      } catch (err) {
        console.error('Failed to attach session:', err);
        toast.error('Failed to attach session');
      }
    },
    [sessionId, agent.id, attachConversationToAgent]
  );

  const handleDetachSession = useCallback(async () => {
    if (currentConversation) {
      try {
        // Optimistically update local state
        detachConversationFromAgent(sessionId, currentConversation.id);
        // Call API to detach
        await detachConversation(sessionId, currentConversation.id, agent.id);
        toast.success('Session detached');
      } catch (err) {
        console.error('Failed to detach session:', err);
        toast.error('Failed to detach session');
      }
    }
  }, [sessionId, currentConversation, agent.id, detachConversationFromAgent]);

  const handleCreateSession = useCallback(async () => {
    try {
      // Create conversation on backend first
      const newConversation = await createConversation(sessionId, { name: 'New Session' });

      // Update local state immediately
      handleConversationEvent(sessionId, 'conversation_created', {
        conversation: {
          id: newConversation.id,
          name: newConversation.name,
          attachedAgentIds: newConversation.attached_agent_ids || [],
          messageCount: newConversation.message_count,
          lastMessageAt: newConversation.last_message_at,
          createdAt: newConversation.created_at,
          updatedAt: newConversation.updated_at,
        },
      });

      // Attach the conversation to this agent
      await attachConversation(sessionId, newConversation.id, agent.id);

      // Update local state for attach
      attachConversationToAgent(sessionId, newConversation.id, agent.id);
      toast.success('New session created');
    } catch (err) {
      console.error('Failed to create session:', err);
      toast.error('Failed to create session');
    }
  }, [sessionId, agent.id, handleConversationEvent, attachConversationToAgent]);

  const handleCompactContext = useCallback(async () => {
    setIsCompacting(true);
    try {
      await compactAgentContext(agent.id);
      toast.success('Context compacted successfully');
    } catch (err) {
      console.error('Failed to compact context:', err);
      toast.error('Failed to compact context');
    } finally {
      setIsCompacting(false);
      setShowContextMenu(false);
    }
  }, [agent.id]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteAgentApi(sessionId, agent.id);
      toast.success('Agent deleted');
    } catch (err) {
      console.error('Failed to delete agent:', err);
      toast.error('Failed to delete agent');
    } finally {
      setIsDeleting(false);
      setShowMoreMenu(false);
    }
  }, [sessionId, agent.id]);

  const handleRename = useCallback(
    async (newName: string) => {
      updateAgent(sessionId, agent.id, { name: newName });
      try {
        await updateAgentSettings(sessionId, agent.id, { name: newName });
        toast.success('Agent renamed');
      } catch (err) {
        console.error('Failed to rename agent:', err);
        toast.error('Failed to rename agent');
      }
      setShowRenameDialog(false);
      setShowMoreMenu(false);
    },
    [sessionId, agent.id, updateAgent]
  );

  return (
    <>
      {/* Toolbar - split into scrollable section and fixed settings button */}
      <div
        className="flex items-center border-b border-border-subtle bg-surface"
        role="toolbar"
        aria-label="Agent controls"
      >
        {/* Scrollable controls section */}
        <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto scrollbar-hide flex-1 min-w-0">
          {/* Model selector */}
          <button
            onClick={() => setShowModelMenu(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 min-h-[44px]"
            aria-label={`Current model: ${currentModelInfo?.display_name || agent.model}`}
          >
            <span className="truncate max-w-[80px]">
              {currentModelInfo?.display_name || agent.modelDisplayName || agent.model}
            </span>
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>

          {/* Mode selector */}
          <button
            onClick={() => setShowModeMenu(true)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 min-h-[44px]',
              'bg-surface-hover hover:bg-surface-active',
              currentModeConfig.color
            )}
            aria-label={`Current mode: ${currentModeConfig.label}`}
          >
            <currentModeConfig.icon className="h-3 w-3" aria-hidden="true" />
            <span>{currentModeConfig.label}</span>
          </button>

          {/* Role selector */}
          <RoleDropdown
            currentRole={agent.role}
            onRoleChange={handleRoleChange}
            className="min-h-[44px]"
          />

          {/* Session selector */}
          <SessionDropdown
            sessionId={sessionId}
            agentId={agent.id}
            currentConversation={currentConversation}
            onAttach={handleAttachSession}
            onDetach={handleDetachSession}
            onCreateNew={handleCreateSession}
            className="min-h-[44px]"
          />

          {/* Context usage */}
          <button
            onClick={() => setShowContextMenu(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 min-h-[44px]"
            aria-label="View context usage"
          >
            <ContextUsageRing agentId={agent.id} size="sm" />
          </button>

          {/* Attention badge */}
          {hasAttention && (
            <button
              onClick={openPanel}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 min-h-[44px]',
                hasUnread && 'animate-pulse',
                highestPriorityAttention?.type === 'error' && 'bg-red-500/20 text-red-400',
                highestPriorityAttention?.type === 'needs_approval' &&
                  'bg-yellow-500/20 text-yellow-400',
                highestPriorityAttention?.type === 'completed' && 'bg-green-500/20 text-green-400',
                highestPriorityAttention?.type === 'waiting_input' &&
                  'bg-blue-500/20 text-blue-400',
                !hasUnread && 'opacity-60'
              )}
              aria-label={`${unreadCount} notifications${hasUnread ? ', unread' : ''}`}
            >
              <Bell className="h-3 w-3" aria-hidden="true" />
              {hasUnread ? (
                <>
                  <span className="font-semibold">{unreadCount}</span>
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-pulse"
                    aria-hidden="true"
                  />
                </>
              ) : (
                <>
                  <span>{agentAttentions.length}</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </div>

        {/* Settings button - always visible, fixed to the right */}
        <button
          onClick={() => setShowMoreMenu(true)}
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-hover text-text-secondary hover:text-text-primary transition-colors flex-shrink-0 mx-2 border-l border-border-subtle pl-2"
          aria-label="Agent settings"
        >
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Model selection sheet */}
      <MobileBottomSheet
        isOpen={showModelMenu}
        onClose={() => setShowModelMenu(false)}
        height="full"
      >
        <ModelSelector
          models={publicModels}
          userKeyModels={userModels as unknown as typeof publicModels}
          selectedModelId={agent.model}
          onSelectModel={handleChangeModel}
          className="h-full"
        />
      </MobileBottomSheet>

      {/* Mode selection sheet */}
      <MobileBottomSheet
        isOpen={showModeMenu}
        onClose={() => setShowModeMenu(false)}
        title="Select Mode"
        height="auto"
      >
        <div className="space-y-2" role="listbox" aria-label="Agent modes">
          {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG.ask][]).map(
            ([mode, config]) => (
              <button
                key={mode}
                onClick={() => handleChangeMode(mode)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors min-h-[56px]',
                  agent.mode === mode
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'bg-surface-hover text-text-primary hover:bg-surface-active'
                )}
                role="option"
                aria-selected={agent.mode === mode}
              >
                <config.icon className={cn('h-5 w-5', config.color)} aria-hidden="true" />
                <div className="text-left">
                  <p className="font-medium">{config.label}</p>
                  <p className="text-xs text-text-secondary">{config.description}</p>
                </div>
              </button>
            )
          )}
        </div>
      </MobileBottomSheet>

      {/* Context management sheet */}
      <MobileBottomSheet
        isOpen={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        title="Context Management"
        height="auto"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-center py-4">
            <ContextUsageRing agentId={agent.id} size="lg" />
          </div>
          <p className="text-sm text-text-secondary text-center">
            Compact context to free up space when the context window is filling up.
          </p>
          <button
            onClick={handleCompactContext}
            disabled={isCompacting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-accent-primary text-text-inverse hover:bg-accent-primary/90 transition-colors disabled:opacity-50 min-h-[48px]"
          >
            {isCompacting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Compacting...</span>
              </>
            ) : (
              <span>Compact Context</span>
            )}
          </button>
        </div>
      </MobileBottomSheet>

      {/* More menu sheet */}
      <MobileBottomSheet
        isOpen={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        title="Agent Settings"
        height="auto"
      >
        <div className="space-y-2">
          <button
            onClick={() => setShowRenameDialog(true)}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-hover text-text-primary hover:bg-surface-active transition-colors min-h-[48px]"
          >
            <Pencil className="h-5 w-5" aria-hidden="true" />
            <span>Rename</span>
          </button>
          <button
            onClick={() => {
              setShowMoreMenu(false);
              setShowVoiceSettings(true);
            }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-surface-hover text-text-primary hover:bg-surface-active transition-colors min-h-[48px]"
          >
            <Volume2 className="h-5 w-5" aria-hidden="true" />
            <span>Voice Settings</span>
          </button>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors min-h-[48px]"
          >
            {isDeleting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            )}
            <span>Delete</span>
          </button>
        </div>
      </MobileBottomSheet>

      {/* Rename dialog */}
      <PromptDialog
        isOpen={showRenameDialog}
        title="Rename Agent"
        message="Enter a new name for this agent:"
        defaultValue={agent.name}
        placeholder="Agent name"
        onConfirm={handleRename}
        onCancel={() => setShowRenameDialog(false)}
      />

      {/* Voice settings dialog */}
      {showVoiceSettings && (
        <VoiceSettingsDialog
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
          onOpenChange={(open) => setShowVoiceSettings(open)}
        />
      )}
    </>
  );
}
