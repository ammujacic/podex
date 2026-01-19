'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Building2,
  Loader2,
  Users,
  Shield,
  AlertCircle,
  Check,
  Crown,
  User,
  Mail,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOrganizationStore, type OrgRole } from '@/stores/organization';
import { useUser } from '@/stores/auth';

interface InvitationInfo {
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    memberCount: number;
  };
  email: string;
  role: OrgRole;
  message: string | null;
  invitedBy: string | null;
  expiresAt: string;
  isValid: boolean;
  error?: string;
}

interface InvitationResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    member_count: number;
  };
  invitation: {
    email: string;
    message: string | null;
  };
  role: OrgRole;
}

interface AcceptInvitationResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    member_count: number;
  };
  role: OrgRole;
}

export default function AcceptInvitationPage() {
  useDocumentTitle('Accept Invitation');
  const params = useParams();
  const router = useRouter();
  const user = useUser();
  const { setContext: _setContext } = useOrganizationStore();
  const token = params.token as string;

  const [invitationInfo, setInvitationInfo] = useState<InvitationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);

  // Fetch invitation info
  useEffect(() => {
    const fetchInvitationInfo = async () => {
      setLoading(true);
      setError(undefined);
      try {
        // Fetch invitation info from API
        const response = (await api.post(
          `/api/organizations/join/invitation/${token}`,
          {}
        )) as InvitationResponse;
        setInvitationInfo({
          organization: {
            id: response.organization.id,
            name: response.organization.name,
            slug: response.organization.slug,
            logoUrl: response.organization.logo_url,
            memberCount: response.organization.member_count || 0,
          },
          email: response.invitation.email,
          role: response.role,
          message: response.invitation.message,
          invitedBy: null,
          expiresAt: new Date().toISOString(),
          isValid: false,
          error: 'Invalid or expired invitation',
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load invitation');
      } finally {
        setLoading(false);
      }
    };
    fetchInvitationInfo();
  }, [token]);

  const handleAccept = async () => {
    if (!user) {
      // Redirect to login/signup with return URL
      router.push(
        `/signup?email=${encodeURIComponent(invitationInfo?.email || '')}&returnTo=/join/invitation/${token}`
      );
      return;
    }

    // Check if logged in user matches invitation email
    if (invitationInfo && user.email.toLowerCase() !== invitationInfo.email.toLowerCase()) {
      setError(
        `This invitation was sent to ${invitationInfo.email}. Please sign in with that email address.`
      );
      return;
    }

    setAccepting(true);
    setError(undefined);
    try {
      // Call API to accept invitation
      const response = (await api.post(
        `/api/organizations/join/invitation/${token}`,
        {}
      )) as AcceptInvitationResponse;
      // Transform API response to match Organization type
      const organization = {
        id: response.organization.id,
        name: response.organization.name,
        slug: response.organization.slug,
        logoUrl: response.organization.logo_url,
        memberCount: response.organization.member_count,
        // Default values for missing properties that will be fetched later
        creditModel: 'pooled' as const,
        creditPoolCents: 0,
        autoJoinEnabled: false,
        autoJoinDomains: null,
        isActive: true,
        website: null,
        onboardingCompleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      _setContext({
        organization,
        role: response.role,
        isBlocked: false,
        limits: {
          spendingLimitCents: null,
          currentSpendingCents: 0,
          remainingSpendingCents: null,
          allocatedCreditsCents: 0,
          usedCreditsCents: 0,
          remainingAllocatedCents: 0,
          allowedModels: null,
          allowedInstanceTypes: null,
          storageLimitGb: null,
          isAtLimit: false,
        },
      });
      setSuccess(true);
      setTimeout(() => {
        router.push('/settings/organization');
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  const getRoleIcon = (role: OrgRole) => {
    switch (role) {
      case 'owner':
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 'admin':
        return <Shield className="w-5 h-5 text-accent-primary" />;
      default:
        return <User className="w-5 h-5 text-text-muted" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  if (!invitationInfo?.isValid) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-accent-error/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-accent-error" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Invalid Invitation</h1>
          <p className="text-text-muted mb-6">
            {invitationInfo?.error ||
              'This invitation is invalid, expired, or has already been used.'}
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/join">
              <Button className="w-full">Enter Invite Code</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="outline" className="w-full">
                Go to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-accent-success/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-accent-success" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Welcome!</h1>
          <p className="text-text-muted mb-4">
            You&apos;ve joined{' '}
            <span className="font-medium text-text-primary">
              {invitationInfo.organization.name}
            </span>
          </p>
          <p className="text-sm text-text-muted">Redirecting to your organization...</p>
        </div>
      </div>
    );
  }

  const org = invitationInfo.organization;
  const isExpired = new Date(invitationInfo.expiresAt) < new Date();
  const emailMismatch = !!user && user.email.toLowerCase() !== invitationInfo.email.toLowerCase();

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-accent-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Mail className="w-6 h-6 text-accent-primary" />
          </div>
          <p className="text-text-muted text-sm">You&apos;ve been invited to join</p>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-6">
          {error && (
            <div className="mb-4 p-4 bg-accent-error/10 border border-accent-error/30 rounded-lg text-accent-error text-sm">
              {error}
            </div>
          )}

          {isExpired && (
            <div className="mb-4 p-4 bg-accent-warning/10 border border-accent-warning/30 rounded-lg text-accent-warning text-sm">
              This invitation expired on {formatDate(invitationInfo.expiresAt)}
            </div>
          )}

          {emailMismatch && (
            <div className="mb-4 p-4 bg-accent-warning/10 border border-accent-warning/30 rounded-lg text-accent-warning text-sm">
              This invitation was sent to <strong>{invitationInfo.email}</strong>. You&apos;re
              currently signed in as <strong>{user.email}</strong>.
            </div>
          )}

          {/* Organization Info */}
          <div className="text-center mb-6">
            {org.logoUrl ? (
              <Image
                src={org.logoUrl}
                alt={org.name}
                width={80}
                height={80}
                className="w-20 h-20 rounded-2xl mx-auto mb-4"
              />
            ) : (
              <div className="w-20 h-20 bg-elevated rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Building2 className="w-10 h-10 text-text-muted" />
              </div>
            )}
            <h1 className="text-xl font-semibold text-text-primary">{org.name}</h1>
            <p className="text-sm text-text-muted mt-1 flex items-center justify-center gap-2">
              <Users className="w-4 h-4" />
              {org.memberCount} members
            </p>
          </div>

          {/* Invitation Details */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between p-3 bg-elevated rounded-lg">
              <span className="text-sm text-text-muted">Invited as</span>
              <span className="flex items-center gap-2 text-text-primary font-medium capitalize">
                {getRoleIcon(invitationInfo.role)}
                {invitationInfo.role}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 bg-elevated rounded-lg">
              <span className="text-sm text-text-muted">Email</span>
              <span className="text-text-primary">{invitationInfo.email}</span>
            </div>
            {invitationInfo.invitedBy && (
              <div className="flex items-center justify-between p-3 bg-elevated rounded-lg">
                <span className="text-sm text-text-muted">Invited by</span>
                <span className="text-text-primary">{invitationInfo.invitedBy}</span>
              </div>
            )}
          </div>

          {/* Personal Message */}
          {invitationInfo.message && (
            <div className="mb-6 p-4 bg-elevated rounded-lg">
              <p className="text-sm text-text-muted mb-1">Message from the team:</p>
              <p className="text-text-primary italic">&quot;{invitationInfo.message}&quot;</p>
            </div>
          )}

          {/* Info Box */}
          <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 mb-6">
            <p className="text-sm text-text-secondary">
              By accepting, your personal billing will be paused and you&apos;ll use the
              organization&apos;s shared resources. You can leave at any time.
            </p>
          </div>

          {/* Actions */}
          {isExpired ? (
            <div className="text-center">
              <p className="text-text-muted text-sm mb-4">
                Contact the organization admin for a new invitation.
              </p>
              <Link href="/dashboard">
                <Button variant="outline" className="w-full">
                  Go to Dashboard
                </Button>
              </Link>
            </div>
          ) : user ? (
            <Button onClick={handleAccept} className="w-full" disabled={accepting || emailMismatch}>
              {accepting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Accepting...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Accept Invitation
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <Link
                href={`/signup?email=${encodeURIComponent(invitationInfo.email)}&returnTo=/join/invitation/${token}`}
              >
                <Button className="w-full">Create Account & Join</Button>
              </Link>
              <Link href={`/login?returnTo=/join/invitation/${token}`}>
                <Button variant="outline" className="w-full">
                  Sign In
                </Button>
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-text-muted mt-6">
          Wrong invitation?{' '}
          <Link href="/join" className="text-accent-primary hover:underline">
            Enter a different code
          </Link>
        </p>
      </div>
    </div>
  );
}
