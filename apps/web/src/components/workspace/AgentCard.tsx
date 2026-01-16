'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  AlertTriangle,
  Bell,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  Eye,
  FileText,
  HelpCircle,
  ImageOff,
  Key,
  Lightbulb,
  Loader2,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
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
  Undo2,
  Volume2,
  VolumeX,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
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
import { useCheckpointsStore } from '@/stores/checkpoints';
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
  togglePlanMode,
  restoreCheckpoint,
  updateAgentSettings,
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
import { ModelTooltip, ModelCapabilityBadges } from './ModelTooltip';
import { ThinkingConfigDialog } from './ThinkingConfigDialog';
import { SlashCommandMenu, isBuiltInCommand, type BuiltInCommand } from './SlashCommandMenu';
import {
  compactAgentContext,
  getAvailableModels,
  getUserProviderModels,
  executeCommand,
  type PublicModel,
  type UserProviderModel,
  type CustomCommand,
} from '@/lib/api';
import { SUPPORTED_IMAGE_TYPES, MAX_ATTACHMENT_SIZE_MB } from '@podex/shared';
import type { ThinkingConfig, AttachmentFile, ModelInfo, LLMProvider } from '@podex/shared';

// Confirmation dialog component
function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full shrink-0',
              confirmVariant === 'danger' ? 'bg-red-500/10' : 'bg-accent-primary/10'
            )}
          >
            <AlertTriangle
              className={cn(
                'h-5 w-5',
                confirmVariant === 'danger' ? 'text-red-400' : 'text-accent-primary'
              )}
            />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer',
              confirmVariant === 'danger'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent-primary hover:bg-accent-primary/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Prompt dialog component
