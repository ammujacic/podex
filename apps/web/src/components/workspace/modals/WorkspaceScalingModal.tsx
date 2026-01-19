'use client';

import React, { useState, useEffect } from 'react';
import { X, Cpu, Zap, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import type { WorkspaceTier, HardwareSpec } from '@podex/shared';
import { scaleWorkspace, getHardwareSpecs } from '@/lib/api';

interface WorkspaceScalingModalProps {
  sessionId: string;
  workspaceId: string;
  currentTier: WorkspaceTier;
  onClose: () => void;
}

/**
 * Modal for scaling a workspace's compute resources.
 */
export function WorkspaceScalingModal({
  sessionId,
  workspaceId: _workspaceId,
  currentTier,
  onClose,
}: WorkspaceScalingModalProps) {
  const [isScaling, setIsScaling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<WorkspaceTier>(currentTier);
  const [hardwareSpecs, setHardwareSpecs] = useState<HardwareSpec[]>([]);
  const [isLoadingSpecs, setIsLoadingSpecs] = useState(true);
  const { updateSessionWorkspaceTier } = useSessionStore();

  // Fetch hardware specs on mount
  useEffect(() => {
    const fetchHardwareSpecs = async () => {
      try {
        const specs = await getHardwareSpecs();
        setHardwareSpecs(specs);
      } catch (err) {
        console.error('Failed to fetch hardware specs:', err);
        setError('Failed to load hardware specifications');
      } finally {
        setIsLoadingSpecs(false);
      }
    };

    fetchHardwareSpecs();
  }, []);

  const handleScale = async () => {
    if (selectedTier === currentTier) {
      onClose();
      return;
    }

    setIsScaling(true);
    setError(null);

    try {
      const result = await scaleWorkspace(sessionId, selectedTier);

      if (result.success) {
        // Update the session store with the new tier
        updateSessionWorkspaceTier(sessionId, selectedTier);
        onClose();
      } else {
        setError(result.message || 'Failed to scale workspace');
      }
    } catch (err) {
      console.error('Failed to scale workspace:', err);
      setError(err instanceof Error ? err.message : 'Failed to scale workspace');
    } finally {
      setIsScaling(false);
    }
  };

  const getSpecByTier = (tier: WorkspaceTier): HardwareSpec | undefined => {
    return hardwareSpecs.find((spec) => spec.tier === tier);
  };

  const getTierIcon = (tier: WorkspaceTier) => {
    const spec = getSpecByTier(tier);
    if (spec?.gpu_type && spec.gpu_type !== 'none') {
      return <Zap className="h-4 w-4 text-purple-400" />;
    }
    return <Cpu className="h-4 w-4 text-blue-400" />;
  };

  const getTierDescription = (tier: WorkspaceTier) => {
    const spec = getSpecByTier(tier);
    if (!spec) return '';

    const gpuInfo = spec.gpu_memory_gb ? `, ${spec.gpu_memory_gb}GB GPU` : '';
    return `${spec.vcpu} vCPU, ${spec.memory_mb}MB RAM${gpuInfo}`;
  };

  const getTierDisplayName = (tier: WorkspaceTier) => {
    const spec = getSpecByTier(tier);
    return spec?.display_name || tier;
  };

  const getTierPrice = (tier: WorkspaceTier) => {
    const spec = getSpecByTier(tier);
    return spec?.user_hourly_rate || spec?.hourly_rate || 0;
  };

  const availableTiers = hardwareSpecs.filter((spec) => spec.is_available).map((spec) => spec.tier);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-scaling-title"
        className="relative w-full max-w-lg rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Cpu className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h2 id="workspace-scaling-title" className="text-lg font-semibold text-text-primary">
                Scale Workspace
              </h2>
              <p className="text-sm text-text-secondary">
                Adjust compute resources for this workspace
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoadingSpecs ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
              <span className="ml-2 text-text-secondary">Loading hardware specifications...</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-text-secondary">
                Current tier:{' '}
                <span className="font-medium text-text-primary">
                  {getTierDisplayName(currentTier)}
                </span>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-text-primary">Select new tier:</label>

                <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto">
                  {availableTiers.map((tier) => {
                    const spec = getSpecByTier(tier);
                    if (!spec) return null;

                    const isSelected = selectedTier === tier;
                    const isCurrent = currentTier === tier;

                    return (
                      <div
                        key={tier}
                        onClick={() => setSelectedTier(tier)}
                        className={`
                          relative p-4 rounded-lg border cursor-pointer transition-all
                          ${
                            isSelected
                              ? 'border-blue-400 bg-blue-500/5'
                              : 'border-border-subtle hover:border-border-default bg-surface hover:bg-overlay'
                          }
                        `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            {getTierIcon(tier)}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-text-primary">
                                  {spec.display_name}
                                </span>
                                {isCurrent && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400">
                                    Current
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-text-secondary mt-1">
                                {getTierDescription(tier)}
                              </p>
                              <p className="text-xs text-text-muted mt-1">
                                ${getTierPrice(tier).toFixed(3)}/hour
                              </p>
                            </div>
                          </div>

                          {isSelected && <CheckCircle className="h-5 w-5 text-blue-400" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Warning for scaling down */}
              {selectedTier !== currentTier && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="text-yellow-400 font-medium">Workspace will restart</p>
                    <p className="text-text-secondary mt-1">
                      Scaling requires restarting the workspace. Any unsaved work will be lost.
                    </p>
                  </div>
                </div>
              )}

              {/* Error display */}
              {error && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="text-red-400 font-medium">Scaling failed</p>
                    <p className="text-text-secondary mt-1">{error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border-subtle">
          <button
            onClick={onClose}
            disabled={isScaling}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleScale}
            disabled={isScaling || selectedTier === currentTier}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
          >
            {isScaling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scaling...
              </>
            ) : selectedTier === currentTier ? (
              'No changes'
            ) : (
              <>Scale to {getTierDisplayName(selectedTier)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
