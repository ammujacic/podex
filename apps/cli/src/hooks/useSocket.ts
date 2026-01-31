/**
 * Socket connection hook.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getSocketClient,
  connectSocket,
  disconnectSocket,
  isSocketConnected,
} from '../services/socket-service';
import type {
  ConnectionState,
  AgentTokenEvent,
  AgentStreamEndEvent,
  AgentThinkingTokenEvent,
  ContextUsageUpdateEvent,
  AgentConfigUpdateEvent,
} from '@podex/api-client';
import type { ApprovalRequest } from '../components/chat/ApprovalPrompt';
import type { ContextUsage, UsageStats, AgentUsageInfo } from '../types/usage';
import type { AgentMode } from '../components/agents/AgentCard';

interface UseSocketOptions {
  sessionId?: string;
  userId?: string;
  autoConnect?: boolean;
}

interface UseSocketReturn {
  isConnected: boolean;
  connectionState: ConnectionState | null;
  streamingContent: string;
  thinkingContent: string;
  pendingApproval: ApprovalRequest | null;
  /** Per-agent context usage */
  agentContextUsage: Record<string, ContextUsage>;
  /** Per-agent config (model, mode, etc.) */
  agentConfigs: Record<string, Partial<AgentUsageInfo>>;
  /** Session-level token usage */
  sessionUsage: UsageStats;
  connect: () => void;
  disconnect: () => void;
  respondToApproval: (approved: boolean, addToAllowlist: boolean) => void;
}

export function useSocket(options: UseSocketOptions = {}): UseSocketReturn {
  const { sessionId, userId, autoConnect = true } = options;

  const [isConnected, setIsConnected] = useState(isSocketConnected());
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);

  // Usage tracking
  const [agentContextUsage, setAgentContextUsage] = useState<Record<string, ContextUsage>>({});
  const [agentConfigs, setAgentConfigs] = useState<Record<string, Partial<AgentUsageInfo>>>({});
  // TODO: Track session-level token usage from agent_message events when available
  const [sessionUsage, _setSessionUsage] = useState<UsageStats>({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  useEffect(() => {
    const socketClient = getSocketClient();

    // Subscribe to connection state
    const unsubscribe = socketClient.onConnectionStateChange((state) => {
      setConnectionState(state);
      setIsConnected(state.connected);
    });

    // Subscribe to streaming events
    const unsubscribeToken = socketClient.on('agent_token', (data: AgentTokenEvent) => {
      setStreamingContent((prev) => prev + data.token);
    });

    const unsubscribeStreamEnd = socketClient.on(
      'agent_stream_end',
      (_data: AgentStreamEndEvent) => {
        setStreamingContent('');
        setThinkingContent('');
      }
    );

    // Subscribe to thinking token events
    const unsubscribeThinking = socketClient.on(
      'agent_thinking_token',
      (data: AgentThinkingTokenEvent) => {
        setThinkingContent((prev) => prev + data.thinking);
      }
    );

    // Subscribe to context usage updates
    const unsubscribeContextUsage = socketClient.on(
      'context_usage_update',
      (data: ContextUsageUpdateEvent) => {
        setAgentContextUsage((prev) => ({
          ...prev,
          [data.agent_id]: {
            tokensUsed: data.tokens_used,
            tokensMax: data.tokens_max,
            percentage: data.percentage,
          },
        }));
      }
    );

    // Subscribe to agent config updates (model changes, mode changes, etc.)
    const unsubscribeConfigUpdate = socketClient.on(
      'agent_config_update',
      (data: AgentConfigUpdateEvent) => {
        setAgentConfigs((prev) => ({
          ...prev,
          [data.agent_id]: {
            ...prev[data.agent_id],
            agentId: data.agent_id,
            model: data.updates.model ?? prev[data.agent_id]?.model,
            mode: (data.updates.mode as AgentMode) ?? prev[data.agent_id]?.mode,
            thinkingEnabled: data.updates.thinking_enabled ?? prev[data.agent_id]?.thinkingEnabled,
            thinkingBudget: data.updates.thinking_budget ?? prev[data.agent_id]?.thinkingBudget,
          },
        }));
      }
    );

    // Subscribe to approval events
    const unsubscribeApproval = socketClient.on('approval_request', (data: unknown) => {
      const approvalData = data as {
        approval_id: string;
        tool: string;
        description: string;
        command?: string;
        args?: Record<string, unknown>;
      };
      setPendingApproval({
        id: approvalData.approval_id,
        tool: approvalData.tool,
        description: approvalData.description,
        command: approvalData.command,
        args: approvalData.args,
      });
    });

    // Auto-connect if requested
    if (autoConnect) {
      connectSocket();
    }

    // Join session if provided
    if (sessionId && userId) {
      socketClient.joinSession(sessionId, userId);
    }

    return () => {
      unsubscribe();
      unsubscribeToken();
      unsubscribeStreamEnd();
      unsubscribeThinking();
      unsubscribeContextUsage();
      unsubscribeConfigUpdate();
      unsubscribeApproval();
    };
  }, [sessionId, userId, autoConnect]);

  const connect = useCallback(() => {
    connectSocket();
  }, []);

  const disconnect = useCallback(() => {
    disconnectSocket();
  }, []);

  const respondToApproval = useCallback(
    (approved: boolean, addToAllowlist: boolean) => {
      if (!pendingApproval || !sessionId) return;

      const socketClient = getSocketClient();
      socketClient.emitApprovalResponse(
        sessionId,
        '', // agentId - would need to track this
        pendingApproval.id,
        approved,
        addToAllowlist
      );
      setPendingApproval(null);
    },
    [pendingApproval, sessionId]
  );

  return {
    isConnected,
    connectionState,
    streamingContent,
    thinkingContent,
    pendingApproval,
    agentContextUsage,
    agentConfigs,
    sessionUsage,
    connect,
    disconnect,
    respondToApproval,
  };
}
