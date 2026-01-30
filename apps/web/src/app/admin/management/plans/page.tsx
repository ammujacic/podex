'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit2, Check, X, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAdminStore, type AdminPlan } from '@/stores/admin';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

interface PlanCardProps {
  plan: AdminPlan;
  onEdit: (plan: AdminPlan) => void;
  onToggleActive: (planId: string, isActive: boolean) => void;
}

function PlanCard({ plan, onEdit, onToggleActive }: PlanCardProps) {
  return (
    <div
      className={cn(
        'bg-surface rounded-xl border p-6',
        plan.is_active ? 'border-border-subtle' : 'border-red-500/30 opacity-70'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-text-primary">{plan.name}</h3>
            {plan.is_popular && (
              <span className="px-2 py-0.5 bg-accent-primary/20 text-accent-primary text-xs rounded-full">
                Popular
              </span>
            )}
            {plan.is_enterprise && (
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-500 text-xs rounded-full">
                Enterprise
              </span>
            )}
          </div>
          <p className="text-text-muted text-sm mt-1">{plan.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(plan)}
            className="p-2 hover:bg-elevated rounded-lg transition-colors"
          >
            <Edit2 className="h-4 w-4 text-text-muted" />
          </button>
          <button
            onClick={() => onToggleActive(plan.id, !plan.is_active)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              plan.is_active
                ? 'hover:bg-red-500/10 text-red-500'
                : 'hover:bg-green-500/10 text-green-500'
            )}
          >
            {plan.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Pricing */}
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-text-primary">
              {formatCurrency(plan.price_monthly_cents)}
            </span>
            <span className="text-text-muted">/month</span>
          </div>
          <p className="text-text-muted text-sm">{formatCurrency(plan.price_yearly_cents)}/year</p>
        </div>

        {/* Subscribers */}
        <div className="flex items-center gap-2 text-sm">
          <Users className="h-4 w-4 text-text-muted" />
          <span className="text-text-secondary">{plan.subscriber_count} subscribers</span>
        </div>

        {/* Included Resources */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Tokens</span>
            <span className="text-text-secondary">
              {(plan.tokens_included / 1000000).toFixed(1)}M
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Compute Credits</span>
            <span className="text-text-secondary">
              ${(plan.compute_credits_cents_included / 100).toFixed(0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Storage</span>
            <span className="text-text-secondary">{plan.storage_gb_included} GB</span>
          </div>
        </div>

        {/* Limits */}
        <div className="space-y-2 text-sm border-t border-border-subtle pt-4">
          <div className="flex justify-between">
            <span className="text-text-muted">Max Agents</span>
            <span className="text-text-secondary">{plan.max_agents}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Max Sessions</span>
            <span className="text-text-secondary">{plan.max_sessions}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Live Collaborators</span>
            <span className="text-text-secondary">{plan.max_team_members}</span>
          </div>
        </div>

        {/* Margins */}
        <div className="space-y-2 text-sm border-t border-border-subtle pt-4">
          <div className="flex justify-between">
            <span className="text-text-muted">LLM Margin</span>
            <span className="text-text-secondary">{plan.llm_margin_percent}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Compute Margin</span>
            <span className="text-text-secondary">{plan.compute_margin_percent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EditPlanModalProps {
  plan: AdminPlan | null;
  onClose: () => void;
  onSave: (data: Partial<AdminPlan>) => Promise<void>;
}

function EditPlanModal({ plan, onClose, onSave }: EditPlanModalProps) {
  const [formData, setFormData] = useState({
    name: plan?.name || '',
    description: plan?.description || '',
    price_monthly_cents: plan?.price_monthly_cents || 0,
    price_yearly_cents: plan?.price_yearly_cents || 0,
    tokens_included: plan?.tokens_included || 0,
    compute_credits_cents_included: plan?.compute_credits_cents_included || 0,
    storage_gb_included: plan?.storage_gb_included || 0,
    max_agents: plan?.max_agents || 1,
    max_sessions: plan?.max_sessions || 1,
    max_team_members: plan?.max_team_members || 1,
    llm_margin_percent: plan?.llm_margin_percent || 0,
    compute_margin_percent: plan?.compute_margin_percent || 0,
    is_popular: plan?.is_popular || false,
    is_enterprise: plan?.is_enterprise || false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-xl border border-border-subtle p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-text-primary mb-6">
          {plan ? 'Edit Plan' : 'Create Plan'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Monthly Price (cents)</label>
              <input
                type="number"
                value={formData.price_monthly_cents}
                onChange={(e) =>
                  setFormData({ ...formData, price_monthly_cents: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Yearly Price (cents)</label>
              <input
                type="number"
                value={formData.price_yearly_cents}
                onChange={(e) =>
                  setFormData({ ...formData, price_yearly_cents: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
          </div>

          {/* Included Resources */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Tokens Included</label>
              <input
                type="number"
                value={formData.tokens_included}
                onChange={(e) =>
                  setFormData({ ...formData, tokens_included: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Compute Credits (cents)</label>
              <input
                type="number"
                value={formData.compute_credits_cents_included}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    compute_credits_cents_included: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Storage (GB)</label>
              <input
                type="number"
                value={formData.storage_gb_included}
                onChange={(e) =>
                  setFormData({ ...formData, storage_gb_included: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
              />
            </div>
          </div>

          {/* Limits */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">Max Agents</label>
              <input
                type="number"
                value={formData.max_agents}
                onChange={(e) =>
                  setFormData({ ...formData, max_agents: parseInt(e.target.value) || 1 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Max Sessions</label>
              <input
                type="number"
                value={formData.max_sessions}
                onChange={(e) =>
                  setFormData({ ...formData, max_sessions: parseInt(e.target.value) || 1 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Live Collaborators</label>
              <input
                type="number"
                value={formData.max_team_members}
                onChange={(e) =>
                  setFormData({ ...formData, max_team_members: parseInt(e.target.value) || 1 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={1}
              />
            </div>
          </div>

          {/* Margins */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1">LLM Margin (%)</label>
              <input
                type="number"
                value={formData.llm_margin_percent}
                onChange={(e) =>
                  setFormData({ ...formData, llm_margin_percent: parseInt(e.target.value) || 0 })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
                max={100}
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Compute Margin (%)</label>
              <input
                type="number"
                value={formData.compute_margin_percent}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    compute_margin_percent: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary"
                min={0}
                max={100}
              />
            </div>
          </div>

          {/* Flags */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_popular}
                onChange={(e) => setFormData({ ...formData, is_popular: e.target.checked })}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Popular</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.is_enterprise}
                onChange={(e) => setFormData({ ...formData, is_enterprise: e.target.checked })}
                className="rounded border-border-subtle"
              />
              <span className="text-sm text-text-secondary">Enterprise</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlansManagement() {
  useDocumentTitle('Subscription Plans');
  const { plans, plansLoading, fetchPlans, updatePlan, error } = useAdminStore();
  const [editingPlan, setEditingPlan] = useState<AdminPlan | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleToggleActive = async (planId: string, isActive: boolean) => {
    await updatePlan(planId, { is_active: isActive });
  };

  const handleSavePlan = async (data: Partial<AdminPlan>) => {
    if (editingPlan) {
      await updatePlan(editingPlan.id, data);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Subscription Plans</h1>
          <p className="text-text-muted mt-1">Manage pricing tiers and features</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          Add Plan
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 text-red-500 p-4 rounded-lg mb-6">Error: {error}</div>
      )}

      {plansLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onEdit={(p) => {
                  setEditingPlan(p);
                  setShowEditModal(true);
                }}
                onToggleActive={handleToggleActive}
              />
            ))}
        </div>
      )}

      {showEditModal && (
        <EditPlanModal
          plan={editingPlan}
          onClose={() => {
            setShowEditModal(false);
            setEditingPlan(null);
          }}
          onSave={handleSavePlan}
        />
      )}
    </div>
  );
}
