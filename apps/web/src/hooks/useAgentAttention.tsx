'use client';

import { useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle, AlertCircle, MessageCircle, AlertTriangle } from 'lucide-react';
import { onSocketEvent, type AgentAttentionEvent, type AgentAttentionType } from '@/lib/socket';
import { useAttentionStore, type AgentAttention } from '@/stores/attention';
import { synthesizeSpeech, markAttentionRead, getAttentionItems } from '@/lib/api';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useOnFocusReturn, useVisibilityStore } from '@/hooks/useVisibilityTracking';

interface UseAgentAttentionOptions {
  sessionId: string;
  enabled?: boolean;
  showToasts?: boolean;
  useTTS?: boolean;
  /** Auto-mark notifications as read when tab regains focus. Default: true */
  autoMarkReadOnFocus?: boolean;
}

// Map attention types to icons
const ATTENTION_ICONS: Record<AgentAttentionType, LucideIcon> = {
  needs_approval: AlertTriangle,
  completed: CheckCircle,
  error: AlertCircle,
  waiting_input: MessageCircle,
};

// Map attention types to colors
const ATTENTION_COLORS: Record<AgentAttentionType, string> = {
  needs_approval: 'text-yellow-500',
  completed: 'text-green-500',
  error: 'text-red-500',
  waiting_input: 'text-blue-500',
};

/**
 * Generate a spoken announcement for TTS.
 */
function getSpokenAnnouncement(attention: AgentAttentionEvent): string {
  switch (attention.type) {
    case 'needs_approval':
      return `${attention.agent_name} needs your approval. ${attention.message}`;
    case 'completed':
      return `${attention.agent_name} has completed a task. ${attention.title}`;
    case 'error':
      return `${attention.agent_name} encountered an error and needs your attention.`;
    case 'waiting_input':
      return `${attention.agent_name} is waiting for your input.`;
    default:
      return `${attention.agent_name} needs your attention.`;
  }
}

/**
 * Hook to handle agent attention notifications.
 *
 * Subscribes to agent_attention socket events, adds them to the attention store,
 * shows toast notifications, and optionally announces via TTS.
 *
 * @example
 * useAgentAttention({
 *   sessionId: 'abc-123',
 *   showToasts: true,
 *   useTTS: true,
 * });
 */
