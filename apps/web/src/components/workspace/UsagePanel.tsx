'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  DollarSign,
  Cpu,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  Bot,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface AgentUsage {
  agentId: string;
  agentName: string;
  agentRole: string;
  model: string;
  tokenUsage: TokenUsage;
  apiCalls: number;
  cost: number;
  lastActive: Date;
}

interface SessionUsage {
  sessionId: string;
  sessionName: string;
  agents: AgentUsage[];
  totalTokens: number;
  totalCost: number;
  totalCalls: number;
  startTime: Date;
}

interface UsageStats {
  today: {
    tokens: number;
    cost: number;
    calls: number;
  };
  thisMonth: {
    tokens: number;
    cost: number;
    calls: number;
  };
  allTime: {
    tokens: number;
    cost: number;
    calls: number;
  };
}

// Model pricing (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5-20251101': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  local: { input: 0, output: 0 },
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

function formatCost(cost: number): string {
  if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`;
  }
  return `$${cost.toFixed(4)}`;
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ??
    MODEL_PRICING['claude-sonnet-4-20250514'] ?? { input: 3, output: 15 };
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// ============================================================================
// Stat Card Component
// ============================================================================

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

function StatCard({ label, value, subValue, icon, trend, trendValue }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-text-muted">{icon}</span>
        {trend && trendValue && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs',
              trend === 'up' && 'text-red-400',
              trend === 'down' && 'text-green-400',
              trend === 'neutral' && 'text-text-muted'
            )}
          >
            {trend === 'up' ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {trendValue}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-sm text-text-muted">{label}</div>
      {subValue && <div className="text-xs text-text-muted mt-1">{subValue}</div>}
    </div>
  );
}

// ============================================================================
// Agent Usage Row
// ============================================================================

interface AgentUsageRowProps {
  agent: AgentUsage;
  expanded: boolean;
  onToggle: () => void;
}

function AgentUsageRow({ agent, expanded, onToggle }: AgentUsageRowProps) {
  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-surface cursor-pointer hover:bg-elevated"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronUp className="h-4 w-4 text-text-muted" />
        )}

        <Bot className="h-4 w-4 text-accent-primary" />

        <div className="flex-1">
          <div className="text-sm font-medium text-text-primary">{agent.agentName}</div>
          <div className="text-xs text-text-muted">
            {agent.agentRole} • {agent.model}
          </div>
        </div>

        <div className="text-right">
          <div className="text-sm font-medium text-text-primary">{formatCost(agent.cost)}</div>
          <div className="text-xs text-text-muted">
            {formatTokens(agent.tokenUsage.totalTokens)} tokens
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 bg-elevated border-t border-border-subtle">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-text-muted text-xs mb-1">Input Tokens</div>
              <div className="text-text-primary">{formatTokens(agent.tokenUsage.inputTokens)}</div>
            </div>
            <div>
              <div className="text-text-muted text-xs mb-1">Output Tokens</div>
              <div className="text-text-primary">{formatTokens(agent.tokenUsage.outputTokens)}</div>
            </div>
            <div>
              <div className="text-text-muted text-xs mb-1">API Calls</div>
              <div className="text-text-primary">{agent.apiCalls}</div>
            </div>
            <div>
              <div className="text-text-muted text-xs mb-1">Last Active</div>
              <div className="text-text-primary">
                {new Date(agent.lastActive).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Usage Bar Chart
// ============================================================================

interface UsageBarProps {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}

function UsageBar({ label, value, maxValue, color }: UsageBarProps) {
  const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary">{formatTokens(value)}</span>
      </div>
      <div className="h-2 bg-elevated rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface UsagePanelProps {
  sessionId: string;
  className?: string;
}

export function UsagePanel({ sessionId, className }: UsagePanelProps) {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  // Load usage data
  useEffect(() => {
    async function loadUsage() {
      setLoading(true);
      try {
        // In real implementation, fetch from API
        // const data = await api.get(`/api/sessions/${sessionId}/usage`);

        // Mock data
        const mockUsage: SessionUsage = {
          sessionId,
          sessionName: 'Development Session',
          totalTokens: 125000,
          totalCost: 2.45,
          totalCalls: 47,
          startTime: new Date(Date.now() - 3600000),
          agents: [
            {
              agentId: 'architect-1',
              agentName: 'Architect',
              agentRole: 'architect',
              model: 'claude-opus-4-5-20251101',
              tokenUsage: { inputTokens: 35000, outputTokens: 15000, totalTokens: 50000 },
              apiCalls: 12,
              cost: 1.65,
              lastActive: new Date(),
            },
            {
              agentId: 'coder-1',
              agentName: 'Coder',
              agentRole: 'coder',
              model: 'claude-sonnet-4-20250514',
              tokenUsage: { inputTokens: 45000, outputTokens: 20000, totalTokens: 65000 },
              apiCalls: 28,
              cost: 0.65,
              lastActive: new Date(Date.now() - 120000),
            },
            {
              agentId: 'reviewer-1',
              agentName: 'Reviewer',
              agentRole: 'reviewer',
              model: 'claude-sonnet-4-20250514',
              tokenUsage: { inputTokens: 8000, outputTokens: 2000, totalTokens: 10000 },
              apiCalls: 7,
              cost: 0.15,
              lastActive: new Date(Date.now() - 600000),
            },
          ],
        };

        const mockStats: UsageStats = {
          today: { tokens: 350000, cost: 8.5, calls: 125 },
          thisMonth: { tokens: 5200000, cost: 145.0, calls: 2340 },
          allTime: { tokens: 45000000, cost: 1250.0, calls: 18500 },
        };

        setUsage(mockUsage);
        setStats(mockStats);
      } catch (error) {
        console.error('Failed to load usage:', error);
      } finally {
        setLoading(false);
      }
    }

    loadUsage();
  }, [sessionId]);

  // Toggle agent expansion
  const toggleAgent = (agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  // Find max tokens for chart scaling
  const maxTokens = useMemo(() => {
    if (!usage) return 0;
    return Math.max(...usage.agents.map((a) => a.tokenUsage.totalTokens));
  }, [usage]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center h-64', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Loading usage data...
        </div>
      </div>
    );
  }

  if (!usage || !stats) {
    return (
      <div className={cn('flex items-center justify-center h-64', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <AlertTriangle className="h-5 w-5" />
          Failed to load usage data
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Usage & Costs</h2>
        </div>
        <button
          onClick={() => setLoading(true)}
          className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Overview stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Session Cost"
            value={formatCost(usage.totalCost)}
            icon={<DollarSign className="h-5 w-5" />}
          />
          <StatCard
            label="Total Tokens"
            value={formatTokens(usage.totalTokens)}
            icon={<Zap className="h-5 w-5" />}
          />
          <StatCard
            label="API Calls"
            value={usage.totalCalls.toString()}
            icon={<Cpu className="h-5 w-5" />}
          />
          <StatCard
            label="Session Duration"
            value={`${Math.round((Date.now() - usage.startTime.getTime()) / 60000)}m`}
            icon={<Clock className="h-5 w-5" />}
          />
        </div>

        {/* Time period stats */}
        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Usage Over Time</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg bg-elevated">
              <div className="text-lg font-bold text-text-primary">
                {formatCost(stats.today.cost)}
              </div>
              <div className="text-xs text-text-muted">Today</div>
              <div className="text-xs text-accent-primary">
                {formatTokens(stats.today.tokens)} tokens
              </div>
            </div>
            <div className="p-3 rounded-lg bg-elevated">
              <div className="text-lg font-bold text-text-primary">
                {formatCost(stats.thisMonth.cost)}
              </div>
              <div className="text-xs text-text-muted">This Month</div>
              <div className="text-xs text-accent-primary">
                {formatTokens(stats.thisMonth.tokens)} tokens
              </div>
            </div>
            <div className="p-3 rounded-lg bg-elevated">
              <div className="text-lg font-bold text-text-primary">
                {formatCost(stats.allTime.cost)}
              </div>
              <div className="text-xs text-text-muted">All Time</div>
              <div className="text-xs text-accent-primary">
                {formatTokens(stats.allTime.tokens)} tokens
              </div>
            </div>
          </div>
        </div>

        {/* Agent usage breakdown */}
        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Token Usage by Agent</h3>
          <div className="space-y-3">
            {usage.agents.map((agent) => (
              <UsageBar
                key={agent.agentId}
                label={agent.agentName}
                value={agent.tokenUsage.totalTokens}
                maxValue={maxTokens}
                color={
                  agent.agentRole === 'architect'
                    ? 'bg-purple-500'
                    : agent.agentRole === 'coder'
                      ? 'bg-blue-500'
                      : agent.agentRole === 'reviewer'
                        ? 'bg-green-500'
                        : 'bg-accent-primary'
                }
              />
            ))}
          </div>
        </div>

        {/* Agent details */}
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-3">Agent Details</h3>
          <div className="space-y-2">
            {usage.agents.map((agent) => (
              <AgentUsageRow
                key={agent.agentId}
                agent={agent}
                expanded={expandedAgents.has(agent.agentId)}
                onToggle={() => toggleAgent(agent.agentId)}
              />
            ))}
          </div>
        </div>

        {/* Model pricing reference */}
        <div className="rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">
            Model Pricing (per 1M tokens)
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {Object.entries(MODEL_PRICING)
              .slice(0, 6)
              .map(([model, pricing]) => (
                <div
                  key={model}
                  className="flex items-center justify-between p-2 rounded bg-elevated"
                >
                  <span className="text-text-secondary truncate">
                    {model.split('-').slice(0, 2).join('-')}
                  </span>
                  <span className="text-text-muted">
                    ${pricing.input} / ${pricing.output}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
