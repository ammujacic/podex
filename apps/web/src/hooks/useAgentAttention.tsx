'use client';

import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle, AlertCircle, MessageCircle, AlertTriangle } from 'lucide-react';
import { onSocketEvent, type AgentAttentionEvent, type AgentAttentionType } from '@/lib/socket';
import { useAttentionStore, type AgentAttention } from '@/stores/attention';
import { synthesizeSpeech } from '@/lib/api';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';

interface UseAgentAttentionOptions {
  sessionId: string;
  enabled?: boolean;
  showToasts?: boolean;
  useTTS?: boolean;
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
  } = useAttentionStore();

  const { playAudioBase64 } = useAudioPlayback({ sessionId });

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
    [sessionId, showToasts, addAttention, announceAttention, openPanel]
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
