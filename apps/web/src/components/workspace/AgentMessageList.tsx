'use client';

import React, { useState, useCallback } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { cn, formatTimestamp } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolResultDisplay } from './ToolResultDisplay';
import { ClaudeEntryRenderer } from './ClaudeEntryRenderer';
import type { AgentMessage } from '@/stores/session';

interface AgentMessageListProps {
  messages: AgentMessage[];
  sessionId: string;
  agentId: string;
  /** Whether this is a Claude Code agent with full session sync */
  isClaudeCodeAgent?: boolean;
  /** Currently playing message ID */
  playingMessageId: string | null;
  /** Message ID being synthesized for TTS */
  synthesizingMessageId: string | null;
  /** Message ID being deleted */
  deletingMessageId: string | null;
  onDeleteMessage: (messageId: string) => void;
  onPlayMessage: (messageId: string, regenerate?: boolean) => void;
  onPlanApprove: (planId: string) => Promise<void>;
  onPlanReject: (planId: string) => Promise<void>;
  /** Callback when a file link is clicked in a message */
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}

/**
 * Renders the list of agent messages with tool calls, thinking blocks, and TTS controls.
 * Memoized to prevent unnecessary re-renders.
 */
export const AgentMessageList = React.memo<AgentMessageListProps>(
  function AgentMessageList({
    messages,
    isClaudeCodeAgent = false,
    playingMessageId,
    synthesizingMessageId,
    deletingMessageId,
    onDeleteMessage,
    onPlayMessage,
    onPlanApprove,
    onPlanReject,
    onFileClick,
  }) {
    const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

    const toggleThinking = useCallback((messageId: string) => {
      setExpandedThinking((prev) => ({
        ...prev,
        [messageId]: !prev[messageId],
      }));
    }, []);

    const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(null), 2000);
      } catch (err) {
        console.error('Failed to copy message:', err);
      }
    }, []);

    if (messages.length === 0) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          <p>No messages yet. Start a conversation.</p>
        </div>
      );
    }

    // For Claude Code agents, use the specialized renderer that handles all entry types
    if (isClaudeCodeAgent) {
      return (
        <>
          {messages.map((msg, index) => (
            <div key={msg.id || `msg-${index}`} className="space-y-1">
              <ClaudeEntryRenderer message={msg} onFileClick={onFileClick} />
            </div>
          ))}
        </>
      );
    }

    // Standard rendering for non-Claude Code agents
    return (
      <>
        {messages.map((msg, index) => (
          <div key={msg.id || `msg-${index}`} className="space-y-2 group/message">
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

            {/* Message bubble */}
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
                  <MarkdownRenderer content={msg.content} onFileClick={onFileClick} />
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
                    {/* Copy message button - visible on hover */}
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      aria-label="Copy message"
                      className={cn(
                        'rounded p-2 -m-1 min-w-[36px] min-h-[36px] flex items-center justify-center transition-colors opacity-0 group-hover/message:opacity-100 cursor-pointer',
                        msg.role === 'user'
                          ? 'hover:bg-white/20 text-text-inverse/60 hover:text-text-inverse'
                          : 'hover:bg-overlay text-text-muted hover:text-text-secondary',
                        copiedMessageId === msg.id && 'opacity-100 text-green-400'
                      )}
                      title={copiedMessageId === msg.id ? 'Copied!' : 'Copy message'}
                    >
                      {copiedMessageId === msg.id ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>

                    {/* Delete message button - visible on hover */}
                    <button
                      onClick={() => onDeleteMessage(msg.id)}
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
                          onClick={() => onPlayMessage(msg.id)}
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
                          onClick={() => onPlayMessage(msg.id, true)}
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
                          if (planId) await onPlanApprove(planId);
                        }}
                        onPlanReject={async (planId) => {
                          if (planId) await onPlanReject(planId);
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
        ))}
      </>
    );
  },
  // Custom comparison for memoization
  (prevProps, nextProps) => {
    return (
      prevProps.messages === nextProps.messages &&
      prevProps.isClaudeCodeAgent === nextProps.isClaudeCodeAgent &&
      prevProps.playingMessageId === nextProps.playingMessageId &&
      prevProps.synthesizingMessageId === nextProps.synthesizingMessageId &&
      prevProps.deletingMessageId === nextProps.deletingMessageId &&
      prevProps.onFileClick === nextProps.onFileClick
    );
  }
);
