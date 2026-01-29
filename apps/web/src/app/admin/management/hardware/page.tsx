'use client';

import { useEffect } from 'react';
import { Plus, Edit2, Cpu, MemoryStick, HardDrive, Zap, Check, X, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminHardwareSpec } from '@/stores/admin';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

interface HardwareCardProps {
  spec: AdminHardwareSpec;
  onEdit: (spec: AdminHardwareSpec) => void;
  onToggleAvailable: (specId: string, isAvailable: boolean) => void;
}

function HardwareCard({ spec, onEdit, onToggleAvailable }: HardwareCardProps) {
  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        spec.is_available ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{spec.display_name}</h3>
          <p className="text-text-muted text-sm">{spec.tier}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(spec)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleAvailable(spec.id, !spec.is_available)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              spec.is_available
                ? 'hover:bg-red-500/10 text-red-500'
                : 'hover:bg-green-500/10 text-green-500'
            )}
          >
            {spec.is_available ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Pricing */}
      <div className="mb-4">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-text-primary">
            {formatCurrency(spec.hourly_rate_cents)}
          </span>
          <span className="text-text-muted">/hour</span>
        </div>
        {spec.requires_subscription && (
          <p className="text-text-muted text-sm mt-1">
            Requires: <span className="text-accent-primary">{spec.requires_subscription}</span> plan
          </p>
        )}
      </div>

      {/* Specs */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Cpu className="h-4 w-4 text-text-muted" />
          <div className="flex-1">
            <p className="text-sm text-text-secondary">
              {spec.vcpu} vCPU ({spec.architecture})
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <MemoryStick className="h-4 w-4 text-text-muted" />
          <div className="flex-1">
            <p className="text-sm text-text-secondary">{spec.memory_mb / 1024} GB RAM</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <HardDrive className="h-4 w-4 text-text-muted" />
          <div className="flex-1">
            <p className="text-sm text-text-secondary">
              {spec.storage_gb_default} - {spec.storage_gb_max} GB Storage
            </p>
          </div>
        </div>

        {spec.bandwidth_mbps && (
          <div className="flex items-center gap-3">
            <Wifi className="h-4 w-4 text-text-muted" />
            <div className="flex-1">
              <p className="text-sm text-text-secondary">
                {spec.bandwidth_mbps >= 1000
                  ? `${spec.bandwidth_mbps / 1000} Gbps`
                  : `${spec.bandwidth_mbps} Mbps`}{' '}
                Network
              </p>
            </div>
          </div>
        )}

        {spec.gpu_type && (
          <div className="flex items-center gap-3">
            <Zap className="h-4 w-4 text-yellow-500" />
            <div className="flex-1">
              <p className="text-sm text-text-secondary">
                {spec.gpu_count}x {spec.gpu_type} ({spec.gpu_memory_gb} GB)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Usage Stats */}
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Active Sessions</span>
          <span className="text-text-secondary">{spec.active_session_count}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-muted">Total Usage</span>
          <span className="text-text-secondary">{spec.total_usage_hours.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  );
}

export default function HardwareManagement() {
  const { hardwareSpecs, hardwareLoading, fetchHardwareSpecs, updateHardwareSpec, error } =
    useAdminStore();

  useEffect(() => {
    fetchHardwareSpecs();
  }, [fetchHardwareSpecs]);

  const handleToggleAvailable = async (specId: string, isAvailable: boolean) => {
    await updateHardwareSpec(specId, { is_available: isAvailable });
  };

  // Group specs by type (standard vs GPU)
  const standardSpecs = hardwareSpecs.filter((s) => !s.gpu_type);
  const gpuSpecs = hardwareSpecs.filter((s) => s.gpu_type);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Hardware Specifications</h1>
          <p className="text-text-muted mt-1">Manage compute tiers and pricing</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          Add Spec
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {hardwareLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="bg-surface rounded-xl border border-border-subtle p-6 animate-pulse"
            >
              <div className="h-6 bg-elevated rounded w-24 mb-4" />
              <div className="h-10 bg-elevated rounded w-32 mb-4" />
              <div className="space-y-2">
                <div className="h-4 bg-elevated rounded w-full" />
                <div className="h-4 bg-elevated rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Standard Tiers */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Standard Compute</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {standardSpecs
                .sort((a, b) => a.hourly_rate_cents - b.hourly_rate_cents)
                .map((spec) => (
                  <HardwareCard
                    key={spec.id}
                    spec={spec}
                    onEdit={() => {}}
                    onToggleAvailable={handleToggleAvailable}
                  />
                ))}
              {standardSpecs.length === 0 && (
                <div className="col-span-3 text-center py-8 text-text-muted">
                  No standard compute tiers configured
                </div>
              )}
            </div>
          </div>

          {/* GPU Tiers */}
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-4">GPU Compute</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {gpuSpecs
                .sort((a, b) => a.hourly_rate_cents - b.hourly_rate_cents)
                .map((spec) => (
                  <HardwareCard
                    key={spec.id}
                    spec={spec}
                    onEdit={() => {}}
                    onToggleAvailable={handleToggleAvailable}
                  />
                ))}
              {gpuSpecs.length === 0 && (
                <div className="col-span-3 text-center py-8 text-text-muted">
                  No GPU compute tiers configured
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
