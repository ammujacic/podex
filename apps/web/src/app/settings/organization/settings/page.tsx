'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Settings,
  ChevronLeft,
  Loader2,
  Building2,
  Globe,
  Users,
  Shield,
  Trash2,
  Save,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useOrganizationStore,
  useIsOrgOwner,
  useOrgContext,
  type CreditModel,
  type Organization,
} from '@/stores/organization';
import Link from 'next/link';

export default function OrganizationSettingsPage() {
  useDocumentTitle('Organization Settings');
  const router = useRouter();
  const isOwner = useIsOrgOwner();
  const orgContext = useOrgContext();
  const { setContext: _setContext } = useOrganizationStore();

  const [loading, _setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [website, setWebsite] = useState('');
  const [creditModel, setCreditModel] = useState<CreditModel>('pooled');
  const [autoJoinEnabled, setAutoJoinEnabled] = useState(false);
  const [autoJoinDomains, setAutoJoinDomains] = useState('');
  const [defaultSpendingLimit, setDefaultSpendingLimit] = useState<string>('');
  const [defaultStorageLimit, setDefaultStorageLimit] = useState<string>('');

  // Redirect if not owner
  useEffect(() => {
    if (!isOwner && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isOwner, orgContext, router]);

  // Initialize form with org data
  useEffect(() => {
    if (orgContext) {
      const org = orgContext.organization;
      setName(org.name);
      setSlug(org.slug);
      setWebsite(org.website || '');
      setCreditModel(org.creditModel);
      setAutoJoinEnabled(org.autoJoinEnabled);
      setAutoJoinDomains(org.autoJoinDomains?.join(', ') || '');
    }
  }, [orgContext]);

  const handleSave = async () => {
    if (!orgContext) return;
    setSaving(true);
    try {
      // Update organization via API
      const updateData: {
        name: string;
        website: string | null;
        credit_model: string;
        auto_join_enabled: boolean;
        auto_join_domains?: string[];
        default_spending_limit_cents?: number;
        default_storage_limit_gb?: number;
      } = {
        name,
        website: website || null,
        credit_model: creditModel,
        auto_join_enabled: autoJoinEnabled,
      };

      if (autoJoinDomains) {
        updateData.auto_join_domains = autoJoinDomains.split(',').map((d: string) => d.trim());
      }

      if (defaultSpendingLimit) {
        updateData.default_spending_limit_cents = parseFloat(defaultSpendingLimit) * 100;
      }

      if (defaultStorageLimit) {
        updateData.default_storage_limit_gb = parseInt(defaultStorageLimit);
      }

      const updated = (await api.patch(
        `/api/organizations/${orgContext.organization.id}`,
        updateData
      )) as Organization;
      _setContext({ ...orgContext, organization: updated });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!orgContext || deleteConfirm !== orgContext.organization.name) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/organizations/${orgContext.organization.id}`);
      _setContext(null);
      router.push('/settings');
    } catch (error) {
      console.error('Failed to delete organization:', error);
      alert('Failed to delete organization. Please try again.');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!isOwner) {
    return null;
  }

  const creditModelOptions = [
    {
      value: 'pooled',
      label: 'Pooled Credits',
      description: 'Shared credits with individual spending caps. Simple and flexible.',
    },
    {
      value: 'allocated',
      label: 'Allocated Credits',
      description: 'Pre-assign credits to each member. Full control over distribution.',
    },
    {
      value: 'usage_based',
      label: 'Usage Based',
      description: 'Track usage and bill at period end with caps. Best for variable usage.',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings/organization"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Organization
        </Link>
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Settings
        </h1>
        <p className="text-text-muted mt-1">Configure your organization settings and defaults</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* General Settings */}
          <section className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-medium text-text-primary flex items-center gap-2 mb-4">
              <Building2 className="w-5 h-5" />
              General
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Slug</label>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted">
                    podex.ai/org/
                  </span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) =>
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                    }
                    className="flex-1 px-3 py-2 bg-elevated border border-border-default rounded-r-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Website (optional)
                </label>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-elevated border border-r-0 border-border-default rounded-l-lg text-text-muted">
                    <Globe className="w-4 h-4" />
                  </span>
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://example.com"
                    className="flex-1 px-3 py-2 bg-elevated border border-border-default rounded-r-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Credit Model */}
          <section className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-medium text-text-primary flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5" />
              Credit Model
            </h2>
            <div className="space-y-3">
              {creditModelOptions.map((option) => (
                <label
                  key={option.value}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    creditModel === option.value
                      ? 'border-accent-primary bg-accent-primary/5'
                      : 'border-border-default hover:border-border-subtle'
                  }`}
                >
                  <input
                    type="radio"
                    name="creditModel"
                    value={option.value}
                    checked={creditModel === option.value}
                    onChange={(e) => setCreditModel(e.target.value as CreditModel)}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium text-text-primary">{option.label}</p>
                    <p className="text-sm text-text-muted">{option.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* Auto-Join Settings */}
          <section className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-medium text-text-primary flex items-center gap-2 mb-4">
              <Users className="w-5 h-5" />
              Domain Auto-Join
            </h2>
            <p className="text-sm text-text-muted mb-4">
              Allow users with matching email domains to automatically join your organization. Only
              business email domains are supported (not gmail.com, yahoo.com, etc.).
            </p>
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={autoJoinEnabled}
                  onChange={(e) => setAutoJoinEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-accent-primary"
                />
                <span className="text-text-primary">Enable domain auto-join</span>
              </label>
              {autoJoinEnabled && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Allowed Domains
                  </label>
                  <input
                    type="text"
                    value={autoJoinDomains}
                    onChange={(e) => setAutoJoinDomains(e.target.value)}
                    placeholder="company.com, team.io"
                    className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Comma-separated list of business email domains
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Default Limits */}
          <section className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-medium text-text-primary mb-4">Default Member Limits</h2>
            <p className="text-sm text-text-muted mb-4">
              These defaults apply to new members. You can override them per member.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Spending Limit ($/month)
                </label>
                <input
                  type="number"
                  value={defaultSpendingLimit}
                  onChange={(e) => setDefaultSpendingLimit(e.target.value)}
                  placeholder="No limit"
                  min={0}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Storage Limit (GB)
                </label>
                <input
                  type="number"
                  value={defaultStorageLimit}
                  onChange={(e) => setDefaultStorageLimit(e.target.value)}
                  placeholder="No limit"
                  min={0}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
            </div>
          </section>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>

          {/* Danger Zone */}
          <section className="bg-surface border border-accent-error/30 rounded-xl p-6">
            <h2 className="text-lg font-medium text-accent-error flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5" />
              Danger Zone
            </h2>
            <p className="text-sm text-text-muted mb-4">
              Deleting your organization is permanent. All members will be removed and their
              personal billing will be reactivated. This action cannot be undone.
            </p>
            <Button variant="danger" onClick={() => setShowDeleteModal(true)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Organization
            </Button>
          </section>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && orgContext && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-2">Delete Organization</h2>
            <p className="text-text-muted mb-4">
              This action is permanent and cannot be undone. All members will lose access and their
              personal billing will be reactivated.
            </p>
            <p className="text-sm text-text-secondary mb-2">
              Type <span className="font-mono font-medium">{orgContext.organization.name}</span> to
              confirm:
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-error/50 mb-4"
            />
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirm('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                disabled={deleteConfirm !== orgContext.organization.name || deleteLoading}
              >
                {deleteLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Delete Organization'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
