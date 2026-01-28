'use client';

import React, { useMemo } from 'react';
import { Check, ChevronDown, MessageSquare, Plus, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { type ConversationSession, formatRelativeTime, useSessionStore } from '@/stores/session';
import { detachConversation } from '@/lib/api';
import { toast } from 'sonner';

interface SessionDropdownProps {
  /** Current session ID (workspace session) */
  sessionId: string;
  /** Current agent ID */
  agentId: string;
  /** Currently attached conversation session, if any */
  currentConversation: ConversationSession | null;
  /** Callback when a session is selected/attached */
  onAttach: (conversationId: string) => void;
  /** Callback when the current session is detached */
  onDetach: () => void;
  /** Callback when "New Session" is clicked */
  onCreateNew: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether the dropdown is disabled */
  disabled?: boolean;
}

/**
 * Dropdown for selecting, attaching, and detaching conversation sessions.
 * Shows the current session name and time, with available sessions in the dropdown.
 */
export function SessionDropdown({
  sessionId,
  agentId,
  currentConversation,
  onAttach,
  onDetach,
  onCreateNew,
  className,
  disabled,
}: SessionDropdownProps) {
  // Get all conversation sessions for this workspace
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const conversationSessions = useMemo(
    () => session?.conversationSessions ?? [],
    [session?.conversationSessions]
  );
  const detachConversationFromAgent = useSessionStore((state) => state.detachConversationFromAgent);

  // Separate sessions into attached and unattached (excluding current)
  const { attached, unattached } = useMemo(() => {
    const attachedSessions: ConversationSession[] = [];
    const unattachedSessions: ConversationSession[] = [];

    conversationSessions.forEach((conv) => {
      // Skip current conversation
      if (conv.id === currentConversation?.id) return;

      // Check if attached to any agent (use new field if available, fallback to legacy)
      const isAttached =
        (conv.attachedAgentIds && conv.attachedAgentIds.length > 0) ||
        conv.attachedToAgentId !== null;

      if (isAttached) {
        attachedSessions.push(conv);
      } else {
        unattachedSessions.push(conv);
      }
    });

    return { attached: attachedSessions, unattached: unattachedSessions };
  }, [conversationSessions, currentConversation?.id]);

  // Sort sessions by last message time (most recent first)
  const sortedAttachedSessions = useMemo(() => {
    return [...attached].sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [attached]);

  const sortedUnattachedSessions = useMemo(() => {
    return [...unattached].sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [unattached]);

  // Get agent name helper
  const getAgentName = (agentId: string | null): string => {
    if (!agentId) return '';
    const agent = session?.agents.find((a) => a.id === agentId);
    return agent?.name || 'Unknown Agent';
  };

  // Handle detach
  const handleDetach = async (
    e: React.MouseEvent,
    conversationId: string,
    attachedAgentId?: string
  ) => {
    e.stopPropagation(); // Prevent dropdown from closing
    try {
      // Optimistically update local state
      detachConversationFromAgent(sessionId, conversationId);

      // Call API to detach from the specific agent (if provided) or all agents
      await detachConversation(sessionId, conversationId, attachedAgentId);

      // If this was the current conversation, call onDetach callback
      if (conversationId === currentConversation?.id && onDetach) {
        onDetach();
      }

      toast.success('Session detached');
    } catch (error) {
      console.error('Failed to detach conversation:', error);
      toast.error('Failed to detach session');
      // WebSocket event will sync state if API call fails
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
            currentConversation
              ? 'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary'
              : 'bg-elevated/50 text-text-muted hover:bg-elevated hover:text-text-secondary',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          <MessageSquare className="h-3 w-3" />
          {currentConversation ? (
            <>
              <span className="max-w-[120px] truncate">{currentConversation.name}</span>
              <span className="text-text-muted">
                {formatRelativeTime(currentConversation.lastMessageAt)}
              </span>
            </>
          ) : (
            <span>No session</span>
          )}
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        {/* Current session */}
        {currentConversation && (
          <>
            <DropdownMenuLabel className="text-xs text-text-muted">
              Current Session
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="flex items-center justify-between cursor-pointer bg-accent-primary/10"
              onClick={() => {}} // No-op, just showing current
            >
              <div className="flex items-center gap-2">
                <Check className="h-3 w-3 text-accent-primary" />
                <span className="truncate max-w-[140px]">{currentConversation.name}</span>
              </div>
              <span className="text-xs text-text-muted">
                {formatRelativeTime(currentConversation.lastMessageAt)}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Attached sessions */}
        {sortedAttachedSessions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-text-muted">
              Attached Sessions
            </DropdownMenuLabel>
            {sortedAttachedSessions.slice(0, 10).map((conv) => {
              // Check if attached to current agent
              const attachedAgentIds =
                conv.attachedAgentIds || (conv.attachedToAgentId ? [conv.attachedToAgentId] : []);
              const isAttachedToCurrentAgent = attachedAgentIds.includes(agentId);

              return (
                <DropdownMenuItem
                  key={conv.id}
                  className={cn(
                    'flex items-center justify-between group',
                    isAttachedToCurrentAgent
                      ? 'cursor-default bg-accent-primary/5'
                      : 'cursor-pointer'
                  )}
                  onClick={() => {
                    if (!isAttachedToCurrentAgent) {
                      onAttach(conv.id);
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="truncate max-w-[100px]">{conv.name}</span>
                    {attachedAgentIds.length > 0 && (
                      <span className="text-xs text-text-muted truncate">
                        (
                        {attachedAgentIds.length === 1
                          ? getAgentName(attachedAgentIds[0] ?? null)
                          : `${attachedAgentIds.length} agents`}
                        )
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-text-muted">
                      {formatRelativeTime(conv.lastMessageAt)}
                    </span>
                    {!isAttachedToCurrentAgent && (
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-overlay rounded transition-opacity"
                        onClick={(e) => handleDetach(e, conv.id, agentId)}
                        title="Detach session from this agent"
                      >
                        <X className="h-3 w-3 text-text-muted hover:text-text-primary" />
                      </button>
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
            {sortedAttachedSessions.length > 10 && (
              <DropdownMenuItem disabled className="text-xs text-text-muted">
                +{sortedAttachedSessions.length - 10} more attached sessions
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Available (unattached) sessions */}
        {sortedUnattachedSessions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-text-muted">
              Available Sessions
            </DropdownMenuLabel>
            {sortedUnattachedSessions.slice(0, 10).map((conv) => (
              <DropdownMenuItem
                key={conv.id}
                className="flex items-center justify-between cursor-pointer"
                onClick={() => onAttach(conv.id)}
              >
                <span className="truncate max-w-[140px]">{conv.name}</span>
                <span className="text-xs text-text-muted">
                  {formatRelativeTime(conv.lastMessageAt)}
                </span>
              </DropdownMenuItem>
            ))}
            {sortedUnattachedSessions.length > 10 && (
              <DropdownMenuItem disabled className="text-xs text-text-muted">
                +{sortedUnattachedSessions.length - 10} more sessions
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Create new */}
        <DropdownMenuItem
          className="flex items-center gap-2 cursor-pointer text-accent-primary"
          onClick={onCreateNew}
        >
          <Plus className="h-3 w-3" />
          <span>New Session</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
