'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { usePlanningStore, AVAILABLE_MODELS } from '@/stores/planning';
import { Settings2, Cpu, Zap, ChevronDown, Sparkles, Clock } from 'lucide-react';

interface PlanningModelSelectorProps {
  className?: string;
  compact?: boolean;
}

export function PlanningModelSelector({ className, compact = false }: PlanningModelSelectorProps) {
  const { settings, updateSettings } = usePlanningStore();

  const planningModel = AVAILABLE_MODELS.find((m) => m.id === settings.planningModel);
  const executionModel = AVAILABLE_MODELS.find((m) => m.id === settings.executionModel);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-surface-secondary text-xs">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span className="text-text-muted">Plan:</span>
          <span className="font-medium">{planningModel?.name.split(' ').pop()}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-surface-secondary text-xs">
          <Zap className="w-3 h-3 text-yellow-400" />
          <span className="text-text-muted">Exec:</span>
          <span className="font-medium">{executionModel?.name.split(' ').pop()}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('p-4 space-y-4', className)}>
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="w-5 h-5 text-accent-primary" />
        <h3 className="font-semibold">Planning Configuration</h3>
      </div>

      {/* Planning Model */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="w-4 h-4 text-purple-400" />
          Planning Model
        </label>
        <p className="text-xs text-text-muted">
          Used for analyzing tasks and generating implementation plans
        </p>
        <div className="relative">
          <select
            value={settings.planningModel}
            onChange={(e) => updateSettings({ planningModel: e.target.value })}
            className="w-full appearance-none px-3 py-2 pr-8 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} {model.tier === 'premium' ? '(Premium)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Execution Model */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Zap className="w-4 h-4 text-yellow-400" />
          Execution Model
        </label>
        <p className="text-xs text-text-muted">
          Used for executing the plan steps and writing code
        </p>
        <div className="relative">
          <select
            value={settings.executionModel}
            onChange={(e) => updateSettings({ executionModel: e.target.value })}
            className="w-full appearance-none px-3 py-2 pr-8 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} {model.tier === 'premium' ? '(Premium)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Parallel Plans */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Cpu className="w-4 h-4 text-blue-400" />
          Parallel Plans
        </label>
        <p className="text-xs text-text-muted">
          Number of competing plans to generate for comparison
        </p>
        <div className="flex items-center gap-3">
          {[1, 2, 3, 4, 5].map((num) => (
            <button
              key={num}
              onClick={() => updateSettings({ parallelPlans: num })}
              className={cn(
                'w-10 h-10 rounded-lg border text-sm font-medium transition-colors',
                settings.parallelPlans === num
                  ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                  : 'border-border-subtle hover:border-border-primary'
              )}
            >
              {num}
            </button>
          ))}
        </div>
      </div>

      {/* Background Planning */}
      <div className="flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-green-400" />
          <div>
            <p className="text-sm font-medium">Background Planning</p>
            <p className="text-xs text-text-muted">Generate plans while you continue chatting</p>
          </div>
        </div>
        <button
          onClick={() => updateSettings({ backgroundPlanning: !settings.backgroundPlanning })}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors',
            settings.backgroundPlanning ? 'bg-accent-primary' : 'bg-surface-secondary'
          )}
        >
          <span
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              settings.backgroundPlanning ? 'left-6' : 'left-1'
            )}
          />
        </button>
      </div>

      {/* Auto-select */}
      <div className="flex items-center justify-between py-2 border-t border-border-subtle pt-4">
        <div>
          <p className="text-sm font-medium">Auto-select Simplest</p>
          <p className="text-xs text-text-muted">
            Automatically select the plan with lowest complexity
          </p>
        </div>
        <button
          onClick={() => updateSettings({ autoSelectSimplest: !settings.autoSelectSimplest })}
          className={cn(
            'relative w-11 h-6 rounded-full transition-colors',
            settings.autoSelectSimplest ? 'bg-accent-primary' : 'bg-surface-secondary'
          )}
        >
          <span
            className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              settings.autoSelectSimplest ? 'left-6' : 'left-1'
            )}
          />
        </button>
      </div>
    </div>
  );
}

export default PlanningModelSelector;
