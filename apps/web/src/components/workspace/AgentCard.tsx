'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileText,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  Mic,
  MoreVertical,
  Pencil,
  RefreshCw,
  Send,
  Server,
  Settings2,
  Shield,
  ShieldOff,
  StopCircle,
  TestTube2,
  Trash2,
  Volume2,
  VolumeX,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@podex/ui';
import { type Agent, type AgentMode, useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import { useApprovalsStore } from '@/stores/approvals';
import { useWorktreesStore } from '@/stores/worktrees';
import { cn, formatTimestamp, cleanStreamingContent, getFriendlyErrorMessage } from '@/lib/utils';
import {
  sendAgentMessage,
  deleteAgent as deleteAgentApi,
  duplicateAgent as duplicateAgentApi,
  deleteAgentMessage as deleteAgentMessageApi,
  synthesizeMessage,
  abortAgent,
  approvePlan,
  rejectPlan,
} from '@/lib/api';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { onSocketEvent, type AgentMessageEvent } from '@/lib/socket';
import { VoiceSettingsDialog } from './VoiceSettingsDialog';
import { AgentModeSelector } from './AgentModeSelector';
import { PlanApprovalActions } from './PlanApprovalActions';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ContextUsageRing } from './ContextUsageRing';
import { CompactionDialog } from './CompactionDialog';
import { ToolResultDisplay } from './ToolResultDisplay';
import { WorktreeStatus } from './WorktreeStatus';
import { compactAgentContext } from '@/lib/api';

export interface AgentCardProps {
  agent: Agent;
  sessionId: string;
  expanded?: boolean;
}

const roleIcons = {
  architect: Workflow,
  coder: Code2,
  reviewer: Bot,
  tester: TestTube2,
  agent_builder: Settings2,
  orchestrator: Workflow,
  chat: MessageCircle,
  security: Shield,
  devops: Server,
  documentator: FileText,
  custom: Bot,
};

const agentColors: Record<string, string> = {
  'agent-1': 'border-agent-1',
  'agent-2': 'border-agent-2',
  'agent-3': 'border-agent-3',
  'agent-4': 'border-agent-4',
  'agent-5': 'border-agent-5',
  'agent-6': 'border-agent-6',
};

const agentTextColors: Record<string, string> = {
  'agent-1': 'text-agent-1',
  'agent-2': 'text-agent-2',
  'agent-3': 'text-agent-3',
  'agent-4': 'text-agent-4',
  'agent-5': 'text-agent-5',
  'agent-6': 'text-agent-6',
};

