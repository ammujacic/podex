/**
 * Hook for real-time Claude Code session synchronization.
 *
 * Listens for `claude:session:sync` WebSocket events from the backend
 * and updates the agent's messages in the session store.
 *
 * The sync flow:
 * 1. Local pod file watcher detects changes to session JSONL file
 * 2. Watcher extracts new messages and sends to backend via WebSocket
 * 3. Backend broadcasts to all clients viewing the session
 * 4. This hook receives the event and updates the store
 *
 * Also includes a polling fallback on WebSocket reconnection to catch
 * any messages that were missed during disconnection.
 */

import { useEffect, useCallback, useRef } from 'react';
import {
  onSocketEvent,
  onConnectionStateChange,
  type ClaudeSessionSyncEvent,
  type ClaudeSessionEntry,
} from '@/lib/socket';
import { useSessionStore } from '@/stores/session';
import { useContextStore } from '@/stores/context';
import {
  getClaudeSessionMessages,
  watchClaudeSession,
  unwatchClaudeSession,
  type ClaudeMessage,
} from '@/lib/api';
import type {
  AgentMessage,
  ToolCall,
  ClaudeSessionInfo,
  Agent,
  ToolResult,
  ProgressData,
  AgentMode,
} from '@/stores/sessionTypes';

/**
 * Map Claude Code mode names to Podex AgentMode.
 * Claude Code may use different names internally:
 * - 'plan' -> 'plan'
 * - 'auto-edit', 'auto' -> 'auto'
 * - 'trust', 'bypass', 'sovereign' -> 'sovereign'
 * - 'ask', 'default', undefined -> 'ask'
 */
function mapClaudeCodeMode(claudeMode: string | undefined): AgentMode {
  if (!claudeMode) return 'ask';

  const normalized = claudeMode.toLowerCase();

  if (normalized === 'plan') return 'plan';
  if (normalized === 'auto-edit' || normalized === 'auto') return 'auto';
  if (normalized === 'trust' || normalized === 'bypass' || normalized === 'sovereign')
    return 'sovereign';
  // 'ask', 'default', or any unknown value defaults to 'ask'
  return 'ask';
}

/**
 * Calculate context usage from Claude Code messages.
 * Uses the latest assistant message's input_tokens as an approximation
 * of current context size, since each request includes conversation history.
 *
 * Returns null if no usage data is available.
 */
function calculateContextUsage(
  messages: AgentMessage[]
): { tokensUsed: number; tokensMax: number } | null {
  // Find the latest assistant message with usage data
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.type === 'assistant' && msg.usage) {
      // Claude Code uses prompt caching, so we need to include:
      // - input_tokens: new (uncached) input tokens
      // - cache_read_input_tokens: tokens read from cache (the bulk of context)
      // - cache_creation_input_tokens: tokens written to cache
      const inputTokens = msg.usage.input_tokens || 0;
      const cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
      const cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
      const outputTokens = msg.usage.output_tokens || 0;

      // Total context = all input tokens (cached + uncached) + output
      const tokensUsed = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;

      // Skip if no meaningful usage data
      if (tokensUsed === 0) continue;

      // Default context window is 200k tokens for Claude
      // Could be enhanced to use the actual model's context window
      const tokensMax = 200000;
      return { tokensUsed, tokensMax };
    }
  }
  return null;
}

interface UseClaudeSessionSyncOptions {
  /** Session ID to sync */
  sessionId: string;
  /** Agent ID to update with new messages */
  agentId: string;
  /** Claude session info (required for polling fallback) */
  claudeSessionInfo?: ClaudeSessionInfo | null;
  /** Whether sync is enabled (default: true) */
  enabled?: boolean;
  /** Callback when sync event is received */
  onSync?: (event: ClaudeSessionSyncEvent) => void;
}

/**
 * Convert Claude session entry to AgentMessage format.
 * Handles all entry types: user, assistant, progress, summary, etc.
 */
