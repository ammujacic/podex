'use client';

import { useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Zap, Check } from 'lucide-react';

interface HardwareSpec {
  id: string;
  tier: string;
  displayName: string;
  description?: string;
  architecture: string;
  vcpu: number;
  memoryMb: number;
  gpuType?: string;
  gpuMemoryGb?: number;
  storageGbDefault: number;
  storageGbMax: number;
  hourlyRate: number; // Base cost
  isAvailable: boolean;
  requiresSubscription?: string;
  // User-specific pricing (with margin applied)
  userHourlyRate?: number | null;
  computeMarginPercent?: number | null;
}

interface HardwareSelectorProps {
  specs: HardwareSpec[];
  selectedTier?: string;
  onSelect: (tier: string) => void;
  currentPlan?: string;
  showUnavailable?: boolean;
}

const formatMemory = (mb: number) => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(0)} GB`;
  }
  return `${mb} MB`;
};

const formatPrice = (hourlyRate: number) => {
  return `$${hourlyRate.toFixed(2)}/hr`;
};

export function HardwareSelector({
  specs,
  selectedTier,
  onSelect,
  currentPlan,
  showUnavailable = false,
}: HardwareSelectorProps) {
  const [showGpu, setShowGpu] = useState(false);

  const filteredSpecs = specs.filter((spec) => {
    if (!showUnavailable && !spec.isAvailable) return false;
    if (showGpu) return spec.gpuType && spec.gpuType !== 'none';
    return !spec.gpuType || spec.gpuType === 'none';
  });

  const canAccessTier = (spec: HardwareSpec) => {
    if (!spec.requiresSubscription) return true;
    if (!currentPlan) return false;

    const planOrder = ['free', 'starter', 'pro', 'team', 'enterprise'];
    const requiredIndex = planOrder.indexOf(spec.requiresSubscription);
    const currentIndex = planOrder.indexOf(currentPlan);
    return currentIndex >= requiredIndex;
  };

  return (
    <div className="space-y-4">
      {/* GPU toggle */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => setShowGpu(false)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !showGpu
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
          }`}
        >
          Standard
        </button>
        <button
          onClick={() => setShowGpu(true)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            showGpu
              ? 'bg-blue-500 text-white'
              : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
          }`}
        >
          <Zap className="w-4 h-4" />
          GPU
        </button>
      </div>

      {/* Hardware options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSpecs.map((spec) => {
          const isSelected = selectedTier === spec.tier;
          const hasAccess = canAccessTier(spec);
          const isDisabled = !spec.isAvailable || !hasAccess;

          return (
            <button
              key={spec.id}
              onClick={() => !isDisabled && onSelect(spec.tier)}
              disabled={isDisabled}
              className={`relative p-4 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/20'
                  : isDisabled
                    ? 'border-neutral-700 bg-neutral-800/30 opacity-60 cursor-not-allowed'
                    : 'border-neutral-700 hover:border-neutral-600 bg-neutral-800/50'
              }`}
            >
              {/* Selected checkmark */}
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <Check className="w-5 h-5 text-blue-400" />
                </div>
              )}

              {/* Header */}
              <div className="mb-3">
                <h4 className="font-semibold text-white">{spec.displayName}</h4>
                {spec.description && (
                  <p className="text-xs text-neutral-400 mt-0.5">{spec.description}</p>
                )}
              </div>

              {/* Specs */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Cpu className="w-4 h-4 text-neutral-500" />
                  <span className="text-neutral-300">
                    {spec.vcpu} vCPU ({spec.architecture})
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MemoryStick className="w-4 h-4 text-neutral-500" />
                  <span className="text-neutral-300">{formatMemory(spec.memoryMb)} RAM</span>
                </div>
                {spec.gpuType && spec.gpuType !== 'none' && (
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="w-4 h-4 text-amber-500" />
                    <span className="text-amber-400">
                      {spec.gpuType.toUpperCase()} ({spec.gpuMemoryGb}GB VRAM)
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="w-4 h-4 text-neutral-500" />
                  <span className="text-neutral-300">
                    {spec.storageGbDefault}GB - {spec.storageGbMax}GB
                  </span>
                </div>
              </div>

              {/* Price and access */}
              <div className="mt-4 pt-3 border-t border-neutral-700 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-lg font-semibold text-white">
                    {formatPrice(spec.userHourlyRate ?? spec.hourlyRate)}
                  </span>
                  {spec.computeMarginPercent != null && spec.computeMarginPercent > 0 && (
                    <span className="text-[10px] text-neutral-500">
                      incl. {spec.computeMarginPercent}% plan fee
                    </span>
                  )}
                </div>
                {spec.requiresSubscription && !hasAccess && (
                  <span className="text-xs text-amber-400 capitalize">
                    Requires {spec.requiresSubscription}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {filteredSpecs.length === 0 && (
        <div className="text-center py-8 text-neutral-500">
          {showGpu ? 'No GPU tiers available' : 'No standard tiers available'}
        </div>
      )}
    </div>
  );
}
