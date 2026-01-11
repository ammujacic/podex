'use client';

import { useState, useEffect } from 'react';
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

interface SessionUsageCompact {
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  agents: AgentUsageCompact[];
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

export function UsageSidebarPanel({ sessionId }: UsageSidebarPanelProps) {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<SessionUsageCompact | null>(null);
  const [expandedAgents, setExpandedAgents] = useState(false);
  const { openModal } = useUIStore();

  useEffect(() => {
    async function loadUsage() {
      setLoading(true);
      try {
        // In real implementation, fetch from API
        await new Promise((resolve) => setTimeout(resolve, 300));

        const mockUsage: SessionUsageCompact = {
          totalTokens: 125000,
          totalCost: 2.45,
          totalCalls: 47,
          agents: [
            {
              agentId: '1',
              agentName: 'Architect',
              model: 'opus-4.5',
              tokens: 50000,
              cost: 1.65,
              calls: 12,
            },
            {
              agentId: '2',
              agentName: 'Coder',
              model: 'sonnet-4',
              tokens: 65000,
              cost: 0.65,
              calls: 28,
            },
            {
              agentId: '3',
              agentName: 'Reviewer',
              model: 'sonnet-4',
              tokens: 10000,
              cost: 0.15,
              calls: 7,
            },
          ],
        };

        setUsage(mockUsage);
      } catch (error) {
        console.error('Failed to load usage:', error);
      } finally {
        setLoading(false);
      }
    }

    loadUsage();
  }, [sessionId]);

  const handleRefresh = () => {
    setLoading(true);
    // Trigger reload
    setTimeout(() => setLoading(false), 300);
  };

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
