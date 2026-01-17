'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mail,
  Link as LinkIcon,
  Plus,
  Loader2,
  Trash2,
  Copy,
  Check,
  ChevronLeft,
  Clock,
  Shield,
  User,
  Crown,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useOrganizationStore,
  useIsOrgAdmin,
  useOrgContext,
  type OrganizationInvitation,
  type OrganizationInviteLink,
  type OrgRole,
} from '@/stores/organization';
import Link from 'next/link';

export default function OrganizationInvitationsPage() {
  useDocumentTitle('Organization Invitations');
  const router = useRouter();
  const isAdmin = useIsOrgAdmin();
  const orgContext = useOrgContext();
  const {
    invitations,
    invitationsLoading,
    setInvitations,
    setInvitationsLoading,
    addInvitation: _addInvitation,
    removeInvitation,
    inviteLinks,
    inviteLinksLoading,
    setInviteLinks,
    setInviteLinksLoading,
    addInviteLink: _addInviteLink,
    removeInviteLink,
  } = useOrganizationStore();

  const [activeTab, setActiveTab] = useState<'email' | 'links'>('email');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [inviteMessage, setInviteMessage] = useState('');

  // Link form state
  const [linkName, setLinkName] = useState('');
  const [linkRole, setLinkRole] = useState<OrgRole>('member');
  const [linkMaxUses, setLinkMaxUses] = useState<number | null>(null);
  const [linkExpiresIn, setLinkExpiresIn] = useState<number | null>(7);

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isAdmin, orgContext, router]);

  // Fetch invitations and links on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!orgContext) return;
      setInvitationsLoading(true);
      setInviteLinksLoading(true);
      try {
        // Fetch invitations and invite links from API
        const [invites, links] = await Promise.all([
          api.get(`/api/organizations/${orgContext.organization.id}/invitations`),
          api.get(`/api/organizations/${orgContext.organization.id}/invite-links`),
        ]);
        setInvitations(invites as OrganizationInvitation[]);
        setInviteLinks(links as OrganizationInviteLink[]);
      } finally {
        setInvitationsLoading(false);
        setInviteLinksLoading(false);
      }
    };
    fetchData();
  }, [orgContext, setInvitationsLoading, setInvitations, setInviteLinksLoading, setInviteLinks]);

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const isExpired = (dateString: string) => {
    return new Date(dateString) < new Date();
  };

  const handleCopyLink = async (link: OrganizationInviteLink) => {
    await navigator.clipboard.writeText(link.url);
    setCopiedLinkId(link.id);
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const handleSendInvite = async () => {
    setActionLoading(true);
    try {
      // Send invitation via API
      const invite = (await api.post(
        `/api/organizations/${orgContext!.organization.id}/invitations`,
        {
          email: inviteEmail,
          role: inviteRole,
          message: inviteMessage || undefined,
        }
      )) as OrganizationInvitation;
      _addInvitation(invite);
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteRole('member');
      setInviteMessage('');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateLink = async () => {
    setActionLoading(true);
    try {
      // Create invite link via API
      const link = (await api.post(
        `/api/organizations/${orgContext!.organization.id}/invite-links`,
        {
          name: linkName || undefined,
          role: linkRole,
          max_uses: linkMaxUses,
          expires_in_days: linkExpiresIn,
        }
      )) as OrganizationInviteLink;
      _addInviteLink(link);
      setShowLinkModal(false);
      setLinkName('');
      setLinkRole('member');
      setLinkMaxUses(null);
      setLinkExpiresIn(7);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeInvitation = async (id: string) => {
    setActionLoading(true);
    try {
      // Revoke invitation via API
      await api.delete(`/api/organizations/${orgContext!.organization.id}/invitations/${id}`);
      removeInvitation(id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeactivateLink = async (id: string) => {
    setActionLoading(true);
    try {
      // Deactivate invite link via API
      await api.delete(`/api/organizations/${orgContext!.organization.id}/invite-links/${id}`);
      removeInviteLink(id);
    } finally {
      setActionLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  const pendingInvitations = invitations.filter((i) => i.status === 'pending');

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
              <Mail className="w-6 h-6" />
              Invitations
            </h1>
            <p className="text-text-muted mt-1">Invite new members to join your organization</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-elevated rounded-lg w-fit mb-6">
        <button
          onClick={() => setActiveTab('email')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'email'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Mail className="w-4 h-4 inline-block mr-2" />
          Email Invitations
        </button>
        <button
          onClick={() => setActiveTab('links')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'links'
              ? 'bg-surface text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <LinkIcon className="w-4 h-4 inline-block mr-2" />
          Invite Links
        </button>
      </div>

      {/* Email Invitations Tab */}
      {activeTab === 'email' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowInviteModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Send Invitation
            </Button>
          </div>

          {invitationsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
          ) : pendingInvitations.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-border-default rounded-xl">
              <Mail className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No pending invitations</p>
              <p className="text-sm text-text-muted mt-1">
                Send email invitations to add new team members
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-4 bg-surface border border-border-default rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-elevated rounded-full flex items-center justify-center">
                      <Mail className="w-5 h-5 text-text-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{invitation.email}</p>
                      <div className="flex items-center gap-2 text-sm text-text-muted">
                        <span className="flex items-center gap-1">
                          {getRoleIcon(invitation.role)}
                          <span className="capitalize">{invitation.role}</span>
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Expires {formatDate(invitation.expiresAt)}
                        </span>
                        {isExpired(invitation.expiresAt) && (
                          <span className="px-1.5 py-0.5 bg-accent-error/10 text-accent-error rounded text-xs">
                            Expired
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeInvitation(invitation.id)}
                    className="p-2 hover:bg-elevated rounded-lg transition-colors"
                    title="Revoke invitation"
                  >
                    <Trash2 className="w-4 h-4 text-accent-error" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite Links Tab */}
      {activeTab === 'links' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowLinkModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Invite Link
            </Button>
          </div>

          {inviteLinksLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
          ) : inviteLinks.length === 0 ? (
            <div className="text-center py-12 bg-surface border border-border-default rounded-xl">
              <LinkIcon className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No invite links</p>
              <p className="text-sm text-text-muted mt-1">
                Create shareable links for easy team onboarding
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {inviteLinks.map((link) => (
                <div
                  key={link.id}
                  className="p-4 bg-surface border border-border-default rounded-xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <LinkIcon className="w-5 h-5 text-text-muted" />
                      <span className="font-medium text-text-primary">
                        {link.name || 'Unnamed link'}
                      </span>
                      {!link.isActive && (
                        <span className="px-1.5 py-0.5 bg-elevated text-text-muted rounded text-xs">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyLink(link)}
                        className="p-2 hover:bg-elevated rounded-lg transition-colors"
                        title="Copy link"
                      >
                        {copiedLinkId === link.id ? (
                          <Check className="w-4 h-4 text-accent-success" />
                        ) : (
                          <Copy className="w-4 h-4 text-text-muted" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeactivateLink(link.id)}
                        className="p-2 hover:bg-elevated rounded-lg transition-colors"
                        title="Deactivate link"
                      >
                        <Trash2 className="w-4 h-4 text-accent-error" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-text-muted">
                    <span className="flex items-center gap-1">
                      {getRoleIcon(link.role)}
                      <span className="capitalize">{link.role}</span>
                    </span>
                    <span>
                      {link.currentUses}
                      {link.maxUses !== null ? ` / ${link.maxUses}` : ''} uses
                    </span>
                    {link.expiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Expires {formatDate(link.expiresAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 p-2 bg-elevated rounded text-xs font-mono text-text-muted truncate">
                    {link.url}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Send Invitation Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Send Invitation</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Personal Message (optional)
                </label>
                <textarea
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  placeholder="Welcome to the team!"
                  rows={3}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowInviteModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleSendInvite} disabled={!inviteEmail || actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Invitation'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Link Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border-default rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Create Invite Link</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Link Name (optional)
                </label>
                <input
                  type="text"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="e.g., Engineering Team"
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Role</label>
                <select
                  value={linkRole}
                  onChange={(e) => setLinkRole(e.target.value as OrgRole)}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Max Uses (optional)
                </label>
                <input
                  type="number"
                  value={linkMaxUses ?? ''}
                  onChange={(e) => setLinkMaxUses(e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="Unlimited"
                  min={1}
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Expires In
                </label>
                <select
                  value={linkExpiresIn ?? ''}
                  onChange={(e) =>
                    setLinkExpiresIn(e.target.value ? parseInt(e.target.value) : null)
                  }
                  className="w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
                >
                  <option value="">Never</option>
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowLinkModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateLink} disabled={actionLoading}>
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Link'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
