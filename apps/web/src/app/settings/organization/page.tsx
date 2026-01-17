'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Users,
  CreditCard,
  Settings,
  Mail,
  Link as LinkIcon,
  Plus,
  Loader2,
  ArrowRight,
  Crown,
  Shield,
  User,
  BarChart3,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useOrgContext,
  useIsInOrganization,
  useIsOrgOwner,
  useIsOrgAdmin,
  useOrganizationStore,
  type UserOrgContext,
} from '@/stores/organization';

export default function OrganizationPage() {
  useDocumentTitle('Organization');
  const isInOrg = useIsInOrganization();
  const orgContext = useOrgContext();
  const isOwner = useIsOrgOwner();
  const isAdmin = useIsOrgAdmin();
  const { contextLoading, setContextLoading, setContext } = useOrganizationStore();
  const [_showCreateModal, _setShowCreateModal] = useState(false);

  // Fetch org context on mount
  useEffect(() => {
    const fetchContext = async () => {
      setContextLoading(true);
      try {
        // Fetch organization context from API
        const response = (await api.get('/api/organizations/me')) as UserOrgContext;
        if (response) setContext(response);
      } finally {
        setContextLoading(false);
      }
    };
    fetchContext();
  }, [setContextLoading]);

  if (contextLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  // Not in an organization - show create/join options
  if (!isInOrg) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-text-primary">Organization</h1>
          <p className="text-text-muted mt-1">
            Create or join an organization for team collaboration and centralized billing
          </p>
        </div>

        <div className="space-y-6">
          {/* Create Organization Card */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-accent-primary/10 rounded-lg">
                <Building2 className="w-6 h-6 text-accent-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-medium text-text-primary">Create an Organization</h2>
                <p className="text-text-muted mt-1 mb-4">
                  Start a new organization and invite your team members. You&apos;ll be the owner
                  with full control over billing, plans, and member permissions.
                </p>
                <ul className="text-sm text-text-secondary space-y-2 mb-4">
                  <li className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-accent-primary" />
                    Centralized billing and credit management
                  </li>
                  <li className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-accent-primary" />
                    Invite team members with custom limits
                  </li>
                  <li className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-accent-primary" />
                    Control which models and features each member can access
                  </li>
                </ul>
                <Link href="/settings/organization/create">
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Organization
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Join Organization Card */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-accent-secondary/10 rounded-lg">
                <Users className="w-6 h-6 text-accent-secondary" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-medium text-text-primary">Join an Organization</h2>
                <p className="text-text-muted mt-1 mb-4">
                  Have an invite link or email invitation? Join an existing organization to
                  collaborate with your team.
                </p>
                <div className="flex gap-3">
                  <Link href="/join">
                    <Button variant="outline">
                      <LinkIcon className="w-4 h-4 mr-2" />
                      Enter Invite Code
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // In an organization - show overview
  const org = orgContext!.organization;
  const role = orgContext!.role;
  const limits = orgContext!.limits;

  const getRoleIcon = (r: string) => {
    switch (r) {
      case 'owner':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-accent-primary" />;
      default:
        return <User className="w-4 h-4 text-text-muted" />;
    }
  };

  const formatCents = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={org.name} className="w-10 h-10 rounded-lg" />
          ) : (
            <div className="w-10 h-10 bg-accent-primary/10 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-accent-primary" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">{org.name}</h1>
            <div className="flex items-center gap-2 text-sm text-text-muted">
              {getRoleIcon(role)}
              <span className="capitalize">{role}</span>
              <span className="text-border-subtle">|</span>
              <span>{org.memberCount} members</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <section className="mb-8">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface border border-border-default rounded-xl p-4">
            <p className="text-sm text-text-muted mb-1">Credit Model</p>
            <p className="text-lg font-medium text-text-primary capitalize">
              {org.creditModel.replace('_', ' ')}
            </p>
          </div>
          <div className="bg-surface border border-border-default rounded-xl p-4">
            <p className="text-sm text-text-muted mb-1">Organization Credits</p>
            <p className="text-lg font-medium text-text-primary">
              {formatCents(org.creditPoolCents)}
            </p>
          </div>
        </div>
      </section>

      {/* Your Limits */}
      <section className="mb-8">
        <h2 className="text-lg font-medium text-text-primary mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Your Usage & Limits
        </h2>
        <div className="bg-surface border border-border-default rounded-xl p-5 space-y-4">
          {limits.spendingLimitCents !== null && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Spending</span>
                <span className="text-text-primary">
                  {formatCents(limits.currentSpendingCents)} /{' '}
                  {formatCents(limits.spendingLimitCents)}
                </span>
              </div>
              <div className="w-full bg-elevated rounded-full h-2">
                <div
                  className="bg-accent-primary h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min((limits.currentSpendingCents / limits.spendingLimitCents) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {org.creditModel === 'allocated' && (
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Allocated Credits</span>
                <span className="text-text-primary">
                  {formatCents(limits.usedCreditsCents)} /{' '}
                  {formatCents(limits.allocatedCreditsCents)}
                </span>
              </div>
              <div className="w-full bg-elevated rounded-full h-2">
                <div
                  className="bg-accent-secondary h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min((limits.usedCreditsCents / limits.allocatedCreditsCents) * 100, 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {limits.allowedModels && (
            <div>
              <p className="text-sm text-text-muted mb-2">Allowed Models</p>
              <div className="flex flex-wrap gap-2">
                {limits.allowedModels.map((model) => (
                  <span
                    key={model}
                    className="px-2 py-1 bg-elevated rounded text-xs text-text-secondary"
                  >
                    {model}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Navigation Cards */}
      <section className="space-y-3">
        {isAdmin && (
          <>
            <Link
              href="/settings/organization/members"
              className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Members</p>
                  <p className="text-sm text-text-muted">Manage team members and their limits</p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-text-muted" />
            </Link>

            <Link
              href="/settings/organization/invitations"
              className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Invitations</p>
                  <p className="text-sm text-text-muted">
                    Manage pending invitations and invite links
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-text-muted" />
            </Link>
          </>
        )}

        {isOwner && (
          <>
            <Link
              href="/settings/organization/billing"
              className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Billing</p>
                  <p className="text-sm text-text-muted">
                    View usage, invoices, and purchase credits
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-text-muted" />
            </Link>

            <Link
              href="/settings/organization/settings"
              className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl hover:border-accent-primary/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Settings className="w-5 h-5 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Settings</p>
                  <p className="text-sm text-text-muted">
                    Configure organization settings and defaults
                  </p>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-text-muted" />
            </Link>
          </>
        )}
      </section>

      {/* Leave Organization */}
      {role !== 'owner' && (
        <section className="mt-8">
          <div className="bg-surface border border-accent-error/30 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-text-primary">Leave Organization</p>
                <p className="text-sm text-text-muted">Your personal billing will be reactivated</p>
              </div>
              <Button variant="danger" size="sm">
                Leave Organization
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