export function AgentCard({ agent, sessionId, expanded = false }: AgentCardProps) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [showAbortedMessage, setShowAbortedMessage] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [synthesizingMessageId, setSynthesizingMessageId] = useState<string | null>(null);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [modeSettingsOpen, setModeSettingsOpen] = useState(false);
  const [compactionDialogOpen, setCompactionDialogOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    removeAgent,
    updateAgent,
    addAgent,
    addAgentMessage,
    deleteAgentMessage,
    streamingMessages,
  } = useSessionStore();
  const { getAgentWorktree } = useWorktreesStore();

  // Get worktree for this agent (if it exists)
  const agentWorktree = getAgentWorktree(sessionId, agent.id);

  // Find active streaming message for this agent
  const streamingMessage = Object.values(streamingMessages).find(
    (sm) => sm.sessionId === sessionId && sm.agentId === agent.id && sm.isStreaming
  );

  // Get user messages for history navigation
  const userMessages = agent.messages
    .filter((msg) => msg.role === 'user')
    .map((msg) => msg.content)
    .reverse();

  // Auto-scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [agent.messages.length, isSending, streamingMessage?.content]);

  // Handle Escape key to abort running tasks
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

  // Listen for Escape key when card is focused
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

  // Clear aborted message after a short delay
  useEffect(() => {
    if (!showAbortedMessage) return;
    const timer = setTimeout(() => {
      setShowAbortedMessage(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showAbortedMessage]);

  // Attention state for this agent
  const { getAttentionsForAgent, getHighestPriorityAttention, openPanel } = useAttentionStore();
  const agentAttentions = getAttentionsForAgent(sessionId, agent.id);
  const highestPriorityAttention = getHighestPriorityAttention(sessionId, agent.id);
  const hasAttention = agentAttentions.length > 0;

  // Approvals state
  const { getAgentApprovals } = useApprovalsStore();
  const agentApprovals = getAgentApprovals(sessionId, agent.id);
  const pendingApprovalCount = agentApprovals.filter((a) => a.status === 'pending').length;

  // Mode display helpers
  const modeConfig: Record<AgentMode, { icon: typeof Eye; label: string; color: string }> = {
    plan: { icon: Eye, label: 'Plan', color: 'text-blue-400' },
    ask: { icon: HelpCircle, label: 'Ask', color: 'text-yellow-400' },
    auto: { icon: Zap, label: 'Auto', color: 'text-green-400' },
    sovereign: { icon: ShieldOff, label: 'Sovereign', color: 'text-red-400' },
  };
  const currentModeConfig = modeConfig[agent.mode || 'ask'];

  // Voice capture hook
  const { isRecording, currentTranscript, startRecording, stopRecording } = useVoiceCapture({
    sessionId,
    agentId: agent.id,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        setMessage(text.trim());
      }
    },
    onError: (error) => {
      console.error('Voice capture error:', error);
    },
  });

  // Audio playback hook
  const { isPlaying, playingMessageId, playAudioUrl, playAudioBase64, stopPlayback } =
    useAudioPlayback({
      sessionId,
      onPlayEnd: () => {
        // Could queue next message for auto-play if enabled
      },
    });

  const Icon = roleIcons[agent.role];
  const borderColor = agentColors[agent.color] ?? 'border-border-default';
  const textColor = agentTextColors[agent.color] ?? 'text-text-primary';

  const handleSendMessage = useCallback(async () => {
    if (!message.trim() || isSending) return;

    const messageContent = message.trim();
    setIsSending(true);
    setMessage('');

    // Optimistically add user message to UI immediately
    const userMessage = {
      id: `temp-${Date.now()}`,
      role: 'user' as const,
      content: messageContent,
      timestamp: new Date(),
    };
    addAgentMessage(sessionId, agent.id, userMessage);

    // Update agent status to show it's processing
    updateAgent(sessionId, agent.id, { status: 'active' });

    try {
      await sendAgentMessage(sessionId, agent.id, messageContent);
      // Response will come via WebSocket
    } catch (error) {
      console.error('Failed to send message:', error);
      // Could remove the optimistic message or show error state
      updateAgent(sessionId, agent.id, { status: 'error' });
    } finally {
      setIsSending(false);
    }
  }, [message, isSending, sessionId, agent.id, addAgentMessage, updateAgent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
      // Reset history navigation after sending
      setHistoryIndex(-1);
      setSavedInput('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (userMessages.length === 0) return;

      if (historyIndex === -1) {
        // Save current input before navigating history
        setSavedInput(message);
      }

      const newIndex = Math.min(historyIndex + 1, userMessages.length - 1);
      setHistoryIndex(newIndex);
      setMessage(userMessages[newIndex] ?? '');

      // Move cursor to end of input
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

      if (newIndex === -1) {
        // Restore saved input when going back to current
        setMessage(savedInput);
      } else {
        setMessage(userMessages[newIndex] ?? '');
      }

      // Move cursor to end of input
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = inputRef.current.value.length;
          inputRef.current.selectionEnd = inputRef.current.value.length;
        }
      }, 0);
    }
  };

  const handleRename = useCallback(() => {
    const newName = prompt('Enter new name for agent:', agent.name);
    if (newName && newName.trim() && newName !== agent.name) {
      updateAgent(sessionId, agent.id, { name: newName.trim() });
    }
  }, [agent.name, agent.id, sessionId, updateAgent]);

  const handleDuplicate = useCallback(async () => {
    if (isDuplicating) return;

    setIsDuplicating(true);
    try {
      const newAgentData = await duplicateAgentApi(sessionId, agent.id);
      // Transform API response to store format and add to store
      addAgent(sessionId, {
        id: newAgentData.id,
        name: newAgentData.name,
        role: newAgentData.role as Agent['role'],
        model: newAgentData.model,
        status: 'idle',
        color: agent.color, // Copy color from original
        messages: [],
        mode: (newAgentData.mode || 'ask') as AgentMode,
      });
    } catch (error) {
      console.error('Failed to duplicate agent:', error);
      alert('Failed to duplicate agent. Please try again.');
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

  const toggleThinking = useCallback((messageId: string) => {
    setExpandedThinking((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Are you sure you want to delete "${agent.name}"?`)) return;

    setIsDeleting(true);
    try {
      await deleteAgentApi(sessionId, agent.id);
      removeAgent(sessionId, agent.id);
    } catch (error) {
      console.error('Failed to delete agent:', error);
      alert('Failed to delete agent. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }, [sessionId, agent.id, agent.name, removeAgent]);

  const availableModels = [
    { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ];

  const handleChangeModel = useCallback(
    (newModel: string) => {
      updateAgent(sessionId, agent.id, { model: newModel });
    },
    [agent.id, sessionId, updateAgent]
  );

  const getModelDisplayName = (modelId: string) => {
    const model = availableModels.find((m) => m.id === modelId);
    return model?.name ?? modelId;
  };

  // Handle TTS playback for a message
  const handlePlayMessage = useCallback(
    async (messageId: string, regenerate: boolean = false) => {
      // If already playing this message, stop it
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
        // Provide user-friendly error context
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const friendlyMessage = getFriendlyErrorMessage('Play Audio', errorMessage);
        console.error(`[Play Audio] ${friendlyMessage}:`, error);
      } finally {
        setSynthesizingMessageId(null);
      }
    },
    [sessionId, agent.id, playingMessageId, playAudioUrl, playAudioBase64, stopPlayback]
  );

  // Handle voice recording release - send the transcribed message
  const handleVoiceRelease = useCallback(async () => {
    await stopRecording();
    // The message will be set via onTranscript callback
    // We could auto-send here if desired
  }, [stopRecording]);

  // Auto-send when final transcript is received (optional - could be enabled via settings)
  useEffect(() => {
    if (currentTranscript && !isRecording && message.trim()) {
      // Optionally auto-send after voice recording stops
      // handleSendMessage();
    }
  }, [currentTranscript, isRecording, message]);

  // Use refs to avoid recreating socket subscriptions on every state change
  const isPlayingRef = useRef(isPlaying);
  const handlePlayMessageRef = useRef(handlePlayMessage);

  // Keep refs up to date
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    handlePlayMessageRef.current = handlePlayMessage;
  }, [handlePlayMessage]);

  // Auto-play new assistant messages when auto_play is enabled
  // Uses refs to avoid subscription churn when isPlaying/handlePlayMessage changes
  useEffect(() => {
    const unsubscribe = onSocketEvent('agent_message', (data: AgentMessageEvent) => {
      // Only handle messages for this agent
      if (data.agent_id !== agent.id) return;

      // Only auto-play assistant messages with auto_play flag
      if (data.role !== 'assistant' || !data.auto_play) return;

      // Don't auto-play if already playing something
      if (isPlayingRef.current) return;

      // Trigger playback for this new message
      handlePlayMessageRef.current(data.id);
    });

    return unsubscribe;
  }, [agent.id]);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={cn(
        'flex flex-col rounded-lg border bg-surface overflow-hidden transition-all outline-none focus:ring-2 focus:ring-accent-primary/50',
        agent.status === 'active' ? borderColor : 'border-border-default',
        agent.status === 'active' && 'shadow-glow',
        expanded && 'h-full',
        // Attention indicators
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
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn('rounded-md bg-elevated p-2', textColor)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">{agent.name}</span>
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  agent.status === 'active' && 'bg-accent-success animate-pulse',
                  agent.status === 'idle' && 'bg-text-muted',
                  agent.status === 'error' && 'bg-accent-error'
                )}
              />
              {/* Context usage ring */}
              <ContextUsageRing
                agentId={agent.id}
                size="sm"
                onClick={() => setCompactionDialogOpen(true)}
              />
              {/* Mode badge */}
              <button
                onClick={() => setModeSettingsOpen(true)}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-elevated hover:bg-overlay transition-colors',
                  currentModeConfig.color
                )}
                title={`Mode: ${currentModeConfig.label}`}
              >
                <currentModeConfig.icon className="h-3 w-3" />
                {currentModeConfig.label}
              </button>
              {/* Auto-switched badge - shows when mode was auto-switched and will revert */}
              {agent.previousMode && (
                <span
                  className="flex items-center gap-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400"
                  title={`Auto-switched from ${agent.previousMode} mode - will revert after task`}
                >
                  <RefreshCw className="h-3 w-3" />
                  Auto
                </span>
              )}
              {/* Pending approval badge */}
              {pendingApprovalCount > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400 animate-pulse">
                  <Shield className="h-3 w-3" />
                  {pendingApprovalCount}
                </span>
              )}
              {/* Attention badge */}
              {hasAttention && (
                <button
                  onClick={openPanel}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium animate-pulse',
                    highestPriorityAttention?.type === 'error' && 'bg-red-500/20 text-red-400',
                    highestPriorityAttention?.type === 'needs_approval' &&
                      'bg-yellow-500/20 text-yellow-400',
                    highestPriorityAttention?.type === 'completed' &&
                      'bg-green-500/20 text-green-400',
                    highestPriorityAttention?.type === 'waiting_input' &&
                      'bg-blue-500/20 text-blue-400'
                  )}
                  title={highestPriorityAttention?.title}
                >
                  <Bell className="h-3 w-3" />
                  {agentAttentions.length}
                </button>
              )}
              {/* Worktree status badge */}
              <WorktreeStatus worktree={agentWorktree} />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary">
                  {getModelDisplayName(agent.model)}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuLabel>Select Model</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {availableModels.map((model) => (
                    <DropdownMenuRadioItem key={model.id} value={model.id}>
                      {model.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Agent Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleRename}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Settings2 className="mr-2 h-4 w-4" />
                Change Model
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {availableModels.map((model) => (
                    <DropdownMenuRadioItem key={model.id} value={model.id}>
                      {model.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => setVoiceSettingsOpen(true)}>
              <Volume2 className="mr-2 h-4 w-4" />
              Voice Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModeSettingsOpen(true)}>
              <Shield className="mr-2 h-4 w-4" />
              Mode Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicate} disabled={isDuplicating}>
              {isDuplicating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {isDuplicating ? 'Duplicating...' : 'Duplicate'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleDelete} className="text-red-400 focus:text-red-400">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        className={cn(
          'flex-1 overflow-y-auto p-4 space-y-4 min-h-0 selection:bg-accent-primary/30 selection:text-text-primary',
          !expanded && 'max-h-[300px]'
        )}
      >
        {agent.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            <p>No messages yet. Start a conversation.</p>
          </div>
        ) : (
          agent.messages.map((msg) => (
            <div key={msg.id} className="space-y-2 group/message">
              {/* Thinking block - collapsible for assistant messages */}
              {msg.role === 'assistant' && msg.thinking && (
                <div className="ml-0 max-w-[85%]">
                  <button
                    onClick={() => toggleThinking(msg.id)}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {expandedThinking[msg.id] ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <Lightbulb className="h-3 w-3" />
                    <span>Thinking</span>
                  </button>
                  {expandedThinking[msg.id] && (
                    <div className="mt-1.5 p-2 rounded-md bg-surface border border-border-subtle text-xs text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                      {msg.thinking}
                    </div>
                  )}
                </div>
              )}
              <div className={cn('flex gap-3', msg.role === 'user' && 'flex-row-reverse')}>
                <div
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm max-w-[85%] relative',
                    msg.role === 'user'
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-elevated text-text-primary'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs opacity-60">{formatTimestamp(msg.timestamp)}</span>
                    <div className="flex items-center gap-1">
                      {/* Delete message button - visible on hover */}
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        disabled={deletingMessageId === msg.id}
                        className={cn(
                          'rounded p-1 transition-colors opacity-0 group-hover/message:opacity-100',
                          msg.role === 'user'
                            ? 'hover:bg-white/20 text-text-inverse/60 hover:text-text-inverse'
                            : 'hover:bg-overlay text-text-muted hover:text-red-400',
                          deletingMessageId === msg.id && 'opacity-50'
                        )}
                        title="Delete message"
                      >
                        {deletingMessageId === msg.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                      {/* TTS playback buttons for assistant messages */}
                      {msg.role === 'assistant' && (
                        <>
                          <button
                            onClick={() => handlePlayMessage(msg.id)}
                            disabled={synthesizingMessageId === msg.id}
                            className={cn(
                              'rounded p-1 transition-colors hover:bg-overlay',
                              playingMessageId === msg.id && 'text-accent-primary',
                              synthesizingMessageId === msg.id && 'opacity-50'
                            )}
                            title={playingMessageId === msg.id ? 'Stop playback' : 'Play message'}
                          >
                            {synthesizingMessageId === msg.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : playingMessageId === msg.id ? (
                              <VolumeX className="h-3 w-3" />
                            ) : (
                              <Volume2 className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={() => handlePlayMessage(msg.id, true)}
                            disabled={synthesizingMessageId === msg.id}
                            className={cn(
                              'rounded p-1 transition-colors hover:bg-overlay text-text-muted hover:text-text-secondary',
                              synthesizingMessageId === msg.id && 'opacity-50'
                            )}
                            title="Regenerate audio summary"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* Inline tool calls for this message */}
              {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-2">
                  {msg.toolCalls.map((tool) => (
                    <div key={tool.id}>
                      {/* Show tool result with proper formatting */}
                      {tool.status === 'completed' && tool.result && (
                        <ToolResultDisplay
                          toolName={tool.name}
                          result={tool.result}
                          onPlanApprove={async (planId) => {
                            if (planId) {
                              try {
                                await approvePlan(sessionId, planId);
                              } catch (error) {
                                console.error('Failed to approve plan:', error);
                              }
                            }
                          }}
                          onPlanReject={async (planId) => {
                            if (planId) {
                              try {
                                await rejectPlan(sessionId, planId, 'User rejected');
                              } catch (error) {
                                console.error('Failed to reject plan:', error);
                              }
                            }
                          }}
                        />
                      )}
                      {/* Show running/pending indicator */}
                      {(tool.status === 'running' || tool.status === 'pending') && (
                        <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle flex items-center gap-2">
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full shrink-0',
                              tool.status === 'running' && 'bg-accent-warning animate-pulse',
                              tool.status === 'pending' && 'bg-text-muted'
                            )}
                          />
                          <span className="text-xs text-text-secondary">
                            {tool.status === 'running' ? 'Running' : 'Pending'}...
                          </span>
                        </div>
                      )}
                      {/* Show error message */}
                      {tool.status === 'error' && tool.result && (
                        <div className="mt-2 p-2 rounded-md bg-accent-error/10 border border-accent-error/20 text-accent-error text-xs">
                          {String(tool.result)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* Streaming message or Thinking indicator when agent is processing */}
        {(agent.status === 'active' || isSending) && (
          <div className="flex gap-3">
            <div className="rounded-lg px-3 py-2 text-sm bg-elevated text-text-primary max-w-[85%]">
              {streamingMessage && streamingMessage.content ? (
                (() => {
                  const { displayContent, isToolCallJson } = cleanStreamingContent(
                    streamingMessage.content
                  );
                  return (
                    <>
                      {isToolCallJson ? (
                        <div className="flex items-center gap-2 text-text-secondary">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{displayContent}</span>
                        </div>
                      ) : (
                        <MarkdownRenderer content={displayContent} />
                      )}
                      <span className="inline-block w-2 h-4 bg-accent-primary animate-pulse ml-0.5 align-middle" />
                    </>
                  );
                })()
              ) : (
                <div className="flex items-center gap-2 text-text-secondary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Thinking...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stopped message when task was aborted */}
        {showAbortedMessage && agent.status === 'idle' && (
          <div className="flex gap-3">
            <div className="rounded-lg px-3 py-2 text-sm bg-elevated text-text-secondary max-w-[85%]">
              <div className="flex items-center gap-2">
                <StopCircle className="h-4 w-4" />
                <span>Stopped</span>
              </div>
            </div>
          </div>
        )}

        {/* Plan approval actions - show when in Plan mode and last message is from assistant */}
        {agent.mode === 'plan' &&
          agent.status === 'idle' &&
          agent.messages.length > 0 &&
          agent.messages[agent.messages.length - 1]?.role === 'assistant' && (
            <PlanApprovalActions
              sessionId={sessionId}
              agentId={agent.id}
              agentName={agent.name}
              onApprove={(newMode) => {
                updateAgent(sessionId, agent.id, { mode: newMode });
              }}
              onRefine={(feedback) => {
                // Send refinement as a new user message
                setMessage(feedback);
                // Trigger send after state update
                setTimeout(() => {
                  const userMessage = {
                    id: `temp-${Date.now()}`,
                    role: 'user' as const,
                    content: feedback,
                    timestamp: new Date(),
                  };
                  addAgentMessage(sessionId, agent.id, userMessage);
                  updateAgent(sessionId, agent.id, { status: 'active' });
                  sendAgentMessage(sessionId, agent.id, feedback).catch((error) => {
                    console.error('Failed to send refinement:', error);
                    updateAgent(sessionId, agent.id, { status: 'error' });
                  });
                  setMessage('');
                }, 0);
              }}
              onReject={() => {
                // Dismiss the plan - optionally could add a message or reset
                updateAgent(sessionId, agent.id, { mode: 'ask' });
              }}
            />
          )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border-subtle p-3" data-tour="agent-input">
        {/* Real-time transcription preview */}
        {isRecording && currentTranscript && (
          <div className="mb-2 rounded-md bg-elevated px-3 py-2 text-sm text-text-secondary">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-error" />
            {currentTranscript}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Mic button - push to talk */}
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

          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Listening...' : `Ask ${agent.name.toLowerCase()}...`}
            className="flex-1 bg-elevated border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none selection:bg-accent-primary selection:text-white"
            disabled={isRecording}
          />
          <button
            onClick={handleSendMessage}
            disabled={!message.trim() || isSending || isRecording}
            className={cn(
              'rounded-md p-2 transition-colors',
              message.trim() && !isSending && !isRecording
                ? 'bg-accent-primary text-text-inverse hover:bg-opacity-90'
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

      {/* Voice Settings Dialog */}
      <VoiceSettingsDialog
        open={voiceSettingsOpen}
        onOpenChange={setVoiceSettingsOpen}
        sessionId={sessionId}
        agentId={agent.id}
        agentName={agent.name}
      />

      {/* Mode Settings Dialog */}
      <AgentModeSelector
        open={modeSettingsOpen}
        onOpenChange={setModeSettingsOpen}
        sessionId={sessionId}
        agentId={agent.id}
        agentName={agent.name}
        currentMode={agent.mode || 'ask'}
        currentAllowlist={agent.commandAllowlist}
        onModeUpdate={(mode, allowlist) => {
          updateAgent(sessionId, agent.id, { mode, commandAllowlist: allowlist });
        }}
      />

      {/* Context Compaction Dialog */}
      <CompactionDialog
        agentId={agent.id}
        agentName={agent.name}
        sessionId={sessionId}
        isOpen={compactionDialogOpen}
        onClose={() => setCompactionDialogOpen(false)}
        onCompact={async (instructions) => {
          await compactAgentContext(agent.id, instructions);
        }}
      />
    </div>
  );
}
