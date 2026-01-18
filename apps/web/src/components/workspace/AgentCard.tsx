'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LogIn, Mic, Paperclip, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { type Agent, type AgentMode, useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import { useApprovalsStore } from '@/stores/approvals';
import { useWorktreesStore } from '@/stores/worktrees';
import { useCheckpointsStore } from '@/stores/checkpoints';
import { cn } from '@/lib/utils';
import { getAgentBorderColor } from '@/lib/agentConstants';
import {
  mapCostTierToTier,
  mapCostTierToReasoningEffort,
  createShortModelName,
  parseModelIdToDisplayName,
} from '@/lib/model-utils';
import {
  sendAgentMessage,
  deleteAgent as deleteAgentApi,
  duplicateAgent as duplicateAgentApi,
  deleteAgentMessage as deleteAgentMessageApi,
  synthesizeMessage,
  abortAgent,
  approvePlan,
  rejectPlan,
  togglePlanMode,
  restoreCheckpoint,
  updateAgentSettings,
  isQuotaError,
  compactAgentContext,
  getAvailableModels,
  getUserProviderModels,
  executeCommand,
  type PublicModel,
  type UserProviderModel,
  type CustomCommand,
} from '@/lib/api';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { onSocketEvent, emitPermissionResponse, type AgentMessageEvent } from '@/lib/socket';
import { SUPPORTED_IMAGE_TYPES, MAX_ATTACHMENT_SIZE_MB } from '@podex/shared';
import type { ThinkingConfig, AttachmentFile, ModelInfo, LLMProvider } from '@podex/shared';

// Extracted components
import { ConfirmDialog, PromptDialog } from '@/components/ui/Dialogs';
import { AgentCardHeader } from './AgentCardHeader';
import { AgentMessageList } from './AgentMessageList';
import { AgentStreamingMessage } from './AgentStreamingMessage';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';
import { AgentModeSelector } from './AgentModeSelector';
import { PlanApprovalActions } from './PlanApprovalActions';
import { CompactionDialog } from './CompactionDialog';
import { ThinkingConfigDialog } from './ThinkingConfigDialog';
import { SlashCommandMenu, isBuiltInCommand, type BuiltInCommand } from './SlashCommandMenu';
import { CreditExhaustedBanner } from './CreditExhaustedBanner';
import { SlashCommandDialog } from './SlashCommandSheet';
import { ApprovalDialog } from './ApprovalDialog';
import {
  isCliAgentRole,
  getCliAgentType,
  getCliSupportedModels,
  normalizeCliModelId,
  useCliAgentAuth,
} from '@/hooks/useCliAgentCommands';
import { useUIStore } from '@/stores/ui';

export interface AgentCardProps {
  agent: Agent;
  sessionId: string;
  expanded?: boolean;
}

// Extended ModelInfo with user API flag
type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

