'use client';

import React, { useRef, useCallback } from 'react';
import { Send, Mic, Paperclip, Loader2, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentInputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoiceToggle: () => void;
  onAbort?: () => void;
  isSubmitting?: boolean;
  isProcessing?: boolean;
  placeholder?: string;
  /** For Claude Code agents - callback when "/" is typed at start of input */
  onSlashCommandStart?: () => void;
  /** Whether this is a Claude Code agent (enables slash command detection) */
  isClaudeCodeAgent?: boolean;
}

/**
 * Input area component for agent chat.
 * Supports text input, voice input, and file attachments (coming soon).
 * Memoized to prevent unnecessary re-renders from parent state changes.
 */
export const AgentInputArea = React.memo<AgentInputAreaProps>(function AgentInputArea({
  value,
  onChange,
  onSubmit,
  onVoiceToggle,
  onAbort,
  isSubmitting = false,
  isProcessing = false,
  placeholder = 'Message...',
  onSlashCommandStart,
  isClaudeCodeAgent = false,
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }

    // Detect "/" at start of empty input for Claude Code agents
    if (isClaudeCodeAgent && onSlashCommandStart && e.key === '/' && value.trim() === '') {
      e.preventDefault();
      onChange('/');
      onSlashCommandStart();
    }
  };

  // Auto-resize textarea based on content
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // Reset height to auto to get the correct scrollHeight
      e.target.style.height = 'auto';
      // Set height to scrollHeight, capped at max-height (128px)
      e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
    },
    [onChange]
  );

  const hasInput = value.trim().length > 0;

  return (
    <div className="flex items-center gap-2">
      {/* Attachment button - disabled until feature is implemented */}
      <button
        disabled
        className={cn(
          'p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center',
          'text-text-tertiary opacity-50 cursor-not-allowed',
          'transition-colors touch-manipulation'
        )}
        aria-label="Attach file (coming soon)"
      >
        <Paperclip className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Text input */}
      <div className="flex-1 relative">
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={isSubmitting}
          className={cn(
            'w-full px-4 py-2.5 rounded-xl resize-none',
            'bg-surface-hover border border-border-subtle',
            'text-base text-text-primary placeholder:text-text-tertiary',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
            'overflow-y-auto disabled:opacity-50',
            'transition-colors'
          )}
          style={{
            minHeight: '44px',
            maxHeight: '128px',
          }}
          aria-label="Message input"
        />
      </div>

      {/* Voice / Send / Stop button */}
      {isProcessing && onAbort ? (
        <button
          onClick={onAbort}
          className={cn(
            'p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center',
            'bg-status-error/10 text-status-error',
            'hover:bg-status-error/20',
            'transition-colors touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-status-error focus:ring-offset-1'
          )}
          aria-label="Stop agent"
        >
          <StopCircle className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : hasInput ? (
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className={cn(
            'p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center',
            'bg-accent-primary text-text-inverse',
            'hover:bg-accent-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-colors touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-1'
          )}
          aria-label="Send message"
        >
          {isSubmitting ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      ) : (
        <button
          onClick={onVoiceToggle}
          className={cn(
            'p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation',
            'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-1'
          )}
          aria-label="Start voice input"
        >
          <Mic className="h-5 w-5 text-text-secondary" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
