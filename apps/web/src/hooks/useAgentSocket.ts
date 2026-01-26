/**
 * React hook for agent WebSocket communication.
 */

import { useEffect, useCallback } from 'react';
import { useSessionStore, type AgentMessage, type AgentMode } from '@/stores/session';
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
  type AgentAutoModeSwitchEvent,
  type AgentConfigUpdateEvent,
  type WorkspaceStatusEvent,
  type WorkspaceBillingStandbyEvent,
  type PermissionRequestEvent,
  type NativeApprovalRequestEvent,
} from '@/lib/socket';
import { sendAgentMessage } from '@/lib/api';
import { parseModelIdToDisplayName } from '@/lib/model-utils';
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
  const addAgentMessage = useSessionStore((state) => state.addAgentMessage);
  const updateAgent = useSessionStore((state) => state.updateAgent);
  const handleAutoModeSwitch = useSessionStore((state) => state.handleAutoModeSwitch);
  const startStreamingMessage = useSessionStore((state) => state.startStreamingMessage);
  const appendStreamingToken = useSessionStore((state) => state.appendStreamingToken);
  const appendThinkingToken = useSessionStore((state) => state.appendThinkingToken);
  const finalizeStreamingMessage = useSessionStore((state) => state.finalizeStreamingMessage);
  const setWorkspaceStatus = useSessionStore((state) => state.setWorkspaceStatus);

  // Use stable ref for callbacks to avoid re-running effects
  const callbacksRef = useStoreCallbacks({
    addAgentMessage,
    updateAgent,
    handleAutoModeSwitch,
    startStreamingMessage,
    appendStreamingToken,
    appendThinkingToken,
    finalizeStreamingMessage,
    setWorkspaceStatus,
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
        // Session not yet loaded, still add the message as the store will handle missing session
        const message: AgentMessage = {
          id: data.id,
          role: data.role,
          content: data.content,
          timestamp: data.created_at ? new Date(data.created_at) : new Date(),
          toolCalls: data.tool_calls || undefined,
        };
        callbacksRef.current.addAgentMessage(sessionId, data.agent_id, message);
        return;
      }

      const agent = session.agents.find((a) => a.id === data.agent_id);

      // Guard against missing agent - may happen if agent was just created
      if (!agent) {
        // Agent not found in store yet, add message anyway
        const message: AgentMessage = {
          id: data.id,
          role: data.role,
          content: data.content,
          timestamp: data.created_at ? new Date(data.created_at) : new Date(),
          toolCalls: data.tool_calls || undefined,
        };
        callbacksRef.current.addAgentMessage(sessionId, data.agent_id, message);
        return;
      }

      // Check by ID first - skip if exact ID already exists
      const existingById = agent.messages.find((m) => m.id === data.id);
      if (existingById) {
        return; // Skip duplicate
      }

      // IMPORTANT: All other deduplication is handled atomically by addAgentMessage.
      // Previously we had manual deduplication here that caused race conditions when
      // two messages with the same content were sent quickly - both handlers would
      // find the same temp message, both would return early, and one real message
      // would be lost. The store's addAgentMessage uses Zustand's set() which receives
      // current state at execution time, avoiding stale snapshot issues.

      const message: AgentMessage = {
        id: data.id,
        role: data.role,
        content: data.content,
        timestamp: data.created_at ? new Date(data.created_at) : new Date(),
        // Include tool calls if present
        toolCalls: data.tool_calls || undefined,
      };

      callbacksRef.current.addAgentMessage(sessionId, data.agent_id, message);
    });

    // Handle agent status changes
    const unsubStatus = onSocketEvent('agent_status', (data: AgentStatusEvent) => {
      if (data.session_id !== sessionId) return;
      callbacksRef.current.updateAgent(sessionId, data.agent_id, { status: data.status });
    });

    // Handle automatic mode switch notifications
    const unsubModeSwitch = onSocketEvent(
      'agent_auto_mode_switch',
      (data: AgentAutoModeSwitchEvent) => {
        if (data.session_id !== sessionId) return;

        // Update the store with new mode
        callbacksRef.current.handleAutoModeSwitch(
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

          // Show toast for CLI-initiated changes
          if (data.source === 'cli') {
            if (data.updates.model) {
              toast.info(`Model switched to ${parseModelIdToDisplayName(data.updates.model)}`, {
                description: 'Changed via CLI command',
              });
            }
            if (data.updates.mode) {
              toast.info(`Mode changed to ${data.updates.mode}`, {
                description: 'Changed via CLI command',
              });
            }
          }
        }
      }
    );

    // Handle workspace status changes (standby, running, error, offline, etc.)
    const unsubWorkspaceStatus = onSocketEvent('workspace_status', (data: WorkspaceStatusEvent) => {
      // Update the session's workspace status in the store
      callbacksRef.current.setWorkspaceStatus(sessionId, data.status, data.standby_at || null);

      // Show toast notification for status changes
      if (data.status === 'standby') {
        toast.info('Workspace moved to standby', {
          description: 'Your workspace was paused due to inactivity. Click Resume to continue.',
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

    // Handle billing standby events (credit exhaustion)
    const unsubBillingStandby = onSocketEvent(
      'workspace_billing_standby',
      (data: WorkspaceBillingStandbyEvent) => {
        // Update the session's workspace status in the store
        callbacksRef.current.setWorkspaceStatus(sessionId, 'standby', data.standby_at);

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

    // Handle Claude Code CLI permission requests
    const unsubPermissionRequest = onSocketEvent(
      'permission_request',
      (data: PermissionRequestEvent) => {
        if (data.session_id !== sessionId) return;

        // Update the agent with the pending permission request
        callbacksRef.current.updateAgent(sessionId, data.agent_id, {
          pendingPermission: {
            requestId: data.request_id,
            command: data.command,
            description: data.description,
            toolName: data.tool_name,
            timestamp: data.timestamp,
            attentionId: data.attention_id ?? `permission-${data.request_id}`,
          },
        });
      }
    );

    // Handle native Podex agent approval requests
    const unsubNativeApproval = onSocketEvent(
      'native_approval_request',
      (data: NativeApprovalRequestEvent) => {
        if (data.session_id !== sessionId) return;

        // Update the agent with the pending permission request
        // Using the same pendingPermission structure as CLI agents for consistency
        callbacksRef.current.updateAgent(sessionId, data.agent_id, {
          pendingPermission: {
            requestId: data.approval_id,
            command: data.action_details.command ?? data.action_details.file_path ?? null,
            description: `${data.action_details.tool_name}: ${data.action_details.command || data.action_details.file_path || 'action'}`,
            toolName: data.action_details.tool_name || 'action',
            timestamp: new Date().toISOString(),
            attentionId: `approval-${data.approval_id}`,
          },
        });

        // Show toast notification
        toast.info(`${data.agent_name} needs your approval`, {
          description: `${data.action_details.tool_name}: ${data.action_details.command || data.action_details.file_path || 'action'}`,
        });
      }
    );

    // Cleanup on unmount
    return () => {
      unsubMessage();
      unsubStatus();
      unsubModeSwitch();
      unsubStreamStart();
      unsubStreamToken();
      unsubThinkingToken();
      unsubStreamEnd();
      unsubConfigUpdate();
      unsubWorkspaceStatus();
      unsubBillingStandby();
      unsubPermissionRequest();
      unsubNativeApproval();
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