export function AgentCard({ agent, sessionId, expanded = false }: AgentCardProps) {
  const router = useRouter();

  // UI state
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [showAbortedMessage, setShowAbortedMessage] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [synthesizingMessageId, setSynthesizingMessageId] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  const [isTogglingPlanMode, setIsTogglingPlanMode] = useState(false);

  // Dialog states
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  const [compactionDialogOpen, setCompactionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [thinkingDialogOpen, setThinkingDialogOpen] = useState(false);
  const [slashCommandSheetOpen, setSlashCommandSheetOpen] = useState(false);

  // Attachments
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);

  // Models
  const [backendModels, setBackendModels] = useState<PublicModel[]>([]);
  const [userProviderModels, setUserProviderModels] = useState<UserProviderModel[]>([]);

  // Slash command menu
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');

  // Credit error
  const [showCreditError, setShowCreditError] = useState(false);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store actions
  const {
    removeAgent,
    updateAgent,
    addAgent,
    addAgentMessage,
    deleteAgentMessage,
    streamingMessages,
    updateAgentThinking,
  } = useSessionStore();
  const { getAgentWorktree } = useWorktreesStore();
  const { getAgentCheckpoints, restoringCheckpointId } = useCheckpointsStore();

  // Related data
  const agentWorktree = getAgentWorktree(sessionId, agent.id);
  const agentCheckpoints = getAgentCheckpoints(sessionId, agent.id);

  // Streaming message
  const streamingMessage = Object.values(streamingMessages).find(
    (sm) => sm.sessionId === sessionId && sm.agentId === agent.id && sm.isStreaming
  );

  // User message history
  const userMessages = agent.messages
    .filter((msg) => msg.role === 'user')
    .map((msg) => msg.content)
    .reverse();

  // Auto-scroll
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [agent.messages.length, isSending, streamingMessage?.content]);

  // Fetch models
  useEffect(() => {
    getAvailableModels()
      .then(setBackendModels)
      .catch((err) => console.error('Failed to fetch platform models:', err));
    getUserProviderModels()
      .then(setUserProviderModels)
      .catch((err) => console.error('Failed to fetch user-provider models:', err));
  }, []);

  // Abort handler
  const handleAbort = useCallback(async () => {
    if (agent.status !== 'active' && !isSending) return;
    if (isAborting) return;

    setIsAborting(true);
    try {
      await abortAgent(sessionId, agent.id);
      setIsSending(false);
      updateAgent(sessionId, agent.id, { status: 'idle' });
      setShowAbortedMessage(true);
    } catch (error) {
      console.error('Failed to abort agent:', error);
    } finally {
      setIsAborting(false);
    }
  }, [agent.status, agent.id, sessionId, isSending, isAborting, updateAgent]);

  // Escape key listener
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (agent.status === 'active' || isSending)) {
        e.preventDefault();
        e.stopPropagation();
        handleAbort();
      }
    };

    card.addEventListener('keydown', handleKeyDown);
    return () => card.removeEventListener('keydown', handleKeyDown);
  }, [agent.status, isSending, handleAbort]);

  // Clear aborted message
  useEffect(() => {
    if (!showAbortedMessage) return;
    const timer = setTimeout(() => setShowAbortedMessage(false), 3000);
    return () => clearTimeout(timer);
  }, [showAbortedMessage]);

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

  // Approvals
  const { getAgentApprovals } = useApprovalsStore();
  const agentApprovals = getAgentApprovals(sessionId, agent.id);
  const pendingApprovalCount = agentApprovals.filter((a) => a.status === 'pending').length;

  // Voice capture
  const { isRecording, currentTranscript, startRecording, stopRecording } = useVoiceCapture({
    sessionId,
    agentId: agent.id,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setMessage(text.trim());
      }
    },
    onError: (error) => console.error('Voice capture error:', error),
  });

  // Audio playback
  const { isPlaying, playingMessageId, playAudioUrl, playAudioBase64, stopPlayback } =
    useAudioPlayback({
      sessionId,
      onPlayEnd: () => {},
    });

  // CLI agent auth (for claude-code, openai-codex, gemini-cli)
  const isCliAgent = isCliAgentRole(agent.role);
  const cliAgentType = getCliAgentType(agent.role);
  const {
    authStatus: cliAuthStatus,
    reauthenticate: claudeCodeReauthenticate,
    checkAuth: checkCliAuth,
  } = useCliAgentAuth(cliAgentType ?? 'claude-code', isCliAgent ? agent.id : undefined);

  // Terminal toggle for CLI auth
  const { toggleTerminal, terminalVisible } = useUIStore();

  // Check if CLI agent needs authentication (blocks input until authenticated)
  const cliNeedsAuth =
    isCliAgent &&
    agent.messages.length === 0 &&
    (cliAuthStatus === null || cliAuthStatus?.needsAuth);

  // CLI agent handlers (non-message handlers)
  const handleOpenSlashCommands = useCallback(() => {
    setSlashCommandSheetOpen(true);
  }, []);

  // Get CLI command name for the agent
  const getCliCommand = useCallback(() => {
    switch (agent.role) {
      case 'claude-code':
        return 'claude';
      case 'openai-codex':
        return 'codex';
      case 'gemini-cli':
        return 'gemini';
      default:
        return agent.role;
    }
  }, [agent.role]);

  // Handle CLI agent login - opens terminal for interactive auth
  const handleCliLogin = useCallback(() => {
    // Open terminal if not visible
    if (!terminalVisible) {
      toggleTerminal();
    }

    const cliCommand = getCliCommand();
    toast.success(`Terminal opened! Run "${cliCommand}" and type "/login" to authenticate.`, {
      duration: 8000,
    });
  }, [terminalVisible, toggleTerminal, getCliCommand]);

  // Handle refresh auth status
  const handleRefreshAuth = useCallback(async () => {
    if (checkCliAuth) {
      toast.info('Checking authentication status...');
      await checkCliAuth();
    }
  }, [checkCliAuth]);

  const handleClaudeCodeReauthenticate = useCallback(async () => {
    try {
      await claudeCodeReauthenticate();
      toast.success(
        'Re-authentication initiated. Please check your workspace for the login prompt.'
      );
    } catch (error) {
      console.error('Failed to reauthenticate:', error);
      toast.error('Failed to start re-authentication');
    }
  }, [claudeCodeReauthenticate]);

  const borderColor = getAgentBorderColor(agent.color);

  // Model conversion helpers
  const backendModelToInfo = useCallback(
    (m: PublicModel, isUserKey = false): ExtendedModelInfo => ({
      id: m.model_id,
      provider: (isUserKey ? m.provider : 'podex') as LLMProvider,
      displayName: m.display_name,
      shortName: createShortModelName(m.display_name),
      tier: mapCostTierToTier(m.cost_tier),
      contextWindow: m.context_window,
      maxOutputTokens: m.max_output_tokens,
      supportsVision: m.capabilities.vision,
      supportsThinking: m.capabilities.thinking,
      thinkingStatus: m.capabilities.thinking
        ? 'available'
        : m.capabilities.thinking_coming_soon
          ? 'coming_soon'
          : 'not_supported',
      capabilities: [
        'chat',
        'code',
        ...(m.capabilities.vision ? (['vision'] as const) : []),
        ...(m.capabilities.tool_use ? (['function_calling'] as const) : []),
      ],
      goodFor: m.good_for || [],
      description: m.description || '',
      reasoningEffort: mapCostTierToReasoningEffort(m.cost_tier),
      isUserKey,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  const userModelToInfo = useCallback(
    (m: UserProviderModel): ExtendedModelInfo => ({
      id: m.model_id,
      provider: m.provider as LLMProvider,
      displayName: m.display_name,
      shortName: createShortModelName(m.display_name),
      tier: mapCostTierToTier(m.cost_tier),
      contextWindow: m.context_window,
      maxOutputTokens: m.max_output_tokens,
      supportsVision: m.capabilities.vision,
      supportsThinking: m.capabilities.thinking,
      thinkingStatus: m.capabilities.thinking
        ? 'available'
        : m.capabilities.thinking_coming_soon
          ? 'coming_soon'
          : 'not_supported',
      capabilities: [
        'chat',
        'code',
        ...(m.capabilities.vision ? (['vision'] as const) : []),
        ...(m.capabilities.tool_use ? (['function_calling'] as const) : []),
      ],
      goodFor: m.good_for || [],
      description: m.description || '',
      reasoningEffort: mapCostTierToReasoningEffort(m.cost_tier),
      isUserKey: true,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  const currentModelInfo = useMemo(() => {
    // For CLI agents, look up model in CLI_CAPABILITIES
    const cliType = getCliAgentType(agent.role);
    if (cliType) {
      const cliModels = getCliSupportedModels(cliType);
      const normalizedModelId = normalizeCliModelId(agent.model, cliType);
      const cliModel = cliModels.find((m) => m.id === normalizedModelId);
      if (cliModel) {
        const supportsVision = cliModel.supportsVision ?? true;
        const supportsThinking = cliModel.supportsThinking ?? false;
        return {
          id: cliModel.id,
          provider: 'anthropic' as LLMProvider,
          displayName: cliModel.name,
          shortName: cliModel.name,
          tier: 'flagship' as const,
          contextWindow: 200000,
          maxOutputTokens: 64000,
          supportsVision,
          supportsThinking,
          thinkingStatus: supportsThinking ? ('available' as const) : ('not_supported' as const),
          capabilities: [
            'chat' as const,
            'code' as const,
            ...(supportsVision ? (['vision'] as const) : []),
            'function_calling' as const,
          ],
          goodFor: [] as string[],
          description: '',
          reasoningEffort: 'medium' as const,
          isUserKey: false,
        };
      }
    }

    // For Podex agents, look up in user/backend models
    const userModel = userProviderModels.find((m) => m.model_id === agent.model);
    if (userModel) return userModelToInfo(userModel);
    const backendModel = backendModels.find((m) => m.model_id === agent.model);
    if (backendModel) return backendModelToInfo(backendModel);
    return undefined;
  }, [
    agent.model,
    agent.role,
    backendModels,
    userProviderModels,
    backendModelToInfo,
    userModelToInfo,
  ]);

  const modelsByTier = useMemo(() => {
    const flagship: ExtendedModelInfo[] = [];
    const balanced: ExtendedModelInfo[] = [];
    const fast: ExtendedModelInfo[] = [];
    const userApi: ExtendedModelInfo[] = [];

    // For CLI agents, use the hardcoded CLI models directly
    const cliType = getCliAgentType(agent.role);
    if (cliType) {
      const cliModels = getCliSupportedModels(cliType);
      for (const m of cliModels) {
        const supportsVision = m.supportsVision ?? true;
        const supportsThinking = m.supportsThinking ?? false;
        // Create minimal ExtendedModelInfo for CLI models
        flagship.push({
          id: m.id,
          provider: 'anthropic' as LLMProvider, // CLI-specific, not Podex
          displayName: m.name,
          shortName: m.name,
          tier: 'flagship',
          contextWindow: 200000,
          maxOutputTokens: 64000,
          supportsVision,
          supportsThinking,
          thinkingStatus: supportsThinking ? 'available' : 'not_supported',
          capabilities: [
            'chat',
            'code',
            ...(supportsVision ? (['vision'] as const) : []),
            'function_calling',
          ],
          goodFor: [],
          description: '',
          reasoningEffort: 'medium',
          isUserKey: false,
        });
      }
      return { flagship, balanced, fast, userApi };
    }

    // Standard Podex model tiers
    for (const m of backendModels) {
      const info = backendModelToInfo(m);
      if (m.cost_tier === 'premium' || m.cost_tier === 'high') flagship.push(info);
      else if (m.cost_tier === 'medium') balanced.push(info);
      else fast.push(info);
    }
    for (const m of userProviderModels) {
      userApi.push(userModelToInfo(m));
    }

    return { flagship, balanced, fast, userApi };
  }, [agent.role, backendModels, userProviderModels, backendModelToInfo, userModelToInfo]);

  const getModelDisplayName = useCallback(
    (modelId: string) => {
      // Only strip "Claude " since Sonnet/Opus/Haiku are recognizable on their own
      // Keep "Llama " since "3.1 8B" alone is not recognizable
      if (agent.modelDisplayName) {
        return agent.modelDisplayName.replace('Claude ', '');
      }
      const userModel = userProviderModels.find((m) => m.model_id === modelId);
      if (userModel) return userModel.display_name.replace('Claude ', '').replace(' (Direct)', '');
      const backendModel = backendModels.find((m) => m.model_id === modelId);
      if (backendModel) return backendModel.display_name.replace('Claude ', '');
      // Fallback: parse raw model ID into user-friendly name
      return parseModelIdToDisplayName(modelId);
    },
    [agent.modelDisplayName, backendModels, userProviderModels]
  );

  // Message handlers
  const handleSendMessage = useCallback(
    async (overrideMessage?: string) => {
      const effectiveMessage = overrideMessage ?? message;
      if ((!effectiveMessage.trim() && attachments.length === 0) || isSending) return;

      const messageContent = effectiveMessage.trim();
      const currentAttachments = [...attachments];
      setIsSending(true);
      setMessage('');
      setAttachments([]);

      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user' as const,
        content: messageContent,
        timestamp: new Date(),
      };
      addAgentMessage(sessionId, agent.id, userMessage);
      updateAgent(sessionId, agent.id, { status: 'active' });

      try {
        await sendAgentMessage(sessionId, agent.id, messageContent, {
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          thinkingConfig: agent.thinkingConfig,
        });
      } catch (error) {
        console.error('Failed to send message:', error);
        updateAgent(sessionId, agent.id, { status: 'error' });

        if (isQuotaError(error)) {
          setShowCreditError(true);
          toast.error('Credit limit reached', {
            description: 'You have run out of credits or exceeded your quota.',
            action: {
              label: 'Buy Credits',
              onClick: () => router.push('/settings/billing/credits'),
            },
            duration: 10000,
          });
        } else {
          toast.error('Failed to send message. Please try again.');
        }
      } finally {
        setIsSending(false);
      }
    },
    [
      message,
      attachments,
      isSending,
      sessionId,
      agent.id,
      agent.thinkingConfig,
      addAgentMessage,
      updateAgent,
      router,
    ]
  );

  // Handle slash command selection for CLI agents (must be after handleSendMessage)
  const handleCliSlashCommand = useCallback(
    (commandName: string) => {
      // Close the sheet
      setSlashCommandSheetOpen(false);

      // Clear the input and send the command directly
      setMessage('');
      handleSendMessage(`/${commandName}`);
    },
    [handleSendMessage]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setMessage(value);

      if (value.startsWith('/')) {
        // For CLI agents (claude-code, openai-codex, gemini-cli), show their specific command sheet
        if (isCliAgent) {
          setSlashCommandSheetOpen(true);
        } else {
          // For regular agents, show the standard slash menu
          setSlashQuery(value.slice(1));
          setShowSlashMenu(true);
        }
      } else {
        setShowSlashMenu(false);
        setSlashQuery('');
      }
    },
    [isCliAgent]
  );

  const handleSlashCommandSelect = useCallback(
    async (command: BuiltInCommand | CustomCommand) => {
      setShowSlashMenu(false);
      setSlashQuery('');

      if (isBuiltInCommand(command)) {
        const builtIn = command as BuiltInCommand;

        if (builtIn.immediate && builtIn.action) {
          switch (builtIn.action) {
            case 'help':
              toast.info('Available Commands', {
                description: 'Type / to see all commands.',
                duration: 5000,
              });
              setMessage('');
              return;
            case 'clear':
              if (agent.messages.length > 0) {
                updateAgent(sessionId, agent.id, { messages: [] });
                toast.success('Conversation cleared');
              } else {
                toast.info('Conversation is already empty');
              }
              setMessage('');
              return;
            case 'compact':
              setCompactionDialogOpen(true);
              setMessage('');
              return;
            case 'checkpoint':
              setMessage('');
              handleSendMessage('/checkpoint - Create a checkpoint of the current changes');
              return;
            case 'undo':
              if (agentCheckpoints.length > 0) {
                toast.info('Use the Undo button in the header to restore a checkpoint');
              } else {
                toast.warning('No checkpoints available');
              }
              setMessage('');
              return;
            case 'mode':
              setModeSettingsOpen(true);
              setMessage('');
              return;
            case 'model':
              toast.info(`Current model: ${agent.model}`, {
                description: 'Use the model dropdown in the agent header to switch models.',
                duration: 4000,
              });
              setMessage('');
              return;
            case 'think':
              setThinkingDialogOpen(true);
              setMessage('');
              return;
          }
        }

        if (builtIn.args && builtIn.args.length > 0) {
          const argPlaceholders = builtIn.args
            .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
            .join(' ');
          setMessage(`/${builtIn.name} ${argPlaceholders}`);
          setTimeout(() => {
            if (inputRef.current) {
              const start = builtIn.name.length + 2;
              inputRef.current.focus();
              inputRef.current.setSelectionRange(start, inputRef.current.value.length);
            }
          }, 0);
          return;
        }

        setMessage('');
        handleSendMessage(`/${builtIn.name}`);
      } else {
        const custom = command as CustomCommand;

        if (custom.arguments && custom.arguments.length > 0) {
          const argPlaceholders = custom.arguments
            .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
            .join(' ');
          setMessage(`/${custom.name} ${argPlaceholders}`);
          setTimeout(() => {
            if (inputRef.current) {
              const start = custom.name.length + 2;
              inputRef.current.focus();
              inputRef.current.setSelectionRange(start, inputRef.current.value.length);
            }
          }, 0);
        } else {
          try {
            const result = await executeCommand(custom.id, {});
            setMessage('');
            handleSendMessage(result.prompt);
          } catch (error) {
            console.error('Failed to execute command:', error);
            toast.error(`Failed to execute /${custom.name}`);
            setMessage('');
          }
        }
      }
    },
    [
      agent.messages.length,
      agentCheckpoints.length,
      handleSendMessage,
      updateAgent,
      sessionId,
      agent.id,
      agent.model,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSlashMenu) {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
      setHistoryIndex(-1);
      setSavedInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (userMessages.length === 0) return;
      if (historyIndex === -1) setSavedInput(message);
      const newIndex = Math.min(historyIndex + 1, userMessages.length - 1);
      setHistoryIndex(newIndex);
      setMessage(userMessages[newIndex] ?? '');
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = inputRef.current.value.length;
          inputRef.current.selectionEnd = inputRef.current.value.length;
        }
      }, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setMessage(newIndex === -1 ? savedInput : (userMessages[newIndex] ?? ''));
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = inputRef.current.value.length;
          inputRef.current.selectionEnd = inputRef.current.value.length;
        }
      }, 0);
    }
  };

  // Agent action handlers
  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      updateAgent(sessionId, agent.id, { name: newName });
      try {
        await updateAgentSettings(sessionId, agent.id, { name: newName });
      } catch (error) {
        console.error('Failed to persist name change:', error);
      }
      setRenameDialogOpen(false);
    },
    [agent.id, sessionId, updateAgent]
  );

  // Permission approval handler (for Claude Code CLI)
  const handlePermissionApproval = useCallback(
    (approved: boolean, addedToAllowlist: boolean) => {
      if (!agent.pendingPermission) return;

      // Emit the permission response via WebSocket
      emitPermissionResponse(
        sessionId,
        agent.id,
        agent.pendingPermission.requestId,
        approved,
        agent.pendingPermission.command,
        agent.pendingPermission.toolName,
        addedToAllowlist
      );

      // Clear the pending permission from the agent
      updateAgent(sessionId, agent.id, { pendingPermission: undefined });
    },
    [sessionId, agent.id, agent.pendingPermission, updateAgent]
  );

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;
    setIsDuplicating(true);
    try {
      const newAgentData = await duplicateAgentApi(sessionId, agent.id);
      addAgent(sessionId, {
        id: newAgentData.id,
        name: newAgentData.name,
        role: newAgentData.role as Agent['role'],
        model: newAgentData.model,
        status: 'idle',
        color: agent.color,
        messages: [],
        mode: (newAgentData.mode || 'ask') as AgentMode,
      });
      toast.success(`Agent duplicated as "${newAgentData.name}"`);
    } catch (error) {
      console.error('Failed to duplicate agent:', error);
      toast.error('Failed to duplicate agent. Please try again.');
    } finally {
      setIsDuplicating(false);
    }
  }, [sessionId, agent.id, agent.color, isDuplicating, addAgent]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (deletingMessageId) return;
      setDeletingMessageId(messageId);
      try {
        await deleteAgentMessageApi(sessionId, agent.id, messageId);
        deleteAgentMessage(sessionId, agent.id, messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
      } finally {
        setDeletingMessageId(null);
      }
    },
    [sessionId, agent.id, deletingMessageId, deleteAgentMessage]
  );

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteDialogOpen(false);
    setIsDeleting(true);
    try {
      await deleteAgentApi(sessionId, agent.id);
      removeAgent(sessionId, agent.id);
    } catch (error) {
      console.error('Failed to delete agent:', error);
      toast.error('Failed to delete agent. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }, [sessionId, agent.id, removeAgent]);

  const handleTogglePlanMode = useCallback(async () => {
    if (isTogglingPlanMode) return;
    setIsTogglingPlanMode(true);
    try {
      const result = await togglePlanMode(sessionId, agent.id);
      updateAgent(sessionId, agent.id, {
        mode: result.mode,
        previousMode: result.previous_mode ?? undefined,
      });
      toast.success(
        result.toggled_to_plan
          ? 'Switched to Plan mode (read-only)'
          : `Switched back to ${result.mode.charAt(0).toUpperCase() + result.mode.slice(1)} mode`
      );
    } catch (error) {
      console.error('Failed to toggle plan mode:', error);
      toast.error('Failed to toggle plan mode');
    } finally {
      setIsTogglingPlanMode(false);
    }
  }, [sessionId, agent.id, isTogglingPlanMode, updateAgent]);

  const handleRestoreCheckpoint = useCallback(
    async (checkpointId: string, description: string | null) => {
      try {
        const result = await restoreCheckpoint(checkpointId);
        if (result.success) {
          toast.success(`Restored: ${description || 'checkpoint'}`, {
            description: `${result.files.length} file(s) restored`,
          });
        } else {
          toast.error('Failed to restore checkpoint');
        }
      } catch (error) {
        console.error('Failed to restore checkpoint:', error);
        toast.error('Failed to restore checkpoint');
      }
    },
    []
  );

  const handleChangeModel = useCallback(
    async (newModel: string) => {
      updateAgent(sessionId, agent.id, { model: newModel });
      try {
        await updateAgentSettings(sessionId, agent.id, { model: newModel });
      } catch (error) {
        console.error('Failed to persist model change:', error);
      }
    },
    [agent.id, sessionId, updateAgent]
  );

  const handleSaveThinkingConfig = useCallback(
    (config: ThinkingConfig) => {
      updateAgentThinking(sessionId, agent.id, config);
    },
    [sessionId, agent.id, updateAgentThinking]
  );

  // File attachments
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      if (!currentModelInfo?.supportsVision) {
        toast.error(
          `${currentModelInfo?.displayName ?? 'This model'} does not support image input`
        );
        return;
      }

      const newAttachments: AttachmentFile[] = [];

      for (const file of Array.from(files)) {
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`Unsupported file type: ${file.name}. Use PNG, JPG, GIF, or WebP.`);
          continue;
        }

        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > MAX_ATTACHMENT_SIZE_MB) {
          toast.error(
            `File too large: ${file.name} (${sizeMB.toFixed(1)}MB). Max is ${MAX_ATTACHMENT_SIZE_MB}MB.`
          );
          continue;
        }

        const preview = URL.createObjectURL(file);
        newAttachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name,
          type: file.type,
          size: file.size,
          preview,
          status: 'ready',
        });
      }

      setAttachments((prev) => [...prev, ...newAttachments]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [currentModelInfo]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) URL.revokeObjectURL(att.preview);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  useEffect(() => {
    if (!currentModelInfo?.supportsVision && attachments.length > 0) {
      toast.warning('Attachments cleared: selected model does not support images');
      attachments.forEach((att) => {
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModelInfo?.supportsVision, attachments.length]);

  // TTS playback
  const handlePlayMessage = useCallback(
    async (messageId: string, regenerate: boolean = false) => {
      if (playingMessageId === messageId && !regenerate) {
        stopPlayback();
        return;
      }

      setSynthesizingMessageId(messageId);
      try {
        const result = await synthesizeMessage(sessionId, agent.id, messageId, regenerate);
        if (result.audio_b64) {
          playAudioBase64(messageId, result.audio_b64, result.content_type);
        } else if (result.audio_url) {
          playAudioUrl(messageId, result.audio_url);
        }
      } catch (error) {
        console.error('Failed to play message:', error);
      } finally {
        setSynthesizingMessageId(null);
      }
    },
    [sessionId, agent.id, playingMessageId, playAudioUrl, playAudioBase64, stopPlayback]
  );

  // Voice recording
  const handleVoiceRelease = useCallback(async () => {
    await stopRecording();
  }, [stopRecording]);

  // Auto-play refs
  const isPlayingRef = useRef(isPlaying);
  const handlePlayMessageRef = useRef(handlePlayMessage);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    handlePlayMessageRef.current = handlePlayMessage;
  }, [handlePlayMessage]);

  // Auto-play new messages
  useEffect(() => {
    const unsubscribe = onSocketEvent('agent_message', (data: AgentMessageEvent) => {
      if (data.agent_id !== agent.id) return;
      if (data.role !== 'assistant' || !data.auto_play) return;
      if (isPlayingRef.current) return;
      handlePlayMessageRef.current(data.id);
    });
    return unsubscribe;
  }, [agent.id]);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={cn(
        'relative flex flex-col rounded-lg border bg-surface overflow-hidden transition-all outline-none focus:ring-2 focus:ring-accent-primary/50',
        agent.status === 'active' ? borderColor : 'border-border-default',
        agent.status === 'active' && 'shadow-glow',
        expanded && 'h-full',
        hasAttention &&
          highestPriorityAttention?.type === 'needs_approval' &&
          'ring-2 ring-yellow-500/50 animate-attention-pulse',
        hasAttention && highestPriorityAttention?.type === 'error' && 'ring-2 ring-red-500/50',
        hasAttention &&
          highestPriorityAttention?.type === 'completed' &&
          'ring-2 ring-green-500/30',
        hasAttention &&
          highestPriorityAttention?.type === 'waiting_input' &&
          'ring-2 ring-blue-500/30'
      )}
      role="region"
      aria-label={`Agent: ${agent.name}`}
    >
      {/* Header */}
      <AgentCardHeader
        agent={agent}
        sessionId={sessionId}
        currentModelInfo={currentModelInfo}
        getModelDisplayName={getModelDisplayName}
        modelsByTier={modelsByTier}
        isDeleting={isDeleting}
        isDuplicating={isDuplicating}
        isTogglingPlanMode={isTogglingPlanMode}
        restoringCheckpointId={restoringCheckpointId}
        agentWorktree={agentWorktree ?? undefined}
        agentCheckpoints={agentCheckpoints}
        hasAttention={hasAttention}
        hasUnread={hasUnread}
        unreadCount={unreadCount}
        agentAttentionsCount={agentAttentions.length}
        highestPriorityAttention={highestPriorityAttention}
        pendingApprovalCount={pendingApprovalCount}
        onChangeModel={handleChangeModel}
        onTogglePlanMode={handleTogglePlanMode}
        onRestoreCheckpoint={handleRestoreCheckpoint}
        onOpenCompaction={() => setCompactionDialogOpen(true)}
        onOpenModeSettings={() => setModeSettingsOpen(true)}
        onOpenThinkingDialog={() => setThinkingDialogOpen(true)}
        onOpenVoiceSettings={() => setVoiceSettingsOpen(true)}
        onOpenAttentionPanel={openPanel}
        onRename={() => setRenameDialogOpen(true)}
        onDuplicate={handleDuplicate}
        onDelete={() => setDeleteDialogOpen(true)}
        onOpenSlashCommands={isCliAgent ? handleOpenSlashCommands : undefined}
        onReauthenticate={isCliAgent ? handleClaudeCodeReauthenticate : undefined}
      />

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        className={cn(
          'flex-1 overflow-y-auto p-4 space-y-4 min-h-0 selection:bg-accent-primary/30 selection:text-text-primary',
          !expanded && 'max-h-[300px]'
        )}
        role="log"
        aria-label="Messages"
      >
        {/* CLI Agent Login Prompt - shown when auth is needed or unknown and no messages yet */}
        {isCliAgent &&
          agent.messages.length === 0 &&
          (cliAuthStatus === null || cliAuthStatus?.needsAuth) && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-4 max-w-sm">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent-primary/10">
                  <LogIn className="h-6 w-6 text-accent-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-text-primary mb-1">
                    Authentication Required
                  </h3>
                  <p className="text-xs text-text-muted">
                    {agent.role === 'claude-code'
                      ? 'Sign in with your Anthropic account to use Claude Code.'
                      : agent.role === 'openai-codex'
                        ? 'Sign in with your OpenAI account to use Codex.'
                        : 'Sign in to use this CLI agent.'}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleCliLogin}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-text-inverse text-sm font-medium hover:bg-accent-primary/90 transition-colors"
                  >
                    <LogIn className="h-4 w-4" />
                    Sign In
                  </button>
                  <button
                    onClick={handleRefreshAuth}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-tertiary text-text-primary text-sm font-medium hover:bg-bg-secondary transition-colors border border-border-default"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </div>
                <p className="text-xs text-text-muted mt-3">
                  After signing in via Terminal, click Refresh to continue.
                </p>
              </div>
            </div>
          )}

        {/* Regular message list - hidden when showing login prompt */}
        {!(
          isCliAgent &&
          agent.messages.length === 0 &&
          (cliAuthStatus === null || cliAuthStatus?.needsAuth)
        ) && (
          <AgentMessageList
            messages={agent.messages}
            sessionId={sessionId}
            agentId={agent.id}
            playingMessageId={playingMessageId}
            synthesizingMessageId={synthesizingMessageId}
            deletingMessageId={deletingMessageId}
            onDeleteMessage={handleDeleteMessage}
            onPlayMessage={handlePlayMessage}
            onPlanApprove={async (planId) => {
              await approvePlan(sessionId, planId);
            }}
            onPlanReject={async (planId) => {
              await rejectPlan(sessionId, planId, 'User rejected');
            }}
          />
        )}

        {/* Streaming message */}
        <AgentStreamingMessage
          streamingMessage={streamingMessage}
          isActive={agent.status === 'active' || isSending}
          showAbortedMessage={showAbortedMessage}
        />

        {/* Plan approval actions */}
        {agent.mode === 'plan' &&
          agent.status === 'idle' &&
          agent.messages.length > 0 &&
          agent.messages[agent.messages.length - 1]?.role === 'assistant' && (
            <PlanApprovalActions
              sessionId={sessionId}
              agentId={agent.id}
              agentName={agent.name}
              onApprove={(newMode) => updateAgent(sessionId, agent.id, { mode: newMode })}
              onRefine={(feedback) => {
                setMessage(feedback);
                setTimeout(() => {
                  const userMessage = {
                    id: `temp-${Date.now()}`,
                    role: 'user' as const,
                    content: feedback,
                    timestamp: new Date(),
                  };
                  addAgentMessage(sessionId, agent.id, userMessage);
                  updateAgent(sessionId, agent.id, { status: 'active' });
                  sendAgentMessage(sessionId, agent.id, feedback, {
                    thinkingConfig: agent.thinkingConfig,
                  }).catch((error) => {
                    console.error('Failed to send refinement:', error);
                    updateAgent(sessionId, agent.id, { status: 'error' });
                    toast.error('Failed to send refinement. Please try again.');
                  });
                  setMessage('');
                }, 0);
              }}
              onReject={() => updateAgent(sessionId, agent.id, { mode: 'ask' })}
            />
          )}

        <div ref={messagesEndRef} />
      </div>

      {/* Credit error banner */}
      {showCreditError && (
        <div className="px-3 pb-2">
          <CreditExhaustedBanner
            type="credits"
            size="sm"
            onDismiss={() => setShowCreditError(false)}
          />
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-border-subtle p-3" data-tour="agent-input">
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att) => (
              <div key={att.id} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.preview}
                  alt={att.name}
                  className="h-16 w-16 object-cover rounded border border-border-subtle"
                />
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove attachment"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Real-time transcription preview */}
        {isRecording && currentTranscript && (
          <div className="mb-2 rounded-md bg-elevated px-3 py-2 text-sm text-text-secondary">
            <span
              className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-error"
              aria-hidden="true"
            />
            {currentTranscript}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!currentModelInfo?.supportsVision}
            className={cn(
              'rounded-md p-2 transition-colors',
              currentModelInfo?.supportsVision
                ? 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-secondary'
                : 'bg-elevated text-text-muted/50 cursor-not-allowed'
            )}
            title={
              currentModelInfo?.supportsVision
                ? 'Attach image (PNG, JPG, GIF, WebP)'
                : `${currentModelInfo?.displayName ?? 'This model'} does not support images`
            }
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Mic button */}
          <button
            onMouseDown={startRecording}
            onMouseUp={handleVoiceRelease}
            onMouseLeave={handleVoiceRelease}
            onTouchStart={(e) => {
              e.preventDefault();
              startRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              handleVoiceRelease();
            }}
            className={cn(
              'rounded-md p-2 transition-colors touch-none',
              isRecording
                ? 'bg-accent-error text-text-inverse animate-pulse'
                : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-secondary'
            )}
            title="Hold to speak"
          >
            <Mic className="h-4 w-4" />
          </button>

          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isRecording
                  ? 'Listening...'
                  : `Type / for commands or ask ${agent.name.toLowerCase()}...`
              }
              className="w-full bg-elevated border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none selection:bg-accent-primary selection:text-white"
              disabled={isRecording || cliNeedsAuth}
              autoComplete="off"
              data-1p-ignore
            />
            {showSlashMenu && (
              <SlashCommandMenu
                query={slashQuery}
                sessionId={sessionId}
                onSelect={handleSlashCommandSelect}
                onClose={() => setShowSlashMenu(false)}
              />
            )}
            {/* Claude Code CLI Permission Approval - inline above input */}
            {agent.pendingPermission && (
              <ApprovalDialog
                approval={{
                  id: agent.pendingPermission.requestId,
                  agent_id: agent.id,
                  session_id: sessionId,
                  action_type: 'command_execute',
                  action_details: {
                    command: agent.pendingPermission.command ?? undefined,
                    tool_name: agent.pendingPermission.toolName,
                  },
                  status: 'pending',
                  expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
                  created_at: agent.pendingPermission.timestamp,
                }}
                agentMode={agent.mode}
                onClose={() => handlePermissionApproval(false, false)}
                onApprovalComplete={handlePermissionApproval}
              />
            )}
          </div>

          <button
            onClick={() => handleSendMessage()}
            disabled={
              (!message.trim() && attachments.length === 0) ||
              isSending ||
              isRecording ||
              cliNeedsAuth ||
              (attachments.length > 0 && !currentModelInfo?.supportsVision)
            }
            className={cn(
              'rounded-md p-2 transition-colors',
              (message.trim() || attachments.length > 0) && !isSending && !isRecording
                ? 'bg-accent-primary text-text-inverse hover:bg-opacity-90 cursor-pointer'
                : 'bg-elevated text-text-muted cursor-not-allowed'
            )}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Dialogs */}
      {voiceSettingsOpen && (
        <VoiceSettingsDialog
          onOpenChange={setVoiceSettingsOpen}
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}
      {modeSettingsOpen && (
        <AgentModeSelector
          onOpenChange={setModeSettingsOpen}
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
          currentMode={agent.mode || 'ask'}
          currentAllowlist={agent.commandAllowlist}
          onModeUpdate={(mode, allowlist) =>
            updateAgent(sessionId, agent.id, { mode, commandAllowlist: allowlist })
          }
        />
      )}
      {compactionDialogOpen && (
        <CompactionDialog
          agentId={agent.id}
          agentName={agent.name}
          sessionId={sessionId}
          onClose={() => setCompactionDialogOpen(false)}
          onCompact={async (options) => {
            // For CLI agents, send /compact as a message instead of using Podex API
            if (isCliAgentRole(agent.role)) {
              const compactMessage = options?.customInstructions
                ? `/compact ${options.customInstructions}`
                : '/compact';
              // Add user message to UI
              const userMessage = {
                id: `temp-${Date.now()}`,
                role: 'user' as const,
                content: compactMessage,
                timestamp: new Date(),
              };
              addAgentMessage(sessionId, agent.id, userMessage);
              updateAgent(sessionId, agent.id, { status: 'active' });
              // Send to CLI agent
              await sendAgentMessage(sessionId, agent.id, compactMessage, {
                thinkingConfig: agent.thinkingConfig,
              });
            } else {
              // For Podex native agents, use the context API
              await compactAgentContext(agent.id, options);
            }
          }}
        />
      )}

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      <PromptDialog
        isOpen={renameDialogOpen}
        title="Rename Agent"
        message="Enter a new name for this agent:"
        defaultValue={agent.name}
        placeholder="Agent name"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameDialogOpen(false)}
      />

      <ThinkingConfigDialog
        open={thinkingDialogOpen}
        onOpenChange={setThinkingDialogOpen}
        config={agent.thinkingConfig}
        onSave={handleSaveThinkingConfig}
        modelName={currentModelInfo?.displayName ?? 'Model'}
        agentRole={agent.role}
      />

      {/* CLI Agent Slash Commands - single responsive component */}
      {isCliAgent && cliAgentType && (
        <SlashCommandDialog
          isOpen={slashCommandSheetOpen}
          onClose={() => setSlashCommandSheetOpen(false)}
          onSelect={handleCliSlashCommand}
          agentType={cliAgentType}
        />
      )}
    </div>
  );
}
