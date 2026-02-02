/**
 * React hook for context window WebSocket events.
 */

import { useEffect, useRef, useMemo } from 'react';
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

  // Stabilize agentIds array to prevent unnecessary effect re-runs
  // This creates a new reference only when the array contents actually change
  const agentIdsKey = agentIds.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only depend on stringified key to stabilize array reference
  const stableAgentIds = useMemo(() => agentIds, [agentIdsKey]);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useContextStore.subscribe((state) => {
      setAgentUsageRef.current = state.setAgentUsage;
      setCompactingRef.current = state.setCompacting;
      addCompactionLogRef.current = state.addCompactionLog;
    });
    return unsubscribe;
  }, []);

  // Fetch initial context usage for all agents with proper cleanup
  useEffect(() => {
    if (!sessionId || stableAgentIds.length === 0) return;

    let isCancelled = false;

    const fetchInitialUsage = async () => {
      for (const agentId of stableAgentIds) {
        if (isCancelled) break;
        try {
          const usage = await getAgentContextUsage(agentId);
          if (isCancelled) break;

          // Guard against incomplete or missing usage data
          if (
            !usage ||
            typeof usage.tokens_used !== 'number' ||
            typeof usage.tokens_max !== 'number'
          ) {
            console.warn(`Received invalid context usage for agent ${agentId}:`, usage);
            continue;
          }

          setAgentUsageRef.current(agentId, {
            tokensUsed: usage.tokens_used,
            tokensMax: usage.tokens_max,
            percentage: usage.percentage,
            lastUpdated: new Date(),
          });
        } catch (error) {
          if (isCancelled) break;
          console.warn(`Failed to fetch context usage for agent ${agentId}:`, error);
        }
      }
    };

    fetchInitialUsage();

    return () => {
      isCancelled = true;
    };
  }, [sessionId, stableAgentIds]);

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

        // Update the context usage - preserve existing tokensMax from store
        const currentUsage = useContextStore.getState().agentUsage[data.agent_id];
        const tokensMax = currentUsage?.tokensMax ?? 200000;
        setAgentUsageRef.current(data.agent_id, {
          tokensUsed: data.tokens_after,
          tokensMax,
          percentage: Math.round((data.tokens_after / tokensMax) * 100),
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
