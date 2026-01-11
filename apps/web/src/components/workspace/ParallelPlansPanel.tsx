'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  usePlanningStore,
  type GeneratedPlan,
  type PlanStep,
  type PlanComparison,
} from '@/stores/planning';
import {
  Layers,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Clock,
  Loader2,
  FileCode,
  GitBranch,
  ThumbsUp,
  ThumbsDown,
  Scale,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface ParallelPlansPanelProps {
  sessionId: string;
  className?: string;
  onSelectPlan?: (planId: string) => void;
  onComparePlans?: (planIds: string[]) => void;
}

export function ParallelPlansPanel({
  sessionId,
  className,
  onSelectPlan,
  onComparePlans,
}: ParallelPlansPanelProps) {
  const {
    getSessionPlans,
    getSelectedPlan,
    selectPlan,
    isGenerating,
    comparison,
    setShowComparisonView,
    setComparisonPlanIds,
  } = usePlanningStore();

  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [selectedForComparison, setSelectedForComparison] = useState<Set<string>>(new Set());

  const plans = getSessionPlans(sessionId);
  const selectedPlan = getSelectedPlan(sessionId);

  const completedPlans = plans.filter((p) => p.status === 'completed' || p.status === 'selected');
  const generatingPlans = plans.filter((p) => p.status === 'generating');

  const toggleComparison = (planId: string) => {
    const newSet = new Set(selectedForComparison);
    if (newSet.has(planId)) {
      newSet.delete(planId);
    } else if (newSet.size < 3) {
      newSet.add(planId);
    }
    setSelectedForComparison(newSet);
  };

  const handleCompare = () => {
    const planIds = Array.from(selectedForComparison);
    if (planIds.length >= 2) {
      setComparisonPlanIds(planIds);
      setShowComparisonView(true);
      onComparePlans?.(planIds);
    }
  };

  const handleSelectPlan = (planId: string) => {
    selectPlan(sessionId, planId);
    onSelectPlan?.(planId);
  };

  if (plans.length === 0 && !isGenerating) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
        <Layers className="w-12 h-12 mb-3 opacity-50 text-text-muted" />
        <p className="text-base font-medium text-text-muted">No plans generated</p>
        <p className="text-sm text-text-muted mt-1">
          Plans will appear here when the agent creates implementation strategies
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-accent-primary" />
          <h3 className="font-semibold">Implementation Plans</h3>
          {completedPlans.length > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-surface-secondary text-text-muted">
              {completedPlans.length}
            </span>
          )}
        </div>

        {selectedForComparison.size >= 2 && (
          <button
            onClick={handleCompare}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90"
          >
            <Scale className="w-4 h-4" />
            Compare ({selectedForComparison.size})
          </button>
        )}
      </div>

      {/* Generating indicator */}
      {generatingPlans.length > 0 && (
        <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20">
          <div className="flex items-center gap-2 text-yellow-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">
              Generating {generatingPlans.length} plan{generatingPlans.length > 1 ? 's' : ''}...
            </span>
          </div>
        </div>
      )}

      {/* Plans list */}
      <div className="flex-1 overflow-y-auto">
        {completedPlans.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            index={index + 1}
            isSelected={selectedPlan?.id === plan.id}
            isExpanded={expandedPlanId === plan.id}
            isSelectedForComparison={selectedForComparison.has(plan.id)}
            onToggleExpand={() => setExpandedPlanId(expandedPlanId === plan.id ? null : plan.id)}
            onSelect={() => handleSelectPlan(plan.id)}
            onToggleComparison={() => toggleComparison(plan.id)}
            comparison={comparison}
          />
        ))}
      </div>

      {/* Recommendations */}
      {comparison && comparison.recommendations.length > 0 && (
        <div className="px-4 py-3 border-t border-border-subtle bg-surface-secondary/50">
          <p className="text-xs font-medium text-text-muted mb-2">Recommendations</p>
          <ul className="space-y-1">
            {comparison.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-secondary">
                <Sparkles className="w-3 h-3 mt-0.5 text-accent-primary flex-shrink-0" />
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface PlanCardProps {
  plan: GeneratedPlan;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  isSelectedForComparison: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onToggleComparison: () => void;
  comparison: PlanComparison | null;
}

function PlanCard({
  plan,
  index,
  isSelected,
  isExpanded,
  isSelectedForComparison,
  onToggleExpand,
  onSelect,
  onToggleComparison,
  comparison,
}: PlanCardProps) {
  const complexityScore = comparison?.complexityScores[plan.id];
  const stepCount = comparison?.stepCounts[plan.id] || plan.steps.length;
  const filesCount =
    comparison?.filesTouched[plan.id] || new Set(plan.steps.flatMap((s) => s.filesAffected)).size;

  const complexityColor = {
    low: 'text-green-500',
    medium: 'text-yellow-500',
    high: 'text-red-500',
  }[plan.totalEstimatedComplexity];

  return (
    <div
      className={cn(
        'border-b border-border-subtle',
        isSelected && 'bg-accent-primary/5 border-l-2 border-l-accent-primary',
        isSelectedForComparison && 'ring-1 ring-inset ring-blue-500/50'
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={onToggleExpand}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleComparison();
          }}
          className={cn(
            'w-5 h-5 rounded border flex items-center justify-center transition-colors',
            isSelectedForComparison
              ? 'border-blue-500 bg-blue-500 text-white'
              : 'border-border-subtle hover:border-blue-500'
          )}
        >
          {isSelectedForComparison && <CheckCircle className="w-3 h-3" />}
        </button>

        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 text-xs rounded bg-surface-secondary text-text-muted">
              #{index}
            </span>
            <h4 className="font-medium truncate">{plan.approachName}</h4>
            {isSelected && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-500">
                Selected
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted truncate mt-0.5">{plan.approachSummary}</p>
        </div>

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {plan.generationTimeMs}ms
          </span>
          <span className={cn('flex items-center gap-1', complexityColor)}>
            <AlertTriangle className="w-3 h-3" />
            {plan.totalEstimatedComplexity}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Stats row */}
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-text-muted">
              <GitBranch className="w-4 h-4" />
              {stepCount} steps
            </span>
            <span className="flex items-center gap-1 text-text-muted">
              <FileCode className="w-4 h-4" />
              {filesCount} files
            </span>
            {complexityScore !== undefined && (
              <span className="flex items-center gap-1 text-text-muted">
                <AlertTriangle className="w-4 h-4" />
                Score: {complexityScore}
              </span>
            )}
          </div>

          {/* Pros/Cons */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-green-500 mb-1 flex items-center gap-1">
                <ThumbsUp className="w-3 h-3" />
                Pros
              </p>
              <ul className="space-y-1">
                {plan.pros.map((pro, i) => (
                  <li key={i} className="text-xs text-text-secondary flex items-start gap-1">
                    <span className="text-green-500">+</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-red-500 mb-1 flex items-center gap-1">
                <ThumbsDown className="w-3 h-3" />
                Cons
              </p>
              <ul className="space-y-1">
                {plan.cons.map((con, i) => (
                  <li key={i} className="text-xs text-text-secondary flex items-start gap-1">
                    <span className="text-red-500">-</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Steps */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-2">Implementation Steps</p>
            <div className="space-y-2">
              {plan.steps.map((step) => (
                <StepItem key={step.index} step={step} />
              ))}
            </div>
          </div>

          {/* Select button */}
          {!isSelected && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
              className="w-full py-2 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90 flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Select This Plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface StepItemProps {
  step: PlanStep;
}

function StepItem({ step }: StepItemProps) {
  const complexityColor = {
    low: 'bg-green-500',
    medium: 'bg-yellow-500',
    high: 'bg-red-500',
  }[step.estimatedComplexity];

  return (
    <div className="flex items-start gap-2 p-2 rounded bg-surface-secondary/50">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-surface-secondary text-xs flex items-center justify-center text-text-muted">
        {step.index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{step.title}</p>
          <span
            className={cn('w-2 h-2 rounded-full', complexityColor)}
            title={`${step.estimatedComplexity} complexity`}
          />
        </div>
        <p className="text-xs text-text-muted mt-0.5">{step.description}</p>
        {step.filesAffected.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {step.filesAffected.slice(0, 3).map((file) => (
              <span
                key={file}
                className="px-1.5 py-0.5 text-xs rounded bg-surface-primary text-text-muted"
              >
                {file.split('/').pop()}
              </span>
            ))}
            {step.filesAffected.length > 3 && (
              <span className="text-xs text-text-muted">+{step.filesAffected.length - 3} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ParallelPlansPanel;
