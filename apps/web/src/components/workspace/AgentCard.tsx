'use client';

import { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Mic, Paperclip, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { type Agent, type AgentMode, type AgentRole, useSessionStore } from '@/stores/session';
import { useEditorStore } from '@/stores/editor';
import { getLanguageFromPath } from '@/lib/vscode/languageUtils';
import { useStreamingStore } from '@/stores/streaming';
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
  getLocalLLMConfig,
  executeCommand,
  attachConversation,
  createConversation,
  detachConversation,
  type PublicModel,
  type UserProviderModel,
  type CustomCommand,
} from '@/lib/api';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { onSocketEvent, type AgentMessageEvent } from '@/lib/socket';
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
import { BrowserContextDialog } from './BrowserContextDialog';
import {
  useBrowserContextStore,
  useIsCaptureEnabled,
  useIsAutoInclude,
  useHasPendingContext,
} from '@/stores/browserContext';

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
  // Track last sent message to prevent duplicate submissions (e.g., from double-clicks or React strict mode)
  const lastSentMessageRef = useRef<{ content: string; timestamp: number } | null>(null);
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
  const [browserContextDialogOpen, setBrowserContextDialogOpen] = useState(false);

  // Browser context state for forwarding preview data to agent
  const browserCaptureEnabled = useIsCaptureEnabled(agent.id);
  const browserAutoInclude = useIsAutoInclude(agent.id);
  const hasPendingBrowserContext = useHasPendingContext(agent.id);
  const {
    toggleCapture: toggleBrowserCapture,
    captureContext: captureBrowserContext,
    getPendingContext: getPendingBrowserContext,
    clearPendingContext: clearPendingBrowserContext,
  } = useBrowserContextStore();

  // Attachments
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);

  // Models
  const [backendModels, setBackendModels] = useState<PublicModel[]>([]);
  const [userProviderModels, setUserProviderModels] = useState<UserProviderModel[]>([]);
  const [localLLMConfig, setLocalLLMConfig] = useState<
    Record<string, { base_url: string; models: { id: string; name: string }[] }>
  >({});

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
  const isUserAtBottomRef = useRef(true);

  // Store actions
  const {
    removeAgent,
    updateAgent,
    addAgent,
    updateAgentThinking,
    setActiveAgent,
    // Conversation session actions
    attachConversationToAgent,
    detachConversationFromAgent,
    addConversationMessage,
    deleteConversationMessage,
    getConversationForAgent,
    handleConversationEvent,
  } = useSessionStore();
  // Use specific selectors to avoid re-renders when unrelated state changes
  // Only subscribe to streaming messages for THIS agent
  const streamingMessage = useStreamingStore(
    useCallback(
      (state) => {
        const messages = Object.values(state.streamingMessages);
        return messages.find(
          (sm) => sm.sessionId === sessionId && sm.agentId === agent.id && sm.isStreaming
        );
      },
      [sessionId, agent.id]
    )
  );

  // Use specific selectors for worktree and checkpoint data
  const agentWorktree = useWorktreesStore(
    useCallback(
      (state) => state.sessionWorktrees[sessionId]?.find((w) => w.agentId === agent.id),
      [sessionId, agent.id]
    )
  );
  // Select raw checkpoints array (stable reference), then filter with useMemo
  // This avoids the infinite loop caused by .filter() creating new arrays in the selector
  const sessionCheckpoints = useCheckpointsStore(
    useCallback((state) => state.sessionCheckpoints[sessionId], [sessionId])
  );
  const agentCheckpoints = useMemo(
    () => sessionCheckpoints?.filter((c) => c.agentId === agent.id) ?? [],
    [sessionCheckpoints, agent.id]
  );
  const restoringCheckpointId = useCheckpointsStore((state) => state.restoringCheckpointId);

  // Get the conversation session attached to this agent
  const conversationSession = getConversationForAgent(sessionId, agent.id);
  const messages = conversationSession?.messages ?? [];

  // User message history (from conversation session)
  const userMessages = messages
    .filter((msg) => msg.role === 'user')
    .map((msg) => msg.content)
    .reverse();

  // Handle scroll to detect if user has scrolled up
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Check if user is at or near the bottom (within 50px threshold)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    isUserAtBottomRef.current = isAtBottom;
  }, []);

  // Auto-scroll only when user is at bottom
  // Use useLayoutEffect to scroll synchronously after DOM updates (before browser paint)
  // This ensures scrollHeight reflects the new content
  const lastMessageId = messages[messages.length - 1]?.id;
  useLayoutEffect(() => {
    if (messagesContainerRef.current && isUserAtBottomRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages.length, lastMessageId, isSending, streamingMessage?.content]);

  // Fetch models (platform, user API keys, and saved local Ollama/LM Studio config)
  useEffect(() => {
    getAvailableModels()
      .then(setBackendModels)
      .catch((err) => console.error('Failed to fetch platform models:', err));
    getUserProviderModels()
      .then(setUserProviderModels)
      .catch((err) => console.error('Failed to fetch user-provider models:', err));
    getLocalLLMConfig()
      .then(setLocalLLMConfig)
      .catch((err) => console.error('Failed to fetch local LLM config:', err));
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
    // Look up model in user/backend models
    const userModel = userProviderModels.find((m) => m.model_id === agent.model);
    if (userModel) return userModelToInfo(userModel);
    const backendModel = backendModels.find((m) => m.model_id === agent.model);
    if (backendModel) return backendModelToInfo(backendModel);
    // Local model only: "ollama/name" or "lmstudio/name"
    if (agent.model.includes('/')) {
      const parts = agent.model.split('/', 2);
      const provider = parts[0];
      const name = parts[1];
      if (!provider || name === undefined) return undefined;
      // Only handle known local LLM providers
      if (provider !== 'ollama' && provider !== 'lmstudio') return undefined;
      const cfg = localLLMConfig[provider as keyof typeof localLLMConfig];
      const m = cfg?.models?.find((x: { id?: string; name: string }) => (x.id || x.name) === name);
      if (m) {
        const providerLabels: Record<string, string> = { ollama: 'Ollama', lmstudio: 'LM Studio' };
        return {
          id: agent.model,
          provider: provider as LLMProvider,
          displayName: `${m.name} (${providerLabels[provider]})`,
          shortName: m.name,
          tier: 'fast',
          contextWindow: 4096,
          maxOutputTokens: 2048,
          supportsVision: false,
          supportsThinking: false,
          thinkingStatus: 'not_supported',
          capabilities: ['chat', 'code'],
          goodFor: [],
          description: `Local model via ${providerLabels[provider]}`,
          reasoningEffort: 'low',
          isUserKey: false,
        } as ExtendedModelInfo;
      }
    }
    return undefined;
  }, [
    agent.model,
    backendModels,
    userProviderModels,
    localLLMConfig,
    backendModelToInfo,
    userModelToInfo,
  ]);

  const getModelDisplayName = useCallback(
    (modelId: string) => {
      // Use cached display name from backend if available
      if (agent.modelDisplayName) {
        return agent.modelDisplayName;
      }
      // Look up display_name from database models
      const userModel = userProviderModels.find((m) => m.model_id === modelId);
      if (userModel) return userModel.display_name;
      const backendModel = backendModels.find((m) => m.model_id === modelId);
      if (backendModel) return backendModel.display_name;
      // For local models, use currentModelInfo's displayName if available
      if (currentModelInfo?.displayName) {
        return currentModelInfo.displayName;
      }
      // Fallback to raw model ID
      return modelId;
    },
    [agent.modelDisplayName, backendModels, userProviderModels, currentModelInfo]
  );

  // Message handlers
  const handleSendMessage = useCallback(
    async (overrideMessage?: string) => {
      const effectiveMessage = overrideMessage ?? message;
      if ((!effectiveMessage.trim() && attachments.length === 0) || isSending) return;

      const messageContent = effectiveMessage.trim();

      // Prevent duplicate submissions: check if same message was sent recently (within 2 seconds)
      const now = Date.now();
      if (
        lastSentMessageRef.current &&
        lastSentMessageRef.current.content === messageContent &&
        now - lastSentMessageRef.current.timestamp < 2000
      ) {
        console.warn('Duplicate message submission prevented', { content: messageContent });
        return;
      }

      // Track this message as sent
      lastSentMessageRef.current = { content: messageContent, timestamp: now };

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

      // Add message to conversation session (creates one if needed)
      let conversationId = conversationSession?.id;
      if (!conversationId) {
        // Create conversation on backend first (backend generates the UUID)
        // NOTE: Don't pass first_message here - sendMessage will create the user message
        // to avoid duplicate message creation
        try {
          const newConversation = await createConversation(sessionId, {});
          conversationId = newConversation.id;

          // Update local state immediately (don't wait for WebSocket)
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

          // Attach conversation to agent
          await attachConversation(sessionId, conversationId, agent.id);

          // Update local state for attach
          attachConversationToAgent(sessionId, conversationId, agent.id);
        } catch (error) {
          console.error('Failed to create conversation:', error);
          toast.error('Failed to start conversation');
          setIsSending(false);
          return;
        }
      }
      addConversationMessage(sessionId, conversationId, userMessage);
      updateAgent(sessionId, agent.id, { status: 'active' });

      try {
        // Build browser context if auto-include is enabled or there's pending context
        let browserContext = undefined;
        if (browserAutoInclude || hasPendingBrowserContext) {
          browserContext = hasPendingBrowserContext
            ? getPendingBrowserContext(agent.id)
            : captureBrowserContext(agent.id);
          // Clear pending context after capturing
          if (hasPendingBrowserContext) {
            clearPendingBrowserContext(agent.id);
          }
        }

        await sendAgentMessage(sessionId, agent.id, messageContent, {
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          thinkingConfig: agent.thinkingConfig,
          browserContext: browserContext || undefined,
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
      conversationSession,
      attachConversationToAgent,
      addConversationMessage,
      updateAgent,
      router,
      browserAutoInclude,
      hasPendingBrowserContext,
      getPendingBrowserContext,
      captureBrowserContext,
      clearPendingBrowserContext,
      handleConversationEvent,
    ]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMessage(value);

    if (value.startsWith('/')) {
      // Show the standard slash menu
      setSlashQuery(value.slice(1));
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
      setSlashQuery('');
    }
  }, []);

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
              if (conversationSession && messages.length > 0) {
                // Detach the conversation from this agent (returns it to the pool)
                detachConversationFromAgent(sessionId, conversationSession.id);
                toast.success('Conversation detached');
              } else {
                toast.info('No conversation attached');
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
      messages.length,
      conversationSession,
      agentCheckpoints.length,
      handleSendMessage,
      detachConversationFromAgent,
      sessionId,
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
        mode: (newAgentData.mode || 'ask') as AgentMode,
        gridSpan: agent.gridSpan ?? { colSpan: 1, rowSpan: 2 },
        conversationSessionId: null, // New agent starts without a conversation
      });
      toast.success(`Agent duplicated as "${newAgentData.name}"`);
    } catch (error) {
      console.error('Failed to duplicate agent:', error);
      toast.error('Failed to duplicate agent. Please try again.');
    } finally {
      setIsDuplicating(false);
    }
  }, [sessionId, agent.id, agent.color, agent.gridSpan, isDuplicating, addAgent]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (deletingMessageId || !conversationSession) return;
      setDeletingMessageId(messageId);
      try {
        await deleteAgentMessageApi(sessionId, agent.id, messageId);
        deleteConversationMessage(sessionId, conversationSession.id, messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
      } finally {
        setDeletingMessageId(null);
      }
    },
    [sessionId, agent.id, conversationSession, deletingMessageId, deleteConversationMessage]
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
      // Clear modelDisplayName when model changes so we look up the new display name
      updateAgent(sessionId, agent.id, { model: newModel, modelDisplayName: undefined });
      try {
        await updateAgentSettings(sessionId, agent.id, { model: newModel });
      } catch (error) {
        console.error('Failed to persist model change:', error);
      }
    },
    [agent.id, sessionId, updateAgent]
  );

  // Role change handler
  const handleChangeRole = useCallback(
    (newRole: AgentRole) => {
      updateAgent(sessionId, agent.id, { role: newRole });
      // TODO: Persist role change to backend when API supports it
    },
    [agent.id, sessionId, updateAgent]
  );

  // Conversation session handlers
  const handleAttachSession = useCallback(
    async (conversationId: string) => {
      try {
        // Optimistically update local state
        attachConversationToAgent(sessionId, conversationId, agent.id);

        // Call API to attach (backend will handle detaching old conversation)
        await attachConversation(sessionId, conversationId, agent.id);
      } catch (error) {
        console.error('Failed to attach conversation:', error);
        toast.error('Failed to attach session');
        // Revert optimistic update - WebSocket event will sync state if API call fails
        // But we should manually detach to fix the UI immediately
        detachConversationFromAgent(sessionId, conversationId);
      }
    },
    [sessionId, agent.id, attachConversationToAgent, detachConversationFromAgent]
  );

  const handleDetachSession = useCallback(async () => {
    if (conversationSession) {
      try {
        // Optimistically update local state
        detachConversationFromAgent(sessionId, conversationSession.id);

        // Call API to detach from this specific agent
        await detachConversation(sessionId, conversationSession.id, agent.id);
      } catch (error) {
        console.error('Failed to detach conversation:', error);
        toast.error('Failed to detach session');
        // WebSocket event will sync state if API call fails
      }
    }
  }, [sessionId, conversationSession, agent.id, detachConversationFromAgent]);

  const handleCreateNewSession = useCallback(async () => {
    try {
      // Create conversation on backend first (backend generates the UUID)
      const newConversation = await createConversation(sessionId, { name: 'New Session' });

      // Update local state immediately (don't wait for WebSocket)
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
    } catch (error) {
      console.error('Failed to create new conversation:', error);
      toast.error('Failed to create new session');
    }
  }, [sessionId, agent.id, handleConversationEvent, attachConversationToAgent]);

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

  // File link click handler - opens file in the Editor tab
  const handleFileClick = useCallback(
    async (path: string, _startLine?: number, _endLine?: number) => {
      const { createEditorGridCard } = useSessionStore.getState();
      const { openTab } = useEditorStore.getState();
      const session = useSessionStore.getState().sessions[sessionId];

      // Ensure the Editor tab is visible
      if (!session?.editorGridCardId) {
        createEditorGridCard(sessionId);
      }

      // Open the file in the Editor
      const language = getLanguageFromPath(path);
      openTab({
        path,
        name: path.split('/').pop() || path,
        language,
        isDirty: false,
        isPreview: true, // Single click opens as preview, editing pins it
        paneId: 'main',
      });

      // Switch to the Editor tab in Focus mode
      setActiveAgent(sessionId, 'editor');

      // TODO: If startLine/endLine are provided, scroll to those lines after the editor opens
    },
    [sessionId, setActiveAgent]
  );

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
        conversationSession={conversationSession}
        currentModelInfo={currentModelInfo}
        getModelDisplayName={getModelDisplayName}
        publicModels={backendModels}
        userKeyModels={userProviderModels}
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
        onChangeRole={handleChangeRole}
        onAttachSession={handleAttachSession}
        onDetachSession={handleDetachSession}
        onCreateNewSession={handleCreateNewSession}
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
        browserCaptureEnabled={browserCaptureEnabled}
        browserAutoInclude={browserAutoInclude}
        hasPendingBrowserContext={hasPendingBrowserContext}
        onToggleBrowserCapture={() => toggleBrowserCapture(agent.id)}
        onOpenBrowserContextDialog={() => setBrowserContextDialogOpen(true)}
      />

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className={cn(
          'flex-1 overflow-y-auto p-4 space-y-4 min-h-0 selection:bg-accent-primary/30 selection:text-text-primary',
          !expanded && 'max-h-[300px]'
        )}
        role="log"
        aria-label="Messages"
      >
        <AgentMessageList
          messages={messages}
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
          onFileClick={handleFileClick}
        />

        {/* Streaming message */}
        <AgentStreamingMessage
          streamingMessage={streamingMessage}
          isActive={agent.status === 'active' || isSending}
          showAbortedMessage={showAbortedMessage}
        />

        {/* Plan approval actions */}
        {agent.mode === 'plan' &&
          agent.status === 'idle' &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === 'assistant' && (
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
                  // Add message to conversation session
                  if (conversationSession) {
                    addConversationMessage(sessionId, conversationSession.id, userMessage);
                  }
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
              disabled={isRecording}
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
          </div>

          <button
            onClick={() => handleSendMessage()}
            disabled={
              (!message.trim() && attachments.length === 0) ||
              isSending ||
              isRecording ||
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
            await compactAgentContext(agent.id, options);
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
      />

      {/* Browser Context Dialog - preview and configure browser context for agents */}
      <BrowserContextDialog
        agentId={agent.id}
        isOpen={browserContextDialogOpen}
        onClose={() => setBrowserContextDialogOpen(false)}
      />
    </div>
  );
}
