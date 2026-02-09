'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  Zap,
  AlertTriangle,
  Loader2,
  CheckCircle,
  Server,
  HardDrive,
  MemoryStick,
} from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import type { WorkspaceTier } from '@podex/shared';
import {
  scaleWorkspace,
  getScaleOptions,
  type ScaleOptionTier,
  type CurrentTierInfo,
} from '@/lib/api';

interface WorkspaceScalingModalProps {
  sessionId: string;
  workspaceId: string;
  currentTier: WorkspaceTier;
  onClose: () => void;
}

/**
 * Modal for scaling a workspace's compute resources.
 * Shows only tiers compatible with the workspace's current server.
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
  const [scaleOptions, setScaleOptions] = useState<ScaleOptionTier[]>([]);
  const [currentTierInfo, setCurrentTierInfo] = useState<CurrentTierInfo | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { updateSessionWorkspaceTier } = useSessionStore();

  // Fetch scale options on mount
  useEffect(() => {
    const fetchScaleOptions = async () => {
      try {
        const response = await getScaleOptions(sessionId);
        setServerId(response.server_id);

        if (response.error) {
          setError(response.error);
          return;
        }

        // Set current tier info from response
        if (response.current_tier_info) {
          setCurrentTierInfo(response.current_tier_info);
        }

        // Build the list including current tier for display
        const allTiers = [...response.available_tiers];

        // Add current tier to the list if we have info (for display in the tier list)
        if (response.current_tier_info) {
          allTiers.push({
            tier: response.current_tier_info.tier,
            display_name: response.current_tier_info.display_name,
            can_scale: true, // Current tier is always "selectable" (to show as current)
            reason: null,
            cpu: response.current_tier_info.cpu,
            memory_mb: response.current_tier_info.memory_mb,
            storage_gb: response.current_tier_info.storage_gb,
            bandwidth_mbps: response.current_tier_info.bandwidth_mbps,
            hourly_rate_cents: response.current_tier_info.hourly_rate_cents,
            is_gpu: response.current_tier_info.is_gpu,
            gpu_type: response.current_tier_info.gpu_type,
          });
        }

        // Sort by hourly rate
        allTiers.sort((a, b) => a.hourly_rate_cents - b.hourly_rate_cents);

        setScaleOptions(allTiers);
      } catch (err) {
        console.error('Failed to fetch scale options:', err);
        setError('Failed to load scaling options');
      } finally {
        setIsLoading(false);
      }
    };

    fetchScaleOptions();
  }, [sessionId]);

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

  const getTierIcon = (tier: ScaleOptionTier) => {
    if (tier.is_gpu) {
      return <Zap className="h-5 w-5 text-purple-400" />;
    }
    return <Cpu className="h-5 w-5 text-blue-400" />;
  };

  const formatMemory = (mb: number): string => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(0)}GB`;
    }
    return `${mb}MB`;
  };

  const formatPrice = (cents: number): string => {
    return `$${(cents / 100).toFixed(3)}/hr`;
  };

  const getSelectedTierInfo = (): ScaleOptionTier | undefined => {
    return scaleOptions.find((t) => t.tier === selectedTier);
  };

  const selectedInfo = getSelectedTierInfo();

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
        className="relative w-full max-w-2xl rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Server className="h-5 w-5 text-blue-400" />
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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
              <span className="ml-2 text-text-secondary">Loading available options...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Server Info Banner */}
              {serverId && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-overlay border border-border-subtle">
                  <Server className="h-4 w-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">
                    Server: <span className="text-text-primary font-medium">{serverId}</span>
                  </span>
                  <span className="text-xs text-text-muted ml-auto">
                    Only compatible tiers shown
                  </span>
                </div>
              )}

              {/* Current vs Selected Comparison */}
              {currentTierInfo && selectedInfo && selectedTier !== currentTier && (
                <div className="grid grid-cols-2 gap-4">
                  {/* Current */}
                  <div className="p-4 rounded-lg bg-overlay border border-border-subtle">
                    <div className="text-xs text-text-muted uppercase tracking-wider mb-2">
                      Current
                    </div>
                    <div className="font-medium text-text-primary">
                      {currentTierInfo.display_name}
                    </div>
                    <div className="mt-2 space-y-1 text-sm text-text-secondary">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-3.5 w-3.5" />
                        <span>{currentTierInfo.cpu} vCPU</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-3.5 w-3.5" />
                        <span>{formatMemory(currentTierInfo.memory_mb)} RAM</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5" />
                        <span>{currentTierInfo.storage_gb}GB storage</span>
                      </div>
                    </div>
                    <div className="mt-2 text-sm font-medium text-text-muted">
                      {formatPrice(currentTierInfo.hourly_rate_cents)}
                    </div>
                  </div>

                  {/* Selected */}
                  <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                    <div className="text-xs text-blue-400 uppercase tracking-wider mb-2">
                      New Tier
                    </div>
                    <div className="font-medium text-text-primary">{selectedInfo.display_name}</div>
                    <div className="mt-2 space-y-1 text-sm text-text-secondary">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-3.5 w-3.5" />
                        <span>
                          {selectedInfo.cpu} vCPU
                          {selectedInfo.cpu > currentTierInfo.cpu && (
                            <span className="text-green-400 ml-1">
                              (+{selectedInfo.cpu - currentTierInfo.cpu})
                            </span>
                          )}
                          {selectedInfo.cpu < currentTierInfo.cpu && (
                            <span className="text-yellow-400 ml-1">
                              ({selectedInfo.cpu - currentTierInfo.cpu})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-3.5 w-3.5" />
                        <span>
                          {formatMemory(selectedInfo.memory_mb)} RAM
                          {selectedInfo.memory_mb > currentTierInfo.memory_mb && (
                            <span className="text-green-400 ml-1">
                              (+
                              {formatMemory(selectedInfo.memory_mb - currentTierInfo.memory_mb)})
                            </span>
                          )}
                          {selectedInfo.memory_mb < currentTierInfo.memory_mb && (
                            <span className="text-yellow-400 ml-1">
                              (-
                              {formatMemory(currentTierInfo.memory_mb - selectedInfo.memory_mb)})
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5" />
                        <span>{selectedInfo.storage_gb}GB storage</span>
                      </div>
                      {selectedInfo.is_gpu && selectedInfo.gpu_type && (
                        <div className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-purple-400" />
                          <span className="text-purple-400">{selectedInfo.gpu_type} GPU</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-medium text-blue-400">
                      {formatPrice(selectedInfo.hourly_rate_cents)}
                    </div>
                  </div>
                </div>
              )}

              {/* Tier Selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-text-primary">Select compute tier</label>

                <div className="grid grid-cols-1 gap-2 max-h-72 overflow-y-auto pr-1">
                  {scaleOptions.map((tier) => {
                    const isSelected = selectedTier === tier.tier;
                    const isCurrent = currentTier === tier.tier;
                    const isDisabled = !tier.can_scale && !isCurrent;

                    return (
                      <div
                        key={tier.tier}
                        onClick={() => {
                          if (!isDisabled) {
                            setSelectedTier(tier.tier as WorkspaceTier);
                          }
                        }}
                        className={`
                          relative p-4 rounded-lg border transition-all
                          ${
                            isDisabled
                              ? 'border-border-subtle bg-surface/50 opacity-60 cursor-not-allowed'
                              : isSelected
                                ? 'border-blue-400 bg-blue-500/5 cursor-pointer'
                                : 'border-border-subtle hover:border-border-default bg-surface hover:bg-overlay cursor-pointer'
                          }
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getTierIcon(tier)}
                            <div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`font-medium ${isDisabled ? 'text-text-muted' : 'text-text-primary'}`}
                                >
                                  {tier.display_name}
                                </span>
                                {isCurrent && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400">
                                    Current
                                  </span>
                                )}
                                {tier.is_gpu && (
                                  <span className="text-xs px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">
                                    GPU
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-sm text-text-secondary">
                                <span>{tier.cpu} vCPU</span>
                                <span className="text-text-muted">|</span>
                                <span>{formatMemory(tier.memory_mb)} RAM</span>
                                <span className="text-text-muted">|</span>
                                <span>{tier.storage_gb}GB</span>
                              </div>
                              {isDisabled && tier.reason && (
                                <p className="text-xs text-yellow-400 mt-1">{tier.reason}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`text-sm font-medium ${isDisabled ? 'text-text-muted' : 'text-text-secondary'}`}
                            >
                              {formatPrice(tier.hourly_rate_cents)}
                            </span>
                            {isSelected && !isDisabled && (
                              <CheckCircle className="h-5 w-5 text-blue-400" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Warning for scaling */}
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
              <>Scale to {getSelectedTierInfo()?.display_name || selectedTier}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
