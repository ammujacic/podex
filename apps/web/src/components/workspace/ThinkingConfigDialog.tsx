'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@podex/ui';
import { Brain, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingConfig } from '@podex/shared';
import { THINKING_PRESETS } from '@podex/shared';

interface ThinkingConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ThinkingConfig | undefined;
  onSave: (config: ThinkingConfig) => void;
  modelName: string;
}

const MIN_BUDGET = 1024;
const MAX_BUDGET = 32000;

/**
 * Dialog for configuring extended thinking settings per agent
 */
export function ThinkingConfigDialog({
  open,
  onOpenChange,
  config,
  onSave,
  modelName,
}: ThinkingConfigDialogProps) {
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [budgetTokens, setBudgetTokens] = useState(config?.budgetTokens ?? 8000);

  // Sync state when config prop changes
  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setBudgetTokens(config.budgetTokens);
    }
  }, [config]);

  const handleSave = useCallback(() => {
    onSave({
      enabled,
      budgetTokens: Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, budgetTokens)),
    });
    onOpenChange(false);
  }, [enabled, budgetTokens, onSave, onOpenChange]);

  const handlePresetClick = useCallback((tokens: number) => {
    setBudgetTokens(tokens);
    setEnabled(true);
  }, []);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBudgetTokens(parseInt(e.target.value, 10));
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-blue-400" />
            Extended Thinking Settings
          </DialogTitle>
          <DialogDescription>
            Configure extended thinking for{' '}
            <span className="font-medium text-text-primary">{modelName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-6">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className={cn('h-5 w-5', enabled ? 'text-blue-400' : 'text-text-muted')} />
              <div>
                <p className="text-sm font-medium text-text-primary">Enable Extended Thinking</p>
                <p className="text-xs text-text-muted">Allow deeper reasoning before responding</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div
                className={cn(
                  'w-11 h-6 rounded-full transition-colors',
                  enabled ? 'bg-blue-500' : 'bg-overlay'
                )}
              >
                <div
                  className={cn(
                    'absolute w-5 h-5 bg-white rounded-full top-0.5 left-0.5 transition-transform',
                    enabled && 'translate-x-5'
                  )}
                />
              </div>
            </label>
          </div>

          {/* Budget Slider */}
          <div className={cn('space-y-3', !enabled && 'opacity-50 pointer-events-none')}>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-primary">Thinking Budget</label>
              <span className="text-sm font-mono text-text-secondary">
                {budgetTokens.toLocaleString()} tokens
              </span>
            </div>

            <input
              type="range"
              min={MIN_BUDGET}
              max={MAX_BUDGET}
              step={1000}
              value={budgetTokens}
              onChange={handleSliderChange}
              disabled={!enabled}
              className="w-full h-2 bg-overlay rounded-lg appearance-none cursor-pointer accent-blue-500"
            />

            <div className="flex justify-between text-xs text-text-muted">
              <span>1K</span>
              <span>8K</span>
              <span>16K</span>
              <span>32K</span>
            </div>
          </div>

          {/* Presets */}
          <div className={cn('space-y-2', !enabled && 'opacity-50 pointer-events-none')}>
            <label className="text-sm font-medium text-text-primary">Presets</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(THINKING_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => handlePresetClick(preset.tokens)}
                  disabled={!enabled}
                  className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    budgetTokens === preset.tokens
                      ? 'bg-blue-500 text-white'
                      : 'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-xs text-text-secondary space-y-1">
              <p>
                Extended thinking allows the model to reason more deeply before responding,
                improving quality on complex tasks.
              </p>
              <p>
                Higher budgets can improve analysis but increase response time and cost. Start with{' '}
                <strong className="text-text-primary">Medium (8K)</strong> for most tasks.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
