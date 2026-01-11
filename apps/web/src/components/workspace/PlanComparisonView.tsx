'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { usePlanningStore, type GeneratedPlan, type PlanComparison } from '@/stores/planning';
import {
  X,
  Scale,
  CheckCircle,
  Clock,
  FileCode,
  GitBranch,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  Trophy,
  Sparkles,
} from 'lucide-react';

interface PlanComparisonViewProps {
  sessionId: string;
  className?: string;
  onClose: () => void;
  onSelectPlan?: (planId: string) => void;
}

export function PlanComparisonView({
  sessionId,
  className,
  onClose,
  onSelectPlan,
}: PlanComparisonViewProps) {
  const { getSessionPlans, comparisonPlanIds, comparison, selectPlan } = usePlanningStore();

  const allPlans = getSessionPlans(sessionId);
  const plansToCompare = allPlans.filter((p) => comparisonPlanIds.includes(p.id));

  if (plansToCompare.length < 2) {
    return null;
  }

  const handleSelectPlan = (planId: string) => {
    selectPlan(sessionId, planId);
    onSelectPlan?.(planId);
    onClose();
  };

  // Find the "best" plan (lowest complexity score)
  const bestPlanId = comparison
    ? Object.entries(comparison.complexityScores).sort((a, b) => a[1] - b[1])[0]?.[0]
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className={cn(
          'w-full max-w-6xl max-h-[90vh] bg-surface-primary rounded-lg shadow-xl flex flex-col',
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <Scale className="w-6 h-6 text-accent-primary" />
            <h2 className="text-xl font-semibold">Compare Plans</h2>
            <span className="px-2 py-0.5 text-sm rounded bg-surface-secondary text-text-muted">
              {plansToCompare.length} plans
            </span>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comparison Grid */}
        <div className="flex-1 overflow-x-auto p-6">
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${plansToCompare.length}, minmax(280px, 1fr))`,
            }}
          >
            {plansToCompare.map((plan) => (
              <ComparisonColumn
                key={plan.id}
                plan={plan}
                isBest={plan.id === bestPlanId}
                comparison={comparison}
                onSelect={() => handleSelectPlan(plan.id)}
              />
            ))}
          </div>
        </div>

        {/* Recommendations Footer */}
        {comparison && comparison.recommendations.length > 0 && (
          <div className="px-6 py-4 border-t border-border-subtle bg-surface-secondary/50">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-accent-primary" />
              <h3 className="text-sm font-medium">AI Recommendations</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              {comparison.recommendations.map((rec, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 text-sm rounded-full bg-surface-primary border border-border-subtle"
                >
                  {rec}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ComparisonColumnProps {
  plan: GeneratedPlan;
  isBest: boolean;
  comparison: PlanComparison | null;
  onSelect: () => void;
}

function ComparisonColumn({ plan, isBest, comparison, onSelect }: ComparisonColumnProps) {
  const complexityScore = comparison?.complexityScores[plan.id] || 0;
  const stepCount = comparison?.stepCounts[plan.id] || plan.steps.length;
  const filesCount =
    comparison?.filesTouched[plan.id] || new Set(plan.steps.flatMap((s) => s.filesAffected)).size;

  const uniqueAspects = comparison?.uniqueApproaches[plan.id] || [];

  const complexityColor = {
    low: 'text-green-500 bg-green-500/10',
    medium: 'text-yellow-500 bg-yellow-500/10',
    high: 'text-red-500 bg-red-500/10',
  }[plan.totalEstimatedComplexity];

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border overflow-hidden',
        isBest ? 'border-accent-primary bg-accent-primary/5' : 'border-border-subtle'
      )}
    >
      {/* Plan Header */}
      <div className="p-4 border-b border-border-subtle">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{plan.approachName}</h3>
              {isBest && <Trophy className="w-4 h-4 text-yellow-500" />}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              via {plan.modelUsed.split('-').slice(0, 2).join(' ')}
            </p>
          </div>
          <span className={cn('px-2 py-1 text-xs rounded', complexityColor)}>
            {plan.totalEstimatedComplexity}
          </span>
        </div>
        <p className="text-sm text-text-secondary mt-2 line-clamp-2">{plan.approachSummary}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-border-subtle border-b border-border-subtle">
        <div className="p-3 text-center">
          <p className="text-lg font-semibold">{stepCount}</p>
          <p className="text-xs text-text-muted flex items-center justify-center gap-1">
            <GitBranch className="w-3 h-3" />
            Steps
          </p>
        </div>
        <div className="p-3 text-center">
          <p className="text-lg font-semibold">{filesCount}</p>
          <p className="text-xs text-text-muted flex items-center justify-center gap-1">
            <FileCode className="w-3 h-3" />
            Files
          </p>
        </div>
        <div className="p-3 text-center">
          <p className="text-lg font-semibold">{complexityScore}</p>
          <p className="text-xs text-text-muted flex items-center justify-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Score
          </p>
        </div>
      </div>

      {/* Pros */}
      <div className="p-4 border-b border-border-subtle">
        <p className="text-xs font-medium text-green-500 mb-2 flex items-center gap-1">
          <ThumbsUp className="w-3 h-3" />
          Advantages
        </p>
        <ul className="space-y-1">
          {plan.pros.map((pro, i) => (
            <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
              <CheckCircle className="w-3 h-3 mt-1 text-green-500 flex-shrink-0" />
              {pro}
            </li>
          ))}
        </ul>
      </div>

      {/* Cons */}
      <div className="p-4 border-b border-border-subtle">
        <p className="text-xs font-medium text-red-500 mb-2 flex items-center gap-1">
          <ThumbsDown className="w-3 h-3" />
          Trade-offs
        </p>
        <ul className="space-y-1">
          {plan.cons.map((con, i) => (
            <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 mt-1 text-red-500 flex-shrink-0" />
              {con}
            </li>
          ))}
        </ul>
      </div>

      {/* Unique Aspects */}
      {uniqueAspects.length > 0 && (
        <div className="p-4 border-b border-border-subtle">
          <p className="text-xs font-medium text-blue-500 mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Unique Aspects
          </p>
          <div className="flex flex-wrap gap-2">
            {uniqueAspects.map((aspect, i) => (
              <span key={i} className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-500">
                {aspect}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Steps Preview */}
      <div className="p-4 flex-1">
        <p className="text-xs font-medium text-text-muted mb-2">Steps Overview</p>
        <div className="space-y-2">
          {plan.steps.slice(0, 4).map((step) => (
            <div key={step.index} className="flex items-center gap-2 text-sm">
              <span className="w-5 h-5 rounded-full bg-surface-secondary text-xs flex items-center justify-center flex-shrink-0">
                {step.index + 1}
              </span>
              <span className="truncate text-text-secondary">{step.title}</span>
            </div>
          ))}
          {plan.steps.length > 4 && (
            <p className="text-xs text-text-muted pl-7">+{plan.steps.length - 4} more steps</p>
          )}
        </div>
      </div>

      {/* Generation Time */}
      <div className="px-4 py-2 bg-surface-secondary/50 text-xs text-text-muted flex items-center gap-1">
        <Clock className="w-3 h-3" />
        Generated in {plan.generationTimeMs}ms
      </div>

      {/* Select Button */}
      <div className="p-4 border-t border-border-subtle">
        <button
          onClick={onSelect}
          className={cn(
            'w-full py-2.5 rounded font-medium text-sm flex items-center justify-center gap-2 transition-colors',
            isBest
              ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
              : 'bg-surface-secondary hover:bg-surface-hover'
          )}
        >
          <CheckCircle className="w-4 h-4" />
          {isBest ? 'Select Best Plan' : 'Select This Plan'}
        </button>
      </div>
    </div>
  );
}

export default PlanComparisonView;
