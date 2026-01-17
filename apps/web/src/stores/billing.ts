import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';

// =============================================================================
// TYPES
// =============================================================================

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  tokensIncluded: number;
  computeHoursIncluded: number; // Legacy - for backward compatibility
  computeCreditsIncluded: number; // Compute credits in dollars
  storageGbIncluded: number;
  maxAgents: number;
  maxSessions: number;
  maxTeamMembers: number;
  overageAllowed: boolean;
  overageTokenRate: number;
  overageComputeRate: number;
  overageStorageRate: number;
  features: Record<string, boolean>;
  isPopular: boolean;
  isEnterprise: boolean;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'paused' | 'incomplete';
  billingCycle: 'monthly' | 'yearly';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialEnd: string | null;
  createdAt: string;
}

export interface UsageSummary {
  periodStart: string;
  periodEnd: string;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  tokensCost: number;
  computeSeconds: number;
  computeHours: number; // Legacy display
  computeCreditsUsed: number; // Compute cost in dollars
  computeCreditsIncluded: number; // Plan's included compute in dollars
  computeCost: number; // Same as computeCreditsUsed
  storageGb: number;
  storageCost: number;
  apiCalls: number;
  totalCost: number;
  usageByModel: Record<string, { input: number; output: number; cost: number }>;
  usageByAgent: Record<string, { tokens: number; cost: number }>;
  usageByTier: Record<string, { seconds: number; cost: number }>; // Compute by tier
}

export interface UsageRecord {
  id: string;
  usageType: string;
  quantity: number;
  unit: string;
  cost: number;
  model: string | null;
  tier: string | null;
  sessionId: string | null;
  agentId: string | null;
  isOverage: boolean;
  createdAt: string;
}

export interface Quota {
  id: string;
  quotaType: string;
  limitValue: number;
  currentUsage: number;
  usagePercentage: number;
  resetAt: string | null;
  overageAllowed: boolean;
  isExceeded: boolean;
  isWarning: boolean;
}

export interface CreditBalance {
  balance: number;
  pending: number;
  expiringSoon: number;
  totalPurchased: number;
  totalUsed: number;
  totalBonus: number;
  lastUpdated: string;
}

export interface CreditTransaction {
  id: string;
  amount: number;
  currency: string;
  transactionType: string;
  description: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paidAt: string | null;
  pdfUrl: string | null;
  createdAt: string;
}

export interface HardwareSpec {
  id: string;
  tier: string;
  displayName: string;
  description: string | null;
  architecture: 'x86_64' | 'arm64';
  vcpu: number;
  memoryMb: number;
  gpuType: string | null;
  gpuMemoryGb: number | null;
  gpuCount: number;
  storageGbDefault: number;
  storageGbMax: number;
  hourlyRate: number;
  isAvailable: boolean;
  requiresSubscription: string | null;
  regionAvailability: string[];
}

// =============================================================================
// STATE INTERFACE
// =============================================================================

interface BillingState {
  // Plans
  plans: SubscriptionPlan[];
  plansLoading: boolean;
  plansError: string | null;

  // User subscription
  subscription: Subscription | null;
  subscriptionLoading: boolean;
  subscriptionError: string | null;

  // Usage
  usageSummary: UsageSummary | null;
  usageHistory: UsageRecord[];
  usageLoading: boolean;
  usageError: string | null;

  // Quotas
  quotas: Quota[];
  quotasLoading: boolean;
  quotasError: string | null;

  // Credits
  creditBalance: CreditBalance | null;
  creditHistory: CreditTransaction[];
  creditsLoading: boolean;
  creditsError: string | null;

  // Invoices
  invoices: Invoice[];
  invoicesLoading: boolean;
  invoicesError: string | null;

  // Hardware specs
  hardwareSpecs: HardwareSpec[];
  hardwareSpecsLoading: boolean;
  hardwareSpecsError: string | null;

