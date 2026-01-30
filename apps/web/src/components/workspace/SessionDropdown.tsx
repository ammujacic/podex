'use client';

import React, { useMemo } from 'react';
import { Check, ChevronDown, MessageSquare, Plus } from 'lucide-react';
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
 * Dropdown for selecting and attaching conversation sessions.
 * Shows the current session name and time, with all available sessions in the dropdown.
 * All sessions are shown equally - a session can be attached to multiple agents.
 */
export function SessionDropdown({
  sessionId,
  agentId,
  currentConversation,
  onAttach,
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

  // Get other sessions (excluding current)
  const otherSessions = useMemo(() => {
    return conversationSessions.filter((conv) => conv.id !== currentConversation?.id);
  }, [conversationSessions, currentConversation?.id]);

  // Sort sessions by last message time (most recent first)
  const sortedSessions = useMemo(() => {
    return [...otherSessions].sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [otherSessions]);

  // Get agent name helper
  const getAgentName = (targetAgentId: string | null): string => {
    if (!targetAgentId) return '';
    const agent = session?.agents.find((a) => a.id === targetAgentId);
    return agent?.name || 'Unknown Agent';
  };

  // Get attached agents display for a session
  const getAttachedAgentsDisplay = (conv: ConversationSession): string | null => {
    const attachedAgentIds = conv.attachedAgentIds || [];
    // Don't show if attached to current agent (will be handled by current session display)
    const otherAgentIds = attachedAgentIds.filter((id) => id !== agentId);
    if (otherAgentIds.length === 0) return null;

    if (otherAgentIds.length === 1) {
      return getAgentName(otherAgentIds[0] ?? null);
    }
    return `${otherAgentIds.length} agents`;
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

        {/* All other sessions */}
        {sortedSessions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-text-muted">
              {currentConversation ? 'Other Sessions' : 'Sessions'}
            </DropdownMenuLabel>
            {sortedSessions.slice(0, 15).map((conv) => {
              const attachedDisplay = getAttachedAgentsDisplay(conv);
              return (
                <DropdownMenuItem
                  key={conv.id}
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => onAttach(conv.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="truncate max-w-[100px]">{conv.name}</span>
                    {attachedDisplay && (
                      <span className="text-xs text-text-muted truncate">({attachedDisplay})</span>
                    )}
                  </div>
                  <span className="text-xs text-text-muted">
                    {formatRelativeTime(conv.lastMessageAt)}
                  </span>
                </DropdownMenuItem>
              );
            })}
            {sortedSessions.length > 15 && (
              <DropdownMenuItem disabled className="text-xs text-text-muted">
                +{sortedSessions.length - 15} more sessions
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