function PromptDialog({
  isOpen,
  title,
  message,
  defaultValue,
  placeholder,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue || '');

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue || '');
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl p-6">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mt-4 w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              onConfirm(value.trim());
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={!value.trim()}
            className="px-4 py-2 text-sm font-medium bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

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
  // Dialog states for replacing native confirm/prompt/alert
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  // Thinking config dialog state
  const [thinkingDialogOpen, setThinkingDialogOpen] = useState(false);
  // Attachment state for image uploads
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  // Backend models state - fetched from API
  const [backendModels, setBackendModels] = useState<PublicModel[]>([]);
  // User-provider models (from user's own API keys)
  const [userProviderModels, setUserProviderModels] = useState<UserProviderModel[]>([]);
  // Slash command menu state
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Get worktree for this agent (if it exists)
  const agentWorktree = getAgentWorktree(sessionId, agent.id);

  // Get checkpoints for this agent
  const agentCheckpoints = getAgentCheckpoints(sessionId, agent.id);

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

  // Fetch available models from backend (platform models + user-provider models)
  useEffect(() => {
    // Fetch platform models
    getAvailableModels()
      .then(setBackendModels)
      .catch((err) => console.error('Failed to fetch platform models:', err));
    // Fetch user-provider models (from user's API keys)
    getUserProviderModels()
      .then(setUserProviderModels)
      .catch((err) => console.error('Failed to fetch user-provider models:', err));
  }, []);

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
    if ((!message.trim() && attachments.length === 0) || isSending) return;

    const messageContent = message.trim();
    const currentAttachments = [...attachments];
    setIsSending(true);
    setMessage('');
    setAttachments([]); // Clear attachments after sending

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
      await sendAgentMessage(sessionId, agent.id, messageContent, {
        attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        thinkingConfig: agent.thinkingConfig,
      });
      // Response will come via WebSocket
    } catch (error) {
      console.error('Failed to send message:', error);
      // Could remove the optimistic message or show error state
      updateAgent(sessionId, agent.id, { status: 'error' });
      toast.error('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  }, [
    message,
    attachments,
    isSending,
    sessionId,
    agent.id,
    agent.thinkingConfig,
    addAgentMessage,
    updateAgent,
  ]);

  // Handle input change to detect slash commands
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMessage(value);

    // Check if user is typing a slash command
    if (value.startsWith('/')) {
      const query = value.slice(1); // Remove the leading slash
      setSlashQuery(query);
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
      setSlashQuery('');
    }
  }, []);

  // Handle slash command selection
  const handleSlashCommandSelect = useCallback(
    async (command: BuiltInCommand | CustomCommand) => {
      setShowSlashMenu(false);
      setSlashQuery('');

      if (isBuiltInCommand(command)) {
        // Handle built-in commands
        const builtIn = command as BuiltInCommand;

        // Immediate actions that don't send to agent
        if (builtIn.immediate && builtIn.action) {
          switch (builtIn.action) {
            case 'help':
              // Show help - list all commands in a toast or message
              toast.info('Available Commands', {
                description: 'Type / to see all commands. Use /init, /test, /commit, and more.',
                duration: 5000,
              });
              setMessage('');
              return;

            case 'clear':
              // Clear conversation messages locally
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
              // Send checkpoint request to agent
              setMessage('/checkpoint - Create a checkpoint of the current changes');
              setTimeout(() => handleSendMessage(), 0);
              return;

            case 'undo':
              // If there are checkpoints, show the dropdown/dialog
              if (agentCheckpoints.length > 0) {
                toast.info('Use the Undo button in the header to restore a checkpoint');
              } else {
                toast.warning('No checkpoints available');
              }
              setMessage('');
              return;

            case 'mode':
              // Open mode settings dialog
              setModeSettingsOpen(true);
              setMessage('');
              return;

            case 'model':
              // Show model info and available models in toast
              // The model dropdown is in the header - inform user
              toast.info(`Current model: ${agent.model}`, {
                description: 'Use the model dropdown in the agent header to switch models.',
                duration: 4000,
              });
              setMessage('');
              return;

            case 'think':
              // Open thinking config dialog
              setThinkingDialogOpen(true);
              setMessage('');
              return;
          }
        }

        // Commands that need arguments - insert template
        if (builtIn.args && builtIn.args.length > 0) {
          const argPlaceholders = builtIn.args
            .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
            .join(' ');
          setMessage(`/${builtIn.name} ${argPlaceholders}`);
          // Select the first placeholder for easy typing
          setTimeout(() => {
            if (inputRef.current) {
              const start = builtIn.name.length + 2; // after "/<name> "
              inputRef.current.focus();
              inputRef.current.setSelectionRange(start, inputRef.current.value.length);
            }
          }, 0);
          return;
        }

        // Commands without args - send directly to agent
        setMessage(`/${builtIn.name}`);
        setTimeout(() => handleSendMessage(), 0);
      } else {
        // Handle custom commands - execute via API to get rendered prompt
        const custom = command as CustomCommand;

        if (custom.arguments && custom.arguments.length > 0) {
          // Has arguments - insert template
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
          // No arguments - execute and send rendered prompt
          try {
            const result = await executeCommand(custom.id, {});
            setMessage(result.prompt);
            setTimeout(() => handleSendMessage(), 0);
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
    // If slash menu is open, let it handle arrow keys and enter
    if (showSlashMenu) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Tab') {
        // SlashCommandMenu handles these via window event listener
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

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

  const handleRenameClick = useCallback(() => {
    setRenameDialogOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      // Update local state immediately
      updateAgent(sessionId, agent.id, { name: newName });

      // Persist to backend
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

  const toggleThinking = useCallback((messageId: string) => {
    setExpandedThinking((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  }, []);

  const handleDeleteClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, []);

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

  const [isTogglingPlanMode, setIsTogglingPlanMode] = useState(false);

  const handleTogglePlanMode = useCallback(async () => {
    if (isTogglingPlanMode) return;
    setIsTogglingPlanMode(true);
    try {
      const result = await togglePlanMode(sessionId, agent.id);
      // Update local state - the WebSocket event will also update but this is faster
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

  // Extended ModelInfo with user API flag
  type ExtendedModelInfo = ModelInfo & { isUserKey?: boolean };

  // Convert backend model to ModelInfo format for tooltips/badges
  const backendModelToInfo = useCallback(
    (m: PublicModel, isUserKey = false): ExtendedModelInfo => ({
      id: m.model_id,
      provider: (isUserKey ? m.provider : 'podex') as LLMProvider,
      displayName: m.display_name,
      shortName: m.display_name
        .replace('Claude ', '')
        .replace('Llama ', '')
        .replace(' (Direct)', ''),
      tier:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'flagship'
          : m.cost_tier === 'medium'
            ? 'balanced'
            : 'fast',
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
      reasoningEffort:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'high'
          : m.cost_tier === 'medium'
            ? 'medium'
            : 'low',
      isUserKey,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  // Convert user-provider model to ModelInfo format
  const userModelToInfo = useCallback(
    (m: UserProviderModel): ExtendedModelInfo => ({
      id: m.model_id,
      provider: m.provider as LLMProvider,
      displayName: m.display_name,
      shortName: m.display_name.replace('Claude ', '').replace(' (Direct)', ''),
      tier:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'flagship'
          : m.cost_tier === 'medium'
            ? 'balanced'
            : 'fast',
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
      reasoningEffort:
        m.cost_tier === 'premium' || m.cost_tier === 'high'
          ? 'high'
          : m.cost_tier === 'medium'
            ? 'medium'
            : 'low',
      isUserKey: true,
      inputPricePerMillion: m.input_cost_per_million ?? undefined,
      outputPricePerMillion: m.output_cost_per_million ?? undefined,
    }),
    []
  );

  // Get model info for current agent model - check all sources (backend only)
  const currentModelInfo = useMemo(() => {
    // Check user-provider models first
    const userModel = userProviderModels.find((m) => m.model_id === agent.model);
    if (userModel) return userModelToInfo(userModel);
    // Check backend (platform) models
    const backendModel = backendModels.find((m) => m.model_id === agent.model);
    if (backendModel) return backendModelToInfo(backendModel);
    // No fallback to frontend constants - return undefined if not found in backend
    return undefined;
  }, [agent.model, backendModels, userProviderModels, backendModelToInfo, userModelToInfo]);

  // Group models by tier for dropdown (platform models + user-provider models)
  const modelsByTier = useMemo((): {
    flagship: ExtendedModelInfo[];
    balanced: ExtendedModelInfo[];
    fast: ExtendedModelInfo[];
    userApi: ExtendedModelInfo[];
  } => {
    const flagship: ExtendedModelInfo[] = [];
    const balanced: ExtendedModelInfo[] = [];
    const fast: ExtendedModelInfo[] = [];
    const userApi: ExtendedModelInfo[] = [];

    // Add platform models
    for (const m of backendModels) {
      const info = backendModelToInfo(m);
      if (m.cost_tier === 'premium' || m.cost_tier === 'high') {
        flagship.push(info);
      } else if (m.cost_tier === 'medium') {
        balanced.push(info);
      } else {
        fast.push(info);
      }
    }

    // Add user-provider models to the userApi section
    for (const m of userProviderModels) {
      userApi.push(userModelToInfo(m));
    }

    return { flagship, balanced, fast, userApi };
  }, [backendModels, userProviderModels, backendModelToInfo, userModelToInfo]);

  const handleChangeModel = useCallback(
    async (newModel: string) => {
      // Update local state immediately for responsive UI
      updateAgent(sessionId, agent.id, { model: newModel });

      // Persist to backend
      try {
        await updateAgentSettings(sessionId, agent.id, { model: newModel });
      } catch (error) {
        console.error('Failed to persist model change:', error);
        // Don't revert - the local state is fine for this session
        // Backend will sync on next session load
      }
    },
    [agent.id, sessionId, updateAgent]
  );

  const getModelDisplayName = useCallback(
    (modelId: string) => {
      // Use backend-provided display name if available (from agent data)
      if (agent.modelDisplayName) {
        return agent.modelDisplayName.replace('Claude ', '').replace('Llama ', '');
      }
      // Check user-provider models first
      const userModel = userProviderModels.find((m) => m.model_id === modelId);
      if (userModel)
        return userModel.display_name
          .replace('Claude ', '')
          .replace('Llama ', '')
          .replace(' (Direct)', '');
      // Check backend platform models
      const backendModel = backendModels.find((m) => m.model_id === modelId);
      if (backendModel)
        return backendModel.display_name.replace('Claude ', '').replace('Llama ', '');
      // No fallback to frontend constants - return model ID if not found
      return modelId;
    },
    [agent.modelDisplayName, backendModels, userProviderModels]
  );

  // Handle thinking config save
  const handleSaveThinkingConfig = useCallback(
    (config: ThinkingConfig) => {
      updateAgentThinking(sessionId, agent.id, config);
    },
    [sessionId, agent.id, updateAgentThinking]
  );

  // Handle file selection for attachments
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Check if model supports vision
      if (!currentModelInfo?.supportsVision) {
        toast.error(
          `${currentModelInfo?.displayName ?? 'This model'} does not support image input`
        );
        return;
      }

      const newAttachments: AttachmentFile[] = [];

      for (const file of Array.from(files)) {
        // Validate file type
        if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          toast.error(`Unsupported file type: ${file.name}. Use PNG, JPG, GIF, or WebP.`);
          continue;
        }

        // Validate file size
        const sizeMB = file.size / (1024 * 1024);
        if (sizeMB > MAX_ATTACHMENT_SIZE_MB) {
          toast.error(
            `File too large: ${file.name} (${sizeMB.toFixed(1)}MB). Max is ${MAX_ATTACHMENT_SIZE_MB}MB.`
          );
          continue;
        }

        // Create preview URL
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

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [currentModelInfo]
  );

  // Remove attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.preview) {
        URL.revokeObjectURL(att.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // Clear attachments when model changes to non-vision model
  useEffect(() => {
    if (!currentModelInfo?.supportsVision && attachments.length > 0) {
      toast.warning('Attachments cleared: selected model does not support images');
      // Cleanup preview URLs
      attachments.forEach((att) => {
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setAttachments([]);
    }
  }, [currentModelInfo?.supportsVision, attachments.length]);

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
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-elevated hover:bg-overlay transition-colors cursor-pointer',
                  currentModeConfig.color
                )}
                title={`Mode: ${currentModeConfig.label}`}
              >
                <currentModeConfig.icon className="h-3 w-3" />
                {currentModeConfig.label}
              </button>
              {/* Plan mode toggle button */}
              <button
                onClick={handleTogglePlanMode}
                disabled={isTogglingPlanMode}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                  agent.mode === 'plan'
                    ? 'bg-blue-500/30 text-blue-400 ring-1 ring-blue-400/50 hover:bg-blue-500/40'
                    : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary',
                  isTogglingPlanMode && 'opacity-50 cursor-not-allowed'
                )}
                title={
                  agent.mode === 'plan'
                    ? `Exit Plan mode (return to ${agent.previousMode || 'Ask'})`
                    : 'Enter Plan mode (read-only)'
                }
              >
                <ClipboardList className="h-3 w-3" />
                <span>Plan</span>
                {agent.mode === 'plan' && (
                  <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                )}
              </button>
              {/* Extended Thinking toggle */}
              {currentModelInfo?.supportsThinking && (
                <button
                  onClick={() => setThinkingDialogOpen(true)}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer',
                    agent.thinkingConfig?.enabled
                      ? 'bg-purple-500/30 text-purple-400 ring-1 ring-purple-400/50 hover:bg-purple-500/40'
                      : 'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary'
                  )}
                  title={
                    agent.thinkingConfig?.enabled
                      ? `Extended Thinking: ${agent.thinkingConfig.budgetTokens.toLocaleString()} tokens`
                      : 'Enable Extended Thinking'
                  }
                >
                  <Brain className="h-3 w-3" />
                  <span>Think</span>
                  {agent.thinkingConfig?.enabled ? (
                    <>
                      <span className="text-purple-300">
                        {Math.round(agent.thinkingConfig.budgetTokens / 1000)}K
                      </span>
                      <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                    </>
                  ) : (
                    <span className="text-text-muted/60">Off</span>
                  )}
                </button>
              )}
              {/* Thinking coming soon badge */}
              {currentModelInfo?.thinkingStatus === 'coming_soon' && (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-gray-500/20 text-gray-400"
                  title="Extended thinking coming soon for this model"
                >
                  <Brain className="h-3 w-3" />
                  Soon
                </span>
              )}
              {/* Undo/Checkpoint dropdown */}
              {agentCheckpoints.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={cn(
                        'flex items-center justify-center rounded-full p-1 text-xs transition-colors cursor-pointer',
                        'bg-elevated text-text-muted hover:bg-overlay hover:text-text-primary',
                        restoringCheckpointId && 'opacity-50 cursor-not-allowed'
                      )}
                      disabled={!!restoringCheckpointId}
                      title="Undo changes"
                    >
                      <Undo2 className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel className="text-xs text-text-muted">
                      Restore to checkpoint
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {agentCheckpoints.slice(0, 10).map((cp) => (
                      <DropdownMenuItem
                        key={cp.id}
                        onClick={() => handleRestoreCheckpoint(cp.id, cp.description)}
                        disabled={cp.status === 'restored' || !!restoringCheckpointId}
                        className="cursor-pointer"
                      >
                        <div className="flex flex-col gap-0.5 w-full">
                          <div className="flex items-center justify-between">
                            <span className="text-sm truncate">
                              {cp.description || `Checkpoint #${cp.checkpointNumber}`}
                            </span>
                            {cp.status === 'restored' && (
                              <span className="text-xs text-green-400">restored</span>
                            )}
                          </div>
                          <span className="text-xs text-text-muted">
                            {cp.fileCount} file{cp.fileCount !== 1 ? 's' : ''} • +
                            {cp.totalLinesAdded}/-{cp.totalLinesRemoved}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                    {agentCheckpoints.length > 10 && (
                      <DropdownMenuItem disabled className="text-xs text-text-muted">
                        +{agentCheckpoints.length - 10} more checkpoints
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium animate-pulse cursor-pointer',
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
                <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary cursor-pointer">
                  {getModelDisplayName(agent.model)}
                  {currentModelInfo && <ModelCapabilityBadges model={currentModelInfo} compact />}
                  {!currentModelInfo?.supportsVision && (
                    <span
                      className="text-yellow-500/70"
                      title={`${currentModelInfo?.displayName ?? 'This model'} does not support image input`}
                    >
                      <ImageOff className="h-3 w-3" />
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Select Model</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {/* Flagship Tier */}
                <DropdownMenuLabel className="text-xs text-amber-400">Flagship</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.flagship.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {/* Balanced Tier */}
                <DropdownMenuLabel className="text-xs text-blue-400">Balanced</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.balanced.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {/* Fast Tier */}
                <DropdownMenuLabel className="text-xs text-green-400">Fast</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.fast.map((model) => (
                    <ModelTooltip key={model.id} model={model} side="right">
                      <DropdownMenuRadioItem
                        value={model.id}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <span>{model.shortName}</span>
                        <ModelCapabilityBadges model={model} compact />
                      </DropdownMenuRadioItem>
                    </ModelTooltip>
                  ))}
                </DropdownMenuRadioGroup>
                {/* Your API Keys */}
                {modelsByTier.userApi.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-purple-400 flex items-center gap-1">
                      <Key className="h-3 w-3" />
                      Your API Keys
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                      {modelsByTier.userApi.map((model) => (
                        <ModelTooltip key={model.id} model={model} side="right">
                          <DropdownMenuRadioItem
                            value={model.id}
                            className="flex items-center justify-between cursor-pointer"
                          >
                            <span className="flex items-center gap-1">
                              <Key className="h-3 w-3 text-purple-400" />
                              {model.shortName}
                            </span>
                            <ModelCapabilityBadges model={model} compact />
                          </DropdownMenuRadioItem>
                        </ModelTooltip>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
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
            <DropdownMenuItem onClick={handleRenameClick} className="cursor-pointer">
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Settings2 className="mr-2 h-4 w-4" />
                Change Model
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {/* Flagship */}
                <DropdownMenuLabel className="text-xs text-amber-400">Flagship</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.flagship.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{model.shortName}</span>
                      <ModelCapabilityBadges model={model} compact />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {/* Balanced */}
                <DropdownMenuLabel className="text-xs text-blue-400">Balanced</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.balanced.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{model.shortName}</span>
                      <ModelCapabilityBadges model={model} compact />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {/* Fast */}
                <DropdownMenuLabel className="text-xs text-green-400">Fast</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                  {modelsByTier.fast.map((model) => (
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{model.shortName}</span>
                      <ModelCapabilityBadges model={model} compact />
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {/* Your API Keys */}
                {modelsByTier.userApi.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-purple-400 flex items-center gap-1">
                      <Key className="h-3 w-3" />
                      Your API Keys
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={agent.model} onValueChange={handleChangeModel}>
                      {modelsByTier.userApi.map((model) => (
                        <DropdownMenuRadioItem
                          key={model.id}
                          value={model.id}
                          className="flex items-center justify-between cursor-pointer"
                        >
                          <span className="flex items-center gap-1">
                            <Key className="h-3 w-3 text-purple-400" />
                            {model.shortName}
                          </span>
                          <ModelCapabilityBadges model={model} compact />
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => setVoiceSettingsOpen(true)} className="cursor-pointer">
              <Volume2 className="mr-2 h-4 w-4" />
              Voice Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setModeSettingsOpen(true)} className="cursor-pointer">
              <Shield className="mr-2 h-4 w-4" />
              Mode Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleDuplicate}
              disabled={isDuplicating}
              className="cursor-pointer"
            >
              {isDuplicating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {isDuplicating ? 'Duplicating...' : 'Duplicate'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDeleteClick}
              className="text-red-400 focus:text-red-400 cursor-pointer"
            >
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
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer py-2 -my-1 min-h-[36px]"
                    aria-expanded={expandedThinking[msg.id]}
                    aria-label={expandedThinking[msg.id] ? 'Collapse thinking' : 'Expand thinking'}
                  >
                    {expandedThinking[msg.id] ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <Lightbulb className="h-4 w-4" />
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
                    <span
                      className={cn(
                        'text-xs',
                        msg.role === 'user' ? 'text-text-inverse/60' : 'text-text-muted'
                      )}
                    >
                      {formatTimestamp(msg.timestamp)}
                    </span>
                    <div className="flex items-center gap-1">
                      {/* Delete message button - visible on hover */}
                      <button
                        onClick={() => handleDeleteMessage(msg.id)}
                        disabled={deletingMessageId === msg.id}
                        aria-label="Delete message"
                        className={cn(
                          'rounded p-2 -m-1 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors opacity-0 group-hover/message:opacity-100 cursor-pointer',
                          msg.role === 'user'
                            ? 'hover:bg-white/20 text-text-inverse/60 hover:text-text-inverse'
                            : 'hover:bg-overlay text-text-muted hover:text-red-400',
                          deletingMessageId === msg.id && 'opacity-50'
                        )}
                        title="Delete message"
                      >
                        {deletingMessageId === msg.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </button>
                      {/* TTS playback buttons for assistant messages */}
                      {msg.role === 'assistant' && (
                        <>
                          <button
                            onClick={() => handlePlayMessage(msg.id)}
                            disabled={synthesizingMessageId === msg.id}
                            aria-label={
                              playingMessageId === msg.id ? 'Stop playback' : 'Play message'
                            }
                            className={cn(
                              'rounded p-2 -m-1 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors hover:bg-overlay cursor-pointer',
                              playingMessageId === msg.id && 'text-accent-primary',
                              synthesizingMessageId === msg.id && 'opacity-50'
                            )}
                            title={playingMessageId === msg.id ? 'Stop playback' : 'Play message'}
                          >
                            {synthesizingMessageId === msg.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : playingMessageId === msg.id ? (
                              <VolumeX className="h-4 w-4" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handlePlayMessage(msg.id, true)}
                            disabled={synthesizingMessageId === msg.id}
                            aria-label="Regenerate audio summary"
                            className={cn(
                              'rounded p-2 -m-1 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors hover:bg-overlay text-text-muted hover:text-text-secondary cursor-pointer',
                              synthesizingMessageId === msg.id && 'opacity-50'
                            )}
                            title="Regenerate audio summary"
                          >
                            <RefreshCw className="h-4 w-4" />
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
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att) => (
              <div key={att.id} className="relative group">
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
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-error" />
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

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

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
            />
            {/* Slash command menu */}
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
            onClick={handleSendMessage}
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

      {/* Voice Settings Dialog */}
      {voiceSettingsOpen && (
        <VoiceSettingsDialog
          onOpenChange={setVoiceSettingsOpen}
          sessionId={sessionId}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}

      {/* Mode Settings Dialog */}
      {modeSettingsOpen && (
        <AgentModeSelector
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
      )}

      {/* Context Compaction Dialog */}
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

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      {/* Rename Prompt Dialog */}
      <PromptDialog
        isOpen={renameDialogOpen}
        title="Rename Agent"
        message="Enter a new name for this agent:"
        defaultValue={agent.name}
        placeholder="Agent name"
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameDialogOpen(false)}
      />

      {/* Extended Thinking Config Dialog */}
      <ThinkingConfigDialog
        open={thinkingDialogOpen}
        onOpenChange={setThinkingDialogOpen}
        config={agent.thinkingConfig}
        onSave={handleSaveThinkingConfig}
        modelName={currentModelInfo?.displayName ?? 'Model'}
      />
    </div>
  );
}
