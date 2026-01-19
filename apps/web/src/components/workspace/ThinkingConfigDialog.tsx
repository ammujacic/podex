'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Brain, Info, X, AlertTriangle, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingConfig } from '@podex/shared';
import {
  isCliAgentRole,
  getCliAgentType,
  getCliCapabilities,
  type CliCapabilities,
} from '@/hooks/useCliAgentCommands';
import { useConfigStore } from '@/stores/config';

interface ThinkingConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ThinkingConfig | undefined;
  onSave: (config: ThinkingConfig) => void;
  modelName: string;
  /** Agent role for checking CLI-specific capabilities */
  agentRole?: string;
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
  agentRole,
}: ThinkingConfigDialogProps) {
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [budgetTokens, setBudgetTokens] = useState(config?.budgetTokens ?? 8000);

  // Get thinking presets from config store
  const getThinkingPresets = useConfigStore((state) => state.getThinkingPresets);
  const configError = useConfigStore((state) => state.error);
  const configLoading = useConfigStore((state) => state.isLoading);
  const initializeConfig = useConfigStore((state) => state.initialize);

  const thinkingPresets = useMemo(() => getThinkingPresets(), [getThinkingPresets]);

  // Initialize config store on mount
  useEffect(() => {
    initializeConfig();
  }, [initializeConfig]);

  // Check CLI capabilities for thinking support
  const cliCapabilities: CliCapabilities | null = useMemo(() => {
    if (!agentRole || !isCliAgentRole(agentRole)) return null;
    const cliType = getCliAgentType(agentRole);
    if (!cliType) return null;
    return getCliCapabilities(cliType);
  }, [agentRole]);

  const isCliAgent = cliCapabilities !== null;
  const thinkingNotSupported = isCliAgent && !cliCapabilities.thinkingSupported;
  const thinkingUsesEffort = isCliAgent && cliCapabilities.thinkingBudgetType === 'effort';

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 sm:px-6 py-4 shrink-0">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Brain className="h-5 w-5 text-purple-400" />
              Extended Thinking Settings
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Configure extended thinking for{' '}
              <span className="font-medium text-text-primary">{modelName}</span>
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          {/* CLI Agent Warning - Thinking Not Supported */}
          {thinkingNotSupported && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary space-y-1">
                <p className="font-medium text-amber-400">Extended thinking not available</p>
                <p>{cliCapabilities?.thinkingDescription}</p>
                <p>This CLI agent manages reasoning internally. Settings below will be ignored.</p>
              </div>
            </div>
          )}

          {/* CLI Agent Info - Thinking Uses Effort Levels */}
          {thinkingUsesEffort && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary space-y-1">
                <p className="font-medium text-blue-400">Reasoning effort mode</p>
                <p>{cliCapabilities?.thinkingDescription}</p>
                <p>
                  Token budget will be converted to effort level: Low (&lt;5K), Medium (5-15K), High
                  (&gt;15K).
                </p>
              </div>
            </div>
          )}

          {/* Enable/Disable Toggle */}
          <div
            className={cn(
              'flex items-center justify-between',
              thinkingNotSupported && 'opacity-50 pointer-events-none'
            )}
          >
            <div className="flex items-center gap-3">
              <Brain
                className={cn(
                  'h-5 w-5',
                  enabled && !thinkingNotSupported ? 'text-blue-400' : 'text-text-muted'
                )}
              />
              <div>
                <p className="text-sm font-medium text-text-primary">Enable Extended Thinking</p>
                <p className="text-xs text-text-muted">Allow deeper reasoning before responding</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={enabled && !thinkingNotSupported}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={thinkingNotSupported}
                className="sr-only peer"
              />
              <div
                className={cn(
                  'w-11 h-6 rounded-full transition-colors',
                  enabled && !thinkingNotSupported ? 'bg-blue-500' : 'bg-overlay'
                )}
              >
                <div
                  className={cn(
                    'absolute w-5 h-5 bg-white rounded-full top-0.5 left-0.5 transition-transform',
                    enabled && !thinkingNotSupported && 'translate-x-5'
                  )}
                />
              </div>
            </label>
          </div>

          {/* Budget Slider */}
          <div
            className={cn(
              'space-y-3',
              (!enabled || thinkingNotSupported) && 'opacity-50 pointer-events-none'
            )}
          >
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
              disabled={!enabled || thinkingNotSupported}
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
          <div
            className={cn(
              'space-y-2',
              (!enabled || thinkingNotSupported) && 'opacity-50 pointer-events-none'
            )}
          >
            <label className="text-sm font-medium text-text-primary">Presets</label>
            {configError ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <span className="text-sm text-red-400">Failed to load presets</span>
                <button
                  onClick={() => initializeConfig()}
                  className="ml-auto text-xs text-red-400 hover:text-red-300"
                >
                  Retry
                </button>
              </div>
            ) : configLoading || !thinkingPresets ? (
              <div className="flex items-center gap-2 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                <span className="text-sm text-text-muted">Loading presets...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(thinkingPresets).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => handlePresetClick(preset.tokens)}
                    disabled={!enabled || thinkingNotSupported}
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
            )}
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

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border-subtle px-4 sm:px-6 py-4 shrink-0">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