  // Actions
  setPlans: (plans: SubscriptionPlan[]) => void;
  setPlansLoading: (loading: boolean) => void;
  setPlansError: (error: string | null) => void;

  setSubscription: (subscription: Subscription | null) => void;
  setSubscriptionLoading: (loading: boolean) => void;
  setSubscriptionError: (error: string | null) => void;

  setUsageSummary: (summary: UsageSummary | null) => void;
  setUsageHistory: (history: UsageRecord[]) => void;
  setUsageLoading: (loading: boolean) => void;
  setUsageError: (error: string | null) => void;

  setQuotas: (quotas: Quota[]) => void;
  setQuotasLoading: (loading: boolean) => void;
  setQuotasError: (error: string | null) => void;

  setCreditBalance: (balance: CreditBalance | null) => void;
  setCreditHistory: (history: CreditTransaction[]) => void;
  setCreditsLoading: (loading: boolean) => void;
  setCreditsError: (error: string | null) => void;

  setInvoices: (invoices: Invoice[]) => void;
  setInvoicesLoading: (loading: boolean) => void;
  setInvoicesError: (error: string | null) => void;

  setHardwareSpecs: (specs: HardwareSpec[]) => void;
  setHardwareSpecsLoading: (loading: boolean) => void;
  setHardwareSpecsError: (error: string | null) => void;

  // Computed helpers
  getQuotaByType: (type: string) => Quota | undefined;
  getPlanBySlug: (slug: string) => SubscriptionPlan | undefined;
  getHardwareSpecByTier: (tier: string) => HardwareSpec | undefined;
  hasFeature: (feature: string) => boolean;
  isQuotaExceeded: (type: string) => boolean;

  // Reset
  reset: () => void;
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const initialState = {
  plans: [],
  plansLoading: false,
  plansError: null,

  subscription: null,
  subscriptionLoading: false,
  subscriptionError: null,

  usageSummary: null,
  usageHistory: [],
  usageLoading: false,
  usageError: null,

  quotas: [],
  quotasLoading: false,
  quotasError: null,

  creditBalance: null,
  creditHistory: [],
  creditsLoading: false,
  creditsError: null,

  invoices: [],
  invoicesLoading: false,
  invoicesError: null,

  hardwareSpecs: [],
  hardwareSpecsLoading: false,
  hardwareSpecsError: null,
};

// =============================================================================
// STORE
// =============================================================================

export const useBillingStore = create<BillingState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Plans
      setPlans: (plans) => set({ plans }),
      setPlansLoading: (plansLoading) => set({ plansLoading }),
      setPlansError: (plansError) => set({ plansError }),

      // Subscription
      setSubscription: (subscription) => set({ subscription }),
      setSubscriptionLoading: (subscriptionLoading) => set({ subscriptionLoading }),
      setSubscriptionError: (subscriptionError) => set({ subscriptionError }),

      // Usage
      setUsageSummary: (usageSummary) => set({ usageSummary }),
      setUsageHistory: (usageHistory) => set({ usageHistory }),
      setUsageLoading: (usageLoading) => set({ usageLoading }),
      setUsageError: (usageError) => set({ usageError }),

      // Quotas
      setQuotas: (quotas) => set({ quotas }),
      setQuotasLoading: (quotasLoading) => set({ quotasLoading }),
      setQuotasError: (quotasError) => set({ quotasError }),

      // Credits
      setCreditBalance: (creditBalance) => set({ creditBalance }),
      setCreditHistory: (creditHistory) => set({ creditHistory }),
      setCreditsLoading: (creditsLoading) => set({ creditsLoading }),
      setCreditsError: (creditsError) => set({ creditsError }),

      // Invoices
      setInvoices: (invoices) => set({ invoices }),
      setInvoicesLoading: (invoicesLoading) => set({ invoicesLoading }),
      setInvoicesError: (invoicesError) => set({ invoicesError }),

