'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Mic,
  Paperclip,
  Loader2,
  StopCircle,
  X,
  Copy,
  Check,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSessionStore, type AgentMessage } from '@/stores/session';
import { useUIStore } from '@/stores/ui';
import {
  getFileContent,
  deleteAgentMessage as deleteAgentMessageApi,
  synthesizeMessage,
} from '@/lib/api';
import { getLanguageFromPath } from '@/lib/vscode/languageUtils';
import { useStreamingStore } from '@/stores/streaming';
import { sendAgentMessage, abortAgent, isQuotaError, attachConversation } from '@/lib/api';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useSwipeGesture } from '@/hooks/useGestures';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { useVoiceSettingsStore } from '@/stores/voiceSettings';
import { onSocketEvent, type AgentMessageEvent } from '@/lib/socket';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CreditExhaustedBanner } from './CreditExhaustedBanner';
import { MobileAgentToolbar } from './MobileAgentToolbar';
import { MobileMessageBubble } from './MobileMessageBubble';
import { NoMessagesEmptyState } from '@/components/ui/EmptyState';
import { VoiceRecordingOverlay } from './VoiceRecordingOverlay';

// Generate temporary ID for optimistic updates
function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

interface MobileAgentViewProps {
  sessionId: string;
  agentId: string;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

export function MobileAgentView({
  sessionId,
  agentId,
  onSwipeLeft,
  onSwipeRight,
}: MobileAgentViewProps) {
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCreditExhausted, setShowCreditExhausted] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [synthesizingMessageId, setSynthesizingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Track last submitted content to prevent double-submission on mobile
  const lastSubmittedRef = useRef<{ content: string; time: number } | null>(null);
  // Track if user is at bottom of scroll container
  const isUserAtBottomRef = useRef(true);
  // Track if we should auto-send when final transcript arrives
  const pendingVoiceSendRef = useRef(false);

  const session = useSessionStore((state) => state.sessions[sessionId]);
  const getConversationForAgent = useSessionStore((state) => state.getConversationForAgent);
  const createConversationSession = useSessionStore((state) => state.createConversationSession);
  const attachConversationToAgent = useSessionStore((state) => state.attachConversationToAgent);
  const addConversationMessage = useSessionStore((state) => state.addConversationMessage);
  const deleteConversationMessage = useSessionStore((state) => state.deleteConversationMessage);
  const streamingMessages = useStreamingStore((state) => state.streamingMessages);
  const agent = session?.agents?.find((a) => a.id === agentId);

  // Voice settings (global TTS enable/disable)
  const ttsEnabled = useVoiceSettingsStore((state) => state.tts_enabled);

  // Audio playback hook for TTS
  const { playingMessageId, playAudioUrl, playAudioBase64, stopPlayback, unlockAudio } =
    useAudioPlayback({
      sessionId,
      onPlayEnd: () => {},
    });

  // Get conversation session for this agent
  const conversationSession = getConversationForAgent(sessionId, agentId);
  const messages = useMemo(
    () => conversationSession?.messages ?? [],
    [conversationSession?.messages]
  );

  // Get finalized messages with deduplication (safety net for race conditions)
  // Only dedupes by exact ID - does NOT dedupe by content to allow duplicate messages
  const finalizedMessages = useMemo(() => {
    if (messages.length === 0) return messages;

    const seenIds = new Set<string>();
    const result: AgentMessage[] = [];

    for (const msg of messages) {
      // Skip messages without valid ID
      const msgId = msg.id ?? '';
      if (!msgId) continue;

      // Skip exact ID duplicates only
      if (seenIds.has(msgId)) continue;
      seenIds.add(msgId);

      result.push(msg);
    }

    return result;
  }, [messages]);

  // Find active streaming message for this agent
  const streamingMessage = useMemo(() => {
    return Object.values(streamingMessages).find(
      (sm) => sm.sessionId === sessionId && sm.agentId === agentId && sm.isStreaming
    );
  }, [streamingMessages, sessionId, agentId]);

  // Check if agent is processing
  const isProcessing = !!streamingMessage;

  // Track pending voice message to submit after final transcript
  const [pendingVoiceSubmit, setPendingVoiceSubmit] = useState<string | null>(null);

  // Voice capture integration
  const {
    isRecording,
    isTranscribing,
    currentTranscript,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceCapture({
    sessionId,
    agentId,
    onTranscript: (text, isFinal) => {
      if (isFinal && text.trim()) {
        // On final transcript, check if we should auto-send
        if (pendingVoiceSendRef.current) {
          pendingVoiceSendRef.current = false;
          // Set the pending voice submit to trigger the effect
          setPendingVoiceSubmit(text.trim());
        } else {
          setInput(text.trim());
        }
      }
    },
    onError: (error) => {
      console.error('Voice capture error:', error);
      pendingVoiceSendRef.current = false;
      toast.error('Microphone access denied or unavailable');
    },
  });

  // Swipe gesture for switching agents
  const {
    ref: swipeRef,
    isSwiping,
    deltaX,
  } = useSwipeGesture<HTMLDivElement>({
    onSwipeLeft,
    onSwipeRight,
    threshold: 100,
    preventDefaultOnSwipe: true,
  });

  // Handle scroll to detect if user has scrolled up
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Check if user is at or near the bottom (within 50px threshold)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    isUserAtBottomRef.current = isAtBottom;
  }, []);

