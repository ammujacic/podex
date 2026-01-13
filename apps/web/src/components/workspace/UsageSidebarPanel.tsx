'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  BarChart3,
  DollarSign,
  Zap,
  Cpu,
  Bot,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import {
  useCostStore,
  formatCost as formatCostUtil,
  formatTokens as formatTokensUtil,
} from '@/stores/cost';
import { useSessionStore } from '@/stores/session';

interface UsageSidebarPanelProps {
  sessionId: string;
}

interface AgentUsageCompact {
  agentId: string;
  agentName: string;
  model: string;
  tokens: number;
  cost: number;
  calls: number;
}

function formatTokens(tokens: number): string {
  return formatTokensUtil(tokens);
}

function formatCost(cost: number): string {
  return formatCostUtil(cost);
}

export function UsageSidebarPanel({ sessionId }: UsageSidebarPanelProps) {
  const [expandedAgents, setExpandedAgents] = useState(false);
  const { openModal } = useUIStore();

  // Get cost data from the store
  const sessionCosts = useCostStore((state) => state.sessionCosts);
  const loading = useCostStore((state) => state.loading);

  // Get agents from the current session to map agent IDs to names
  const session = useSessionStore((state) => state.sessions[sessionId]);

  // Derive usage data from cost store
  const usage = useMemo(() => {
    const costData = sessionCosts[sessionId];
    if (!costData) return null;

    const agents = session?.agents || [];

    // Build agent breakdown
    const agentUsage: AgentUsageCompact[] = Object.entries(costData.byAgent || {}).map(
      ([agentId, data]) => {
        const agent = agents.find((a: { id: string }) => a.id === agentId);
        return {
          agentId,
          agentName: agent?.name || `Agent ${agentId.slice(0, 8)}`,
          model: agent?.model || 'unknown',
          tokens: data.tokens || 0,
          cost: data.cost || 0,
          calls: 0, // Not tracked per-agent yet
        };
      }
    );

    return {
      totalTokens: costData.totalTokens,
      totalCost: costData.totalCost,
      totalCalls: costData.callCount,
      agents: agentUsage,
    };
  }, [sessionCosts, sessionId, session?.agents]);

  const handleRefresh = useCallback(() => {
    // Cost updates come via WebSocket, so just trigger a visual refresh
    useCostStore.getState().setLoading(true);
    setTimeout(() => useCostStore.getState().setLoading(false), 300);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center px-4">
        <BarChart3 className="h-8 w-8 text-text-muted mb-2" />
        <p className="text-xs text-text-muted">No usage data</p>
      </div>
    );
  }

  const maxTokens = Math.max(...usage.agents.map((a) => a.tokens));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary stats */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded bg-elevated">
            <DollarSign className="h-3.5 w-3.5 mx-auto text-success mb-1" />
            <div className="text-sm font-semibold text-text-primary">
              {formatCost(usage.totalCost)}
            </div>
            <div className="text-[10px] text-text-muted">Cost</div>
          </div>
          <div className="text-center p-2 rounded bg-elevated">
            <Zap className="h-3.5 w-3.5 mx-auto text-accent-primary mb-1" />
            <div className="text-sm font-semibold text-text-primary">
              {formatTokens(usage.totalTokens)}
            </div>
            <div className="text-[10px] text-text-muted">Tokens</div>
          </div>
          <div className="text-center p-2 rounded bg-elevated">
            <Cpu className="h-3.5 w-3.5 mx-auto text-info mb-1" />
            <div className="text-sm font-semibold text-text-primary">{usage.totalCalls}</div>
            <div className="text-[10px] text-text-muted">Calls</div>
          </div>
        </div>
      </div>

      {/* Agent breakdown */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setExpandedAgents(!expandedAgents)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-overlay border-b border-border-subtle"
        >
          {expandedAgents ? (
            <ChevronDown className="h-3 w-3 text-text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted" />
          )}
          <Bot className="h-3.5 w-3.5 text-accent-primary" />
          <span className="text-xs font-medium text-text-primary flex-1">By Agent</span>
          <span className="text-[10px] text-text-muted">{usage.agents.length}</span>
        </button>

        {expandedAgents && (
          <div className="p-2 space-y-2">
            {usage.agents.map((agent) => {
              const percentage = maxTokens > 0 ? (agent.tokens / maxTokens) * 100 : 0;

              return (
                <div key={agent.agentId} className="p-2 rounded bg-elevated">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-text-primary">{agent.agentName}</span>
                    <span className="text-[10px] text-text-muted">{agent.model}</span>
                  </div>
                  <div className="h-1.5 bg-void rounded-full overflow-hidden mb-1">
                    <div
                      className="h-full bg-accent-primary rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-text-muted">
                    <span>{formatTokens(agent.tokens)} tokens</span>
                    <span>{formatCost(agent.cost)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick actions */}
        <div className="p-2 space-y-1">
          <button
            onClick={handleRefresh}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-overlay rounded"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            onClick={() => openModal('usage-details')}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-overlay rounded"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View Details
          </button>
        </div>
      </div>
    </div>
  );
}
