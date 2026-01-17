'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Mic, Paperclip, Loader2, StopCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSessionStore, type AgentMessage } from '@/stores/session';
import { sendAgentMessage, abortAgent, isQuotaError } from '@/lib/api';
import { useSwipeGesture } from '@/hooks/useGestures';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { MarkdownRenderer } from './MarkdownRenderer';
import { CreditExhaustedBanner } from './CreditExhaustedBanner';
import { MobileAgentToolbar } from './MobileAgentToolbar';
import { MobileMessageBubble } from './MobileMessageBubble';
import { NoMessagesEmptyState } from '@/components/ui/EmptyState';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Track last submitted content to prevent double-submission on mobile
  const lastSubmittedRef = useRef<{ content: string; time: number } | null>(null);

  const session = useSessionStore((state) => state.sessions[sessionId]);
  const streamingMessages = useSessionStore((state) => state.streamingMessages);
  const agent = session?.agents?.find((a) => a.id === agentId);

  // Get finalized messages with deduplication (safety net for race conditions and stale localStorage)
  // Uses O(n) Set-based approach for efficiency
  const finalizedMessages = useMemo(() => {
    const messages = agent?.messages ?? [];
    if (messages.length === 0) return messages;

    const seenIds = new Set<string>();
    const contentToRealId = new Map<string, string>(); // content key -> real (non-temp) message id
    const result: typeof messages = [];

    // Single pass: track content keys and prefer real IDs over temp IDs
    for (const msg of messages) {
      // Skip exact ID duplicates
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);

      const contentKey = `${msg.role}:${msg.content}`;
      const existingRealId = contentToRealId.get(contentKey);
      const isTemp = msg.id.startsWith('temp-');

      if (existingRealId) {
        // Content already added with a real ID, skip this duplicate
        continue;
      }

      if (!isTemp) {
        // This is a real ID - mark this content as having a real ID
        contentToRealId.set(contentKey, msg.id);
      }

      // Check if we already added a temp version of this content
      const existingTempIndex = result.findIndex(
        (m) => m.id.startsWith('temp-') && `${m.role}:${m.content}` === contentKey
      );

      if (existingTempIndex !== -1 && !isTemp) {
        // Replace temp message with real one (maintains position)
        result[existingTempIndex] = msg;
      } else if (existingTempIndex === -1) {
        // No existing message with this content, add it
        result.push(msg);
      }
      // else: temp message exists and this is also temp, skip
    }

    return result;
  }, [agent?.messages]);

  // Find active streaming message for this agent
  const streamingMessage = useMemo(() => {
    return Object.values(streamingMessages).find(
      (sm) => sm.sessionId === sessionId && sm.agentId === agentId && sm.isStreaming
    );
  }, [streamingMessages, sessionId, agentId]);

  // Check if agent is processing
  const isProcessing = !!streamingMessage;

  // Voice capture integration
  const { isRecording, currentTranscript, startRecording, stopRecording, cancelRecording } =
    useVoiceCapture({
      sessionId,
      agentId,
      onTranscript: (text, isFinal) => {
        if (isFinal && text.trim()) {
          // On final transcript, set input
          setInput(text.trim());
        }
      },
      onError: (error) => {
        console.error('Voice capture error:', error);
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

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [finalizedMessages, streamingMessage?.content]);

  const addAgentMessage = useSessionStore((state) => state.addAgentMessage);

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

    // Add optimistic user message to store (with temp ID that will be updated by WebSocket)
    const userMessage: AgentMessage = {
      id: generateTempId(),
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };
    addAgentMessage(sessionId, agentId, userMessage);

    try {
      await sendAgentMessage(sessionId, agentId, trimmedInput);
    } catch (error) {
      console.error('Failed to send message:', error);
      if (isQuotaError(error)) {
        setShowCreditExhausted(true);
      } else {
        toast.error('Failed to send message');
      }
      // Note: We don't restore input on error since the optimistic message is already shown
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting, agent, sessionId, agentId, addAgentMessage]);

  // Handle voice recording toggle
  const handleVoiceToggle = useCallback(async () => {
    try {
      if (isRecording) {
        await stopRecording();
        // After stopping, the transcript becomes input via onTranscript callback
      } else {
        await startRecording();
      }
    } catch (error) {
      console.error('Voice recording error:', error);
      toast.error('Failed to toggle voice recording');
    }
  }, [isRecording, startRecording, stopRecording]);

  // Handle voice cancel
  const handleVoiceCancel = useCallback(() => {
    cancelRecording();
    setInput('');
  }, [cancelRecording]);

  // Handle voice send - stop recording and submit the transcript
  const handleVoiceSend = useCallback(async () => {
    const transcript = currentTranscript.trim();
    try {
      await stopRecording();
    } catch (error) {
      console.error('Failed to stop recording:', error);
      toast.error('Failed to stop recording');
      return;
    }
    if (transcript && !isSubmitting && agent) {
      // Prevent double-submission on mobile
      const now = Date.now();
      if (
        lastSubmittedRef.current &&
        lastSubmittedRef.current.content === transcript &&
        now - lastSubmittedRef.current.time < 2000
      ) {
        return; // Same content within 2 seconds, ignore
      }
      lastSubmittedRef.current = { content: transcript, time: now };

      setIsSubmitting(true);
      setInput('');

      // Add optimistic user message to store
      const userMessage: AgentMessage = {
        id: generateTempId(),
        role: 'user',
        content: transcript,
        timestamp: new Date(),
      };
      addAgentMessage(sessionId, agentId, userMessage);

      try {
        await sendAgentMessage(sessionId, agentId, transcript);
      } catch (error) {
        console.error('Failed to send message:', error);
        if (isQuotaError(error)) {
          setShowCreditExhausted(true);
        } else {
          toast.error('Failed to send message');
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  }, [currentTranscript, stopRecording, isSubmitting, agent, sessionId, agentId, addAgentMessage]);

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
      className="flex flex-col h-full touch-pan-y"
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
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
        {finalizedMessages.length === 0 && !streamingMessage ? (
          <NoMessagesEmptyState agentName={agent.name} />
        ) : (
          <div className="space-y-4">
            {finalizedMessages.map((message) => (
              <MobileMessageBubble key={message.id} message={message} />
            ))}
            {/* Streaming message or thinking indicator */}
            {isProcessing && (
              <div className="flex flex-col items-start">
                {streamingMessage?.content ? (
                  <>
                    <div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-[#1a1a2e] border border-border-subtle text-text-primary rounded-bl-md">
                      <div className="text-sm">
                        <MarkdownRenderer content={streamingMessage.content} />
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
        className="flex-none border-t border-border-subtle bg-surface p-3"
        data-tour="agent-input"
      >
        {isRecording ? (
          /* Recording UI */
          <div className="flex flex-col gap-3">
            {/* Recording indicator and transcript */}
            <div className="flex items-center gap-3 px-2">
              {/* Pulsing mic indicator */}
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-status-error/30 rounded-full animate-ping" />
                <div className="relative w-10 h-10 rounded-full bg-status-error flex items-center justify-center">
                  <Mic className="h-5 w-5 text-white" />
                </div>
              </div>

              {/* Live transcript */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-status-error font-medium mb-0.5">Recording...</p>
                <p className="text-sm text-text-primary truncate">
                  {currentTranscript || 'Listening...'}
                </p>
              </div>
            </div>

            {/* Recording controls */}
            <div className="flex items-center justify-center gap-4">
              {/* Cancel button */}
              <button
                onClick={handleVoiceCancel}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg',
                  'bg-surface-hover text-text-secondary',
                  'hover:bg-surface-active hover:text-text-primary',
                  'transition-colors touch-manipulation'
                )}
              >
                <X className="h-5 w-5" />
                <span className="text-sm font-medium">Cancel</span>
              </button>

              {/* Send button */}
              <button
                onClick={handleVoiceSend}
                disabled={!currentTranscript.trim()}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg',
                  'bg-accent-primary text-text-inverse',
                  'hover:bg-accent-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors touch-manipulation'
                )}
              >
                <Send className="h-5 w-5" />
                <span className="text-sm font-medium">Send</span>
              </button>
            </div>
          </div>
        ) : (
          /* Normal input UI */
          <div className="flex items-center gap-2">
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
            ) : (
              <button
                onClick={handleVoiceToggle}
                className={cn(
                  'p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg',
                  'hover:bg-surface-hover active:bg-surface-active',
                  'transition-colors touch-manipulation'
                )}
                aria-label="Voice input"
              >
                <Mic className="h-5 w-5 text-text-secondary" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
