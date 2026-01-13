'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Link from 'next/link';
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
import { useUsageTracking } from '@/hooks/useUsageTracking';
import { api } from '@/lib/api';
import { getUsageSummary, getQuotas } from '@/lib/api';
import type { UsageSummary, Quota } from '@/lib/api';

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
  const [monthlyUsage, setMonthlyUsage] = useState<UsageSummary | null>(null);
  const [tokenQuota, setTokenQuota] = useState<Quota | null>(null);
  const { openModal } = useUIStore();

  // Fetch and track usage data
  useUsageTracking({
    sessionId,
    enabled: true,
    pollingInterval: 30000, // Poll every 30 seconds
  });

  // Fetch monthly usage summary
  useEffect(() => {
    async function fetchMonthlyUsage() {
      try {
        const [summary, quotas] = await Promise.all([
          getUsageSummary('current').catch(() => null),
          getQuotas().catch(() => []),
        ]);
        setMonthlyUsage(summary);
        // Find token quota
        const tokensQuota = quotas.find((q) => q.quotaType === 'tokens');
        setTokenQuota(tokensQuota || null);
      } catch (error) {
        console.error('Failed to fetch monthly usage:', error);
      }
    }

    // Fetch immediately on mount
    fetchMonthlyUsage();

    // Then refresh every 30 seconds to stay in sync with current session
    const interval = setInterval(fetchMonthlyUsage, 30000);
    return () => clearInterval(interval);
  }, []);

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

  const handleRefresh = useCallback(async () => {
    try {
      useCostStore.getState().setLoading(true);

      // Refresh monthly usage as well
      const [summary, quotas] = await Promise.all([
        getUsageSummary('current').catch(() => null),
        getQuotas().catch(() => []),
      ]);
      setMonthlyUsage(summary);
      const tokensQuota = quotas.find((q) => q.quotaType === 'tokens');
      setTokenQuota(tokensQuota || null);

      // API returns array directly (max page_size is 100)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const records = await api.get<any[]>(
        `/api/billing/usage/history?session_id=${sessionId}&page_size=100`
      );

      // Aggregate usage by model and agent
      const costBreakdown = {
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cachedInputCost: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        callCount: 0,
        byModel: {} as Record<string, { inputTokens: number; outputTokens: number; cost: number }>,
        byAgent: {} as Record<string, { tokens: number; cost: number }>,
      };

      const apiCallRecords = new Set();

      for (const record of records) {
        const quantity = record.quantity || 0;
        const cost = record.cost || 0;
        const usageType = record.usage_type;

        if (usageType === 'tokens_input') {
          costBreakdown.inputTokens += quantity;
          costBreakdown.inputCost += cost;
          costBreakdown.totalTokens += quantity;
        } else if (usageType === 'tokens_output') {
          costBreakdown.outputTokens += quantity;
          costBreakdown.outputCost += cost;
          costBreakdown.totalTokens += quantity;
        } else if (usageType === 'tokens_cached') {
          costBreakdown.cachedInputTokens += quantity;
          costBreakdown.cachedInputCost += cost;
          costBreakdown.totalTokens += quantity;
        } else if (usageType.startsWith('tokens')) {
          costBreakdown.totalTokens += quantity;
        }

        costBreakdown.totalCost += cost;

        if (record.id) {
          apiCallRecords.add(record.id.split('-')[0]);
        }

        const model = record.model || 'unknown';
        if (!costBreakdown.byModel[model]) {
          costBreakdown.byModel[model] = { inputTokens: 0, outputTokens: 0, cost: 0 };
        }
        if (usageType === 'tokens_input') {
          costBreakdown.byModel[model].inputTokens += quantity;
        } else if (usageType === 'tokens_output') {
          costBreakdown.byModel[model].outputTokens += quantity;
        }
        costBreakdown.byModel[model].cost += cost;

        const agentId = record.agent_id || 'unknown';
        if (!costBreakdown.byAgent[agentId]) {
          costBreakdown.byAgent[agentId] = { tokens: 0, cost: 0 };
        }
        costBreakdown.byAgent[agentId].tokens += quantity;
        costBreakdown.byAgent[agentId].cost += cost;
      }

      costBreakdown.callCount = apiCallRecords.size || records.length;

      useCostStore.getState().setSessionCost(sessionId, costBreakdown);
    } catch (error) {
      console.error('Failed to refresh usage:', error);
    } finally {
      useCostStore.getState().setLoading(false);
    }
  }, [sessionId]);

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
      {/* Monthly Usage Summary */}
      {monthlyUsage && (
        <div className="px-3 py-3 border-b border-border-subtle">
          <div className="mb-3 p-3 rounded bg-surface border border-border-default">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-muted">This Month</span>
              <Link href="/settings/usage">
                <button className="text-xs text-accent-primary hover:underline flex items-center gap-1">
                  View All
                  <ExternalLink className="h-3 w-3" />
                </button>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center mb-2">
              <div>
                <div className="text-lg font-semibold text-text-primary">
                  {formatTokens(monthlyUsage.tokensTotal)}
                </div>
                <div className="text-[10px] text-text-muted">Tokens</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-text-primary">
                  {formatCost(monthlyUsage.totalCost)}
                </div>
                <div className="text-[10px] text-text-muted">Cost</div>
              </div>
            </div>

            {/* Quota Progress Bar */}
            {tokenQuota && (
              <div className="mt-2">
                <div className="flex justify-between text-[10px] text-text-muted mb-1">
                  <span>Token Quota</span>
                  <span>{tokenQuota.usagePercentage.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-void rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      tokenQuota.isExceeded
                        ? 'bg-accent-error'
                        : tokenQuota.isWarning
                          ? 'bg-accent-warning'
                          : 'bg-accent-success'
                    }`}
                    style={{ width: `${Math.min(tokenQuota.usagePercentage, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="text-xs font-medium text-text-muted mb-2">Current Session</div>
        </div>
      )}

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
