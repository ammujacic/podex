'use client';

import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Loader2, StopCircle } from 'lucide-react';
import { cleanStreamingContent } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import type { StreamingMessage } from '@/stores/session';

interface AgentStreamingMessageProps {
  streamingMessage: StreamingMessage | undefined;
  isActive: boolean;
  showAbortedMessage: boolean;
}

/**
 * Displays streaming message content with thinking blocks.
 * Shows processing state, thinking content, and streaming text.
 */
export const AgentStreamingMessage = React.memo<AgentStreamingMessageProps>(
  function AgentStreamingMessage({ streamingMessage, isActive, showAbortedMessage }) {
    const [thinkingExpanded, setThinkingExpanded] = useState(false);

    // Show nothing if not active and no aborted message
    if (!isActive && !showAbortedMessage) return null;

    return (
      <div className="space-y-2">
        {/* Streaming thinking content - collapsible spoiler */}
        {streamingMessage?.thinkingContent && (
          <div className="max-w-[85%]">
            <button
              onClick={() => setThinkingExpanded(!thinkingExpanded)}
              className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors cursor-pointer py-1"
              aria-expanded={thinkingExpanded}
              aria-label={thinkingExpanded ? 'Collapse thinking' : 'Expand thinking'}
            >
              {thinkingExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <Brain className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
              <span>Thinking...</span>
              <span className="text-text-muted font-mono">
                ({Math.round(streamingMessage.thinkingContent.length / 4)} tokens)
              </span>
            </button>
            {thinkingExpanded && (
              <div className="mt-1.5 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {streamingMessage.thinkingContent}
                <span
                  className="inline-block w-1.5 h-3 bg-purple-400 animate-pulse ml-0.5 align-middle"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>
        )}

        {/* Main streaming content */}
        {isActive && (
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
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          <span>{displayContent}</span>
                        </div>
                      ) : (
                        <MarkdownRenderer content={displayContent} />
                      )}
                      <span
                        className="inline-block w-2 h-4 bg-accent-primary animate-pulse ml-0.5 align-middle"
                        aria-hidden="true"
                      />
                    </>
                  );
                })()
              ) : (
                <div className="flex items-center gap-2 text-text-secondary" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{streamingMessage?.thinkingContent ? 'Processing...' : 'Thinking...'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Stopped message when task was aborted */}
        {showAbortedMessage && !isActive && (
          <div className="flex gap-3">
            <div className="rounded-lg px-3 py-2 text-sm bg-elevated text-text-secondary max-w-[85%]">
              <div className="flex items-center gap-2" role="status">
                <StopCircle className="h-4 w-4" aria-hidden="true" />
                <span>Stopped</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
