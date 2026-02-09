'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCostStore, formatCost, formatTokens } from '@/stores/cost';
import {
  DollarSign,
  TrendingUp,
  Coins,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
  BarChart3,
} from 'lucide-react';

interface SessionCostCounterProps {
  sessionId: string;
  className?: string;
  compact?: boolean;
  showBudget?: boolean;
  onOpenDetails?: () => void;
}

export function SessionCostCounter({
  sessionId,
  className,
  compact = false,
  showBudget = true,
  onOpenDetails,
}: SessionCostCounterProps) {
  const { sessionCosts, setCurrentSession, getActiveBudgetStatus } = useCostStore();

  const [expanded, setExpanded] = useState(false);
  const [previousCost, setPreviousCost] = useState(0);
  const [costChange, setCostChange] = useState(0);

  useEffect(() => {
    setCurrentSession(sessionId);
  }, [sessionId, setCurrentSession]);

  const cost = sessionCosts[sessionId];
  const budgetStatus = getActiveBudgetStatus();

  // Animate cost changes
  useEffect(() => {
    if (cost && cost.totalCost !== previousCost) {
      setCostChange(cost.totalCost - previousCost);
      setPreviousCost(cost.totalCost);

      // Clear the change indicator after animation
      const timer = setTimeout(() => setCostChange(0), 2000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [cost, previousCost]);

  if (!cost) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-secondary text-text-muted',
          className
        )}
      >
        <DollarSign className="w-4 h-4" />
        <span className="text-sm font-mono">$0.00</span>
      </div>
    );
  }

  const isNearBudget = budgetStatus && budgetStatus.percentageUsed >= 80;
  const isOverBudget = budgetStatus && budgetStatus.percentageUsed >= 100;

  if (compact) {
    return (
      <button
        onClick={() => onOpenDetails?.()}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded text-sm font-mono transition-colors',
          isOverBudget
            ? 'bg-red-500/20 text-red-500'
            : isNearBudget
              ? 'bg-yellow-500/20 text-yellow-500'
              : 'bg-surface-secondary hover:bg-surface-hover',
          className
        )}
        title={`${cost.callCount} API calls, ${formatTokens(cost.totalTokens)} tokens`}
      >
        <DollarSign className="w-3.5 h-3.5" />
        <span className={cn('transition-colors', costChange > 0 && 'text-green-400 animate-pulse')}>
          {formatCost(cost.totalCost)}
        </span>
        {isNearBudget && <AlertTriangle className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <div className={cn('rounded-lg bg-surface-secondary border border-border-subtle', className)}>
      {/* Main Counter */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'p-2 rounded-lg',
              isOverBudget
                ? 'bg-red-500/20 text-red-500'
                : isNearBudget
                  ? 'bg-yellow-500/20 text-yellow-500'
                  : 'bg-accent-primary/20 text-accent-primary'
            )}
          >
            <DollarSign className="w-5 h-5" />
          </div>

          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold font-mono">{formatCost(cost.totalCost)}</span>
              {costChange > 0 && (
                <span className="flex items-center text-xs text-green-400 animate-fade-in">
                  <TrendingUp className="w-3 h-3 mr-0.5" />+{formatCost(costChange)}
                </span>
              )}
            </div>
            <span className="text-xs text-text-muted">
              {cost.callCount} calls · {formatTokens(cost.totalTokens)} tokens
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showBudget && budgetStatus && (
            <BudgetProgressRing percentage={budgetStatus.percentageUsed} size={36} />
          )}
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-text-muted" />
          ) : (
            <ChevronDown className="w-5 h-5 text-text-muted" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border-subtle space-y-4">
          {/* Cost Breakdown */}
          <div className="grid grid-cols-3 gap-3">
            <CostBreakdownItem
              label="Input"
              cost={cost.inputCost}
              tokens={cost.inputTokens}
              icon={<Zap className="w-3.5 h-3.5" />}
            />
            <CostBreakdownItem
              label="Output"
              cost={cost.outputCost}
              tokens={cost.outputTokens}
              icon={<BarChart3 className="w-3.5 h-3.5" />}
            />
            <CostBreakdownItem
              label="Cached"
              cost={cost.cachedInputCost}
              tokens={cost.cachedInputTokens}
              icon={<Coins className="w-3.5 h-3.5" />}
            />
          </div>

          {/* Model Breakdown */}
          {Object.keys(cost.byModel).length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted mb-2">By Model</h4>
              <div className="space-y-1.5">
                {Object.entries(cost.byModel).map(([model, modelCost]) => (
                  <div key={model} className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary truncate max-w-[150px]">
                      {model.split('-').slice(0, 2).join(' ')}
                    </span>
                    <span className="font-mono text-text-primary">
                      {formatCost(modelCost.cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Budget Status */}
          {showBudget && budgetStatus && (
            <div className="pt-2 border-t border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">{budgetStatus.budget.period} Budget</span>
                <span className="text-xs font-mono">
                  {formatCost(budgetStatus.spent)} / {formatCost(budgetStatus.budget.amount)}
                </span>
              </div>
              <div className="h-2 bg-surface-primary rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    isOverBudget
                      ? 'bg-red-500'
                      : isNearBudget
                        ? 'bg-yellow-500'
                        : 'bg-accent-primary'
                  )}
                  style={{ width: `${Math.min(budgetStatus.percentageUsed, 100)}%` }}
                />
              </div>
              <p className="text-xs text-text-muted mt-1">
                {formatCost(budgetStatus.remaining)} remaining
              </p>
            </div>
          )}

          {/* View Details Button */}
          {onOpenDetails && (
            <button
              onClick={onOpenDetails}
              className="w-full py-2 text-sm text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
            >
              View Full Breakdown
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CostBreakdownItemProps {
  label: string;
  cost: number;
  tokens: number;
  icon: React.ReactNode;
}

function CostBreakdownItem({ label, cost, tokens, icon }: CostBreakdownItemProps) {
  return (
    <div className="p-2 rounded bg-surface-primary">
      <div className="flex items-center gap-1 text-text-muted mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="font-mono text-sm">{formatCost(cost)}</p>
      <p className="text-xs text-text-muted">{formatTokens(tokens)} tokens</p>
    </div>
  );
}

interface BudgetProgressRingProps {
  percentage: number;
  size: number;
}

function BudgetProgressRing({ percentage, size }: BudgetProgressRingProps) {
  const radius = (size - 4) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;

  const color =
    percentage >= 100
      ? '#ef4444' // red
      : percentage >= 80
        ? '#eab308' // yellow
        : '#22c55e'; // green

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-surface-primary"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold">{Math.round(percentage)}%</span>
      </div>
    </div>
  );
}

// Inline mini counter for headers
interface MiniCostCounterProps {
  sessionId: string;
  className?: string;
}

export function MiniCostCounter({ sessionId, className }: MiniCostCounterProps) {
  const cost = useCostStore((state) => state.sessionCosts[sessionId]);

  if (!cost) {
    return <span className={cn('font-mono text-xs text-text-muted', className)}>$0.00</span>;
  }

  return <span className={cn('font-mono text-xs', className)}>{formatCost(cost.totalCost)}</span>;
}

export default SessionCostCounter;
