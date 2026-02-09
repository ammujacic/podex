'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useContextStore } from '@/stores/context';

interface ContextUsageRingProps {
  agentId: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  onClick?: () => void;
  className?: string;
}

const sizeConfig = {
  xs: { diameter: 22, strokeWidth: 2, fontSize: 'text-[8px]' },
  sm: { diameter: 32, strokeWidth: 3, fontSize: 'text-[10px]' },
  md: { diameter: 40, strokeWidth: 4, fontSize: 'text-xs' },
  lg: { diameter: 56, strokeWidth: 5, fontSize: 'text-sm' },
};

/**
 * Circular progress ring showing context window usage for an agent.
 * Colors: green (normal), yellow (warning 70%+), red (critical 90%+)
 */
export function ContextUsageRing({
  agentId,
  size = 'sm',
  showLabel = false,
  onClick,
  className,
}: ContextUsageRingProps) {
  const { agentUsage, getUsageLevel, isCompacting } = useContextStore();
  const usage = agentUsage[agentId];
  const level = getUsageLevel(agentId);
  const compacting = isCompacting(agentId);

  const config = sizeConfig[size];
  const radius = (config.diameter - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const { percentage, strokeDashoffset, colorClass } = useMemo(() => {
    const pct = usage?.percentage ?? 0;
    const offset = circumference - (pct / 100) * circumference;

    let color: string;
    switch (level) {
      case 'critical':
        color = 'stroke-red-500';
        break;
      case 'warning':
        color = 'stroke-yellow-500';
        break;
      default:
        color = 'stroke-green-500';
    }

    return { percentage: pct, strokeDashoffset: offset, colorClass: color };
  }, [usage?.percentage, level, circumference]);

  const formattedTokens = useMemo(() => {
    if (!usage) return '0';
    const tokens = usage.tokensUsed;
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
    return tokens.toString();
  }, [usage]);

  return (
    <div
      className={cn('relative inline-flex items-center gap-1.5 cursor-pointer group', className)}
      onClick={onClick}
      title={`Context: ${percentage}% used (${usage?.tokensUsed?.toLocaleString() ?? 0} / ${usage?.tokensMax?.toLocaleString() ?? 200000} tokens)`}
    >
      <svg
        width={config.diameter}
        height={config.diameter}
        className={cn('transform -rotate-90 transition-all', compacting && 'animate-pulse')}
      >
        {/* Background circle */}
        <circle
          cx={config.diameter / 2}
          cy={config.diameter / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.strokeWidth}
          className="text-border-subtle opacity-30"
        />
        {/* Progress circle */}
        <circle
          cx={config.diameter / 2}
          cy={config.diameter / 2}
          r={radius}
          fill="none"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={cn(colorClass, 'transition-all duration-500')}
        />
      </svg>

      {/* Center percentage */}
      <span
        className={cn(
          'absolute top-0 left-0 flex items-center justify-center font-mono font-semibold',
          config.fontSize,
          level === 'critical' && 'text-red-400',
          level === 'warning' && 'text-yellow-400',
          level === 'normal' && 'text-green-400'
        )}
        style={{ width: config.diameter, height: config.diameter }}
      >
        {compacting ? <span className="animate-spin">↻</span> : `${percentage}`}
      </span>

      {/* Optional label */}
      {showLabel && (
        <div className="flex flex-col">
          <span className="text-xs text-text-secondary">{formattedTokens}</span>
          <span className="text-[10px] text-text-muted">tokens</span>
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline version for use in headers
 */
export function ContextUsageBadge({ agentId, className }: { agentId: string; className?: string }) {
  const { agentUsage, getUsageLevel } = useContextStore();
  const usage = agentUsage[agentId];
  const level = getUsageLevel(agentId);

  if (!usage) return null;

  const bgColor = {
    normal: 'bg-green-500/10 text-green-500',
    warning: 'bg-yellow-500/10 text-yellow-500',
    critical: 'bg-red-500/10 text-red-500',
  }[level];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono',
        bgColor,
        className
      )}
      title={`${usage.tokensUsed.toLocaleString()} / ${usage.tokensMax.toLocaleString()} tokens`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {usage.percentage}%
    </span>
  );
}
