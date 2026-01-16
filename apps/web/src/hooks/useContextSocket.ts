/**
 * React hook for context window WebSocket events.
 */

import { useEffect, useRef } from 'react';
import { useContextStore } from '@/stores/context';
import {
  onSocketEvent,
  type ContextUsageUpdateEvent,
  type CompactionStartedEvent,
  type CompactionCompletedEvent,
} from '@/lib/socket';
import { getAgentContextUsage } from '@/lib/api';

interface UseContextSocketOptions {
  sessionId: string;
  agentIds?: string[];
}

/**
 * Hook to manage Socket.IO events for context window tracking.
 * Updates the context store when context usage or compaction events occur.
 */
export function useContextSocket({ sessionId, agentIds = [] }: UseContextSocketOptions) {
  // Use refs to avoid effect re-runs when store selectors change
  const setAgentUsageRef = useRef(useContextStore.getState().setAgentUsage);
  const setCompactingRef = useRef(useContextStore.getState().setCompacting);
  const addCompactionLogRef = useRef(useContextStore.getState().addCompactionLog);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useContextStore.subscribe((state) => {
      setAgentUsageRef.current = state.setAgentUsage;
      setCompactingRef.current = state.setCompacting;
      addCompactionLogRef.current = state.addCompactionLog;
    });
    return unsubscribe;
  }, []);

  // Fetch initial context usage for all agents
  useEffect(() => {
    if (!sessionId || agentIds.length === 0) return;

    const fetchInitialUsage = async () => {
      for (const agentId of agentIds) {
        try {
          const usage = await getAgentContextUsage(agentId);
          setAgentUsageRef.current(agentId, {
            tokensUsed: usage.tokens_used,
            tokensMax: usage.tokens_max,
            percentage: usage.percentage,
            lastUpdated: new Date(),
          });
        } catch (error) {
          console.warn(`Failed to fetch context usage for agent ${agentId}:`, error);
        }
      }
    };

    fetchInitialUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, agentIds.join(',')]); // Join to create stable dependency

  useEffect(() => {
    if (!sessionId) return;

    // Handle context usage updates
    const unsubUsage = onSocketEvent('context_usage_update', (data: ContextUsageUpdateEvent) => {
      setAgentUsageRef.current(data.agent_id, {
        tokensUsed: data.tokens_used,
        tokensMax: data.tokens_max,
        percentage: data.percentage,
        lastUpdated: new Date(),
      });
    });

    // Handle compaction started
    const unsubCompactStart = onSocketEvent(
      'compaction_started',
      (data: CompactionStartedEvent) => {
        if (data.session_id !== sessionId) return;
        setCompactingRef.current(data.agent_id, true);
      }
    );

    // Handle compaction completed
    const unsubCompactEnd = onSocketEvent(
      'compaction_completed',
      (data: CompactionCompletedEvent) => {
        if (data.session_id !== sessionId) return;

        setCompactingRef.current(data.agent_id, false);

        // Update the context usage
        setAgentUsageRef.current(data.agent_id, {
          tokensUsed: data.tokens_after,
          tokensMax: 200000, // Default, should come from agent config
          percentage: Math.round((data.tokens_after / 200000) * 100),
          lastUpdated: new Date(),
        });

        // Add to compaction history
        addCompactionLogRef.current(sessionId, {
          id: `log-${Date.now()}`,
          agentId: data.agent_id,
          tokensBefore: data.tokens_before,
          tokensAfter: data.tokens_after,
          messagesRemoved: data.messages_removed,
          messagesPreserved: 0, // Not sent in event
          summaryText: data.summary,
          triggerType: data.trigger_type || 'manual',
          createdAt: new Date(),
        });
      }
    );

    // Cleanup on unmount
    return () => {
      unsubUsage();
      unsubCompactStart();
      unsubCompactEnd();
    };
  }, [sessionId]);
}
