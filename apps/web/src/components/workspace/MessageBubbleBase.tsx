'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/ui-utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolResultDisplay } from './ToolResultDisplay';
import type { AgentMessage } from '@/stores/session';

interface MessageBubbleBaseProps {
  message: AgentMessage;
  /** Enable mobile-optimized touch targets and styling */
  isMobile?: boolean;
  /** Callback when a file link is clicked in a message */
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}

/**
 * Shared message bubble component for displaying agent/user messages.
 * Used by both desktop MessageBubble and MobileMessageBubble.
 * Memoized to prevent unnecessary re-renders during streaming.
 */
export const MessageBubbleBase = React.memo<MessageBubbleBaseProps>(
  function MessageBubbleBase({ message, isMobile = false, onFileClick }) {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const [isExpanded, setIsExpanded] = useState(true);

    // Check if message has tool calls with results
    const completedToolCalls =
      message.toolCalls?.filter((tc) => tc.status === 'completed' && tc.result) ?? [];
    const hasToolResults = completedToolCalls.length > 0;

    // Check if message content is just a simple tool execution summary that can be hidden
    // when tool results are available (e.g., "Executed list_directory.", "Executed read_file.")
    const isBoilerplateToolMessage =
      hasToolResults && message.content && /^Executed \w+\.?$/i.test(message.content.trim());

    const toolResultsId = `tool-results-${message.id}`;

    // For tool-only messages, show results directly without the bubble wrapper
    if (isBoilerplateToolMessage) {
      return (
        <div
          className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
          role={isMobile ? undefined : 'listitem'}
        >
          <div className="w-full max-w-[85%] space-y-2">
            {completedToolCalls.map((toolCall) => (
              <ToolResultDisplay
                key={toolCall.id}
                toolName={toolCall.name}
                result={toolCall.result}
              />
            ))}
          </div>
          {/* Timestamp */}
          {isMobile ? (
            <span className="text-2xs text-text-tertiary mt-1 px-1">
              {formatTime(message.timestamp)}
            </span>
          ) : (
            <time
              className="text-2xs text-text-tertiary mt-1 px-1"
              dateTime={
                typeof message.timestamp === 'string'
                  ? message.timestamp
                  : message.timestamp.toISOString()
              }
            >
              {formatTime(message.timestamp)}
            </time>
          )}
        </div>
      );
    }

    return (
      <div
        className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
        role={isMobile ? undefined : 'listitem'}
      >
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
                <MarkdownRenderer content={message.content} onFileClick={onFileClick} />
              )}
            </div>
          )}

          {/* Thinking display */}
          {message.thinking && (
            <details className="mt-2 text-xs text-text-tertiary">
              <summary
                className={cn(
                  'cursor-pointer hover:text-text-secondary',
                  isMobile && 'min-h-[44px] py-2 touch-manipulation'
                )}
              >
                View thinking...
              </summary>
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
                'hover:text-text-secondary transition-colors',
                isMobile && 'min-h-[44px] py-2 touch-manipulation'
              )}
              aria-expanded={isMobile ? undefined : isExpanded}
              aria-controls={isMobile ? undefined : toolResultsId}
            >
              <ChevronDown
                className={cn(
                  'transition-transform',
                  isMobile ? 'h-4 w-4' : 'h-3.5 w-3.5',
                  !isExpanded && '-rotate-90'
                )}
                aria-hidden={isMobile ? undefined : true}
              />
              <span>
                {completedToolCalls.length} tool{' '}
                {completedToolCalls.length === 1 ? 'result' : 'results'}
              </span>
            </button>

            {isExpanded && (
              <div id={isMobile ? undefined : toolResultsId} className="mt-2 space-y-2">
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
        {isMobile ? (
          <span className="text-2xs text-text-tertiary mt-1 px-1">
            {formatTime(message.timestamp)}
          </span>
        ) : (
          <time
            className="text-2xs text-text-tertiary mt-1 px-1"
            dateTime={
              typeof message.timestamp === 'string'
                ? message.timestamp
                : message.timestamp.toISOString()
            }
          >
            {formatTime(message.timestamp)}
          </time>
        )}
      </div>
    );
  },
  // Custom comparison: re-render only if message content or tool calls changed
  (prevProps, nextProps) => {
    // isMobile prop doesn't change at runtime, so we only check message
    if (prevProps.isMobile !== nextProps.isMobile) {
      return false;
    }

    // Check onFileClick callback
    if (prevProps.onFileClick !== nextProps.onFileClick) {
      return false;
    }

    const prev = prevProps.message;
    const next = nextProps.message;

    // Check basic properties
    if (prev.id !== next.id || prev.content !== next.content || prev.thinking !== next.thinking) {
      return false;
    }

    // Check tool calls
    const prevToolCalls = prev.toolCalls ?? [];
    const nextToolCalls = next.toolCalls ?? [];

    if (prevToolCalls.length !== nextToolCalls.length) {
      return false;
    }

    return prevToolCalls.every(
      (tc, i) =>
        tc.id === nextToolCalls[i]?.id &&
        tc.status === nextToolCalls[i]?.status &&
        tc.result === nextToolCalls[i]?.result
    );
  }
);