      // Hardware specs
      setHardwareSpecs: (hardwareSpecs) => set({ hardwareSpecs }),
      setHardwareSpecsLoading: (hardwareSpecsLoading) => set({ hardwareSpecsLoading }),
      setHardwareSpecsError: (hardwareSpecsError) => set({ hardwareSpecsError }),

      // Helpers
      getQuotaByType: (type) => get().quotas.find((q) => q.quotaType === type),
      getPlanBySlug: (slug) => get().plans.find((p) => p.slug === slug),
      getHardwareSpecByTier: (tier) => get().hardwareSpecs.find((s) => s.tier === tier),

      hasFeature: (feature) => {
        const subscription = get().subscription;
        if (!subscription) return false;
        return subscription.plan.features[feature] === true;
      },

      isQuotaExceeded: (type) => {
        const quota = get().quotas.find((q) => q.quotaType === type);
        return quota?.isExceeded ?? false;
      },

      // Reset
      reset: () => set(initialState),
    }),
    { name: 'podex-billing' }
  )
);

// =============================================================================
// SELECTOR HOOKS
// =============================================================================

export const useSubscription = () => useBillingStore((state) => state.subscription);
export const usePlans = () => useBillingStore((state) => state.plans);
export const useUsageSummary = () => useBillingStore((state) => state.usageSummary);
export const useQuotas = () => useBillingStore((state) => state.quotas);
export const useCreditBalance = () => useBillingStore((state) => state.creditBalance);
export const useInvoices = () => useBillingStore((state) => state.invoices);
export const useHardwareSpecs = () => useBillingStore((state) => state.hardwareSpecs);

// Loading states
export const useBillingLoading = () =>
  useBillingStore(
    useShallow((state) => ({
      plans: state.plansLoading,
      subscription: state.subscriptionLoading,
      usage: state.usageLoading,
      quotas: state.quotasLoading,
      credits: state.creditsLoading,
      invoices: state.invoicesLoading,
      hardwareSpecs: state.hardwareSpecsLoading,
    }))
  );

// Computed
export const useCurrentPlan = () => useBillingStore((state) => state.subscription?.plan ?? null);

export const useHasActiveSubscription = () =>
  useBillingStore(
    (state) =>
      state.subscription !== null && ['active', 'trialing'].includes(state.subscription.status)
  );

export const useTokenQuota = () =>
  useBillingStore((state) => state.quotas.find((q) => q.quotaType === 'tokens'));

export const useComputeQuota = () =>
  useBillingStore((state) => state.quotas.find((q) => q.quotaType === 'compute_credits'));

export const useStorageQuota = () =>
  useBillingStore((state) => state.quotas.find((q) => q.quotaType === 'storage_gb'));

// Feature checks
export const useCanAccessGpu = () =>
  useBillingStore((state) => state.subscription?.plan.features.gpu_access === true);

export const useCanUseTeams = () =>
  useBillingStore((state) => state.subscription?.plan.features.team_collaboration === true);

export const useCanUsePlanning = () =>
  useBillingStore((state) => state.subscription?.plan.features.planning_mode === true);

// Quota warnings
export const useQuotaWarnings = () =>
  useBillingStore(useShallow((state) => state.quotas.filter((q) => q.isWarning && !q.isExceeded)));

export const useQuotaExceeded = () =>
  useBillingStore(useShallow((state) => state.quotas.filter((q) => q.isExceeded)));

// Low credit balance (less than $1.00)
export const useLowCredits = () =>
  useBillingStore((state) => state.creditBalance && state.creditBalance.balance < 100);

// Check if user has any quota issues (warning or exceeded)
export const useHasQuotaIssues = () =>
  useBillingStore((state) => state.quotas.some((q) => q.isWarning || q.isExceeded));

// Get highest severity quota issue
export const useQuotaSeverity = (): 'none' | 'warning' | 'exceeded' =>
  useBillingStore((state) => {
    if (state.quotas.some((q) => q.isExceeded)) return 'exceeded';
    if (state.quotas.some((q) => q.isWarning)) return 'warning';
    return 'none';
  });