export function useAgentAttention({
  sessionId,
  enabled = true,
  showToasts = true,
  useTTS = true,
  autoMarkReadOnFocus = true,
}: UseAgentAttentionOptions) {
  const {
    addAttention,
    markAsRead,
    dismissAttention,
    dismissAllForAgent,
    ttsEnabled,
    announcePriorities,
    getAttentionsForSession,
    getUnreadCount,
    openPanel,
    panelOpen,
  } = useAttentionStore();

  const { playAudioBase64 } = useAudioPlayback({ sessionId });
  const isFocused = useVisibilityStore((state) => state.isFocused);

  // Load persisted attention items on mount
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    getAttentionItems(sessionId)
      .then((response) => {
        if (cancelled) return;

        response.items.forEach((item) => {
          addAttention({
            id: item.id,
            agentId: item.agent_id,
            agentName: item.agent_name,
            sessionId: item.session_id,
            type: item.attention_type,
            title: item.title,
            message: item.message,
            metadata: item.metadata ?? undefined,
            priority: item.priority,
            read: item.is_read,
            dismissed: item.is_dismissed,
            createdAt: new Date(item.created_at),
            expiresAt: item.expires_at ? new Date(item.expires_at) : undefined,
          });
        });
      })
      .catch((error) => {
        console.error('Failed to load attention history:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, sessionId, addAttention]);

  // Track IDs of notifications that arrived while unfocused
  const unfocusedNotificationIds = useRef<Set<string>>(new Set());

  // Auto-mark notifications as read when user returns focus
  // Only mark if the notification panel is open OR user has been away for a while
  useOnFocusReturn(
    useCallback(
      (unfocusedDuration) => {
        if (!autoMarkReadOnFocus || !enabled) return;

        const unreadCount = getUnreadCount(sessionId);
        if (unreadCount === 0) return;

        // If panel is open or user was away for more than 5 seconds,
        // mark all notifications that arrived while unfocused as read
        if (panelOpen || unfocusedDuration > 5000) {
          // Mark all as read (they've been "seen" by returning to the tab)
          const attentions = getAttentionsForSession(sessionId);
          const unreadIds = attentions.filter((a) => !a.read).map((a) => a.id);

          // Mark locally and sync with backend
          unreadIds.forEach((id) => {
            markAsRead(sessionId, id);
            // Fire and forget backend sync
            markAttentionRead(sessionId, id).catch((err) => {
              console.error('Failed to sync attention read status:', err);
            });
          });

          // Clear tracked unfocused notifications
          unfocusedNotificationIds.current.clear();
        }
      },
      [
        autoMarkReadOnFocus,
        enabled,
        sessionId,
        panelOpen,
        getUnreadCount,
        getAttentionsForSession,
        markAsRead,
      ]
    ),
    { minUnfocusedTime: 1000, enabled: autoMarkReadOnFocus && enabled }
  );

  // Track notifications that arrive while unfocused
  const trackUnfocusedNotification = useCallback(
    (attentionId: string) => {
      if (!isFocused) {
        unfocusedNotificationIds.current.add(attentionId);
      }
    },
    [isFocused]
  );

  // Announce attention via TTS
  const announceAttention = useCallback(
    async (attention: AgentAttentionEvent) => {
      if (!useTTS || !ttsEnabled) return;
      if (!announcePriorities.includes(attention.priority)) return;

      const announcement = getSpokenAnnouncement(attention);

      try {
        const result = await synthesizeSpeech(sessionId, announcement);
        if (result?.audio_b64) {
          playAudioBase64(`attention-${attention.id}`, result.audio_b64, 'audio/mpeg');
        }
      } catch (error) {
        console.error('Failed to synthesize attention announcement:', error);
      }
    },
    [sessionId, useTTS, ttsEnabled, announcePriorities, playAudioBase64]
  );

  // Handle incoming attention event
  const handleAttentionEvent = useCallback(
    (event: AgentAttentionEvent) => {
      if (event.session_id !== sessionId) return;

      // Transform and add to store
      const attention: AgentAttention = {
        id: event.id,
        agentId: event.agent_id,
        agentName: event.agent_name,
        sessionId: event.session_id,
        type: event.type,
        title: event.title,
        message: event.message,
        priority: event.priority,
        metadata: event.metadata,
        read: false,
        dismissed: false,
        createdAt: new Date(event.created_at),
      };

      addAttention(attention);

      // Track if this arrived while unfocused
      trackUnfocusedNotification(event.id);

      // Show toast notification
      if (showToasts) {
        const Icon = ATTENTION_ICONS[event.type];
        const colorClass = ATTENTION_COLORS[event.type];

        toast(event.title, {
          description: event.message,
          icon: <Icon className={`h-5 w-5 ${colorClass}`} />,
          action:
            event.type === 'needs_approval'
              ? {
                  label: 'View',
                  onClick: () => {
                    openPanel();
                  },
                }
              : undefined,
          duration: event.priority === 'critical' ? 10000 : 5000,
        });
      }

      // Announce via TTS
      announceAttention(event);
    },
    [sessionId, showToasts, addAttention, announceAttention, openPanel, trackUnfocusedNotification]
  );

  // Handle attention read event (from other clients)
  const handleAttentionRead = useCallback(
    (event: { session_id: string; attention_id: string }) => {
      if (event.session_id !== sessionId) return;
      markAsRead(sessionId, event.attention_id);
    },
    [sessionId, markAsRead]
  );

  // Handle attention dismiss event (from other clients)
  const handleAttentionDismiss = useCallback(
    (event: { session_id: string; attention_id: string; agent_id: string | null }) => {
      if (event.session_id !== sessionId) return;

      if (event.agent_id && !event.attention_id) {
        // Dismiss all for agent
        dismissAllForAgent(sessionId, event.agent_id);
      } else {
        dismissAttention(sessionId, event.attention_id);
      }
    },
    [sessionId, dismissAttention, dismissAllForAgent]
  );

  // Handle dismiss all event
  const handleAttentionDismissAll = useCallback(
    (event: { session_id: string }) => {
      if (event.session_id !== sessionId) return;
      useAttentionStore.getState().dismissAllForSession(sessionId);
    },
    [sessionId]
  );

  // Subscribe to socket events
  useEffect(() => {
    if (!enabled) return;

    const unsubscribers = [
      onSocketEvent('agent_attention', handleAttentionEvent),
      onSocketEvent('agent_attention_read', handleAttentionRead),
      onSocketEvent('agent_attention_dismiss', handleAttentionDismiss),
      onSocketEvent('agent_attention_dismiss_all', handleAttentionDismissAll),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    enabled,
    handleAttentionEvent,
    handleAttentionRead,
    handleAttentionDismiss,
    handleAttentionDismissAll,
  ]);

  return {
    attentions: getAttentionsForSession(sessionId),
    unreadCount: getUnreadCount(sessionId),
    markAsRead: (attentionId: string) => markAsRead(sessionId, attentionId),
    dismiss: (attentionId: string) => dismissAttention(sessionId, attentionId),
  };
}
