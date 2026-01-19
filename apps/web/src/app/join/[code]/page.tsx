'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Building2, Loader2, Users, Shield, AlertCircle, Check, Crown, User } from 'lucide-react';
import { Button } from '@podex/ui';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useOrganizationStore, type OrgRole } from '@/stores/organization';
import { useUser } from '@/stores/auth';

interface InviteLinkInfo {
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    memberCount: number;
  };
  role: OrgRole;
  isValid: boolean;
  error?: string;
}

interface InviteLinkResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    member_count: number;
  };
  role: OrgRole;
}

interface JoinResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    member_count: number;
  };
  role: OrgRole;
}

export default function JoinByCodePage() {
  useDocumentTitle('Join Organization');
  const params = useParams();
  const router = useRouter();
  const user = useUser();
  const { setContext: _setContext } = useOrganizationStore();
  const code = params.code as string;

  const [linkInfo, setLinkInfo] = useState<InviteLinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [success, setSuccess] = useState(false);

  // Fetch link info
  useEffect(() => {
    const fetchLinkInfo = async () => {
      setLoading(true);
      setError(undefined);
      try {
        // Fetch invite link info from API
        const response = (await api.post(
          `/api/organizations/join/link/${code}`,
          {}
        )) as InviteLinkResponse;
        setLinkInfo({
          organization: {
            id: response.organization.id,
            name: response.organization.name,
            slug: response.organization.slug,
            logoUrl: response.organization.logo_url,
            memberCount: response.organization.member_count || 0,
          },
          role: response.role,
          isValid: true,
          error: undefined,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load invite link');
      } finally {
        setLoading(false);
      }
    };
    fetchLinkInfo();
  }, [code]);

  const handleJoin = async () => {
    if (!user) {
      // Redirect to login with return URL
      router.push(`/login?returnTo=/join/${code}`);
      return;
    }

    setJoining(true);
    setError(undefined);
    try {
      // Call API to join via link
      const response = (await api.post(`/api/organizations/join/link/${code}`, {})) as JoinResponse;
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
      setError(err instanceof Error ? err.message : 'Failed to join organization');
    } finally {
      setJoining(false);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  if (!linkInfo?.isValid) {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 bg-accent-error/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-accent-error" />
          </div>
          <h1 className="text-2xl font-semibold text-text-primary mb-2">Invalid Invite Link</h1>
          <p className="text-text-muted mb-6">
            {linkInfo?.error ||
              'This invite link is invalid, expired, or has reached its usage limit.'}
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/join">
              <Button className="w-full">Try Another Code</Button>
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
            <span className="font-medium text-text-primary">{linkInfo.organization.name}</span>
          </p>
          <p className="text-sm text-text-muted">Redirecting to your organization...</p>
        </div>
      </div>
    );
  }

  const org = linkInfo.organization;

  return (
    <div className="min-h-screen bg-void flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <p className="text-text-muted text-sm mb-2">You&apos;ve been invited to join</p>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-6">
          {error && (
            <div className="mb-4 p-4 bg-accent-error/10 border border-accent-error/30 rounded-lg text-accent-error text-sm">
              {error}
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

          {/* Role Badge */}
          <div className="flex items-center justify-center gap-2 mb-6 p-3 bg-elevated rounded-lg">
            {getRoleIcon(linkInfo.role)}
            <span className="text-text-primary">
              You&apos;ll join as a <span className="font-medium capitalize">{linkInfo.role}</span>
            </span>
          </div>

          {/* Info Box */}
          <div className="bg-accent-primary/5 border border-accent-primary/20 rounded-lg p-4 mb-6">
            <p className="text-sm text-text-secondary">
              By joining, your personal billing will be paused and you&apos;ll use the
              organization&apos;s shared resources. You can leave at any time.
            </p>
          </div>

          {/* Actions */}
          {user ? (
            <Button onClick={handleJoin} className="w-full" disabled={joining}>
              {joining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Joining...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Join {org.name}
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              <Link href={`/login?returnTo=/join/${code}`}>
                <Button className="w-full">Sign in to Join</Button>
              </Link>
              <Link href={`/signup?returnTo=/join/${code}`}>
                <Button variant="outline" className="w-full">
                  Create Account
                </Button>
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-sm text-text-muted mt-6">
          Wrong organization?{' '}
          <Link href="/join" className="text-accent-primary hover:underline">
            Enter a different code
          </Link>
        </p>
      </div>
    </div>
  );
}
