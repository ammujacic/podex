'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit2, Cpu, MemoryStick, HardDrive, Zap, Check, X, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminHardwareSpec } from '@/stores/admin';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// ============================================================================
// Edit Hardware Modal
// ============================================================================

interface EditHardwareModalProps {
  spec: AdminHardwareSpec;
  onClose: () => void;
  onSave: (specId: string, data: Partial<AdminHardwareSpec>) => Promise<void>;
}

function EditHardwareModal({ spec, onClose, onSave }: EditHardwareModalProps) {
  const [formData, setFormData] = useState({
    display_name: spec.display_name,
    description: spec.description || '',
    tier: spec.tier,
    vcpu: spec.vcpu,
    memory_mb: spec.memory_mb,
    storage_gb: spec.storage_gb,
    bandwidth_mbps: spec.bandwidth_mbps || 0,
    hourly_rate_cents: spec.hourly_rate_cents,
    requires_subscription: spec.requires_subscription || '',
    gpu_type: spec.gpu_type || '',
    gpu_memory_gb: spec.gpu_memory_gb || 0,
    gpu_count: spec.gpu_count || 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(spec.id, {
        display_name: formData.display_name,
        description: formData.description || null,
        tier: formData.tier,
        vcpu: formData.vcpu,
        memory_mb: formData.memory_mb,
        storage_gb: formData.storage_gb,
        bandwidth_mbps: formData.bandwidth_mbps || null,
        hourly_rate_cents: formData.hourly_rate_cents,
        requires_subscription: formData.requires_subscription || null,
        gpu_type: formData.gpu_type || null,
        gpu_memory_gb: formData.gpu_memory_gb || null,
        gpu_count: formData.gpu_count || 0,
      });
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border-subtle rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-6">Edit Hardware Spec</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Tier</label>
            <input
              type="text"
              value={formData.tier}
              onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              required
            />
          </div>

          {/* Compute Resources */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">vCPU</label>
              <input
                type="number"
                value={formData.vcpu}
                onChange={(e) => setFormData({ ...formData, vcpu: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Memory (MB)</label>
              <input
                type="number"
                value={formData.memory_mb}
                onChange={(e) =>
                  setFormData({ ...formData, memory_mb: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={512}
                step={512}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Storage (GB)</label>
              <input
                type="number"
                value={formData.storage_gb}
                onChange={(e) =>
                  setFormData({ ...formData, storage_gb: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={1}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Bandwidth (Mbps)</label>
              <input
                type="number"
                value={formData.bandwidth_mbps}
                onChange={(e) =>
                  setFormData({ ...formData, bandwidth_mbps: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                min={0}
              />
            </div>
          </div>

          {/* GPU (optional) */}
          <div className="border-t border-border-subtle pt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3">GPU (Optional)</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">GPU Type</label>
                <input
                  type="text"
                  value={formData.gpu_type}
                  onChange={(e) => setFormData({ ...formData, gpu_type: e.target.value })}
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                  placeholder="e.g., A100"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">GPU Memory (GB)</label>
                <input
                  type="number"
                  value={formData.gpu_memory_gb}
                  onChange={(e) =>
                    setFormData({ ...formData, gpu_memory_gb: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">GPU Count</label>
                <input
                  type="number"
                  value={formData.gpu_count}
                  onChange={(e) =>
                    setFormData({ ...formData, gpu_count: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                  min={0}
                />
              </div>
            </div>
          </div>

          {/* Pricing */}
          <div className="border-t border-border-subtle pt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3">Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  Hourly Rate (cents)
                </label>
                <input
                  type="number"
                  value={formData.hourly_rate_cents}
                  onChange={(e) =>
                    setFormData({ ...formData, hourly_rate_cents: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                  min={0}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Requires Plan</label>
                <select
                  value={formData.requires_subscription}
                  onChange={(e) =>
                    setFormData({ ...formData, requires_subscription: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                >
                  <option value="">None</option>
                  <option value="pro">Pro</option>
                  <option value="team">Team</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
            <p className="text-sm text-text-secondary">{spec.storage_gb} GB Storage</p>
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
  useDocumentTitle('Hardware Specifications');
  const { hardwareSpecs, hardwareLoading, fetchHardwareSpecs, updateHardwareSpec, error } =
    useAdminStore();
  const [editingSpec, setEditingSpec] = useState<AdminHardwareSpec | null>(null);

  useEffect(() => {
    fetchHardwareSpecs();
  }, [fetchHardwareSpecs]);

  const handleToggleAvailable = async (specId: string, isAvailable: boolean) => {
    await updateHardwareSpec(specId, { is_available: isAvailable });
  };

  const handleEdit = (spec: AdminHardwareSpec) => {
    setEditingSpec(spec);
  };

  const handleSaveEdit = async (specId: string, data: Partial<AdminHardwareSpec>) => {
    await updateHardwareSpec(specId, data);
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
                    onEdit={handleEdit}
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
                    onEdit={handleEdit}
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

      {/* Edit Modal */}
      {editingSpec && (
        <EditHardwareModal
          spec={editingSpec}
          onClose={() => setEditingSpec(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}
