'use client';

import { Bot, Cpu, DollarSign, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatsCardSkeleton } from '@/components/ui/Skeleton';

interface Stat {
  label: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  color: string;
}

interface StatsGridProps {
  stats?: {
    tokensUsed: number;
    apiCalls: number;
    activeAgents: number;
    estimatedCost: number;
  };
  isLoading?: boolean;
}

export function StatsGrid({ stats, isLoading }: StatsGridProps) {
  if (isLoading || !stats) {
    return (
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatsCardSkeleton />
        <StatsCardSkeleton />
        <StatsCardSkeleton />
        <StatsCardSkeleton />
      </div>
    );
  }

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const statItems: Stat[] = [
    {
      label: 'Tokens Used',
      value: formatNumber(stats.tokensUsed),
      change: '+12%',
      changeType: 'neutral',
      icon: <Zap className="w-5 h-5" />,
      color: 'text-accent-primary',
    },
    {
      label: 'API Calls',
      value: formatNumber(stats.apiCalls),
      change: '+8%',
      changeType: 'positive',
      icon: <Cpu className="w-5 h-5" />,
      color: 'text-accent-secondary',
    },
    {
      label: 'Active Agents',
      value: stats.activeAgents,
      icon: <Bot className="w-5 h-5" />,
      color: 'text-accent-success',
    },
    {
      label: 'Est. Cost',
      value: `$${stats.estimatedCost.toFixed(2)}`,
      change: '-5%',
      changeType: 'positive',
      icon: <DollarSign className="w-5 h-5" />,
      color: 'text-accent-warning',
    },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      {statItems.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </div>
  );
}

function StatCard({ stat }: { stat: Stat }) {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-4 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn('p-2.5 rounded-lg bg-elevated', stat.color)}>{stat.icon}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-muted truncate">{stat.label}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-xl font-semibold text-text-primary">{stat.value}</p>
            {stat.change && (
              <span
                className={cn(
                  'text-xs font-medium',
                  stat.changeType === 'positive' && 'text-accent-success',
                  stat.changeType === 'negative' && 'text-accent-error',
                  stat.changeType === 'neutral' && 'text-text-muted'
                )}
              >
                {stat.change}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
