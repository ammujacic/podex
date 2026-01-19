'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  Crown,
  Shield,
  User,
  Loader2,
  Ban,
  Trash2,
  Edit2,
  ChevronLeft,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useOrganizationStore,
  useIsOrgAdmin,
  useOrgContext,
  type OrganizationMember,
  type OrgRole,
} from '@/stores/organization';
import Link from 'next/link';

export default function OrganizationMembersPage() {
  useDocumentTitle('Organization Members');
  const router = useRouter();
  const isAdmin = useIsOrgAdmin();
  const orgContext = useOrgContext();
  const { members, membersLoading, setMembers, setMembersLoading, updateMember, removeMember } =
    useOrganizationStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<OrganizationMember | null>(null);
  const [_showEditModal, setShowEditModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isAdmin, orgContext, router]);

  // Fetch members on mount
  useEffect(() => {
    const fetchMembers = async () => {
      if (!orgContext) return;
      setMembersLoading(true);
      try {
        // Fetch members from API
        const response = (await api.get(
          `/api/organizations/${orgContext.organization.id}/members`
        )) as OrganizationMember[];
        setMembers(response);
      } finally {
        setMembersLoading(false);
      }
    };
    fetchMembers();
  }, [orgContext, setMembersLoading, setMembers]);

  const filteredMembers = members.filter(
    (member) =>
      member.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRoleIcon = (role: OrgRole) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-4 h-4 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-4 h-4 text-accent-primary" />;
      default:
        return <User className="w-4 h-4 text-text-muted" />;
    }
  };

  const getRoleBadgeClass = (role: OrgRole) => {
    switch (role) {
      case 'owner':
        return 'bg-yellow-500/10 text-yellow-600';
      case 'admin':
        return 'bg-accent-primary/10 text-accent-primary';
      default:
        return 'bg-elevated text-text-secondary';
    }
  };

  const formatCents = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const handleBlockMember = async (member: OrganizationMember) => {
    setActionLoading(true);
    try {
      // Block/unblock member via API
      if (member.isBlocked) {
        await api.post(
          `/api/organizations/${orgContext!.organization.id}/members/${member.userId}/unblock`,
          {}
        );
      } else {
        await api.post(
          `/api/organizations/${orgContext!.organization.id}/members/${member.userId}/block`,
          {
            reason: 'Blocked by admin',
          }
        );
      }
      updateMember(member.userId, { isBlocked: !member.isBlocked });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!selectedMember) return;
    setActionLoading(true);
    try {
      // Remove member via API
      await api.delete(
        `/api/organizations/${orgContext!.organization.id}/members/${selectedMember.userId}`
      );
      removeMember(selectedMember.userId);
      setShowRemoveModal(false);
      setSelectedMember(null);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings/organization"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Organization
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
              <Users className="w-6 h-6" />
              Members
            </h1>
            <p className="text-text-muted mt-1">
              Manage your organization&apos;s team members and their permissions
            </p>
          </div>
          <Link href="/settings/organization/invitations">
            <Button>Invite Members</Button>
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
        <input
          type="text"
          placeholder="Search members..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-surface border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
        />
      </div>

      {/* Members List */}
      {membersLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-12 bg-surface border border-border-default rounded-xl">
          <Users className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <p className="text-text-muted">
            {searchQuery ? 'No members match your search' : 'No members yet'}
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Member</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Role</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">
                  Spending
                </th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Status</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => (
                <tr
                  key={member.id}
                  className="border-b border-border-subtle last:border-0 hover:bg-elevated/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {member.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={member.avatarUrl}
                          alt={member.name || member.email}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-elevated rounded-full flex items-center justify-center">
                          <User className="w-4 h-4 text-text-muted" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-text-primary">{member.name || 'No name'}</p>
                        <p className="text-sm text-text-muted">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${getRoleBadgeClass(member.role)}`}
                    >
                      {getRoleIcon(member.role)}
                      <span className="capitalize">{member.role}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm">
                      <p className="text-text-primary">
                        {formatCents(member.currentSpendingCents)}
                        {member.spendingLimitCents !== null && (
                          <span className="text-text-muted">
                            {' '}
                            / {formatCents(member.spendingLimitCents)}
                          </span>
                        )}
                      </p>
                      {member.spendingLimitCents !== null && (
                        <div className="w-24 bg-elevated rounded-full h-1.5 mt-1">
                          <div
                            className="bg-accent-primary h-1.5 rounded-full"
                            style={{
                              width: `${Math.min((member.currentSpendingCents / member.spendingLimitCents) * 100, 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {member.isBlocked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-error/10 text-accent-error rounded text-xs font-medium">
                        <Ban className="w-3 h-3" />
                        Blocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-success/10 text-accent-success rounded text-xs font-medium">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {member.role !== 'owner' && (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            setSelectedMember(member);
                            setShowEditModal(true);
                          }}
                          className="p-2 hover:bg-elevated rounded-lg transition-colors"
                          title="Edit limits"
                        >
                          <Edit2 className="w-4 h-4 text-text-muted" />
                        </button>
                        <button
                          onClick={() => handleBlockMember(member)}
                          className="p-2 hover:bg-elevated rounded-lg transition-colors"
                          title={member.isBlocked ? 'Unblock' : 'Block'}
                        >
                          <Ban
                            className={`w-4 h-4 ${member.isBlocked ? 'text-accent-success' : 'text-text-muted'}`}
                          />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedMember(member);
                            setShowRemoveModal(true);
                          }}
                          className="p-2 hover:bg-elevated rounded-lg transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4 text-accent-error" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Remove Member Modal */}
      {showRemoveModal && selectedMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-2">Remove Member</h2>
            <p className="text-text-muted mb-6">
              Are you sure you want to remove{' '}
              <span className="text-text-primary font-medium">
                {selectedMember.name || selectedMember.email}
              </span>{' '}
              from the organization? Their personal billing will be reactivated.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRemoveModal(false);
                  setSelectedMember(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRemoveMember} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Remove Member'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
