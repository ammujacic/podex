import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

export type CreditModel = 'pooled' | 'allocated' | 'usage_based';
export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  creditModel: CreditModel;
  creditPoolCents: number;
  autoJoinEnabled: boolean;
  autoJoinDomains: string[] | null;
  isActive: boolean;
  logoUrl: string | null;
  website: string | null;
  onboardingCompleted: boolean;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: OrgRole;
  spendingLimitCents: number | null;
  currentSpendingCents: number;
  allocatedCreditsCents: number;
  usedCreditsCents: number;
  isBlocked: boolean;
  blockedReason: string | null;
  joinedAt: string;
}

export interface OrganizationInvitation {
  id: string;
  email: string;
  role: OrgRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitedByEmail: string | null;
  message: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface OrganizationInviteLink {
  id: string;
  code: string;
  url: string;
  name: string | null;
  role: OrgRole;
  maxUses: number | null;
  currentUses: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface UserLimits {
  spendingLimitCents: number | null;
  currentSpendingCents: number;
  remainingSpendingCents: number | null;
  allocatedCreditsCents: number;
  usedCreditsCents: number;
  remainingAllocatedCents: number;
  allowedModels: string[] | null;
  allowedInstanceTypes: string[] | null;
  storageLimitGb: number | null;
  isAtLimit: boolean;
}

export interface UserOrgContext {
  organization: Organization;
  role: OrgRole;
  isBlocked: boolean;
  limits: UserLimits;
}

interface OrganizationState {
  // Current user's organization context
  context: UserOrgContext | null;
  contextLoading: boolean;
  contextError: string | null;

  // Members list (for admin views)
  members: OrganizationMember[];
  membersLoading: boolean;
  membersError: string | null;

  // Invitations list
  invitations: OrganizationInvitation[];
  invitationsLoading: boolean;

  // Invite links list
  inviteLinks: OrganizationInviteLink[];
  inviteLinksLoading: boolean;

  // Actions
  setContext: (context: UserOrgContext | null) => void;
  setContextLoading: (loading: boolean) => void;
  setContextError: (error: string | null) => void;

  setMembers: (members: OrganizationMember[]) => void;
  setMembersLoading: (loading: boolean) => void;
  setMembersError: (error: string | null) => void;
  updateMember: (userId: string, updates: Partial<OrganizationMember>) => void;
  removeMember: (userId: string) => void;

  setInvitations: (invitations: OrganizationInvitation[]) => void;
  setInvitationsLoading: (loading: boolean) => void;
  addInvitation: (invitation: OrganizationInvitation) => void;
  removeInvitation: (id: string) => void;

  setInviteLinks: (links: OrganizationInviteLink[]) => void;
  setInviteLinksLoading: (loading: boolean) => void;
  addInviteLink: (link: OrganizationInviteLink) => void;
  removeInviteLink: (id: string) => void;

  reset: () => void;
}

const initialState = {
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
};

const organizationStoreCreator: StateCreator<OrganizationState> = (set) => ({
  ...initialState,

  setContext: (context) => set({ context }),
  setContextLoading: (contextLoading) => set({ contextLoading }),
  setContextError: (contextError) => set({ contextError }),

  setMembers: (members) => set({ members }),
  setMembersLoading: (membersLoading) => set({ membersLoading }),
  setMembersError: (membersError) => set({ membersError }),
  updateMember: (userId, updates) =>
    set((state) => ({
      members: state.members.map((m) => (m.userId === userId ? { ...m, ...updates } : m)),
    })),
  removeMember: (userId) =>
    set((state) => ({
      members: state.members.filter((m) => m.userId !== userId),
    })),

  setInvitations: (invitations) => set({ invitations }),
  setInvitationsLoading: (invitationsLoading) => set({ invitationsLoading }),
  addInvitation: (invitation) =>
    set((state) => ({
      invitations: [invitation, ...state.invitations],
    })),
  removeInvitation: (id) =>
    set((state) => ({
      invitations: state.invitations.filter((inv) => inv.id !== id),
    })),

  setInviteLinks: (inviteLinks) => set({ inviteLinks }),
  setInviteLinksLoading: (inviteLinksLoading) => set({ inviteLinksLoading }),
  addInviteLink: (link) =>
    set((state) => ({
      inviteLinks: [link, ...state.inviteLinks],
    })),
  removeInviteLink: (id) =>
    set((state) => ({
      inviteLinks: state.inviteLinks.filter((link) => link.id !== id),
    })),

  reset: () => set(initialState),
});

export const useOrganizationStore = create<OrganizationState>()(
  devtools(organizationStoreCreator, {
    name: 'podex-organization',
  })
);

// Selector hooks for convenience
export const useOrgContext = () => useOrganizationStore((state) => state.context);
export const useIsInOrganization = () => useOrganizationStore((state) => state.context !== null);
export const useOrgRole = () => useOrganizationStore((state) => state.context?.role ?? null);
export const useIsOrgOwner = () => useOrganizationStore((state) => state.context?.role === 'owner');
export const useIsOrgAdmin = () =>
  useOrganizationStore(
    (state) => state.context?.role === 'owner' || state.context?.role === 'admin'
  );
export const useCanManageMembers = () =>
  useOrganizationStore(
    (state) => state.context?.role === 'owner' || state.context?.role === 'admin'
  );
export const useCanAccessBilling = () =>
  useOrganizationStore((state) => state.context?.role === 'owner');
export const useOrgMembers = () => useOrganizationStore((state) => state.members);
export const useOrgInvitations = () => useOrganizationStore((state) => state.invitations);
export const useOrgInviteLinks = () => useOrganizationStore((state) => state.inviteLinks);
export const useUserLimits = () => useOrganizationStore((state) => state.context?.limits ?? null);
export const useIsAtLimit = () =>
  useOrganizationStore((state) => state.context?.limits?.isAtLimit ?? false);
export const useIsBlocked = () =>
  useOrganizationStore((state) => state.context?.isBlocked ?? false);
