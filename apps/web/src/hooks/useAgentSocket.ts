/**
 * React hook for agent WebSocket communication.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useSessionStore, type AgentMessage, type AgentMode } from '@/stores/session';
import {
  connectSocket,
  joinSession,
  leaveSession,
  onSocketEvent,
  type AgentMessageEvent,
  type AgentStatusEvent,
  type AgentStreamStartEvent,
  type AgentTokenEvent,
  type AgentStreamEndEvent,
  type AgentAutoModeSwitchEvent,
} from '@/lib/socket';
import { sendAgentMessage } from '@/lib/api';
import { toast } from 'sonner';

interface UseAgentSocketOptions {
  sessionId: string;
  userId: string;
  authToken?: string;
}

/**
 * Hook to manage Socket.IO connection for agent messaging.
 * Automatically joins/leaves session rooms and updates store on events.
 */
export function useAgentSocket({ sessionId, userId, authToken }: UseAgentSocketOptions) {
  // Use refs to avoid effect re-runs when store selectors change
  const addAgentMessageRef = useRef(useSessionStore.getState().addAgentMessage);
  const updateAgentRef = useRef(useSessionStore.getState().updateAgent);
  const handleAutoModeSwitchRef = useRef(useSessionStore.getState().handleAutoModeSwitch);
  // Streaming refs
  const startStreamingMessageRef = useRef(useSessionStore.getState().startStreamingMessage);
  const appendStreamingTokenRef = useRef(useSessionStore.getState().appendStreamingToken);
  const finalizeStreamingMessageRef = useRef(useSessionStore.getState().finalizeStreamingMessage);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe((state) => {
      addAgentMessageRef.current = state.addAgentMessage;
      updateAgentRef.current = state.updateAgent;
      handleAutoModeSwitchRef.current = state.handleAutoModeSwitch;
      startStreamingMessageRef.current = state.startStreamingMessage;
      appendStreamingTokenRef.current = state.appendStreamingToken;
      finalizeStreamingMessageRef.current = state.finalizeStreamingMessage;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!sessionId || !userId) return;

    // Connect to socket and join session
    connectSocket();
    joinSession(sessionId, userId, authToken);

    // Handle incoming agent messages
    const unsubMessage = onSocketEvent('agent_message', (data: AgentMessageEvent) => {
      if (data.session_id !== sessionId) return;

      // Check if message already exists (avoid duplicates from optimistic updates)
      const session = useSessionStore.getState().sessions[sessionId];
      const agent = session?.agents.find((a) => a.id === data.agent_id);

      // Check by ID first
      const existingById = agent?.messages.find((m) => m.id === data.id);
      if (existingById) {
        return; // Skip duplicate
      }

      // For user messages, also check by content (optimistic messages have temp-xxx IDs)
      if (data.role === 'user') {
        const existingByContent = agent?.messages.find(
          (m) => m.role === 'user' && m.content === data.content && m.id.startsWith('temp-')
        );
        if (existingByContent) {
          // Replace temp message with real one (update ID)
          const { updateMessageId } = useSessionStore.getState();
          if (updateMessageId) {
            updateMessageId(sessionId, data.agent_id, existingByContent.id, data.id);
          }
          return; // Don't add duplicate
        }
      }

      const message: AgentMessage = {
        id: data.id,
        role: data.role,
        content: data.content,
        timestamp: new Date(data.created_at),
        // Include tool calls if present
        toolCalls: data.tool_calls || undefined,
      };

      addAgentMessageRef.current(sessionId, data.agent_id, message);
    });

    // Handle agent status changes
    const unsubStatus = onSocketEvent('agent_status', (data: AgentStatusEvent) => {
      if (data.session_id !== sessionId) return;

      updateAgentRef.current(sessionId, data.agent_id, { status: data.status });
    });

    // Handle automatic mode switch notifications
    const unsubModeSwitch = onSocketEvent(
      'agent_auto_mode_switch',
      (data: AgentAutoModeSwitchEvent) => {
        if (data.session_id !== sessionId) return;

        // Update the store with new mode
        handleAutoModeSwitchRef.current(
          sessionId,
          data.agent_id,
          data.new_mode as AgentMode,
          data.auto_revert ? (data.old_mode as AgentMode) : null
        );

        // Show toast notification
        const modeLabels: Record<string, string> = {
          plan: 'Plan',
          ask: 'Ask',
          auto: 'Auto',
          sovereign: 'Sovereign',
        };
        const newModeLabel = modeLabels[data.new_mode] || data.new_mode;

        if (data.auto_revert) {
          // This is an auto-switch that will revert later
          toast.info(`${data.agent_name} switched to ${newModeLabel} mode`, {
            description: data.reason,
          });
        } else {
          // This is a revert back to original mode
          toast.info(`${data.agent_name} returned to ${newModeLabel} mode`, {
            description: 'Task completed',
          });
        }
      }
    );

    // Handle streaming: stream start
    const unsubStreamStart = onSocketEvent('agent_stream_start', (data: AgentStreamStartEvent) => {
      if (data.session_id !== sessionId) return;
      startStreamingMessageRef.current(sessionId, data.agent_id, data.message_id);
      // Set agent status to active when streaming starts
      updateAgentRef.current(sessionId, data.agent_id, { status: 'active' });
    });

    // Handle streaming: individual tokens
    const unsubStreamToken = onSocketEvent('agent_token', (data: AgentTokenEvent) => {
      if (data.session_id !== sessionId) return;
      appendStreamingTokenRef.current(data.message_id, data.token);
    });

    // Handle streaming: stream end
    const unsubStreamEnd = onSocketEvent('agent_stream_end', (data: AgentStreamEndEvent) => {
      if (data.session_id !== sessionId) return;
      finalizeStreamingMessageRef.current(data.message_id, data.full_content || '');
      // Set agent status to idle when streaming ends
      updateAgentRef.current(sessionId, data.agent_id, { status: 'idle' });
    });

    // Cleanup on unmount
    return () => {
      unsubMessage();
      unsubStatus();
      unsubModeSwitch();
      unsubStreamStart();
      unsubStreamToken();
      unsubStreamEnd();
      leaveSession(sessionId, userId);
    };
  }, [sessionId, userId, authToken]);
}

/**
 * Hook to send messages to an agent via API.
 * Uses the authenticated API client from api.ts.
 */
export function useSendAgentMessage(sessionId: string) {
  const sendMessage = useCallback(
    async (agentId: string, content: string): Promise<void> => {
      // Use the API client which handles auth tokens and error handling properly
      await sendAgentMessage(sessionId, agentId, content);
    },
    [sessionId]
  );

  return { sendMessage };
}