  // Auto-scroll to bottom on new messages or streaming updates (only if user is at bottom)
  useEffect(() => {
    if (messagesEndRef.current && isUserAtBottomRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [finalizedMessages, streamingMessage?.content]);

  const updateAgent = useSessionStore((state) => state.updateAgent);

  // Auto-submit voice message when final transcript arrives
  useEffect(() => {
    if (!pendingVoiceSubmit || isSubmitting || !agent) return;

    const submitVoiceMessage = async () => {
      const transcript = pendingVoiceSubmit;
      setPendingVoiceSubmit(null);

      // Prevent double-submission
      const now = Date.now();
      if (
        lastSubmittedRef.current &&
        lastSubmittedRef.current.content === transcript &&
        now - lastSubmittedRef.current.time < 2000
      ) {
        return;
      }
      lastSubmittedRef.current = { content: transcript, time: now };

      setIsSubmitting(true);
      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      // Create or get conversation session
      let conversationId = conversationSession?.id;
      if (!conversationId) {
        const newConversation = createConversationSession(sessionId, { firstMessage: transcript });
        conversationId = newConversation.id;
        attachConversationToAgent(sessionId, conversationId, agentId);
        attachConversation(sessionId, conversationId, agentId).catch((error) => {
          console.error('Failed to attach conversation:', error);
        });
      }

      // Add optimistic user message
      const userMessage: AgentMessage = {
        id: generateTempId(),
        role: 'user',
        content: transcript,
        timestamp: new Date(),
      };
      addConversationMessage(sessionId, conversationId, userMessage);
      updateAgent(sessionId, agentId, { status: 'active' });

      try {
        await sendAgentMessage(sessionId, agentId, transcript);
      } catch (error) {
        console.error('Failed to send voice message:', error);
        if (isQuotaError(error)) {
          setShowCreditExhausted(true);
        } else {
          toast.error('Failed to send message');
        }
        updateAgent(sessionId, agentId, { status: 'error' });
      } finally {
        setIsSubmitting(false);
      }
    };

    submitVoiceMessage();
  }, [
    pendingVoiceSubmit,
    isSubmitting,
    agent,
    sessionId,
    agentId,
    conversationSession,
    createConversationSession,
    attachConversationToAgent,
    addConversationMessage,
    updateAgent,
  ]);
  const openMobileFile = useUIStore((state) => state.openMobileFile);

  // File link click handler - opens mobile file viewer sheet
  const handleFileClick = useCallback(
    async (path: string, _startLine?: number, _endLine?: number) => {
      try {
        // Fetch file content first
        const fileContent = await getFileContent(sessionId, path);

        // Open in mobile file viewer sheet
        openMobileFile(
          fileContent.path,
          fileContent.content,
          fileContent.language || getLanguageFromPath(path)
        );
      } catch (err) {
        console.error('Failed to load file content:', err);
        toast.error('Failed to open file');
      }
    },
    [sessionId, openMobileFile]
  );

  // Copy message to clipboard
  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
      toast.error('Failed to copy message');
    }
  }, []);

  // Delete message
  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (deletingMessageId || !conversationSession) return;
      setDeletingMessageId(messageId);
      try {
        await deleteAgentMessageApi(sessionId, agentId, messageId);
        deleteConversationMessage(sessionId, conversationSession.id, messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
        toast.error('Failed to delete message');
      } finally {
        setDeletingMessageId(null);
      }
    },
    [sessionId, agentId, conversationSession, deletingMessageId, deleteConversationMessage]
  );

  // Play message TTS
  const handlePlayMessage = useCallback(
    async (messageId: string) => {
      if (playingMessageId === messageId) {
        stopPlayback();
        return;
      }

      // Unlock audio element synchronously during user gesture (required for mobile)
      unlockAudio();

      setSynthesizingMessageId(messageId);
      try {
        const result = await synthesizeMessage(sessionId, agentId, messageId);
        if (result.audio_b64) {
          playAudioBase64(messageId, result.audio_b64, result.content_type);
        } else if (result.audio_url) {
          playAudioUrl(messageId, result.audio_url);
        }
      } catch (error) {
        console.error('Failed to play message:', error);
        toast.error('Failed to play audio');
      } finally {
        setSynthesizingMessageId(null);
      }
    },
    [sessionId, agentId, playingMessageId, playAudioUrl, playAudioBase64, stopPlayback, unlockAudio]
  );

  // Auto-play refs
  const isPlayingRef = useRef(!!playingMessageId);
  const handlePlayMessageRef = useRef(handlePlayMessage);
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    isPlayingRef.current = !!playingMessageId;
  }, [playingMessageId]);
  useEffect(() => {
    handlePlayMessageRef.current = handlePlayMessage;
  }, [handlePlayMessage]);
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  // Auto-play new messages (only when TTS is enabled)
  useEffect(() => {
    const unsubscribe = onSocketEvent('agent_message', (data: AgentMessageEvent) => {
      if (data.agent_id !== agentId) return;
      if (data.role !== 'assistant' || !data.auto_play) return;
      if (!ttsEnabledRef.current) return; // Don't auto-play if TTS is disabled
      if (isPlayingRef.current) return;
      handlePlayMessageRef.current(data.id);
    });
    return unsubscribe;
  }, [agentId]);

  const handleSubmit = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isSubmitting || !agent) return;

    // Prevent double-submission on mobile (touch events can fire multiple times)
    const now = Date.now();
    if (
      lastSubmittedRef.current &&
      lastSubmittedRef.current.content === trimmedInput &&
      now - lastSubmittedRef.current.time < 2000
    ) {
      return; // Same content within 2 seconds, ignore
    }
    lastSubmittedRef.current = { content: trimmedInput, time: now };

    setIsSubmitting(true);
    setInput('');
    // Reset textarea height when clearing input
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    // Create or get conversation session for this agent
    let conversationId = conversationSession?.id;
    if (!conversationId) {
      // Create a new conversation session and attach to this agent
      const newConversation = createConversationSession(sessionId, { firstMessage: trimmedInput });
      conversationId = newConversation.id;
      // Optimistically update local state
      attachConversationToAgent(sessionId, conversationId, agentId);
      // Call API to attach (don't await - let it happen in background)
      // Backend will handle detaching old conversation if needed
      attachConversation(sessionId, conversationId, agentId).catch((error) => {
        console.error('Failed to attach conversation:', error);
        // WebSocket event will sync state if API call fails
      });
    }

    // Add optimistic user message to store (with temp ID that will be updated by WebSocket)
    const userMessage: AgentMessage = {
      id: generateTempId(),
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };
    addConversationMessage(sessionId, conversationId, userMessage);
    updateAgent(sessionId, agentId, { status: 'active' });

    try {
      await sendAgentMessage(sessionId, agentId, trimmedInput);
    } catch (error) {
      console.error('Failed to send message:', error);
      if (isQuotaError(error)) {
        setShowCreditExhausted(true);
      } else {
        toast.error('Failed to send message');
      }
      updateAgent(sessionId, agentId, { status: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    input,
    isSubmitting,
    agent,
    sessionId,
    agentId,
    conversationSession,
    createConversationSession,
    attachConversationToAgent,
    addConversationMessage,
    updateAgent,
  ]);

  // Handle voice cancel
  const handleVoiceCancel = useCallback(() => {
    pendingVoiceSendRef.current = false;
    cancelRecording();
    setInput('');
    // Reset textarea height when clearing input
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }, [cancelRecording]);

  // Handle voice send - stop recording and mark for auto-send when final transcript arrives
  const handleVoiceSend = useCallback(async () => {
    // Mark that we want to auto-send when final transcript arrives
    pendingVoiceSendRef.current = true;
    try {
      await stopRecording();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      pendingVoiceSendRef.current = false;
      toast.error('Failed to stop recording');
    }
  }, [stopRecording]);

  const handleAbort = useCallback(async () => {
    try {
      await abortAgent(sessionId, agentId);
      toast.success('Agent stopped');
    } catch (error) {
      console.error('Failed to stop agent:', error);
      toast.error('Failed to stop agent');
    }
  }, [sessionId, agentId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea based on content
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Reset height to auto to get the correct scrollHeight
    e.target.style.height = 'auto';
    // Set height to scrollHeight, capped at max-height (128px)
    e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
  }, []);

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary">Agent not found</p>
      </div>
    );
  }

  return (
    <div
      ref={swipeRef}
      className="flex flex-col h-full touch-pan-y overflow-x-hidden"
      data-tour="agent-grid"
      style={{
        transform: isSwiping ? `translateX(${deltaX * 0.3}px)` : undefined,
        transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
      }}
    >
      {/* Credit exhausted banner */}
      {showCreditExhausted && (
        <CreditExhaustedBanner onDismiss={() => setShowCreditExhausted(false)} />
      )}

      {/* Agent toolbar - always visible at top */}
      <div className="flex-none">
        <MobileAgentToolbar sessionId={sessionId} agent={agent} />
      </div>

      {/* Messages area - scrollable middle section */}
      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4"
      >
        {finalizedMessages.length === 0 && !streamingMessage ? (
          <NoMessagesEmptyState agentName={agent.name} />
        ) : (
          <div className="space-y-4">
            {finalizedMessages.map((message) => (
              <div key={message.id} className="space-y-1">
                <MobileMessageBubble message={message} onFileClick={handleFileClick} />
                {/* Message control buttons - always visible on mobile */}
                <div
                  className={cn(
                    'flex items-center gap-1 px-1',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {/* Copy button */}
                  <button
                    onClick={() => handleCopyMessage(message.id, message.content)}
                    aria-label="Copy message"
                    className={cn(
                      'rounded p-2 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors touch-manipulation',
                      message.role === 'user'
                        ? 'text-text-tertiary active:bg-white/10'
                        : 'text-text-tertiary active:bg-overlay',
                      copiedMessageId === message.id && 'text-green-400'
                    )}
                  >
                    {copiedMessageId === message.id ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteMessage(message.id)}
                    disabled={deletingMessageId === message.id}
                    aria-label="Delete message"
                    className={cn(
                      'rounded p-2 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors touch-manipulation',
                      message.role === 'user'
                        ? 'text-text-tertiary active:bg-white/10'
                        : 'text-text-tertiary active:bg-overlay',
                      deletingMessageId === message.id && 'opacity-50'
                    )}
                  >
                    {deletingMessageId === message.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                  </button>

                  {/* TTS Play button - only for assistant messages when TTS is enabled */}
                  {message.role === 'assistant' && ttsEnabled && (
                    <button
                      onClick={() => handlePlayMessage(message.id)}
                      disabled={synthesizingMessageId === message.id}
                      aria-label={
                        playingMessageId === message.id ? 'Stop playback' : 'Play message'
                      }
                      className={cn(
                        'rounded p-2 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors touch-manipulation',
                        'text-text-tertiary active:bg-overlay',
                        playingMessageId === message.id && 'text-accent-primary',
                        synthesizingMessageId === message.id && 'opacity-50'
                      )}
                    >
                      {synthesizingMessageId === message.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : playingMessageId === message.id ? (
                        <VolumeX className="h-4 w-4" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {/* Streaming message or thinking indicator */}
            {isProcessing && (
              <div className="flex flex-col items-start">
                {streamingMessage?.content ? (
                  <>
                    <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-[#1a1a2e] border border-border-subtle text-text-primary rounded-bl-md">
                      <div className="text-sm">
                        <MarkdownRenderer
                          content={streamingMessage.content}
                          onFileClick={handleFileClick}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 px-1">
                      <Loader2 className="h-3 w-3 animate-spin text-accent-primary" />
                      <span className="text-2xs text-text-tertiary">Thinking...</span>
                    </div>
                  </>
                ) : (
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-[#1a1a2e] border border-border-subtle text-text-primary rounded-bl-md">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area - always visible at bottom */}
      <div
        className="relative flex-none border-t border-border-subtle bg-surface p-3"
        data-tour="agent-input"
      >
        {/* Voice Recording Overlay - shows during recording or transcribing */}
        <VoiceRecordingOverlay
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          currentTranscript={currentTranscript}
          onCancel={handleVoiceCancel}
        />

        {/* Normal input UI - hidden during recording/transcribing */}
        <div
          className={cn(
            'flex items-center gap-2 transition-opacity',
            (isRecording || isTranscribing) && 'opacity-0 pointer-events-none'
          )}
        >
          {/* Attachment button - disabled until feature is implemented */}
          <button
            disabled
            className={cn(
              'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
              'text-text-tertiary opacity-50 cursor-not-allowed',
              'transition-colors touch-manipulation'
            )}
            aria-label="Attach file (coming soon)"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl resize-none',
                'bg-surface-hover border border-border-subtle',
                'text-base text-text-primary placeholder:text-text-tertiary',
                'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                'overflow-y-auto'
              )}
              style={{
                minHeight: '44px',
                maxHeight: '128px',
              }}
            />
          </div>

          {/* Voice / Send button */}
          {isProcessing ? (
            <button
              onClick={handleAbort}
              className={cn(
                'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
                'bg-status-error/10 text-status-error',
                'hover:bg-status-error/20',
                'transition-colors touch-manipulation'
              )}
              aria-label="Stop agent"
            >
              <StopCircle className="h-5 w-5" />
            </button>
          ) : input.trim() ? (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={cn(
                'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
                'bg-accent-primary text-text-inverse',
                'hover:bg-accent-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-colors touch-manipulation'
              )}
              aria-label="Send message"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          ) : ttsEnabled ? (
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                startRecording();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                handleVoiceSend();
              }}
              onMouseDown={startRecording}
              onMouseUp={handleVoiceSend}
              onMouseLeave={() => {
                if (isRecording) {
                  handleVoiceSend();
                }
              }}
              className={cn(
                'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
                'hover:bg-surface-hover active:bg-surface-active',
                'transition-colors touch-manipulation select-none',
                isRecording && 'bg-status-error text-white animate-pulse'
              )}
              aria-label="Hold to speak"
            >
              <Mic className="h-5 w-5 text-text-secondary" />
            </button>
          ) : (
            <button
              disabled
              className={cn(
                'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
                'bg-accent-primary/50 text-text-inverse',
                'opacity-50 cursor-not-allowed',
                'transition-colors touch-manipulation'
              )}
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
