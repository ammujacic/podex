'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, DollarSign, Cpu, Bot } from 'lucide-react';
import { Button } from '@podex/ui';
import { api, listHardwareSpecs, type HardwareSpecResponse } from '@/lib/api';
import type { OrganizationMember, OrgRole } from '@/stores/organization';

interface LLMModel {
  id: string;
  model_id: string;
  display_name: string;
  provider: string;
  is_enabled: boolean;
}

interface EditMemberModalProps {
  member: OrganizationMember;
  orgId: string;
  creditModel: string;
  onClose: () => void;
  onSave: (updates: Partial<OrganizationMember>) => void;
}

export function EditMemberModal({
  member,
  orgId,
  creditModel,
  onClose,
  onSave,
}: EditMemberModalProps) {
  const [role, setRole] = useState<OrgRole>(member.role);
  const [spendingLimitCents, setSpendingLimitCents] = useState<number | null>(
    member.spendingLimitCents
  );
  const [allocatedCreditsCents, setAllocatedCreditsCents] = useState<number>(
    member.allocatedCreditsCents
  );
  const [allowedModels, setAllowedModels] = useState<string[] | null>(null);
  const [allowedInstanceTypes, setAllowedInstanceTypes] = useState<string[] | null>(null);

  const [availableHardware, setAvailableHardware] = useState<HardwareSpecResponse[]>([]);
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load available options and member's current settings
  useEffect(() => {
    async function loadData() {
      try {
        // Load available hardware specs
        const specs = await listHardwareSpecs();
        setAvailableHardware(specs);

        // Load available models (platform models)
        const models = (await api.get('/api/billing/llm-models')) as LLMModel[];
        setAvailableModels(models.filter((m) => m.is_enabled));

        // Load member's current settings
        const memberDetails = (await api.get(
          `/api/organizations/${orgId}/members/${member.userId}`
        )) as {
          allowed_models: string[] | null;
          allowed_instance_types: string[] | null;
        };

        setAllowedModels(memberDetails.allowed_models);
        setAllowedInstanceTypes(memberDetails.allowed_instance_types);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [orgId, member.userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        role,
        spending_limit_cents: spendingLimitCents,
      };

      if (creditModel === 'allocated') {
        updates.allocated_credits_cents = allocatedCreditsCents;
      }

      // Only include if explicitly set (empty array means no access, null means inherit from org)
      if (allowedModels !== null) {
        updates.allowed_models = allowedModels;
      }
      if (allowedInstanceTypes !== null) {
        updates.allowed_instance_types = allowedInstanceTypes;
      }

      await api.patch(`/api/organizations/${orgId}/members/${member.userId}`, updates);

      onSave({
        role,
        spendingLimitCents,
        allocatedCreditsCents,
      });
      onClose();
    } catch (err) {
      console.error('Failed to update member:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleModel = (modelId: string) => {
    if (allowedModels === null) {
      // Currently inheriting from org, set to just this model
      setAllowedModels([modelId]);
    } else if (allowedModels.includes(modelId)) {
      // Remove model
      const newList = allowedModels.filter((m) => m !== modelId);
      setAllowedModels(newList.length > 0 ? newList : null);
    } else {
      // Add model
      setAllowedModels([...allowedModels, modelId]);
    }
  };

  const toggleInstanceType = (tier: string) => {
    if (allowedInstanceTypes === null) {
      // Currently inheriting from org, set to just this tier
      setAllowedInstanceTypes([tier]);
    } else if (allowedInstanceTypes.includes(tier)) {
      // Remove tier
      const newList = allowedInstanceTypes.filter((t) => t !== tier);
      setAllowedInstanceTypes(newList.length > 0 ? newList : null);
    } else {
      // Add tier
      setAllowedInstanceTypes([...allowedInstanceTypes, tier]);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-surface border border-border-default rounded-xl p-6 max-w-lg w-full mx-4">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border-default rounded-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-default sticky top-0 bg-surface">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Edit Member</h2>
            <p className="text-sm text-text-muted">{member.name || member.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-elevated rounded-lg">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              disabled={member.role === 'owner'}
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary disabled:opacity-50"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              {member.role === 'owner' && <option value="owner">Owner</option>}
            </select>
          </div>

          {/* Spending Limit */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <DollarSign className="w-4 h-4 inline mr-1" />
              Monthly Spending Limit
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={spendingLimitCents !== null ? spendingLimitCents / 100 : ''}
                onChange={(e) =>
                  setSpendingLimitCents(
                    e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null
                  )
                }
                placeholder="No limit"
                min="0"
                step="1"
                className="flex-1 px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
              />
              <span className="text-text-muted">USD</span>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Current spending: {formatCurrency(member.currentSpendingCents)}
            </p>
          </div>

          {/* Allocated Credits (for allocated model) */}
          {creditModel === 'allocated' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Allocated Credits
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={allocatedCreditsCents / 100}
                  onChange={(e) =>
                    setAllocatedCreditsCents(Math.round(parseFloat(e.target.value || '0') * 100))
                  }
                  min="0"
                  step="1"
                  className="flex-1 px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-text-primary"
                />
                <span className="text-text-muted">USD</span>
              </div>
              <p className="text-xs text-text-muted mt-1">
                Used: {formatCurrency(member.usedCreditsCents)} / Remaining:{' '}
                {formatCurrency(allocatedCreditsCents - member.usedCreditsCents)}
              </p>
            </div>
          )}

          {/* Allowed Instance Types */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Cpu className="w-4 h-4 inline mr-1" />
              Allowed Hardware Tiers
            </label>
            <p className="text-xs text-text-muted mb-3">
              {allowedInstanceTypes === null
                ? 'Inheriting from organization defaults (all tiers allowed)'
                : `${allowedInstanceTypes.length} tier(s) selected`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {availableHardware.map((spec) => (
                <button
                  key={spec.id}
                  onClick={() => toggleInstanceType(spec.tier)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    allowedInstanceTypes === null || allowedInstanceTypes.includes(spec.tier)
                      ? 'border-accent-primary bg-accent-primary/10'
                      : 'border-border-subtle bg-elevated hover:border-border-default'
                  }`}
                >
                  <p className="font-medium text-text-primary text-sm">{spec.display_name}</p>
                  <p className="text-xs text-text-muted">
                    {spec.vcpu} vCPU, {Math.round(spec.memory_mb / 1024)}GB RAM
                  </p>
                </button>
              ))}
            </div>
            {allowedInstanceTypes !== null && (
              <button
                onClick={() => setAllowedInstanceTypes(null)}
                className="text-xs text-accent-primary hover:underline mt-2"
              >
                Reset to organization defaults
              </button>
            )}
          </div>

          {/* Allowed Models */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Bot className="w-4 h-4 inline mr-1" />
              Allowed AI Models
            </label>
            <p className="text-xs text-text-muted mb-3">
              {allowedModels === null
                ? 'Inheriting from organization defaults (all models allowed)'
                : `${allowedModels.length} model(s) selected`}
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
              {availableModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => toggleModel(model.model_id)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    allowedModels === null || allowedModels.includes(model.model_id)
                      ? 'border-accent-primary bg-accent-primary/10'
                      : 'border-border-subtle bg-elevated hover:border-border-default'
                  }`}
                >
                  <p className="font-medium text-text-primary text-sm">{model.display_name}</p>
                  <p className="text-xs text-text-muted capitalize">{model.provider}</p>
                </button>
              ))}
            </div>
            {allowedModels !== null && (
              <button
                onClick={() => setAllowedModels(null)}
                className="text-xs text-accent-primary hover:underline mt-2"
              >
                Reset to organization defaults
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-border-default sticky bottom-0 bg-surface">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
