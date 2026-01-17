'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Building2,
  Search,
  Users,
  DollarSign,
  Loader2,
  Settings,
  Pause,
  Play,
  Eye,
  ChevronDown,
  TrendingUp,
  AlertCircle,
  Percent,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  creditModel: 'pooled' | 'allocated' | 'usage_based';
  creditPoolCents: number;
  memberCount: number;
  isActive: boolean;
  logoUrl: string | null;
  marginPercent: number;
  createdAt: string;
  totalSpendingCents: number;
  stripeCustomerId: string | null;
}

interface OrganizationsResponse {
  organizations: AdminOrganization[];
}
interface OrgPricingDefaults {
  defaultMarginPercent: number;
  defaultSpendingLimitCents: number | null;
  defaultStorageLimitGb: number | null;
  defaultAllowedModels: string[];
  defaultAllowedInstanceTypes: string[];
}

export default function AdminOrganizationsPage() {
  useDocumentTitle('Admin - Organizations');

  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [selectedOrg, setSelectedOrg] = useState<AdminOrganization | null>(null);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [showDefaultsModal, setShowDefaultsModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Pricing defaults state
  const [pricingDefaults, setPricingDefaults] = useState<OrgPricingDefaults>({
    defaultMarginPercent: 15,
    defaultSpendingLimitCents: null,
    defaultStorageLimitGb: null,
    defaultAllowedModels: [],
    defaultAllowedInstanceTypes: [],
  });

  // Edit org state
  const [editMargin, setEditMargin] = useState<number>(15);
  const [editCredits, setEditCredits] = useState<string>('');

  // Fetch organizations
  useEffect(() => {
    const fetchOrganizations = async () => {
      setLoading(true);
      try {
        // Fetch organizations from API
        const response = (await api.get('/api/admin/organizations/')) as OrganizationsResponse;
        setOrganizations(response.organizations || []);
      } finally {
        setLoading(false);
      }
    };
    fetchOrganizations();
  }, []);

  // Fetch pricing defaults
  useEffect(() => {
    const fetchDefaults = async () => {
      try {
        // TODO: Fetch from API
        // const response = await api.admin.organizations.getPricingDefaults();
        // setPricingDefaults(response);
      } catch {
        // Use defaults
      }
    };
    fetchDefaults();
  }, []);

  const filteredOrganizations = organizations.filter((org) => {
    const matchesSearch =
      org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.slug.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && org.isActive) ||
      (statusFilter === 'suspended' && !org.isActive);
    return matchesSearch && matchesStatus;
  });

  const formatCents = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const getCreditModelBadge = (model: string) => {
    const styles: Record<string, string> = {
      pooled: 'bg-blue-500/10 text-blue-500',
      allocated: 'bg-purple-500/10 text-purple-500',
      usage_based: 'bg-green-500/10 text-green-500',
    };
    return styles[model] || 'bg-elevated text-text-muted';
  };

  const handleOpenOrgModal = (org: AdminOrganization) => {
    setSelectedOrg(org);
    setEditMargin(org.marginPercent);
    setEditCredits('');
    setShowOrgModal(true);
  };

  const handleSuspendOrg = async (org: AdminOrganization) => {
    setActionLoading(true);
    try {
      // Suspend organization via API
      await api.post(`/api/admin/organizations/${org.id}/suspend`, {});
      setOrganizations((prev) =>
        prev.map((o) => (o.id === org.id ? { ...o, isActive: false } : o))
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivateOrg = async (org: AdminOrganization) => {
    setActionLoading(true);
    try {
      // Activate organization via API
      await api.post(`/api/admin/organizations/${org.id}/activate`, {});
      setOrganizations((prev) => prev.map((o) => (o.id === org.id ? { ...o, isActive: true } : o)));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveOrgSettings = async () => {
    if (!selectedOrg) return;
    setActionLoading(true);
    try {
      // Update organization via API
      const updateData: { credit_pool_cents?: number } = {};
      if (editCredits) {
        updateData.credit_pool_cents = selectedOrg.creditPoolCents + parseFloat(editCredits) * 100;
      }
      if (Object.keys(updateData).length > 0) {
        await api.patch(`/api/admin/organizations/${selectedOrg.id}`, updateData);
      }

      setOrganizations((prev) =>
        prev.map((o) =>
          o.id === selectedOrg.id
            ? {
                ...o,
                marginPercent: editMargin,
                creditPoolCents: editCredits
                  ? o.creditPoolCents + parseFloat(editCredits) * 100
                  : o.creditPoolCents,
              }
            : o
        )
      );
      setShowOrgModal(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveDefaults = async () => {
    setActionLoading(true);
    try {
      // TODO: Implement pricing defaults API endpoint
      // await api.patch('/api/admin/organizations/pricing-defaults', pricingDefaults);
      setShowDefaultsModal(false);
    } finally {
      setActionLoading(false);
    }
  };

  // Stats
  const totalOrgs = organizations.length;
  const activeOrgs = organizations.filter((o) => o.isActive).length;
  const totalMembers = organizations.reduce((sum, o) => sum + o.memberCount, 0);
  const totalRevenue = organizations.reduce((sum, o) => sum + o.totalSpendingCents, 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Building2 className="w-7 h-7" />
            Organizations
          </h1>
          <p className="text-text-muted mt-1">
            Manage organizations, pricing, and default settings
          </p>
        </div>
        <Button onClick={() => setShowDefaultsModal(true)}>
          <Settings className="w-4 h-4 mr-2" />
          Default Pricing
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-surface border border-border-default rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Building2 className="w-4 h-4" />
            <span className="text-sm">Total Organizations</span>
          </div>
          <p className="text-2xl font-semibold text-text-primary">{totalOrgs}</p>
        </div>
        <div className="bg-surface border border-border-default rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Play className="w-4 h-4" />
            <span className="text-sm">Active</span>
          </div>
          <p className="text-2xl font-semibold text-accent-success">{activeOrgs}</p>
        </div>
        <div className="bg-surface border border-border-default rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <Users className="w-4 h-4" />
            <span className="text-sm">Total Members</span>
          </div>
          <p className="text-2xl font-semibold text-text-primary">{totalMembers}</p>
        </div>
        <div className="bg-surface border border-border-default rounded-xl p-4">
          <div className="flex items-center gap-2 text-text-muted mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm">Total Revenue</span>
          </div>
          <p className="text-2xl font-semibold text-text-primary">{formatCents(totalRevenue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
          <input
            type="text"
            placeholder="Search organizations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="appearance-none px-4 py-2 pr-10 bg-surface border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Organizations Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        </div>
      ) : filteredOrganizations.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-border-default rounded-xl">
          <Building2 className="w-16 h-16 text-text-muted mx-auto mb-4" />
          <p className="text-lg text-text-muted">
            {searchQuery || statusFilter !== 'all'
              ? 'No organizations match your filters'
              : 'No organizations yet'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            Organizations will appear here when users create them
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                  Organization
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                  Credit Model
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Members</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Credits</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Margin</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOrganizations.map((org) => (
                <tr
                  key={org.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-elevated/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {org.logoUrl ? (
                        <Image
                          src={org.logoUrl}
                          alt={org.name}
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-lg"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-elevated rounded-lg flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-text-muted" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-text-primary">{org.name}</p>
                        <p className="text-xs text-text-muted">/{org.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium capitalize ${getCreditModelBadge(org.creditModel)}`}
                    >
                      {org.creditModel.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-primary">{org.memberCount}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-primary">{formatCents(org.creditPoolCents)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-primary">{org.marginPercent}%</span>
                  </td>
                  <td className="px-4 py-3">
                    {org.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-success/10 text-accent-success rounded text-xs font-medium">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-error/10 text-accent-error rounded text-xs font-medium">
                        <AlertCircle className="w-3 h-3" />
                        Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => handleOpenOrgModal(org)}
                        className="p-2 hover:bg-elevated rounded-lg transition-colors"
                        title="View & Edit"
                      >
                        <Eye className="w-4 h-4 text-text-muted" />
                      </button>
                      {org.isActive ? (
                        <button
                          onClick={() => handleSuspendOrg(org)}
                          className="p-2 hover:bg-elevated rounded-lg transition-colors"
                          title="Suspend"
                        >
                          <Pause className="w-4 h-4 text-accent-warning" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivateOrg(org)}
                          className="p-2 hover:bg-elevated rounded-lg transition-colors"
                          title="Activate"
                        >
                          <Play className="w-4 h-4 text-accent-success" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Organization Edit Modal */}
      {showOrgModal && selectedOrg && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-6">
              {selectedOrg.logoUrl ? (
                <Image
                  src={selectedOrg.logoUrl}
                  alt={selectedOrg.name}
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-lg"
                />
              ) : (
                <div className="w-12 h-12 bg-elevated rounded-lg flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-text-muted" />
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{selectedOrg.name}</h2>
                <p className="text-sm text-text-muted">/{selectedOrg.slug}</p>
              </div>
            </div>

            {/* Org Info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-elevated rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Credit Model</p>
                <p className="text-sm font-medium text-text-primary capitalize">
                  {selectedOrg.creditModel.replace('_', ' ')}
                </p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Members</p>
                <p className="text-sm font-medium text-text-primary">{selectedOrg.memberCount}</p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Current Credits</p>
                <p className="text-sm font-medium text-text-primary">
                  {formatCents(selectedOrg.creditPoolCents)}
                </p>
              </div>
              <div className="bg-elevated rounded-lg p-3">
                <p className="text-xs text-text-muted mb-1">Total Spending</p>
                <p className="text-sm font-medium text-text-primary">
                  {formatCents(selectedOrg.totalSpendingCents)}
                </p>
              </div>
            </div>

            {/* Edit Fields */}
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Margin (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={editMargin}
                    onChange={(e) => setEditMargin(parseFloat(e.target.value) || 0)}
                    min={0}
                    max={100}
                    className="w-full px-3 py-2 pr-10 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Platform margin applied to this organization&apos;s usage
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Add Credits ($)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={editCredits}
                    onChange={(e) => setEditCredits(e.target.value)}
                    min={0}
                    placeholder="0.00"
                    className="w-full px-3 py-2 pl-8 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Add promotional or adjustment credits (super admin only)
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowOrgModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveOrgSettings} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Default Pricing Modal */}
      {showDefaultsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-lg w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-2">
              Default Pricing Settings
            </h2>
            <p className="text-text-muted text-sm mb-6">
              These settings apply to newly created organizations. Existing organizations are not
              affected.
            </p>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Default Margin (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={pricingDefaults.defaultMarginPercent}
                    onChange={(e) =>
                      setPricingDefaults((prev) => ({
                        ...prev,
                        defaultMarginPercent: parseFloat(e.target.value) || 0,
                      }))
                    }
                    min={0}
                    max={100}
                    className="w-full px-3 py-2 pr-10 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <Percent className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Platform margin added to LLM provider costs
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Default Member Spending Limit ($)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={
                      pricingDefaults.defaultSpendingLimitCents !== null
                        ? pricingDefaults.defaultSpendingLimitCents / 100
                        : ''
                    }
                    onChange={(e) =>
                      setPricingDefaults((prev) => ({
                        ...prev,
                        defaultSpendingLimitCents: e.target.value
                          ? parseFloat(e.target.value) * 100
                          : null,
                      }))
                    }
                    min={0}
                    placeholder="No limit"
                    className="w-full px-3 py-2 pl-8 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                  />
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Monthly spending limit for new org members
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Default Storage Limit (GB)
                </label>
                <input
                  type="number"
                  value={pricingDefaults.defaultStorageLimitGb ?? ''}
                  onChange={(e) =>
                    setPricingDefaults((prev) => ({
                      ...prev,
                      defaultStorageLimitGb: e.target.value ? parseInt(e.target.value) : null,
                    }))
                  }
                  min={0}
                  placeholder="No limit"
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Default Allowed Models
                </label>
                <p className="text-xs text-text-muted mb-2">
                  Leave empty to allow all models. Enter model IDs separated by commas.
                </p>
                <input
                  type="text"
                  value={pricingDefaults.defaultAllowedModels.join(', ')}
                  onChange={(e) =>
                    setPricingDefaults((prev) => ({
                      ...prev,
                      defaultAllowedModels: e.target.value
                        ? e.target.value.split(',').map((s) => s.trim())
                        : [],
                    }))
                  }
                  placeholder="gpt-4o, claude-3-5-sonnet, ..."
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDefaultsModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveDefaults} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Defaults'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
