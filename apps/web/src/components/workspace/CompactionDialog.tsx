'use client';

import React, { useState, useCallback } from 'react';
import { Zap, Settings, History, AlertTriangle, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useContextStore, type CompactionSettings } from '@/stores/context';

interface CompactionDialogProps {
  agentId: string;
  agentName: string;
  sessionId: string;
  onClose: () => void;
  onCompact: (instructions?: string) => Promise<void>;
}

type TabId = 'compact' | 'settings' | 'history';

export function CompactionDialog({
  agentId,
  agentName,
  sessionId,
  onClose,
  onCompact,
}: CompactionDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>('compact');
  const [customInstructions, setCustomInstructions] = useState('');
  const [isCompacting, setIsCompacting] = useState(false);

  const {
    agentUsage,
    getSessionSettings,
    updateSessionSettings,
    getCompactionHistory,
    setCompacting,
  } = useContextStore();

  const usage = agentUsage[agentId];
  const settings = getSessionSettings(sessionId);
  const history = getCompactionHistory(sessionId);

  const handleCompact = useCallback(async () => {
    setIsCompacting(true);
    setCompacting(agentId, true);
    try {
      await onCompact(customInstructions || undefined);
    } finally {
      setIsCompacting(false);
      setCompacting(agentId, false);
    }
  }, [agentId, customInstructions, onCompact, setCompacting]);

  const handleSettingsChange = useCallback(
    (updates: Partial<CompactionSettings>) => {
      updateSessionSettings(sessionId, updates);
    },
    [sessionId, updateSessionSettings]
  );

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'compact', label: 'Compact', icon: <Zap className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
    { id: 'history', label: 'History', icon: <History className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={() => onClose()} />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Zap className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Context Management</h2>
              <p className="text-sm text-text-muted">
                Manage context window for {agentName}. Compact to free up space or configure
                auto-compaction settings.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Usage Summary */}
        {usage && (
          <div className="mx-6 mb-4 p-4 rounded-lg border border-border-default bg-elevated">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">Context Usage</span>
              <span
                className={cn(
                  'text-sm font-mono font-semibold',
                  usage.percentage >= 90 && 'text-red-400',
                  usage.percentage >= 70 && usage.percentage < 90 && 'text-yellow-400',
                  usage.percentage < 70 && 'text-green-400'
                )}
              >
                {usage.percentage}%
              </span>
            </div>
            <div className="h-2 bg-void rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all duration-500',
                  usage.percentage >= 90 && 'bg-red-500',
                  usage.percentage >= 70 && usage.percentage < 90 && 'bg-yellow-500',
                  usage.percentage < 70 && 'bg-green-500'
                )}
                style={{ width: `${usage.percentage}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-xs text-text-muted">
              <span>{usage.tokensUsed.toLocaleString()} tokens used</span>
              <span>{usage.tokensMax.toLocaleString()} max</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border-subtle mx-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-accent-primary border-b-2 border-accent-primary -mb-px'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'compact' && (
            <div className="space-y-4">
              <p className="text-sm text-text-muted leading-relaxed">
                Compact the conversation to free up context space. The agent will summarize the
                conversation while preserving important context.
              </p>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  Custom Instructions (Optional)
                </label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="E.g., 'Preserve all code snippets' or 'Focus on the API design discussion'"
                  className="w-full h-24 px-3 py-2 text-sm bg-elevated border border-border-default rounded-md resize-none placeholder:text-text-muted focus:outline-none focus:border-border-focus"
                />
              </div>

              {usage && usage.percentage < 50 && (
                <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-text-muted leading-relaxed">
                    Context usage is low ({usage.percentage}%). Compacting now may not be necessary.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium text-text-primary">Auto-Compact</label>
                  <p className="text-xs text-text-muted mt-0.5">
                    Automatically compact when threshold is reached
                  </p>
                </div>
                <button
                  onClick={() =>
                    handleSettingsChange({
                      autoCompactEnabled: !settings.autoCompactEnabled,
                    })
                  }
                  className={cn(
                    'relative w-10 h-5 rounded-full transition-colors shrink-0',
                    settings.autoCompactEnabled ? 'bg-accent-primary' : 'bg-border-default'
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                      settings.autoCompactEnabled && 'translate-x-5'
                    )}
                  />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  Auto-Compact Threshold: {settings.autoCompactThresholdPercent}%
                </label>
                <input
                  type="range"
                  min={50}
                  max={95}
                  step={5}
                  value={settings.autoCompactThresholdPercent}
                  onChange={(e) =>
                    handleSettingsChange({
                      autoCompactThresholdPercent: parseInt(e.target.value),
                    })
                  }
                  className="w-full accent-accent-primary"
                />
                <div className="flex justify-between text-xs text-text-muted">
                  <span>50%</span>
                  <span>95%</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  Preserve Recent Messages: {settings.preserveRecentMessages}
                </label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={settings.preserveRecentMessages}
                  onChange={(e) =>
                    handleSettingsChange({
                      preserveRecentMessages: parseInt(e.target.value),
                    })
                  }
                  className="w-full accent-accent-primary"
                />
                <div className="flex justify-between text-xs text-text-muted">
                  <span>5</span>
                  <span>50</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-primary">
                  Default Compaction Instructions
                </label>
                <textarea
                  value={settings.customCompactionInstructions || ''}
                  onChange={(e) =>
                    handleSettingsChange({
                      customCompactionInstructions: e.target.value || null,
                    })
                  }
                  placeholder="Instructions to always include when compacting..."
                  className="w-full h-20 px-3 py-2 text-sm bg-elevated border border-border-default rounded-md resize-none placeholder:text-text-muted focus:outline-none focus:border-border-focus"
                />
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-default p-8 text-center">
                  <p className="text-sm text-text-muted">No compaction history yet</p>
                </div>
              ) : (
                history
                  .slice(-10)
                  .reverse()
                  .map((log) => (
                    <div
                      key={log.id}
                      className="p-3 bg-elevated rounded-lg border border-border-default"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-muted">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                        <span
                          className={cn(
                            'text-xs px-2 py-0.5 rounded-full font-medium',
                            log.triggerType === 'auto'
                              ? 'bg-blue-500/10 text-blue-400'
                              : 'bg-purple-500/10 text-purple-400'
                          )}
                        >
                          {log.triggerType}
                        </span>
                      </div>
                      <div className="text-sm font-mono">
                        <span className="text-red-400">{log.tokensBefore.toLocaleString()}</span>
                        <span className="text-text-muted mx-2">→</span>
                        <span className="text-green-400">{log.tokensAfter.toLocaleString()}</span>
                        <span className="text-text-muted ml-2">
                          (-{((1 - log.tokensAfter / log.tokensBefore) * 100).toFixed(0)}%)
                        </span>
                      </div>
                      {log.summaryText && (
                        <p className="text-xs text-text-muted mt-2 line-clamp-2">
                          {log.summaryText}
                        </p>
                      )}
                    </div>
                  ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4 shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          {activeTab === 'compact' && (
            <button
              onClick={handleCompact}
              disabled={isCompacting}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                !isCompacting
                  ? 'bg-accent-primary text-text-inverse hover:bg-accent-primary/90'
                  : 'bg-elevated text-text-muted cursor-not-allowed'
              )}
            >
              {isCompacting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Compacting...
                </span>
              ) : (
                'Compact Now'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
