import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useOrganizationStore,
  useOrgContext,
  useIsInOrganization,
  useOrgRole,
  useIsOrgOwner,
  useIsOrgAdmin,
  useCanManageMembers,
  useCanAccessBilling,
  useOrgMembers,
  useOrgInvitations,
  useOrgInviteLinks,
  useUserLimits,
  useIsAtLimit,
  useIsBlocked,
  type Organization,
  type OrganizationMember,
  type OrganizationInvitation,
  type OrganizationInviteLink,
  type UserOrgContext,
} from '../organization';

// Test fixtures
const mockOrganization: Organization = {
  id: 'org-1',
  name: 'Test Organization',
  slug: 'test-org',
  creditModel: 'pooled',
  creditPoolCents: 100000,
  autoJoinEnabled: false,
  autoJoinDomains: null,
  isActive: true,
  logoUrl: null,
  website: null,
  onboardingCompleted: true,
  memberCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockUserOrgContext: UserOrgContext = {
  organization: mockOrganization,
  role: 'admin',
  isBlocked: false,
  limits: {
    spendingLimitCents: 50000,
    currentSpendingCents: 10000,
    remainingSpendingCents: 40000,
    allocatedCreditsCents: 20000,
    usedCreditsCents: 5000,
    remainingAllocatedCents: 15000,
    allowedModels: null,
    allowedInstanceTypes: null,
    storageLimitGb: null,
    isAtLimit: false,
  },
};

const mockOwnerContext: UserOrgContext = {
  ...mockUserOrgContext,
  role: 'owner',
};

const mockMemberContext: UserOrgContext = {
  ...mockUserOrgContext,
  role: 'member',
};

const mockOrganizationMember: OrganizationMember = {
  id: 'member-1',
  userId: 'user-1',
  email: 'member@example.com',
  name: 'John Doe',
  avatarUrl: null,
  role: 'member',
  spendingLimitCents: 10000,
  currentSpendingCents: 2000,
  allocatedCreditsCents: 5000,
  usedCreditsCents: 1000,
  isBlocked: false,
  blockedReason: null,
  joinedAt: '2024-01-01T00:00:00Z',
};

const mockAdminMember: OrganizationMember = {
  ...mockOrganizationMember,
  id: 'member-2',
  userId: 'user-2',
  email: 'admin@example.com',
  name: 'Jane Admin',
  role: 'admin',
};

const mockOwnerMember: OrganizationMember = {
  ...mockOrganizationMember,
  id: 'member-3',
  userId: 'user-3',
  email: 'owner@example.com',
  name: 'Bob Owner',
  role: 'owner',
};

const mockInvitation: OrganizationInvitation = {
  id: 'invite-1',
  email: 'newmember@example.com',
  role: 'member',
  status: 'pending',
  invitedByEmail: 'admin@example.com',
  message: 'Welcome to the team!',
  expiresAt: '2024-02-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

const mockInviteLink: OrganizationInviteLink = {
  id: 'link-1',
  code: 'abc123',
  url: 'https://app.podex.ai/invite/abc123',
  name: 'General Invite',
  role: 'member',
  maxUses: 10,
  currentUses: 3,
  isActive: true,
  expiresAt: '2024-03-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('organizationStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useOrganizationStore.setState({
        context: null,
        contextLoading: false,
        contextError: null,
        members: [],
        membersLoading: false,
        membersError: null,
        invitations: [],
        invitationsLoading: false,
        inviteLinks: [],
        inviteLinksLoading: false,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has no organization context', () => {
      const { result } = renderHook(() => useOrganizationStore());
      expect(result.current.context).toBeNull();
    });

    it('has no loading states active', () => {
      const { result } = renderHook(() => useOrganizationStore());
      expect(result.current.contextLoading).toBe(false);
      expect(result.current.membersLoading).toBe(false);
      expect(result.current.invitationsLoading).toBe(false);
      expect(result.current.inviteLinksLoading).toBe(false);
    });

    it('has no errors', () => {
      const { result } = renderHook(() => useOrganizationStore());
      expect(result.current.contextError).toBeNull();
      expect(result.current.membersError).toBeNull();
    });

    it('has empty members, invitations, and invite links', () => {
      const { result } = renderHook(() => useOrganizationStore());
      expect(result.current.members).toEqual([]);
      expect(result.current.invitations).toEqual([]);
      expect(result.current.inviteLinks).toEqual([]);
    });
  });

  // ========================================================================
  // Organization Context Management
  // ========================================================================

  describe('Organization Context Management', () => {
    describe('setContext', () => {
      it('sets organization context', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContext(mockUserOrgContext);
        });

        expect(result.current.context).toEqual(mockUserOrgContext);
      });

      it('can update organization context', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContext(mockUserOrgContext);
          result.current.setContext(mockOwnerContext);
        });

        expect(result.current.context?.role).toBe('owner');
      });

      it('can clear organization context', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContext(mockUserOrgContext);
          result.current.setContext(null);
        });

        expect(result.current.context).toBeNull();
      });
    });

    describe('setContextLoading', () => {
      it('sets context loading state', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContextLoading(true);
        });

        expect(result.current.contextLoading).toBe(true);
      });

      it('can clear loading state', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContextLoading(true);
          result.current.setContextLoading(false);
        });

        expect(result.current.contextLoading).toBe(false);
      });
    });

    describe('setContextError', () => {
      it('sets context error', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContextError('Failed to load organization');
        });

        expect(result.current.contextError).toBe('Failed to load organization');
      });

      it('can clear error', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContextError('Error');
          result.current.setContextError(null);
        });

        expect(result.current.contextError).toBeNull();
      });
    });

    describe('organization settings', () => {
      it('stores credit model configuration', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const allocatedContext: UserOrgContext = {
          ...mockUserOrgContext,
          organization: {
            ...mockOrganization,
            creditModel: 'allocated',
          },
        };

        act(() => {
          result.current.setContext(allocatedContext);
        });

        expect(result.current.context?.organization.creditModel).toBe('allocated');
      });

      it('stores auto-join domain settings', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const autoJoinContext: UserOrgContext = {
          ...mockUserOrgContext,
          organization: {
            ...mockOrganization,
            autoJoinEnabled: true,
            autoJoinDomains: ['example.com', 'test.com'],
          },
        };

        act(() => {
          result.current.setContext(autoJoinContext);
        });

        expect(result.current.context?.organization.autoJoinEnabled).toBe(true);
        expect(result.current.context?.organization.autoJoinDomains).toEqual([
          'example.com',
          'test.com',
        ]);
      });

      it('stores organization branding', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const brandedContext: UserOrgContext = {
          ...mockUserOrgContext,
          organization: {
            ...mockOrganization,
            logoUrl: 'https://example.com/logo.png',
            website: 'https://example.com',
          },
        };

        act(() => {
          result.current.setContext(brandedContext);
        });

        expect(result.current.context?.organization.logoUrl).toBe('https://example.com/logo.png');
        expect(result.current.context?.organization.website).toBe('https://example.com');
      });
    });

    describe('user limits tracking', () => {
      it('tracks spending limits', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContext(mockUserOrgContext);
        });

        expect(result.current.context?.limits.spendingLimitCents).toBe(50000);
        expect(result.current.context?.limits.currentSpendingCents).toBe(10000);
        expect(result.current.context?.limits.remainingSpendingCents).toBe(40000);
      });

      it('tracks credit allocation', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setContext(mockUserOrgContext);
        });

        expect(result.current.context?.limits.allocatedCreditsCents).toBe(20000);
        expect(result.current.context?.limits.usedCreditsCents).toBe(5000);
        expect(result.current.context?.limits.remainingAllocatedCents).toBe(15000);
      });

      it('tracks limit status', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const atLimitContext: UserOrgContext = {
          ...mockUserOrgContext,
          limits: {
            ...mockUserOrgContext.limits,
            isAtLimit: true,
          },
        };

        act(() => {
          result.current.setContext(atLimitContext);
        });

        expect(result.current.context?.limits.isAtLimit).toBe(true);
      });

      it('tracks blocked status', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const blockedContext: UserOrgContext = {
          ...mockUserOrgContext,
          isBlocked: true,
        };

        act(() => {
          result.current.setContext(blockedContext);
        });

        expect(result.current.context?.isBlocked).toBe(true);
      });
    });
  });

  // ========================================================================
  // Member Management
  // ========================================================================

  describe('Member Management', () => {
    describe('setMembers', () => {
      it('sets organization members', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const members = [mockOrganizationMember, mockAdminMember];

        act(() => {
          result.current.setMembers(members);
        });

        expect(result.current.members).toEqual(members);
        expect(result.current.members).toHaveLength(2);
      });

      it('replaces existing members', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setMembers([mockOrganizationMember]);
          result.current.setMembers([mockAdminMember, mockOwnerMember]);
        });

        expect(result.current.members).toHaveLength(2);
        expect(result.current.members[0].id).toBe('member-2');
      });
    });

    describe('setMembersLoading', () => {
      it('sets members loading state', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setMembersLoading(true);
        });

        expect(result.current.membersLoading).toBe(true);
      });
    });

    describe('setMembersError', () => {
      it('sets members error', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setMembersError('Failed to load members');
        });

        expect(result.current.membersError).toBe('Failed to load members');
      });
    });

    describe('updateMember', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useOrganizationStore());
        act(() => {
          result.current.setMembers([mockOrganizationMember, mockAdminMember]);
        });
      });

      it('updates member role', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.updateMember('user-1', { role: 'admin' });
        });

        const updatedMember = result.current.members.find((m) => m.userId === 'user-1');
        expect(updatedMember?.role).toBe('admin');
      });

      it('updates member spending limit', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.updateMember('user-1', { spendingLimitCents: 20000 });
        });

        const updatedMember = result.current.members.find((m) => m.userId === 'user-1');
        expect(updatedMember?.spendingLimitCents).toBe(20000);
      });

      it('blocks a member', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.updateMember('user-1', {
            isBlocked: true,
            blockedReason: 'Exceeded spending limit',
          });
        });

        const updatedMember = result.current.members.find((m) => m.userId === 'user-1');
        expect(updatedMember?.isBlocked).toBe(true);
        expect(updatedMember?.blockedReason).toBe('Exceeded spending limit');
      });

      it('updates allocated credits', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.updateMember('user-1', {
            allocatedCreditsCents: 15000,
            usedCreditsCents: 3000,
          });
        });

        const updatedMember = result.current.members.find((m) => m.userId === 'user-1');
        expect(updatedMember?.allocatedCreditsCents).toBe(15000);
        expect(updatedMember?.usedCreditsCents).toBe(3000);
      });

      it('only updates specified member', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.updateMember('user-1', { role: 'admin' });
        });

        const unchangedMember = result.current.members.find((m) => m.userId === 'user-2');
        expect(unchangedMember?.role).toBe('admin');
      });

      it('handles updating non-existent member gracefully', () => {
        const { result } = renderHook(() => useOrganizationStore());

        expect(() => {
          act(() => {
            result.current.updateMember('non-existent', { role: 'admin' });
          });
        }).not.toThrow();
      });
    });

    describe('removeMember', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useOrganizationStore());
        act(() => {
          result.current.setMembers([mockOrganizationMember, mockAdminMember, mockOwnerMember]);
        });
      });

      it('removes member from organization', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.removeMember('user-1');
        });

        expect(result.current.members).toHaveLength(2);
        expect(result.current.members.find((m) => m.userId === 'user-1')).toBeUndefined();
      });

      it('only removes specified member', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.removeMember('user-1');
        });

        expect(result.current.members.find((m) => m.userId === 'user-2')).toBeDefined();
        expect(result.current.members.find((m) => m.userId === 'user-3')).toBeDefined();
      });

      it('handles removing non-existent member gracefully', () => {
        const { result } = renderHook(() => useOrganizationStore());

        expect(() => {
          act(() => {
            result.current.removeMember('non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('member roles', () => {
      it('differentiates between member roles', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setMembers([mockOrganizationMember, mockAdminMember, mockOwnerMember]);
        });

        const members = result.current.members;
        const member = members.find((m) => m.role === 'member');
        const admin = members.find((m) => m.role === 'admin');
        const owner = members.find((m) => m.role === 'owner');

        expect(member).toBeDefined();
        expect(admin).toBeDefined();
        expect(owner).toBeDefined();
        expect(member?.role).toBe('member');
        expect(admin?.role).toBe('admin');
        expect(owner?.role).toBe('owner');
      });
    });
  });

  // ========================================================================
  // Invitation Management
  // ========================================================================

  describe('Invitation Management', () => {
    describe('setInvitations', () => {
      it('sets invitations list', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const invitations = [mockInvitation];

        act(() => {
          result.current.setInvitations(invitations);
        });

        expect(result.current.invitations).toEqual(invitations);
      });

      it('replaces existing invitations', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const invitation2: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-2',
          email: 'another@example.com',
        };

        act(() => {
          result.current.setInvitations([mockInvitation]);
          result.current.setInvitations([invitation2]);
        });

        expect(result.current.invitations).toHaveLength(1);
        expect(result.current.invitations[0].id).toBe('invite-2');
      });
    });

    describe('setInvitationsLoading', () => {
      it('sets invitations loading state', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setInvitationsLoading(true);
        });

        expect(result.current.invitationsLoading).toBe(true);
      });
    });

    describe('addInvitation', () => {
      it('adds invitation to beginning of list', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.addInvitation(mockInvitation);
        });

        expect(result.current.invitations).toHaveLength(1);
        expect(result.current.invitations[0]).toEqual(mockInvitation);
      });

      it('prepends new invitation', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const invitation2: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-2',
          email: 'second@example.com',
        };

        act(() => {
          result.current.addInvitation(mockInvitation);
          result.current.addInvitation(invitation2);
        });

        expect(result.current.invitations).toHaveLength(2);
        expect(result.current.invitations[0].id).toBe('invite-2');
        expect(result.current.invitations[1].id).toBe('invite-1');
      });

      it('handles different invitation statuses', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const acceptedInvite: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-accepted',
          status: 'accepted',
        };
        const expiredInvite: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-expired',
          status: 'expired',
        };
        const revokedInvite: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-revoked',
          status: 'revoked',
        };

        act(() => {
          result.current.addInvitation(mockInvitation);
          result.current.addInvitation(acceptedInvite);
          result.current.addInvitation(expiredInvite);
          result.current.addInvitation(revokedInvite);
        });

        expect(result.current.invitations).toHaveLength(4);
        expect(result.current.invitations.find((i) => i.status === 'pending')).toBeDefined();
        expect(result.current.invitations.find((i) => i.status === 'accepted')).toBeDefined();
        expect(result.current.invitations.find((i) => i.status === 'expired')).toBeDefined();
        expect(result.current.invitations.find((i) => i.status === 'revoked')).toBeDefined();
      });
    });

    describe('removeInvitation', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useOrganizationStore());
        const invitation2: OrganizationInvitation = {
          ...mockInvitation,
          id: 'invite-2',
          email: 'second@example.com',
        };
        act(() => {
          result.current.setInvitations([mockInvitation, invitation2]);
        });
      });

      it('removes invitation by id', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.removeInvitation('invite-1');
        });

        expect(result.current.invitations).toHaveLength(1);
        expect(result.current.invitations[0].id).toBe('invite-2');
      });

      it('handles removing non-existent invitation gracefully', () => {
        const { result } = renderHook(() => useOrganizationStore());

        expect(() => {
          act(() => {
            result.current.removeInvitation('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Invite Link Management
  // ========================================================================

  describe('Invite Link Management', () => {
    describe('setInviteLinks', () => {
      it('sets invite links list', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const links = [mockInviteLink];

        act(() => {
          result.current.setInviteLinks(links);
        });

        expect(result.current.inviteLinks).toEqual(links);
      });

      it('replaces existing links', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const link2: OrganizationInviteLink = {
          ...mockInviteLink,
          id: 'link-2',
          code: 'xyz789',
        };

        act(() => {
          result.current.setInviteLinks([mockInviteLink]);
          result.current.setInviteLinks([link2]);
        });

        expect(result.current.inviteLinks).toHaveLength(1);
        expect(result.current.inviteLinks[0].id).toBe('link-2');
      });
    });

    describe('setInviteLinksLoading', () => {
      it('sets invite links loading state', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.setInviteLinksLoading(true);
        });

        expect(result.current.inviteLinksLoading).toBe(true);
      });
    });

    describe('addInviteLink', () => {
      it('adds invite link to beginning of list', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.addInviteLink(mockInviteLink);
        });

        expect(result.current.inviteLinks).toHaveLength(1);
        expect(result.current.inviteLinks[0]).toEqual(mockInviteLink);
      });

      it('prepends new invite link', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const link2: OrganizationInviteLink = {
          ...mockInviteLink,
          id: 'link-2',
          code: 'xyz789',
        };

        act(() => {
          result.current.addInviteLink(mockInviteLink);
          result.current.addInviteLink(link2);
        });

        expect(result.current.inviteLinks).toHaveLength(2);
        expect(result.current.inviteLinks[0].id).toBe('link-2');
      });

      it('tracks invite link usage', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const usedLink: OrganizationInviteLink = {
          ...mockInviteLink,
          currentUses: 8,
          maxUses: 10,
        };

        act(() => {
          result.current.addInviteLink(usedLink);
        });

        const link = result.current.inviteLinks[0];
        expect(link.currentUses).toBe(8);
        expect(link.maxUses).toBe(10);
      });

      it('handles unlimited invite links', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const unlimitedLink: OrganizationInviteLink = {
          ...mockInviteLink,
          maxUses: null,
        };

        act(() => {
          result.current.addInviteLink(unlimitedLink);
        });

        expect(result.current.inviteLinks[0].maxUses).toBeNull();
      });

      it('tracks active/inactive status', () => {
        const { result } = renderHook(() => useOrganizationStore());
        const inactiveLink: OrganizationInviteLink = {
          ...mockInviteLink,
          id: 'link-inactive',
          isActive: false,
        };

        act(() => {
          result.current.addInviteLink(mockInviteLink);
          result.current.addInviteLink(inactiveLink);
        });

        expect(result.current.inviteLinks.find((l) => l.isActive)).toBeDefined();
        expect(result.current.inviteLinks.find((l) => !l.isActive)).toBeDefined();
      });
    });

    describe('removeInviteLink', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useOrganizationStore());
        const link2: OrganizationInviteLink = {
          ...mockInviteLink,
          id: 'link-2',
          code: 'xyz789',
        };
        act(() => {
          result.current.setInviteLinks([mockInviteLink, link2]);
        });
      });

      it('removes invite link by id', () => {
        const { result } = renderHook(() => useOrganizationStore());

        act(() => {
          result.current.removeInviteLink('link-1');
        });

        expect(result.current.inviteLinks).toHaveLength(1);
        expect(result.current.inviteLinks[0].id).toBe('link-2');
      });

      it('handles removing non-existent link gracefully', () => {
        const { result } = renderHook(() => useOrganizationStore());

        expect(() => {
          act(() => {
            result.current.removeInviteLink('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Reset Store
  // ========================================================================

  describe('reset', () => {
    it('resets store to initial state', () => {
      const { result } = renderHook(() => useOrganizationStore());

      act(() => {
        result.current.setContext(mockUserOrgContext);
        result.current.setMembers([mockOrganizationMember]);
        result.current.setInvitations([mockInvitation]);
        result.current.setInviteLinks([mockInviteLink]);
        result.current.reset();
      });

      expect(result.current.context).toBeNull();
      expect(result.current.members).toEqual([]);
      expect(result.current.invitations).toEqual([]);
      expect(result.current.inviteLinks).toEqual([]);
    });

    it('clears all loading and error states', () => {
      const { result } = renderHook(() => useOrganizationStore());

      act(() => {
        result.current.setContextLoading(true);
        result.current.setContextError('Error');
        result.current.setMembersLoading(true);
        result.current.setMembersError('Error');
        result.current.reset();
      });

      expect(result.current.contextLoading).toBe(false);
      expect(result.current.contextError).toBeNull();
      expect(result.current.membersLoading).toBe(false);
      expect(result.current.membersError).toBeNull();
    });
  });

  // ========================================================================
  // Selector Hooks
  // ========================================================================

  describe('Selector Hooks', () => {
    describe('useOrgContext', () => {
      it('returns organization context', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useOrgContext());
        expect(result.current).toEqual(mockUserOrgContext);
      });
    });

    describe('useIsInOrganization', () => {
      it('returns true when context exists', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useIsInOrganization());
        expect(result.current).toBe(true);
      });

      it('returns false when context is null', () => {
        const { result } = renderHook(() => useIsInOrganization());
        expect(result.current).toBe(false);
      });
    });

    describe('useOrgRole', () => {
      it('returns user role from context', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useOrgRole());
        expect(result.current).toBe('admin');
      });

      it('returns null when no context', () => {
        const { result } = renderHook(() => useOrgRole());
        expect(result.current).toBeNull();
      });
    });

    describe('useIsOrgOwner', () => {
      it('returns true for owner role', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockOwnerContext });
        });

        const { result } = renderHook(() => useIsOrgOwner());
        expect(result.current).toBe(true);
      });

      it('returns false for non-owner roles', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useIsOrgOwner());
        expect(result.current).toBe(false);
      });
    });

    describe('useIsOrgAdmin', () => {
      it('returns true for owner role', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockOwnerContext });
        });

        const { result } = renderHook(() => useIsOrgAdmin());
        expect(result.current).toBe(true);
      });

      it('returns true for admin role', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useIsOrgAdmin());
        expect(result.current).toBe(true);
      });

      it('returns false for member role', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockMemberContext });
        });

        const { result } = renderHook(() => useIsOrgAdmin());
        expect(result.current).toBe(false);
      });
    });

    describe('useCanManageMembers', () => {
      it('returns true for owner', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockOwnerContext });
        });

        const { result } = renderHook(() => useCanManageMembers());
        expect(result.current).toBe(true);
      });

      it('returns true for admin', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useCanManageMembers());
        expect(result.current).toBe(true);
      });

      it('returns false for member', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockMemberContext });
        });

        const { result } = renderHook(() => useCanManageMembers());
        expect(result.current).toBe(false);
      });
    });

    describe('useCanAccessBilling', () => {
      it('returns true for owner', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockOwnerContext });
        });

        const { result } = renderHook(() => useCanAccessBilling());
        expect(result.current).toBe(true);
      });

      it('returns false for admin', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useCanAccessBilling());
        expect(result.current).toBe(false);
      });

      it('returns false for member', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockMemberContext });
        });

        const { result } = renderHook(() => useCanAccessBilling());
        expect(result.current).toBe(false);
      });
    });

    describe('useOrgMembers', () => {
      it('returns members list', () => {
        const members = [mockOrganizationMember, mockAdminMember];
        act(() => {
          useOrganizationStore.setState({ members });
        });

        const { result } = renderHook(() => useOrgMembers());
        expect(result.current).toEqual(members);
      });
    });

    describe('useOrgInvitations', () => {
      it('returns invitations list', () => {
        const invitations = [mockInvitation];
        act(() => {
          useOrganizationStore.setState({ invitations });
        });

        const { result } = renderHook(() => useOrgInvitations());
        expect(result.current).toEqual(invitations);
      });
    });

    describe('useOrgInviteLinks', () => {
      it('returns invite links list', () => {
        const inviteLinks = [mockInviteLink];
        act(() => {
          useOrganizationStore.setState({ inviteLinks });
        });

        const { result } = renderHook(() => useOrgInviteLinks());
        expect(result.current).toEqual(inviteLinks);
      });
    });

    describe('useUserLimits', () => {
      it('returns user limits from context', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useUserLimits());
        expect(result.current).toEqual(mockUserOrgContext.limits);
      });

      it('returns null when no context', () => {
        const { result } = renderHook(() => useUserLimits());
        expect(result.current).toBeNull();
      });
    });

    describe('useIsAtLimit', () => {
      it('returns true when at limit', () => {
        const atLimitContext: UserOrgContext = {
          ...mockUserOrgContext,
          limits: {
            ...mockUserOrgContext.limits,
            isAtLimit: true,
          },
        };
        act(() => {
          useOrganizationStore.setState({ context: atLimitContext });
        });

        const { result } = renderHook(() => useIsAtLimit());
        expect(result.current).toBe(true);
      });

      it('returns false when not at limit', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useIsAtLimit());
        expect(result.current).toBe(false);
      });

      it('returns false when no context', () => {
        const { result } = renderHook(() => useIsAtLimit());
        expect(result.current).toBe(false);
      });
    });

    describe('useIsBlocked', () => {
      it('returns true when blocked', () => {
        const blockedContext: UserOrgContext = {
          ...mockUserOrgContext,
          isBlocked: true,
        };
        act(() => {
          useOrganizationStore.setState({ context: blockedContext });
        });

        const { result } = renderHook(() => useIsBlocked());
        expect(result.current).toBe(true);
      });

      it('returns false when not blocked', () => {
        act(() => {
          useOrganizationStore.setState({ context: mockUserOrgContext });
        });

        const { result } = renderHook(() => useIsBlocked());
        expect(result.current).toBe(false);
      });

      it('returns false when no context', () => {
        const { result } = renderHook(() => useIsBlocked());
        expect(result.current).toBe(false);
      });
    });
  });
});
