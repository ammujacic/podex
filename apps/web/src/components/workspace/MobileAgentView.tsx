'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Mic, Paperclip, Loader2, StopCircle, ChevronDown, Bot, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useSessionStore, type AgentMessage } from '@/stores/session';
import { sendAgentMessage, abortAgent, isQuotaError } from '@/lib/api';

// Generate temporary ID for optimistic updates
function generateTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
import { useSwipeGesture } from '@/hooks/useGestures';
import { useVoiceCapture } from '@/hooks/useVoiceCapture';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolResultDisplay } from './ToolResultDisplay';
import { CreditExhaustedBanner } from './CreditExhaustedBanner';
import { MobileAgentToolbar } from './MobileAgentToolbar';

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
  const finalizedMessages = useMemo(() => {
    const messages = agent?.messages ?? [];
    // Deduplicate by ID and by content (for messages with different IDs but same content)
    // Two-pass approach: first collect all messages, then filter to prefer real IDs over temp IDs
    const seenIds = new Set<string>();
    const contentToMessages = new Map<string, typeof messages>(); // content -> all messages with that content

    // First pass: group messages by content, skip exact ID duplicates
    for (const msg of messages) {
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);

      const contentKey = `${msg.role}:${msg.content}`;
      const existing = contentToMessages.get(contentKey) ?? [];
      existing.push(msg);
      contentToMessages.set(contentKey, existing);
    }

    // Second pass: for each content group, pick the best message (prefer real ID over temp)
    const result: typeof messages = [];
    const usedContents = new Set<string>();

    for (const msg of messages) {
      const contentKey = `${msg.role}:${msg.content}`;
      if (usedContents.has(contentKey)) continue;

      const group = contentToMessages.get(contentKey) ?? [msg];
      // Prefer message with real ID (non-temp) if available
      const bestMsg = group.find((m) => !m.id.startsWith('temp-')) ?? group[0];
      if (bestMsg) {
        result.push(bestMsg);
        usedContents.add(contentKey);
      }
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
    if (isRecording) {
      await stopRecording();
      // After stopping, the transcript becomes input via onTranscript callback
    } else {
      await startRecording();
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
    await stopRecording();
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
      className="flex flex-col h-full"
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
          <div className="flex flex-col items-center justify-center min-h-full text-center px-4">
            <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-accent-primary" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">{agent.name}</h3>
            <p className="text-sm text-text-secondary max-w-xs">
              Start a conversation with this agent. Ask questions, request code changes, or explore
              your codebase.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {finalizedMessages.map((message) => (
              <MessageBubble key={message.id} message={message} />
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
                  'flex items-center gap-2 px-4 py-2 rounded-lg',
                  'bg-surface-hover text-text-secondary',
                  'hover:bg-surface-active hover:text-text-primary',
                  'transition-colors touch-manipulation'
                )}
              >
                <X className="h-4 w-4" />
                <span className="text-sm font-medium">Cancel</span>
              </button>

              {/* Send button */}
              <button
                onClick={handleVoiceSend}
                disabled={!currentTranscript.trim()}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg',
                  'bg-accent-primary text-text-inverse',
                  'hover:bg-accent-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  'transition-colors touch-manipulation'
                )}
              >
                <Send className="h-4 w-4" />
                <span className="text-sm font-medium">Send</span>
              </button>
            </div>
          </div>
        ) : (
          /* Normal input UI */
          <div className="flex items-center gap-2">
            {/* Attachment button */}
            <button
              className={cn(
                'p-2 rounded-lg',
                'hover:bg-surface-hover active:bg-surface-active',
                'transition-colors touch-manipulation'
              )}
              aria-label="Attach file"
            >
              <Paperclip className="h-5 w-5 text-text-secondary" />
            </button>

            {/* Text input */}
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message..."
                rows={1}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl resize-none',
                  'bg-surface-hover border border-border-subtle',
                  'text-base text-text-primary placeholder:text-text-tertiary',
                  'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                  'max-h-32 overflow-y-auto'
                )}
                style={{
                  minHeight: '44px',
                  height: 'auto',
                }}
              />
            </div>

            {/* Voice / Send button */}
            {isProcessing ? (
              <button
                onClick={handleAbort}
                className={cn(
                  'p-2 rounded-lg',
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
                  'p-2 rounded-lg',
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
                  'p-2 rounded-lg',
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

// Message bubble component
interface MessageBubbleProps {
  message: AgentMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const [isExpanded, setIsExpanded] = useState(true);

  // Check if message has tool calls with results
  const completedToolCalls =
    message.toolCalls?.filter((tc) => tc.status === 'completed' && tc.result) ?? [];
  const hasToolResults = completedToolCalls.length > 0;

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5',
          isUser
            ? 'bg-accent-primary text-text-inverse rounded-br-md'
            : 'bg-[#1a1a2e] border border-border-subtle text-text-primary rounded-bl-md'
        )}
      >
        {/* Message content */}
        {message.content && (
          <div className="text-sm">
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
          </div>
        )}

        {/* Thinking display */}
        {message.thinking && (
          <details className="mt-2 text-xs text-text-tertiary">
            <summary className="cursor-pointer hover:text-text-secondary">View thinking...</summary>
            <p className="mt-1 whitespace-pre-wrap">{message.thinking}</p>
          </details>
        )}
      </div>

      {/* Tool results (for assistant messages) */}
      {isAssistant && hasToolResults && (
        <div className="w-full max-w-[85%] mt-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              'flex items-center gap-1.5 text-xs text-text-tertiary',
              'hover:text-text-secondary transition-colors'
            )}
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', !isExpanded && '-rotate-90')}
            />
            <span>
              {completedToolCalls.length} tool{' '}
              {completedToolCalls.length === 1 ? 'result' : 'results'}
            </span>
          </button>

          {isExpanded && (
            <div className="mt-2 space-y-2">
              {completedToolCalls.map((toolCall) => (
                <ToolResultDisplay
                  key={toolCall.id}
                  toolName={toolCall.name}
                  result={toolCall.result}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timestamp */}
      <span className="text-2xs text-text-tertiary mt-1 px-1">{formatTime(message.timestamp)}</span>
    </div>
  );
}

function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