function convertToAgentMessage(entry: ClaudeSessionEntry): AgentMessage {
  const entryType = entry.type;

  // Convert tool calls if present
  let toolCalls: ToolCall[] | undefined;
  if (entry.tool_calls && entry.tool_calls.length > 0) {
    toolCalls = entry.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.input || {},
      status: 'completed' as const,
    }));
  }

  // Convert tool results if present
  let toolResults: ToolResult[] | undefined;
  if (entry.tool_results && entry.tool_results.length > 0) {
    toolResults = entry.tool_results.map((tr) => ({
      tool_use_id: tr.tool_use_id,
      content: tr.content,
      is_error: tr.is_error,
    }));
  }

  // Determine role - for non-message types, use 'assistant' as display
  const role: 'user' | 'assistant' =
    entryType === 'user' ? 'user' : entryType === 'assistant' ? 'assistant' : 'assistant';

  // Build the base message
  const message: AgentMessage = {
    id: entry.uuid,
    role,
    content: entry.content || '',
    thinking: entry.thinking || undefined, // Extended thinking content
    timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
    type: entryType,
    toolCalls,
    toolResults,
    model: entry.model,
    stopReason: entry.stop_reason,
    usage: entry.usage,
    isSidechain: entry.is_sidechain,
    parentUuid: entry.parent_uuid,
  };

  // Add progress-specific fields
  if (entryType === 'progress') {
    message.progressType = entry.progress_type;
    message.progressData = entry.data as ProgressData;
    message.toolUseId = entry.tool_use_id;
    message.parentToolUseId = entry.parent_tool_use_id;
  }

  // Add summary-specific fields
  if (entryType === 'summary') {
    message.summary = entry.summary;
    message.leafUuid = entry.leaf_uuid;
  }

  // Add config/mode change fields
  if (['config', 'config_change', 'system', 'init'].includes(entryType)) {
    message.mode = entry.mode;
    message.configData = entry.config_data;
  }

  // Store raw data for unknown types
  if (
    ![
      'user',
      'assistant',
      'progress',
      'summary',
      'config',
      'config_change',
      'system',
      'init',
    ].includes(entryType)
  ) {
    message.rawData = entry as Record<string, unknown>;
  }

  return message;
}

/**
 * Convert API message format to AgentMessage format.
 * Handles all entry types from the backend API.
 */
function convertApiMessageToAgentMessage(msg: ClaudeMessage): AgentMessage {
  const entryType = msg.type || msg.role || 'assistant';

  // Convert tool calls if present
  let toolCalls: ToolCall[] | undefined;
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    toolCalls = msg.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: (tc.input as Record<string, unknown>) || {},
      status: 'completed' as const,
    }));
  }

  // Convert tool results if present
  let toolResults: ToolResult[] | undefined;
  if (msg.tool_results && msg.tool_results.length > 0) {
    toolResults = msg.tool_results.map((tr) => ({
      tool_use_id: tr.tool_use_id,
      content: tr.content,
      is_error: tr.is_error,
    }));
  }

  const role: 'user' | 'assistant' =
    entryType === 'user' ? 'user' : entryType === 'assistant' ? 'assistant' : 'assistant';

  const message: AgentMessage = {
    id: msg.uuid,
    role,
    content: msg.content || '',
    thinking: msg.thinking ?? undefined, // Extended thinking content
    timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    type: entryType,
    toolCalls,
    toolResults,
    model: msg.model ?? undefined,
    stopReason: msg.stop_reason ?? undefined,
    usage: msg.usage ?? undefined,
    isSidechain: msg.is_sidechain,
    parentUuid: msg.parent_uuid ?? undefined,
  };

  // Add progress-specific fields
  if (entryType === 'progress') {
    message.progressType = msg.progress_type;
    message.progressData = msg.data as ProgressData;
    message.toolUseId = msg.tool_use_id;
    message.parentToolUseId = msg.parent_tool_use_id;
  }

  // Add summary-specific fields
  if (entryType === 'summary') {
    message.summary = msg.summary;
    message.leafUuid = msg.leaf_uuid;
  }

  // Add config/mode change fields
  if (['config', 'config_change', 'system', 'init'].includes(entryType)) {
    message.mode = msg.mode;
    message.configData = msg.config_data;
  }

  // Store raw data for unknown types
  if (
    ![
      'user',
      'assistant',
      'progress',
      'summary',
      'config',
      'config_change',
      'system',
      'init',
    ].includes(entryType)
  ) {
    message.rawData = msg as Record<string, unknown>;
  }

  return message;
}

/**
 * Get agent from current store state.
 */
function getAgent(sessionId: string, agentId: string): Agent | undefined {
  const state = useSessionStore.getState();
  const session = state.sessions[sessionId];
  return session?.agents.find((a) => a.id === agentId);
}

