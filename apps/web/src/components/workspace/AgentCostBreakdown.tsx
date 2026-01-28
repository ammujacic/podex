'use client';

import React, { useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useCostStore, formatCost, formatTokens } from '@/stores/cost';
import { Bot, Zap, BarChart3, Coins, PieChart, TrendingUp, ChevronRight } from 'lucide-react';
import { useModelLoading } from '@/hooks/useModelLoading';

interface AgentCostBreakdownProps {
  sessionId: string;
  className?: string;
  onAgentClick?: (agentId: string) => void;
}

export function AgentCostBreakdown({
  sessionId,
  className,
  onAgentClick,
}: AgentCostBreakdownProps) {
  const cost = useCostStore((state) => state.sessionCosts[sessionId]);
  const { backendModels, userProviderModels } = useModelLoading();

  const modelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of backendModels) {
      map.set(m.model_id, m.display_name);
    }
    for (const m of userProviderModels) {
      // Strip noisy suffixes from user models if present
      map.set(m.model_id, m.display_name.replace(' (User API)', ''));
    }
    return map;
  }, [backendModels, userProviderModels]);

  const formatModelName = useCallback(
    (modelId: string): string => {
      const fromBackend = modelNameById.get(modelId);
      if (fromBackend) return fromBackend;
      // If we don't have metadata, surface the raw ID so the user sees exactly what ran.
      return modelId;
    },
    [modelNameById]
  );

  const agentCosts = useMemo(() => {
    if (!cost || !cost.byAgent) return [];

    return Object.entries(cost.byAgent)
      .map(([agentId, agentCost]) => ({
        agentId,
        ...agentCost,
        percentage: cost.totalCost > 0 ? (agentCost.cost / cost.totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [cost]);

  const modelCosts = useMemo(() => {
    if (!cost || !cost.byModel) return [];

    return Object.entries(cost.byModel)
      .map(([model, modelCost]) => ({
        model,
        ...modelCost,
        totalTokens: modelCost.inputTokens + modelCost.outputTokens,
        percentage: cost.totalCost > 0 ? (modelCost.cost / cost.totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [cost]);

  if (!cost) {
    return (
      <div className={cn('p-4 text-center text-text-muted', className)}>No cost data available</div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Cost"
          value={formatCost(cost.totalCost)}
          icon={<Coins className="w-4 h-4" />}
          color="accent-primary"
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(cost.totalTokens)}
          icon={<Zap className="w-4 h-4" />}
          color="blue-500"
        />
        <StatCard
          label="API Calls"
          value={cost.callCount.toString()}
          icon={<BarChart3 className="w-4 h-4" />}
          color="green-500"
        />
        <StatCard
          label="Avg/Call"
          value={formatCost(cost.callCount > 0 ? cost.totalCost / cost.callCount : 0)}
          icon={<TrendingUp className="w-4 h-4" />}
          color="purple-500"
        />
      </div>

      {/* Cost by Token Type */}
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        <div className="px-4 py-3 bg-surface-secondary border-b border-border-subtle">
          <h3 className="font-medium flex items-center gap-2">
            <PieChart className="w-4 h-4 text-accent-primary" />
            Cost Breakdown by Type
          </h3>
        </div>
        <div className="p-4">
          <div className="flex gap-4">
            {/* Visual bars */}
            <div className="flex-1 space-y-3">
              <CostBar
                label="Input Tokens"
                cost={cost.inputCost}
                totalCost={cost.totalCost}
                tokens={cost.inputTokens}
                color="bg-blue-500"
              />
              <CostBar
                label="Output Tokens"
                cost={cost.outputCost}
                totalCost={cost.totalCost}
                tokens={cost.outputTokens}
                color="bg-green-500"
              />
              {cost.cachedInputCost > 0 && (
                <CostBar
                  label="Cached Input"
                  cost={cost.cachedInputCost}
                  totalCost={cost.totalCost}
                  tokens={cost.cachedInputTokens}
                  color="bg-yellow-500"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cost by Model */}
      {modelCosts.length > 0 && (
        <div className="rounded-lg border border-border-subtle overflow-hidden">
          <div className="px-4 py-3 bg-surface-secondary border-b border-border-subtle">
            <h3 className="font-medium flex items-center gap-2">
              <Bot className="w-4 h-4 text-accent-primary" />
              Cost by Model
            </h3>
          </div>
          <div className="divide-y divide-border-subtle">
            {modelCosts.map(
              ({ model, cost: modelCost, inputTokens, outputTokens, totalTokens, percentage }) => (
                <div key={model} className="p-4 hover:bg-surface-hover transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium">{formatModelName(model)}</p>
                      <p className="text-xs text-text-muted">
                        {formatTokens(totalTokens)} tokens ({formatTokens(inputTokens)} in,{' '}
                        {formatTokens(outputTokens)} out)
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-medium">{formatCost(modelCost)}</p>
                      <p className="text-xs text-text-muted">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-surface-primary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent-primary rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Cost by Agent */}
      {agentCosts.length > 0 && (
        <div className="rounded-lg border border-border-subtle overflow-hidden">
          <div className="px-4 py-3 bg-surface-secondary border-b border-border-subtle">
            <h3 className="font-medium flex items-center gap-2">
              <Bot className="w-4 h-4 text-accent-primary" />
              Cost by Agent
            </h3>
          </div>
          <div className="divide-y divide-border-subtle">
            {agentCosts.map(({ agentId, cost: agentCost, tokens, percentage }) => (
              <button
                key={agentId}
                onClick={() => onAgentClick?.(agentId)}
                className="w-full p-4 hover:bg-surface-hover transition-colors text-left flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-primary flex items-center justify-center">
                    <Bot className="w-4 h-4 text-text-muted" />
                  </div>
                  <div>
                    <p className="font-medium">{formatAgentId(agentId)}</p>
                    <p className="text-xs text-text-muted">{formatTokens(tokens)} tokens</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-mono font-medium">{formatCost(agentCost)}</p>
                    <p className="text-xs text-text-muted">{percentage.toFixed(1)}%</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div className="p-4 rounded-lg bg-surface-secondary">
      <div className={cn('inline-flex p-2 rounded-lg mb-2', `bg-${color}/20 text-${color}`)}>
        {icon}
      </div>
      <p className="text-2xl font-bold font-mono">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}

interface CostBarProps {
  label: string;
  cost: number;
  totalCost: number;
  tokens: number;
  color: string;
}

function CostBar({ label, cost, totalCost, tokens, color }: CostBarProps) {
  const percentage = totalCost > 0 ? (cost / totalCost) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className="text-sm font-mono">{formatCost(cost)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-surface-primary rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', color)}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="text-xs text-text-muted w-16 text-right">{formatTokens(tokens)}</span>
      </div>
    </div>
  );
}

function formatAgentId(agentId: string): string {
  // Extract agent name from ID or format it nicely
  if (agentId.includes('_')) {
    return agentId.split('_').slice(0, -1).join(' ');
  }
  return `Agent ${agentId.slice(0, 8)}`;
}

export default AgentCostBreakdown;
