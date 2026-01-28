/**
 * React hook for agent WebSocket communication.
 */

import { useEffect, useCallback } from 'react';
import {
  useSessionStore,
  type AgentMessage,
  type AgentMode,
  type ConversationSession,
  type ToolCall,
} from '@/stores/session';
import { useStoreCallbacks } from './useStoreCallbacks';
import {
  connectSocket,
  joinSession,
  leaveSession,
  onSocketEvent,
  type AgentMessageEvent,
  type AgentStatusEvent,
  type AgentStreamStartEvent,
  type AgentTokenEvent,
  type AgentThinkingTokenEvent,
  type AgentStreamEndEvent,
  type AgentConfigUpdateEvent,
  type WorkspaceStatusEvent,
  type WorkspaceBillingStandbyEvent,
  type ConversationCreatedEvent,
  type ConversationUpdatedEvent,
  type ConversationDeletedEvent,
  type ConversationAttachedEvent,
  type ConversationDetachedEvent,
  type ConversationMessageEvent,
} from '@/lib/socket';
import { sendAgentMessage } from '@/lib/api';
import { toast } from 'sonner';
import { useBillingStore } from '@/stores/billing';

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
  // Get store methods directly - Zustand selectors are stable and efficient
  const addConversationMessage = useSessionStore((state) => state.addConversationMessage);
  const getConversationForAgent = useSessionStore((state) => state.getConversationForAgent);
  const handleConversationEvent = useSessionStore((state) => state.handleConversationEvent);
  const updateAgent = useSessionStore((state) => state.updateAgent);
  const handleAutoModeSwitch = useSessionStore((state) => state.handleAutoModeSwitch);
  const startStreamingMessage = useSessionStore((state) => state.startStreamingMessage);
  const appendStreamingToken = useSessionStore((state) => state.appendStreamingToken);
  const appendThinkingToken = useSessionStore((state) => state.appendThinkingToken);
  const finalizeStreamingMessage = useSessionStore((state) => state.finalizeStreamingMessage);
  const setWorkspaceStatus = useSessionStore((state) => state.setWorkspaceStatus);

  // Use stable ref for callbacks to avoid re-running effects
  const callbacksRef = useStoreCallbacks({
    addConversationMessage,
    getConversationForAgent,
    updateAgent,
    handleAutoModeSwitch,
    startStreamingMessage,
    appendStreamingToken,
    appendThinkingToken,
    finalizeStreamingMessage,
    setWorkspaceStatus,
    handleConversationEvent,
  });

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

      // Guard against missing session - may happen during initial load
      if (!session) {
        return; // Can't add message without session
      }

      const agent = session.agents.find((a) => a.id === data.agent_id);

      // Guard against missing agent - may happen if agent was just created
      if (!agent) {
        return; // Can't add message without agent
      }

      // Get the conversation session for this agent
      const conversation = callbacksRef.current.getConversationForAgent(sessionId, data.agent_id);
      if (!conversation) {
        // No conversation attached to this agent yet - skip
        // Messages will be added when user sends first message and creates a conversation
        return;
      }

      // Check by ID first - skip if exact ID already exists
      const existingById = conversation.messages.find((m: AgentMessage) => m.id === data.id);
      if (existingById) {
        return; // Skip duplicate
      }

      // IMPORTANT: All other deduplication is handled atomically by addConversationMessage.
      // The store's addConversationMessage uses Zustand's set() which receives
      // current state at execution time, avoiding stale snapshot issues.

      const message: AgentMessage = {
        id: data.id,
        role: data.role,
        content: data.content,
        timestamp: data.created_at ? new Date(data.created_at) : new Date(),
        // Include tool calls if present
        toolCalls: data.tool_calls || undefined,
      };

      callbacksRef.current.addConversationMessage(sessionId, conversation.id, message);
    });

    // Handle agent status changes
    const unsubStatus = onSocketEvent('agent_status', (data: AgentStatusEvent) => {
      if (data.session_id !== sessionId) return;
      callbacksRef.current.updateAgent(sessionId, data.agent_id, { status: data.status });
    });

    // Handle streaming: stream start
    const unsubStreamStart = onSocketEvent('agent_stream_start', (data: AgentStreamStartEvent) => {
      if (data.session_id !== sessionId) return;
      callbacksRef.current.startStreamingMessage(sessionId, data.agent_id, data.message_id);
      // Set agent status to active when streaming starts
      callbacksRef.current.updateAgent(sessionId, data.agent_id, { status: 'active' });
    });

    // Handle streaming: individual tokens
    const unsubStreamToken = onSocketEvent('agent_token', (data: AgentTokenEvent) => {
      if (data.session_id !== sessionId) return;
      callbacksRef.current.appendStreamingToken(data.message_id, data.token);
    });

    // Handle streaming: thinking tokens (for collapsible thinking display)
    const unsubThinkingToken = onSocketEvent(
      'agent_thinking_token',
      (data: AgentThinkingTokenEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.appendThinkingToken(data.message_id, data.thinking);
      }
    );

    // Handle streaming: stream end
    const unsubStreamEnd = onSocketEvent('agent_stream_end', (data: AgentStreamEndEvent) => {
      if (data.session_id !== sessionId) return;
      // Include tool_calls when finalizing the streaming message
      callbacksRef.current.finalizeStreamingMessage(
        data.message_id,
        data.full_content || '',
        data.tool_calls || undefined
      );
      // Set agent status to idle when streaming ends
      callbacksRef.current.updateAgent(sessionId, data.agent_id, { status: 'idle' });
    });

    // Handle CLI agent config updates (bi-directional sync)
    const unsubConfigUpdate = onSocketEvent(
      'agent_config_update',
      (data: AgentConfigUpdateEvent) => {
        if (data.session_id !== sessionId) return;

        // Map backend field names to frontend agent state
        const agentUpdates: Partial<Parameters<typeof callbacksRef.current.updateAgent>[2]> = {};

        if (data.updates.model) {
          agentUpdates.model = data.updates.model;
        }
        if (data.updates.mode) {
          agentUpdates.mode = data.updates.mode as AgentMode;
        }
        if (
          data.updates.thinking_enabled !== undefined ||
          data.updates.thinking_budget !== undefined
        ) {
          agentUpdates.thinkingConfig = {
            enabled: data.updates.thinking_enabled ?? false,
            budgetTokens: data.updates.thinking_budget ?? 10000,
          };
        }

        // Only update if there are changes
        if (Object.keys(agentUpdates).length > 0) {
          callbacksRef.current.updateAgent(sessionId, data.agent_id, agentUpdates);
        }
      }
    );

    // Handle workspace status changes (running, stopped, error, offline, etc.)
    const unsubWorkspaceStatus = onSocketEvent('workspace_status', (data: WorkspaceStatusEvent) => {
      // Update the session's workspace status in the store
      callbacksRef.current.setWorkspaceStatus(sessionId, data.status);

      // Show toast notification for status changes
      if (data.status === 'stopped') {
        toast.info('Workspace stopped', {
          description: 'Your workspace was stopped. Click Start to continue.',
        });
      } else if (data.status === 'offline') {
        toast.warning('Local pod disconnected', {
          description:
            'Your local pod has gone offline. The workspace will reconnect automatically when the pod comes back online.',
        });
      } else if (data.status === 'error' && data.error) {
        toast.error('Workspace error', {
          description: data.error,
        });
      }
    });

    // Handle billing stop events (credit exhaustion)
    // Handle conversation session lifecycle events
    const unsubConversationCreated = onSocketEvent(
      'conversation_created',
      (data: ConversationCreatedEvent) => {
        if (data.session_id !== sessionId) return;

        const conv = data.conversation;
        callbacksRef.current.handleConversationEvent(sessionId, 'conversation_created', {
          conversation: {
            id: conv.id,
            name: conv.name,
            messages: [],
            attachedToAgentId: conv.attached_to_agent_id,
            messageCount: conv.message_count,
            lastMessageAt: conv.last_message_at,
            createdAt: conv.created_at,
            updatedAt: conv.updated_at,
          } as ConversationSession,
        });
      }
    );

    const unsubConversationUpdated = onSocketEvent(
      'conversation_updated',
      (data: ConversationUpdatedEvent) => {
        if (data.session_id !== sessionId) return;
        const conv = data.conversation;
        callbacksRef.current.handleConversationEvent(sessionId, 'conversation_updated', {
          conversation: {
            id: conv.id,
            name: conv.name,
            attachedToAgentId: conv.attached_to_agent_id,
            messageCount: conv.message_count ?? 0,
            lastMessageAt: conv.last_message_at ?? null,
            createdAt: conv.created_at ?? new Date().toISOString(),
            updatedAt: conv.updated_at ?? new Date().toISOString(),
            messages: [],
          } as ConversationSession,
        });
      }
    );

    const unsubConversationDeleted = onSocketEvent(
      'conversation_deleted',
      (data: ConversationDeletedEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.handleConversationEvent(sessionId, 'conversation_deleted', {
          conversation_id: data.conversation_id,
        });
      }
    );

    const unsubConversationAttached = onSocketEvent(
      'conversation_attached',
      (data: ConversationAttachedEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.handleConversationEvent(sessionId, 'conversation_attached', {
          conversation_id: data.conversation_id,
          agent_id: data.agent_id,
        });
      }
    );

    const unsubConversationDetached = onSocketEvent(
      'conversation_detached',
      (data: ConversationDetachedEvent) => {
        if (data.session_id !== sessionId) return;
        callbacksRef.current.handleConversationEvent(sessionId, 'conversation_detached', {
          conversation_id: data.conversation_id,
          previous_agent_id: data.previous_agent_id,
        });
      }
    );

    const unsubConversationMessage = onSocketEvent(
      'conversation_message',
      (data: ConversationMessageEvent) => {
        if (data.session_id !== sessionId) return;

        const backendMsg = data.message;
        const agentMessage: AgentMessage = {
          id: backendMsg.id,
          role: backendMsg.role === 'system' ? 'assistant' : backendMsg.role,
          content: backendMsg.content,
          thinking: backendMsg.thinking ?? undefined,
          // Backend tool_calls is an arbitrary record; we don't have full typing here,
          // so leave toolCalls undefined to avoid type mismatches.
          toolCalls: undefined as ToolCall[] | undefined,
          timestamp: new Date(backendMsg.created_at),
        };

        // Use addConversationMessage directly instead of handleConversationEvent
        // This ensures proper deduplication logic is applied
        callbacksRef.current.addConversationMessage(sessionId, data.conversation_id, agentMessage);
      }
    );
    const unsubBillingStandby = onSocketEvent(
      'workspace_billing_standby',
      (data: WorkspaceBillingStandbyEvent) => {
        // Update the session's workspace status in the store
        callbacksRef.current.setWorkspaceStatus(sessionId, 'stopped');

        // Show the credit exhausted modal
        useBillingStore.getState().showCreditExhaustedModal({
          error_code: 'CREDITS_EXHAUSTED',
          message: data.message,
          quota_remaining: 0,
          credits_remaining: 0,
          resource_type: 'compute',
          upgrade_url: data.upgrade_url,
          add_credits_url: data.add_credits_url,
        });

        // Also show a toast as backup notification
        toast.warning('Workspace paused - credits exhausted', {
          description: data.message,
          duration: 10000,
        });
      }
    );

    // Cleanup on unmount
    return () => {
      unsubMessage();
      unsubStatus();
      unsubStreamStart();
      unsubStreamToken();
      unsubThinkingToken();
      unsubStreamEnd();
      unsubConfigUpdate();
      unsubWorkspaceStatus();
      unsubBillingStandby();
      unsubConversationCreated();
      unsubConversationUpdated();
      unsubConversationDeleted();
      unsubConversationAttached();
      unsubConversationDetached();
      unsubConversationMessage();
      leaveSession(sessionId, userId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