/**
 * Hook for real-time Claude Code session synchronization.
 *
 * Automatically subscribes to sync events when the component mounts
 * and unsubscribes on unmount. Also polls for missed messages on reconnect.
 *
 * @example
 * ```tsx
 * // In an agent card component
 * useClaudeSessionSync({
 *   sessionId: session.id,
 *   agentId: agent.id,
 *   claudeSessionInfo: agent.claudeSessionInfo,
 *   enabled: agent.role === 'claude-code' && !!agent.claudeSessionInfo,
 * });
 * ```
 */
export function useClaudeSessionSync({
  sessionId,
  agentId,
  claudeSessionInfo,
  enabled = true,
  onSync,
}: UseClaudeSessionSyncOptions): void {
  const updateAgent = useSessionStore((state) => state.updateAgent);
  const mergeAgentMessages = useSessionStore((state) => state.mergeAgentMessages);

  // Track processed UUIDs to prevent duplicates (client-side deduplication)
  const processedUuids = useRef<Set<string>>(new Set());

  // Track if we were disconnected (for polling fallback)
  const wasDisconnected = useRef(false);

  // Track what session is currently registered to avoid redundant watch calls
  const registeredSessionKey = useRef<string | null>(null);

  // Track if initial sync has been done (to avoid re-fetching on every render)
  const initialSyncDone = useRef(false);

  // Track loading state for progressive history loading
  const historyLoadingState = useRef<{
    totalMessages: number;
    loadedMessages: number;
    isLoading: boolean;
  }>({ totalMessages: 0, loadedMessages: 0, isLoading: false });

  // Handle sync event
  const handleSync = useCallback(
    (event: ClaudeSessionSyncEvent) => {
      // Only process events for this session and agent
      if (event.session_id !== sessionId || event.agent_id !== agentId) {
        return;
      }

      // Filter to only new messages (client-side deduplication)
      const newMessages = event.new_messages.filter((msg) => !processedUuids.current.has(msg.uuid));

      if (newMessages.length === 0) {
        return;
      }

      // Mark as processed
      newMessages.forEach((msg) => {
        processedUuids.current.add(msg.uuid);
      });

      // Convert to AgentMessage format
      const agentMessages = newMessages.map(convertToAgentMessage);

      // Extract latest mode/model from config entries or assistant messages
      const agentUpdates: { mode?: AgentMode; model?: string; modelDisplayName?: string } = {};

      for (const msg of agentMessages) {
        // Config entries have mode info
        if (['config', 'config_change', 'system', 'init'].includes(msg.type || '')) {
          if (msg.mode) {
            agentUpdates.mode = mapClaudeCodeMode(msg.mode);
          }
          if (msg.configData?.model) {
            agentUpdates.model = msg.configData.model as string;
            // Clear modelDisplayName so UI derives it from model ID
            agentUpdates.modelDisplayName = undefined;
          }
        }
        // Assistant messages have the current model
        if (msg.type === 'assistant' && msg.model) {
          agentUpdates.model = msg.model;
          // Clear modelDisplayName so UI derives it from model ID
          agentUpdates.modelDisplayName = undefined;
        }
      }

      // Use atomic merge to avoid race conditions with optimistic updates
      // The mergeAgentMessages action handles deduplication and sorting internally
      mergeAgentMessages(
        sessionId,
        agentId,
        agentMessages,
        Object.keys(agentUpdates).length > 0 ? agentUpdates : undefined
      );

      // Update context usage from the merged messages
      const agent = getAgent(sessionId, agentId);

      if (agent) {
        const contextUsage = calculateContextUsage(agent.messages);
        if (contextUsage) {
          useContextStore.getState().setAgentUsage(agentId, {
            tokensUsed: contextUsage.tokensUsed,
            tokensMax: contextUsage.tokensMax,
            percentage: Math.round((contextUsage.tokensUsed / contextUsage.tokensMax) * 100),
            lastUpdated: new Date(),
          });
        }
      }

      // Call optional callback
      onSync?.(event);
    },
    [sessionId, agentId, updateAgent, onSync]
  );

  // Bottom-up message loading: loads latest messages first, then progressively loads older ones
  // This provides fast initial display while still loading full history
  const INITIAL_BATCH_SIZE = 200;
  const HISTORY_BATCH_SIZE = 200;

  // Load a batch of older messages and prepend them to the message list
  const loadOlderMessages = useCallback(
    async (offset: number) => {
      if (!claudeSessionInfo) return;

      const state = historyLoadingState.current;
      if (state.isLoading) return; // Already loading

      state.isLoading = true;

      try {
        // Fetch older messages (reverse=true means offset 0 = newest, so we need to adjust)
        // When reverse=true: offset 0 = newest 200, offset 200 = next oldest 200, etc.
        const response = await getClaudeSessionMessages(
          claudeSessionInfo.claudeSessionId,
          claudeSessionInfo.projectPath,
          { limit: HISTORY_BATCH_SIZE, offset, reverse: true }
        );

        // Filter out already-processed messages (by processedUuids)
        // The mergeAgentMessages action handles ID-based deduplication internally
        const newMessages = response.messages
          .filter((m) => !processedUuids.current.has(m.uuid))
          .map(convertApiMessageToAgentMessage);

        if (newMessages.length === 0) {
          state.loadedMessages = state.totalMessages; // All loaded
          return;
        }

        // Mark as processed
        newMessages.forEach((msg) => processedUuids.current.add(msg.id));

        // Use atomic merge to avoid race conditions
        mergeAgentMessages(sessionId, agentId, newMessages);

        state.loadedMessages += newMessages.length;
      } catch (error) {
        console.warn('[ClaudeSync] Failed to load older messages:', error);
      } finally {
        state.isLoading = false;
      }
    },
    [claudeSessionInfo, sessionId, agentId, updateAgent]
  );

  // Queue progressive loading of older messages (defined before pollForMissedMessages to avoid dependency issues)
  const queueOlderMessagesLoad = useCallback(() => {
    const state = historyLoadingState.current;
    if (state.loadedMessages >= state.totalMessages) return;

    // Load in batches with a small delay to avoid overwhelming the UI
    const loadNextBatch = async () => {
      if (state.loadedMessages >= state.totalMessages) return;

      await loadOlderMessages(state.loadedMessages);

      // Continue loading if more messages exist
      if (state.loadedMessages < state.totalMessages) {
        setTimeout(loadNextBatch, 100); // Small delay between batches
      }
    };

    // Start loading after a brief delay to let the UI render first
    setTimeout(loadNextBatch, 50);
  }, [loadOlderMessages]);

  // Initial load: fetch latest messages first (bottom-up loading)
  const pollForMissedMessages = useCallback(async () => {
    if (!claudeSessionInfo) {
      return;
    }

    try {
      // Step 1: Fetch the latest messages first (reverse=true for newest-first)
      const response = await getClaudeSessionMessages(
        claudeSessionInfo.claudeSessionId,
        claudeSessionInfo.projectPath,
        { limit: INITIAL_BATCH_SIZE, offset: 0, reverse: true }
      );

      // Track total for progressive loading
      historyLoadingState.current.totalMessages = response.total;
      historyLoadingState.current.loadedMessages = response.messages.length;

      // Get current agent
      const agent = getAgent(sessionId, agentId);
      if (!agent) {
        return;
      }

      // Filter out messages we already have
      const existingIds = new Set(agent.messages.map((m) => m.id));
      const newMessages = response.messages
        .filter((m) => !existingIds.has(m.uuid) && !processedUuids.current.has(m.uuid))
        .map(convertApiMessageToAgentMessage);

      if (newMessages.length === 0) {
        // Still queue loading of older messages if we haven't loaded everything
        if (response.total > INITIAL_BATCH_SIZE) {
          queueOlderMessagesLoad();
        }
        return;
      }

      // Mark as processed
      newMessages.forEach((msg) => processedUuids.current.add(msg.id));

      // Extract latest mode/model from the messages
      const agentUpdates: { mode?: AgentMode; model?: string } = {};

      for (const msg of newMessages) {
        // Config entries have mode info
        if (['config', 'config_change', 'system', 'init'].includes(msg.type || '')) {
          if (msg.mode) {
            agentUpdates.mode = mapClaudeCodeMode(msg.mode);
          }
          if (msg.configData?.model) {
            agentUpdates.model = msg.configData.model as string;
          }
        }
        // Assistant messages have the current model
        if (msg.type === 'assistant' && msg.model) {
          agentUpdates.model = msg.model;
        }
      }

      // Use atomic merge to avoid race conditions with optimistic updates
      // The mergeAgentMessages action handles deduplication and sorting internally
      mergeAgentMessages(
        sessionId,
        agentId,
        newMessages,
        Object.keys(agentUpdates).length > 0 ? agentUpdates : undefined
      );

      // Update context usage from the merged messages
      const updatedAgent = getAgent(sessionId, agentId);
      if (updatedAgent) {
        const contextUsage = calculateContextUsage(updatedAgent.messages);
        if (contextUsage) {
          useContextStore.getState().setAgentUsage(agentId, {
            tokensUsed: contextUsage.tokensUsed,
            tokensMax: contextUsage.tokensMax,
            percentage: Math.round((contextUsage.tokensUsed / contextUsage.tokensMax) * 100),
            lastUpdated: new Date(),
          });
        }
      }

      // Step 2: Queue loading of older messages if there are more
      if (response.total > INITIAL_BATCH_SIZE) {
        queueOlderMessagesLoad();
      }
    } catch (error) {
      // Polling failures are non-critical, just log
      console.warn('[ClaudeSync] Polling fallback failed:', error);
    }
  }, [claudeSessionInfo, sessionId, agentId, mergeAgentMessages, queueOlderMessagesLoad]);

  // Subscribe to sync events
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribe = onSocketEvent('claude:session:sync', handleSync);

    return () => {
      unsubscribe();
    };
  }, [enabled, handleSync, sessionId, agentId]);

  // Handle connection state changes for polling fallback
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribe = onConnectionStateChange((state) => {
      if (!state.connected) {
        // Mark that we were disconnected
        wasDisconnected.current = true;
      } else if (wasDisconnected.current) {
        // We just reconnected - poll for missed messages
        wasDisconnected.current = false;
        pollForMissedMessages();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, pollForMissedMessages]);

  // Clear processed UUIDs and initial sync flag when agent changes
  useEffect(() => {
    processedUuids.current.clear();
    initialSyncDone.current = false;
  }, [agentId]);

  // Initial sync on mount - fetch existing messages when claudeSessionInfo becomes available
  useEffect(() => {
    if (!enabled || !claudeSessionInfo || initialSyncDone.current) {
      return;
    }

    // Mark as done immediately to prevent duplicate fetches
    initialSyncDone.current = true;

    // Fetch existing messages
    pollForMissedMessages();
  }, [enabled, claudeSessionInfo, pollForMissedMessages]);

  // Register session with file watcher on mount, unregister on unmount
  // Use a stable session key to avoid redundant registrations from re-renders
  const claudeSessionId = claudeSessionInfo?.claudeSessionId;
  const projectPath = claudeSessionInfo?.projectPath;

  useEffect(() => {
    if (!enabled || !claudeSessionId || !projectPath) {
      return;
    }

    // Create a stable key for this watch registration
    const sessionKey = `${agentId}:${claudeSessionId}:${projectPath}`;

    // Skip if already registered for this exact session
    if (registeredSessionKey.current === sessionKey) {
      return;
    }

    let isMounted = true;

    // Get the last synced UUID from current messages for incremental sync
    const agent = getAgent(sessionId, agentId);
    const lastSyncedUuid = agent?.messages.length
      ? agent.messages[agent.messages.length - 1]?.id
      : undefined;

    // Register session for file watching
    const registerWatch = async () => {
      try {
        const result = await watchClaudeSession({
          claude_session_id: claudeSessionId,
          project_path: projectPath,
          podex_session_id: sessionId,
          podex_agent_id: agentId,
          last_synced_uuid: lastSyncedUuid,
        });

        if (isMounted && result.status === 'registered') {
          registeredSessionKey.current = sessionKey;
        } else if (isMounted && result.error) {
          console.warn('[ClaudeSync] Failed to register session for watching:', result.error);
        }
      } catch (error) {
        // Non-critical - we still have polling fallback
        if (isMounted) {
          console.warn('[ClaudeSync] Failed to register session for watching:', error);
        }
      }
    };

    registerWatch();

    // Cleanup: unregister on unmount or when session changes
    return () => {
      isMounted = false;
      // Only unwatch if this is the session we registered
      if (registeredSessionKey.current === sessionKey) {
        registeredSessionKey.current = null;
        unwatchClaudeSession(
          claudeSessionId,
          projectPath,
          agentId // Pass agentId so backend can clear config
        ).catch((err) => {
          console.warn('[ClaudeSync] Failed to unregister session:', err);
        });
      }
    };
  }, [enabled, claudeSessionId, projectPath, sessionId, agentId]);
}

/**
 * Initialize the processed UUIDs set from existing messages.
 * Call this after loading a session to prevent re-syncing existing messages.
 */
export function initializeProcessedUuids(
  messages: AgentMessage[],
  processedUuids: Set<string>
): void {
  messages.forEach((msg) => {
    processedUuids.add(msg.id);
  });
}
