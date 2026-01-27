'use client';

import React, { useMemo } from 'react';
import { Check, ChevronDown, MessageSquare, Plus, Unplug } from 'lucide-react';
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
 * Dropdown for selecting, attaching, and detaching conversation sessions.
 * Shows the current session name and time, with available sessions in the dropdown.
 */
export function SessionDropdown({
  sessionId,
  agentId: _agentId,
  currentConversation,
  onAttach,
  onDetach,
  onCreateNew,
  className,
  disabled,
}: SessionDropdownProps) {
  // Get all conversation sessions for this workspace
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const conversationSessions = session?.conversationSessions ?? [];

  // Filter to available (unattached) sessions, excluding the current one
  const availableSessions = useMemo(() => {
    return conversationSessions.filter(
      (c) => c.attachedToAgentId === null && c.id !== currentConversation?.id
    );
  }, [conversationSessions, currentConversation?.id]);

  // Sort available sessions by last message time (most recent first)
  const sortedAvailableSessions = useMemo(() => {
    return [...availableSessions].sort((a, b) => {
      const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [availableSessions]);

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
            <DropdownMenuItem
              className="flex items-center gap-2 cursor-pointer text-text-muted hover:text-text-secondary"
              onClick={onDetach}
            >
              <Unplug className="h-3 w-3" />
              <span>Detach session</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Available sessions */}
        {sortedAvailableSessions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs text-text-muted">
              Available Sessions
            </DropdownMenuLabel>
            {sortedAvailableSessions.slice(0, 10).map((conv) => (
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
            {sortedAvailableSessions.length > 10 && (
              <DropdownMenuItem disabled className="text-xs text-text-muted">
                +{sortedAvailableSessions.length - 10} more sessions
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
