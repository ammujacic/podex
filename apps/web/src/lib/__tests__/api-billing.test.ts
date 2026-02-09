/**
 * Comprehensive tests for the second half of api.ts
 * Tests billing, workspace, git, user config, dashboard, skills, and platform APIs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiRequestError } from '@podex/api-client';

// =============================================================================
// Mock Setup - use vi.hoisted for hoisted mock state
// =============================================================================

const mocks = vi.hoisted(() => {
  // API client mock functions
  const mockGet = vi.fn();
  const mockPost = vi.fn();
  const mockPut = vi.fn();
  const mockPatch = vi.fn();
  const mockDelete = vi.fn();
  const mockGetCached = vi.fn();
  const mockLogin = vi.fn();
  const mockRegister = vi.fn();
  const mockRefreshToken = vi.fn();
  const mockGetCurrentUser = vi.fn();
  const mockSetBaseUrl = vi.fn();
  const mockInvalidatePattern = vi.fn();
  const mockGetCache = vi.fn(() => ({ invalidatePattern: mockInvalidatePattern }));

  // Store mock functions
  const mockSetUser = vi.fn();
  const mockSetTokens = vi.fn();
  const mockSetLoading = vi.fn();
  const mockSetError = vi.fn();
  const mockClearError = vi.fn();
  const mockSetInitialized = vi.fn();
  const mockLogout = vi.fn();
  const mockShowCreditExhaustedModal = vi.fn();
  const mockSetWorkspaceError = vi.fn();

  // Mock store states
  const mockAuthStoreState = {
    user: null,
    tokens: {
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    },
    isLoading: false,
    error: null,
    isInitialized: false,
    setUser: mockSetUser,
    setTokens: mockSetTokens,
    setLoading: mockSetLoading,
    setError: mockSetError,
    clearError: mockClearError,
    setInitialized: mockSetInitialized,
    logout: mockLogout,
  };

  const mockSessionStoreState = {
    sessions: {} as Record<string, { workspaceError?: string | null }>,
    setWorkspaceError: mockSetWorkspaceError,
  };

  const mockBillingStoreState = {
    showCreditExhaustedModal: mockShowCreditExhaustedModal,
  };

  return {
    mockGet,
    mockPost,
    mockPut,
    mockPatch,
    mockDelete,
    mockGetCached,
    mockLogin,
    mockRegister,
    mockRefreshToken,
    mockGetCurrentUser,
    mockSetBaseUrl,
    mockInvalidatePattern,
    mockGetCache,
    mockSetUser,
    mockSetTokens,
    mockSetLoading,
    mockSetError,
    mockClearError,
    mockSetInitialized,
    mockLogout,
    mockShowCreditExhaustedModal,
    mockSetWorkspaceError,
    mockAuthStoreState,
    mockSessionStoreState,
    mockBillingStoreState,
  };
});

// Mock stores - reference mocks object inside factory
vi.mock('@/stores/auth', () => ({
  useAuthStore: Object.assign(() => mocks.mockAuthStoreState, {
    getState: () => mocks.mockAuthStoreState,
  }),
}));

vi.mock('@/stores/billing', () => ({
  useBillingStore: Object.assign(() => mocks.mockBillingStoreState, {
    getState: () => mocks.mockBillingStoreState,
  }),
}));

vi.mock('@/stores/session', () => ({
  useSessionStore: Object.assign(() => mocks.mockSessionStoreState, {
    getState: () => mocks.mockSessionStoreState,
  }),
}));

// Mock the API adapters - define class inline
vi.mock('@/lib/api-adapters', () => {
  class MockPodexApiClient {
    get = mocks.mockGet;
    post = mocks.mockPost;
    put = mocks.mockPut;
    patch = mocks.mockPatch;
    delete = mocks.mockDelete;
    getCached = mocks.mockGetCached;
    login = mocks.mockLogin;
    register = mocks.mockRegister;
    refreshToken = mocks.mockRefreshToken;
    getCurrentUser = mocks.mockGetCurrentUser;
    setBaseUrl = mocks.mockSetBaseUrl;
    getCache = mocks.mockGetCache;
  }

  return {
    FetchHttpAdapter: class FetchHttpAdapter {},
    PodexApiClient: MockPodexApiClient,
    SentryErrorReporter: class SentryErrorReporter {},
    ZustandAuthProvider: class ZustandAuthProvider {},
  };
});

vi.mock('@/lib/api-url', () => ({
  getApiBaseUrl: vi.fn(() => Promise.resolve('http://localhost:8000')),
  getApiBaseUrlSync: vi.fn(() => 'http://localhost:8000'),
}));

// Backward-compatible alias for tests that reference mockApiClient
const mockApiClient = {
  get: mocks.mockGet,
  post: mocks.mockPost,
  put: mocks.mockPut,
  patch: mocks.mockPatch,
  delete: mocks.mockDelete,
  getCached: mocks.mockGetCached,
  login: mocks.mockLogin,
  register: mocks.mockRegister,
  refreshToken: mocks.mockRefreshToken,
  getCurrentUser: mocks.mockGetCurrentUser,
  setBaseUrl: mocks.mockSetBaseUrl,
  getCache: mocks.mockGetCache,
};

// Backward-compatible aliases for tests
const mockAuthStoreState = mocks.mockAuthStoreState;
const mockSessionStoreState = mocks.mockSessionStoreState;
const mockBillingStoreState = mocks.mockBillingStoreState;

// Now import the module under test
import {
  // Billing APIs
  listSubscriptionPlans,
  getSubscriptionPlan,
  getSubscription,
  createSubscription,
  updateSubscription,
  cancelSubscription,
  getUsageSummary,
  getBillingUsageHistory,
  getQuotas,
  getCreditBalance,
  purchaseCredits,
  getCreditHistory,
  listInvoices,
  getInvoice,
  listHardwareSpecs,
  getHardwareSpec,
  listBillingEvents,
  getSessionRealtimeCost,
  getAgentRealtimeCost,
  getSessionUsageHistory,
  getDailyUsage,
  setSessionBudget,
  setUserBudget,
  getUserBudgets,
  getBudgetStatus,
  deleteBudget,
  getCostAlerts,
  acknowledgeCostAlert,
  // Workspace APIs
  getWorkspaceStatus,
  startWorkspace,
  scaleWorkspace,
  // Git APIs
  getGitStatus,
  getGitBranches,
  getGitLog,
  getGitDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  pushChanges,
  pullChanges,
  checkoutBranch,
  compareBranches,
  previewMerge,
  // User Config APIs
  getUserConfig,
  updateUserConfig,
  getCompletedTours,
  completeTour,
  uncompleteTour,
  resetAllTours,
  getLLMApiKeys,
  setLLMApiKey,
  removeLLMApiKey,
  discoverLocalModels,
  getLocalLLMConfig,
  saveLocalLLMUrl,
  // Dashboard APIs
  getDashboardStats,
  getActivityFeed,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getPinnedSessions,
  pinSession,
  unpinSession,
  getUsageHistory,
  getProductivitySummary,
  getProductivityTrends,
  // Transform functions
  transformUsageSummary,
  transformQuota,
  // Error helpers
  isBillingError,
  isWorkspaceError,
  // Skills APIs
  getAvailableSkills,
  getUserSkills,
  createUserSkill,
  updateUserSkill,
  deleteUserSkill,
  getSkillTemplates,
  getSkillTemplate,
  createSkillFromTemplate,
  getSkillRepositories,
  createSkillRepository,
  updateSkillRepository,
  deleteSkillRepository,
  syncSkillRepository,
  getSkillSyncLogs,
  getSkillRepositoryWebhook,
  getMarketplaceSkills,
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
  getMyMarketplaceSkills,
  submitSkillToMarketplace,
  getMyMarketplaceSubmissions,
  getSkillAnalytics,
  getSkillAnalyticsDetail,
  getSkillAnalyticsTimeline,
  getSkillAnalyticsTrends,
  // Platform APIs
  getPlatformSettings,
  getPlatformSetting,
  getProviders,
  getProvider,
  getPlatformConfig,
  // Health Check APIs
  getSessionHealth,
  getSessionHealthRecommendations,
  analyzeSessionHealth,
  applyHealthFix,
  getHealthChecks,
  getDefaultHealthChecks,
  createHealthCheck,
  updateHealthCheck,
  deleteHealthCheck,
  testHealthCheck,
  testHealthCommand,
  // Memory APIs
  getMemories,
  deleteMemory,
  clearAllMemories,
  // Admin Model APIs
  adminListModels,
  adminCreateModel,
  adminGetModel,
  adminUpdateModel,
  adminDeleteModel,
  adminGetAgentDefaults,
  adminUpdateAgentDefaults,
  adminSeedModels,
  // Admin Provider APIs
  adminListProviders,
  adminGetProvider,
  adminCreateProvider,
  adminUpdateProvider,
  adminDeleteProvider,
} from '../api';

describe('API - Billing Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStoreState.sessions = {};
    mockAuthStoreState.tokens = {
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Subscription Plans
  // ============================================================================

  describe('Subscription Plans', () => {
    const mockPlans = [
      { id: 'plan-free', name: 'Free', slug: 'free', price_monthly: 0 },
      { id: 'plan-pro', name: 'Pro', slug: 'pro', price_monthly: 29 },
    ];

    it('should list subscription plans', async () => {
      mockApiClient.get.mockResolvedValue(mockPlans);

      const result = await listSubscriptionPlans();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/plans');
      expect(result).toEqual(mockPlans);
    });

    it('should get a specific subscription plan by slug', async () => {
      mockApiClient.get.mockResolvedValue(mockPlans[1]);

      const result = await getSubscriptionPlan('pro');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/plans/pro');
      expect(result.slug).toBe('pro');
    });
  });

  // ============================================================================
  // User Subscription
  // ============================================================================

  describe('User Subscription', () => {
    const mockSubscription = {
      id: 'sub-123',
      user_id: 'user-1',
      plan: { id: 'plan-pro', name: 'Pro', slug: 'pro' },
      status: 'active',
      billing_cycle: 'monthly',
      current_period_start: '2024-01-01T00:00:00Z',
      current_period_end: '2024-02-01T00:00:00Z',
      cancel_at_period_end: false,
    };

    it('should get current subscription', async () => {
      mockApiClient.get.mockResolvedValue(mockSubscription);

      const result = await getSubscription();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/subscription');
      expect(result).toEqual(mockSubscription);
    });

    it('should return null when no subscription exists', async () => {
      mockApiClient.get.mockResolvedValue(null);

      const result = await getSubscription();

      expect(result).toBeNull();
    });

    it('should create a new subscription with monthly billing', async () => {
      mockApiClient.post.mockResolvedValue(mockSubscription);

      const result = await createSubscription('pro', 'monthly');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/billing/subscription', {
        plan_slug: 'pro',
        billing_cycle: 'monthly',
      });
      expect(result).toEqual(mockSubscription);
    });

    it('should create subscription with yearly billing', async () => {
      mockApiClient.post.mockResolvedValue({ ...mockSubscription, billing_cycle: 'yearly' });

      await createSubscription('pro', 'yearly');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/billing/subscription', {
        plan_slug: 'pro',
        billing_cycle: 'yearly',
      });
    });

    it('should update subscription plan', async () => {
      const updated = { ...mockSubscription, plan: { slug: 'enterprise' } };
      mockApiClient.patch.mockResolvedValue(updated);

      const result = await updateSubscription({ plan_slug: 'enterprise' });

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/billing/subscription', {
        plan_slug: 'enterprise',
      });
      expect(result).toEqual(updated);
    });

    it('should cancel subscription with reason', async () => {
      const cancelled = { ...mockSubscription, cancel_at_period_end: true };
      mockApiClient.patch.mockResolvedValue(cancelled);

      const result = await cancelSubscription('Too expensive');

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/billing/subscription', {
        cancel_at_period_end: true,
        cancellation_reason: 'Too expensive',
      });
      expect(result.cancel_at_period_end).toBe(true);
    });

    it('should cancel subscription without reason', async () => {
      mockApiClient.patch.mockResolvedValue({ ...mockSubscription, cancel_at_period_end: true });

      await cancelSubscription();

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/billing/subscription', {
        cancel_at_period_end: true,
        cancellation_reason: undefined,
      });
    });
  });

  // ============================================================================
  // Usage Summary
  // ============================================================================

  describe('Usage Summary', () => {
    const mockUsageResponse = {
      period_start: '2024-01-01T00:00:00Z',
      period_end: '2024-02-01T00:00:00Z',
      tokens_input: 250000,
      tokens_output: 150000,
      tokens_total: 400000,
      tokens_cost: 8.0,
      compute_seconds: 18000,
      compute_hours: 5.0,
      compute_credits_used: 5.0,
      compute_credits_included: 10.0,
      compute_cost: 5.0,
      storage_gb: 3.5,
      storage_cost: 0.35,
      api_calls: 1500,
      total_cost: 13.35,
      usage_by_model: { 'claude-opus': { input: 100000, output: 50000, cost: 4.0 } },
      usage_by_agent: { 'agent-1': { tokens: 200000, cost: 4.0 } },
      usage_by_session: { 'session-1': { tokens: 400000, cost: 8.0 } },
      usage_by_tier: { basic: { seconds: 10800, cost: 3.0 } },
    };

    it('should get current period usage summary', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageResponse);

      const result = await getUsageSummary('current');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/usage?period=current');
      expect(result.tokensTotal).toBe(400000);
      expect(result.totalCost).toBe(13.35);
    });

    it('should get last month usage summary', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageResponse);

      await getUsageSummary('last_month');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/usage?period=last_month');
    });

    it('should get all time usage summary', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageResponse);

      await getUsageSummary('all_time');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/usage?period=all_time');
    });

    it('should transform usage summary to camelCase', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageResponse);

      const result = await getUsageSummary();

      expect(result.periodStart).toBe('2024-01-01T00:00:00Z');
      expect(result.tokensInput).toBe(250000);
      expect(result.computeCreditsUsed).toBe(5.0);
      expect(result.usageByModel).toBeDefined();
    });

    it('should handle empty usage data', async () => {
      mockApiClient.get.mockResolvedValue({
        period_start: '2024-01-01',
        period_end: '2024-02-01',
      });

      const result = await getUsageSummary();

      expect(result.tokensTotal).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.usageByModel).toEqual({});
    });
  });

  // ============================================================================
  // Billing Usage History
  // ============================================================================

  describe('Billing Usage History', () => {
    const mockUsageRecords = [
      { id: 'usage-1', usage_type: 'tokens', quantity: 100000, cost: 2.0 },
      { id: 'usage-2', usage_type: 'compute', quantity: 3600, cost: 1.0 },
    ];

    it('should get billing usage history with default pagination', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageRecords);

      const result = await getBillingUsageHistory();

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/usage/history?page=1&page_size=50'
      );
      expect(result).toEqual(mockUsageRecords);
    });

    it('should get billing usage history with custom pagination', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageRecords);

      await getBillingUsageHistory(2, 100);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/usage/history?page=2&page_size=100'
      );
    });

    it('should filter usage history by usage type', async () => {
      mockApiClient.get.mockResolvedValue([mockUsageRecords[0]]);

      await getBillingUsageHistory(1, 50, 'tokens');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/usage/history?page=1&page_size=50&usage_type=tokens'
      );
    });

    it('should filter usage history by session', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageRecords);

      await getBillingUsageHistory(1, 50, undefined, 'session-123');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/usage/history?page=1&page_size=50&session_id=session-123'
      );
    });
  });

  // ============================================================================
  // Quotas
  // ============================================================================

  describe('Quotas', () => {
    const mockQuotasResponse = [
      {
        id: 'quota-1',
        quota_type: 'tokens',
        limit_value: 1000000,
        current_usage: 400000,
        usage_percentage: 40,
        reset_at: '2024-02-01T00:00:00Z',
        overage_allowed: true,
        is_exceeded: false,
        is_warning: false,
      },
    ];

    it('should get quotas and transform to camelCase', async () => {
      mockApiClient.get.mockResolvedValue(mockQuotasResponse);

      const result = await getQuotas();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/quotas');
      expect(result[0].quotaType).toBe('tokens');
      expect(result[0].limitValue).toBe(1000000);
      expect(result[0].currentUsage).toBe(400000);
    });

    it('should transform quota warning states', async () => {
      mockApiClient.get.mockResolvedValue([{ ...mockQuotasResponse[0], is_warning: true }]);

      const result = await getQuotas();

      expect(result[0].isWarning).toBe(true);
    });

    it('should transform quota exceeded states', async () => {
      mockApiClient.get.mockResolvedValue([
        { ...mockQuotasResponse[0], is_exceeded: true, usage_percentage: 110 },
      ]);

      const result = await getQuotas();

      expect(result[0].isExceeded).toBe(true);
      expect(result[0].usagePercentage).toBe(110);
    });
  });

  // ============================================================================
  // Credits
  // ============================================================================

  describe('Credits', () => {
    const mockCreditBalance = {
      balance: 5000,
      pending: 100,
      expiring_soon: 500,
      total_purchased: 10000,
      total_used: 4900,
    };

    it('should get credit balance', async () => {
      mockApiClient.get.mockResolvedValue(mockCreditBalance);

      const result = await getCreditBalance();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/credits');
      expect(result).toEqual(mockCreditBalance);
    });

    it('should purchase credits', async () => {
      const mockTransaction = { id: 'txn-1', amount: 1000 };
      mockApiClient.post.mockResolvedValue(mockTransaction);

      const result = await purchaseCredits(1000);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/billing/credits/purchase', {
        amount_cents: 1000,
      });
      expect(result).toEqual(mockTransaction);
    });

    it('should get credit history', async () => {
      const mockHistory = [{ id: 'txn-1', amount: 1000 }];
      mockApiClient.get.mockResolvedValue(mockHistory);

      const result = await getCreditHistory(1, 50);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/credits/history?page=1&page_size=50'
      );
      expect(result).toEqual(mockHistory);
    });
  });

  // ============================================================================
  // Invoices
  // ============================================================================

  describe('Invoices', () => {
    const mockInvoices = [
      { id: 'inv-1', invoice_number: 'INV-2024-001', total: 31.9, status: 'paid' },
    ];

    it('should list invoices with default pagination', async () => {
      mockApiClient.get.mockResolvedValue(mockInvoices);

      const result = await listInvoices();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/invoices?page=1&page_size=20');
      expect(result).toEqual(mockInvoices);
    });

    it('should list invoices with custom pagination', async () => {
      mockApiClient.get.mockResolvedValue(mockInvoices);

      await listInvoices(2, 50);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/invoices?page=2&page_size=50');
    });

    it('should get a specific invoice', async () => {
      mockApiClient.get.mockResolvedValue(mockInvoices[0]);

      const result = await getInvoice('inv-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/invoices/inv-1');
      expect(result.invoice_number).toBe('INV-2024-001');
    });
  });

  // ============================================================================
  // Hardware Specs
  // ============================================================================

  describe('Hardware Specs', () => {
    const mockHardwareSpecs = [
      { id: 'spec-1', tier: 'basic', vcpu: 2, gpu_count: 0, hourly_rate: 0.5 },
      { id: 'spec-2', tier: 'gpu-t4', vcpu: 4, gpu_type: 'nvidia-tesla-t4', hourly_rate: 2.5 },
    ];

    it('should list hardware specs', async () => {
      mockApiClient.get.mockResolvedValue(mockHardwareSpecs);

      const result = await listHardwareSpecs();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/hardware-specs');
      expect(result).toEqual(mockHardwareSpecs);
    });

    it('should get a specific hardware spec', async () => {
      mockApiClient.get.mockResolvedValue(mockHardwareSpecs[1]);

      const result = await getHardwareSpec('gpu-t4');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/hardware-specs/gpu-t4');
      expect(result.tier).toBe('gpu-t4');
    });
  });

  // ============================================================================
  // Billing Events
  // ============================================================================

  describe('Billing Events', () => {
    const mockEvents = [{ id: 'event-1', event_type: 'subscription.created' }];

    it('should list billing events', async () => {
      mockApiClient.get.mockResolvedValue(mockEvents);

      const result = await listBillingEvents();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/events?page=1&page_size=50');
      expect(result).toEqual(mockEvents);
    });

    it('should list billing events with custom pagination', async () => {
      mockApiClient.get.mockResolvedValue(mockEvents);

      await listBillingEvents(3, 100);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/events?page=3&page_size=100');
    });
  });

  // ============================================================================
  // Real-Time Cost Tracking
  // ============================================================================

  describe('Real-Time Cost Tracking', () => {
    const mockRealtimeCost = {
      session_id: 'session-1',
      total_cost: 5.25,
      input_cost: 3.0,
      output_cost: 2.0,
      total_tokens: 500000,
    };

    it('should get session realtime cost', async () => {
      mockApiClient.get.mockResolvedValue(mockRealtimeCost);

      const result = await getSessionRealtimeCost('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/realtime/session/session-1');
      expect(result.total_cost).toBe(5.25);
    });

    it('should get agent realtime cost', async () => {
      mockApiClient.get.mockResolvedValue(mockRealtimeCost);

      const result = await getAgentRealtimeCost('session-1', 'agent-1');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/realtime/agent/session-1/agent-1'
      );
      expect(result).toEqual(mockRealtimeCost);
    });

    it('should get session usage history', async () => {
      const mockHistory = [{ call_id: 'call-1', model: 'claude-opus', cost: 0.05 }];
      mockApiClient.get.mockResolvedValue(mockHistory);

      const result = await getSessionUsageHistory('session-1', 50);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/realtime/usage-history/session-1?limit=50'
      );
      expect(result).toEqual(mockHistory);
    });

    it('should get daily usage', async () => {
      const mockDailyUsage = [{ date: '2024-01-15', total_cost: 5.0, total_tokens: 500000 }];
      mockApiClient.get.mockResolvedValue(mockDailyUsage);

      const result = await getDailyUsage(30);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/realtime/daily-usage?days=30');
      expect(result).toEqual(mockDailyUsage);
    });
  });

  // ============================================================================
  // Budget Management
  // ============================================================================

  describe('Budget Management', () => {
    const mockBudget = { id: 'budget-1', amount: 50.0, period: 'monthly' };

    it('should set session budget', async () => {
      mockApiClient.post.mockResolvedValue(mockBudget);

      const result = await setSessionBudget('session-1', { amount: 50.0, warning_threshold: 0.8 });

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/billing/budgets/session/session-1', {
        amount: 50.0,
        warning_threshold: 0.8,
      });
      expect(result).toEqual(mockBudget);
    });

    it('should set user budget', async () => {
      mockApiClient.post.mockResolvedValue(mockBudget);

      const result = await setUserBudget({ amount: 100.0, period: 'monthly', hard_limit: true });

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/billing/budgets/user', {
        amount: 100.0,
        period: 'monthly',
        hard_limit: true,
      });
      expect(result).toEqual(mockBudget);
    });

    it('should get user budgets', async () => {
      mockApiClient.get.mockResolvedValue([mockBudget]);

      const result = await getUserBudgets();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/budgets');
      expect(result).toHaveLength(1);
    });

    it('should get budget status', async () => {
      const mockStatus = [{ budget: mockBudget, spent: 25.0, remaining: 25.0 }];
      mockApiClient.get.mockResolvedValue(mockStatus);

      const result = await getBudgetStatus();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/billing/budgets/status');
      expect(result).toEqual(mockStatus);
    });

    it('should get budget status for specific session', async () => {
      mockApiClient.get.mockResolvedValue([]);

      await getBudgetStatus('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/budgets/status?session_id=session-1'
      );
    });

    it('should delete budget', async () => {
      mockApiClient.delete.mockResolvedValue({ success: true });

      const result = await deleteBudget('budget-1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/billing/budgets/budget-1');
      expect(result.success).toBe(true);
    });
  });

  // ============================================================================
  // Cost Alerts
  // ============================================================================

  describe('Cost Alerts', () => {
    const mockAlerts = [{ id: 'alert-1', alert_type: 'budget_warning', acknowledged: false }];

    it('should get cost alerts', async () => {
      mockApiClient.get.mockResolvedValue(mockAlerts);

      const result = await getCostAlerts();

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/alerts?include_acknowledged=false&limit=50'
      );
      expect(result).toEqual(mockAlerts);
    });

    it('should get cost alerts including acknowledged', async () => {
      mockApiClient.get.mockResolvedValue(mockAlerts);

      await getCostAlerts(true);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/billing/alerts?include_acknowledged=true&limit=50'
      );
    });

    it('should acknowledge cost alert', async () => {
      mockApiClient.post.mockResolvedValue({ success: true });

      const result = await acknowledgeCostAlert('alert-1');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/billing/alerts/alert-1/acknowledge',
        {}
      );
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Workspace API Functions
// ============================================================================

describe('API - Workspace Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Workspace Status', () => {
    const mockStatus = { id: 'workspace-1', status: 'running' };

    it('should get workspace status', async () => {
      mockApiClient.get.mockResolvedValue(mockStatus);

      const result = await getWorkspaceStatus('workspace-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/workspaces/workspace-1/status');
      expect(result.status).toBe('running');
    });

    it('should start a stopped workspace', async () => {
      mockApiClient.post.mockResolvedValue(mockStatus);

      const result = await startWorkspace('workspace-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/workspaces/workspace-1/start', {});
      expect(result.status).toBe('running');
    });
  });

  describe('Workspace Scaling', () => {
    const mockScaleResponse = { success: true, new_tier: 'gpu-t4', requires_restart: true };

    it('should scale workspace', async () => {
      mockApiClient.post.mockResolvedValue(mockScaleResponse);

      const result = await scaleWorkspace('session-1', 'gpu-t4');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/scale-workspace', {
        new_tier: 'gpu-t4',
      });
      expect(result.new_tier).toBe('gpu-t4');
    });
  });
});

// ============================================================================
// Git Operations API Functions
// ============================================================================

describe('API - Git Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Git Status', () => {
    const mockGitStatus = { branch: 'main', is_clean: false, ahead: 2, behind: 0 };

    it('should get git status', async () => {
      mockApiClient.get.mockResolvedValue(mockGitStatus);

      const result = await getGitStatus('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/git/status');
      expect(result.branch).toBe('main');
    });

    it('should get git status with working directory', async () => {
      mockApiClient.get.mockResolvedValue(mockGitStatus);

      await getGitStatus('session-1', '/workspace/project');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/status?working_dir=%2Fworkspace%2Fproject'
      );
    });
  });

  describe('Git Branches', () => {
    const mockBranches = [
      { name: 'main', is_current: true, is_remote: false },
      { name: 'feature', is_current: false, is_remote: false },
    ];

    it('should get git branches', async () => {
      mockApiClient.get.mockResolvedValue(mockBranches);

      const result = await getGitBranches('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/git/branches');
      expect(result).toHaveLength(2);
    });

    it('should get git branches with working directory', async () => {
      mockApiClient.get.mockResolvedValue(mockBranches);

      await getGitBranches('session-1', '/workspace');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/branches?working_dir=%2Fworkspace'
      );
    });
  });

  describe('Git Log', () => {
    const mockLog = [
      { hash: 'abc123', message: 'Initial commit', author: 'Test' },
      { hash: 'def456', message: 'Add feature', author: 'Test' },
    ];

    it('should get git log with default limit', async () => {
      mockApiClient.get.mockResolvedValue(mockLog);

      const result = await getGitLog('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/git/log?limit=20');
      expect(result).toHaveLength(2);
    });

    it('should get git log with custom limit', async () => {
      mockApiClient.get.mockResolvedValue(mockLog);

      await getGitLog('session-1', 50);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/sessions/session-1/git/log?limit=50');
    });

    it('should get git log with working directory', async () => {
      mockApiClient.get.mockResolvedValue(mockLog);

      await getGitLog('session-1', 20, '/workspace');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/log?limit=20&working_dir=%2Fworkspace'
      );
    });
  });

  describe('Git Diff', () => {
    const mockDiff = [{ path: 'src/App.tsx', status: 'modified', additions: 10, deletions: 5 }];

    it('should get unstaged diff', async () => {
      mockApiClient.get.mockResolvedValue(mockDiff);

      const result = await getGitDiff('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/diff?staged=false'
      );
      expect(result).toEqual(mockDiff);
    });

    it('should get staged diff', async () => {
      mockApiClient.get.mockResolvedValue(mockDiff);

      await getGitDiff('session-1', true);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/diff?staged=true'
      );
    });

    it('should get diff with working directory', async () => {
      mockApiClient.get.mockResolvedValue(mockDiff);

      await getGitDiff('session-1', false, '/workspace');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/diff?staged=false&working_dir=%2Fworkspace'
      );
    });
  });

  describe('Git Stage Operations', () => {
    it('should stage files', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await stageFiles('session-1', ['src/App.tsx', 'src/utils.ts']);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/stage', {
        files: ['src/App.tsx', 'src/utils.ts'],
        working_dir: undefined,
      });
    });

    it('should stage files with working directory', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await stageFiles('session-1', ['App.tsx'], '/workspace');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/stage', {
        files: ['App.tsx'],
        working_dir: '/workspace',
      });
    });

    it('should unstage files', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await unstageFiles('session-1', ['src/App.tsx']);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/unstage', {
        files: ['src/App.tsx'],
        working_dir: undefined,
      });
    });
  });

  describe('Git Commit', () => {
    const mockCommitResponse = { message: 'Changes committed', hash: 'abc123def456' };

    it('should commit changes with message', async () => {
      mockApiClient.post.mockResolvedValue(mockCommitResponse);

      const result = await commitChanges('session-1', 'Initial commit');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/commit', {
        message: 'Initial commit',
        files: undefined,
        working_dir: undefined,
      });
      expect(result.hash).toBe('abc123def456');
    });

    it('should commit specific files', async () => {
      mockApiClient.post.mockResolvedValue(mockCommitResponse);

      await commitChanges('session-1', 'Update app', ['src/App.tsx']);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/commit', {
        message: 'Update app',
        files: ['src/App.tsx'],
        working_dir: undefined,
      });
    });

    it('should commit with working directory', async () => {
      mockApiClient.post.mockResolvedValue(mockCommitResponse);

      await commitChanges('session-1', 'Commit', undefined, '/workspace');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/commit', {
        message: 'Commit',
        files: undefined,
        working_dir: '/workspace',
      });
    });
  });

  describe('Git Push', () => {
    it('should push changes with defaults', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Pushed successfully' });

      const result = await pushChanges('session-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/push', {
        remote: 'origin',
        branch: undefined,
        working_dir: undefined,
      });
      expect(result.message).toBe('Pushed successfully');
    });

    it('should push to specific remote and branch', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Pushed' });

      await pushChanges('session-1', 'upstream', 'feature');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/push', {
        remote: 'upstream',
        branch: 'feature',
        working_dir: undefined,
      });
    });
  });

  describe('Git Pull', () => {
    it('should pull changes with defaults', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Pulled successfully' });

      const result = await pullChanges('session-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/pull', {
        remote: 'origin',
        branch: undefined,
        working_dir: undefined,
      });
      expect(result.message).toBe('Pulled successfully');
    });

    it('should pull from specific remote and branch', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Pulled' });

      await pullChanges('session-1', 'upstream', 'main');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/pull', {
        remote: 'upstream',
        branch: 'main',
        working_dir: undefined,
      });
    });
  });

  describe('Git Checkout', () => {
    it('should checkout existing branch', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Switched to branch feature' });

      const result = await checkoutBranch('session-1', 'feature');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/checkout', {
        branch: 'feature',
        create: false,
        working_dir: undefined,
      });
      expect(result.message).toContain('feature');
    });

    it('should create and checkout new branch', async () => {
      mockApiClient.post.mockResolvedValue({ message: 'Created and switched to new-feature' });

      await checkoutBranch('session-1', 'new-feature', true);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/checkout', {
        branch: 'new-feature',
        create: true,
        working_dir: undefined,
      });
    });
  });

  describe('Branch Comparison', () => {
    const mockCompare = { base: 'main', compare: 'feature', commits: [], ahead: 1 };

    it('should compare branches', async () => {
      mockApiClient.get.mockResolvedValue(mockCompare);

      const result = await compareBranches('session-1', 'main', 'feature');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/compare?base=main&compare=feature'
      );
      expect(result.ahead).toBe(1);
    });

    it('should compare branches with working directory', async () => {
      mockApiClient.get.mockResolvedValue(mockCompare);

      await compareBranches('session-1', 'main', 'feature', '/workspace');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/sessions/session-1/git/compare?base=main&compare=feature&working_dir=%2Fworkspace'
      );
    });
  });

  describe('Merge Preview', () => {
    const mockPreview = { can_merge: true, has_conflicts: false, conflicts: [] };

    it('should preview merge', async () => {
      mockApiClient.post.mockResolvedValue(mockPreview);

      const result = await previewMerge('session-1', 'feature', 'main');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/git/merge-preview', {
        source_branch: 'feature',
        target_branch: 'main',
        working_dir: undefined,
      });
      expect(result.can_merge).toBe(true);
    });

    it('should preview merge with conflicts', async () => {
      const conflicting = { ...mockPreview, has_conflicts: true, conflicts: ['src/App.tsx'] };
      mockApiClient.post.mockResolvedValue(conflicting);

      const result = await previewMerge('session-1', 'feature', 'main');

      expect(result.has_conflicts).toBe(true);
      expect(result.conflicts).toContain('src/App.tsx');
    });
  });
});

// ============================================================================
// User Config API Functions
// ============================================================================

describe('API - User Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('User Config', () => {
    const mockConfig = {
      id: 'config-1',
      sync_dotfiles: true,
      dotfiles_repo: 'https://github.com/user/dotfiles',
      default_shell: 'zsh',
      theme: 'dark',
    };

    it('should get user config', async () => {
      mockApiClient.get.mockResolvedValue(mockConfig);

      const result = await getUserConfig();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/user/config');
      expect(result.default_shell).toBe('zsh');
    });

    it('should update user config', async () => {
      const updated = { ...mockConfig, theme: 'light' };
      mockApiClient.patch.mockResolvedValue(updated);

      const result = await updateUserConfig({ theme: 'light' });

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/user/config', { theme: 'light' });
      expect(result.theme).toBe('light');
    });

    it('should update multiple config fields', async () => {
      mockApiClient.patch.mockResolvedValue({
        ...mockConfig,
        theme: 'light',
        default_shell: 'bash',
      });

      await updateUserConfig({ theme: 'light', default_shell: 'bash' });

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/user/config', {
        theme: 'light',
        default_shell: 'bash',
      });
    });
  });

  describe('Onboarding Tours', () => {
    it('should get completed tours', async () => {
      mockApiClient.get.mockResolvedValue({ completed_tours: ['welcome', 'agent-intro'] });

      const result = await getCompletedTours();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/user/config/tours');
      expect(result.completed_tours).toContain('welcome');
    });

    it('should complete a tour', async () => {
      mockApiClient.post.mockResolvedValue({ completed_tours: ['welcome', 'git-basics'] });

      const result = await completeTour('git-basics');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/user/config/tours/git-basics/complete',
        {}
      );
      expect(result.completed_tours).toContain('git-basics');
    });

    it('should uncomplete a tour', async () => {
      mockApiClient.delete.mockResolvedValue({ completed_tours: ['welcome'] });

      const result = await uncompleteTour('agent-intro');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/user/config/tours/agent-intro');
      expect(result.completed_tours).not.toContain('agent-intro');
    });

    it('should reset all tours', async () => {
      mockApiClient.delete.mockResolvedValue({ completed_tours: [] });

      const result = await resetAllTours();

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/user/config/tours');
      expect(result.completed_tours).toHaveLength(0);
    });
  });

  describe('LLM API Keys', () => {
    it('should get LLM API keys', async () => {
      mockApiClient.get.mockResolvedValue({ providers: ['anthropic', 'openai'] });

      const result = await getLLMApiKeys();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/user/config/llm-api-keys');
      expect(result.providers).toContain('anthropic');
    });

    it('should set LLM API key', async () => {
      mockApiClient.post.mockResolvedValue({ providers: ['anthropic', 'openai', 'google'] });

      const result = await setLLMApiKey('google', 'sk-test-key');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/user/config/llm-api-keys', {
        provider: 'google',
        api_key: 'sk-test-key',
      });
      expect(result.providers).toContain('google');
    });

    it('should remove LLM API key', async () => {
      mockApiClient.delete.mockResolvedValue({ providers: ['anthropic'] });

      const result = await removeLLMApiKey('openai');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/user/config/llm-api-keys/openai');
      expect(result.providers).not.toContain('openai');
    });
  });

  describe('Local LLM Config', () => {
    it('should discover local models', async () => {
      const mockModels = { models: [{ id: 'llama2', name: 'Llama 2' }], success: true };
      mockApiClient.post.mockResolvedValue(mockModels);

      const result = await discoverLocalModels({
        provider: 'ollama',
        base_url: 'http://localhost:11434',
      });

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/user/config/discover-local-models', {
        provider: 'ollama',
        base_url: 'http://localhost:11434',
      });
      expect(result.models).toHaveLength(1);
    });

    it('should get local LLM config', async () => {
      const mockConfig = { ollama: { base_url: 'http://localhost:11434', models: [] } };
      mockApiClient.get.mockResolvedValue(mockConfig);

      const result = await getLocalLLMConfig();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/user/config/local-llm-config');
      expect(result.ollama).toBeDefined();
    });

    it('should save local LLM URL', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await saveLocalLLMUrl('ollama', 'http://localhost:11434');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/user/config/local-llm-config/url', {
        provider: 'ollama',
        base_url: 'http://localhost:11434',
      });
    });
  });
});

// ============================================================================
// Dashboard/Analytics API Functions
// ============================================================================

describe('API - Dashboard/Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dashboard Stats', () => {
    const mockStats = { usage: { total_tokens_used: 1000000, total_cost: 50.0 }, total_pods: 5 };

    it('should get dashboard stats', async () => {
      mockApiClient.get.mockResolvedValue(mockStats);

      const result = await getDashboardStats();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/dashboard/stats');
      expect(result.total_pods).toBe(5);
    });
  });

  describe('Activity Feed', () => {
    const mockActivity = { items: [{ id: 'activity-1', type: 'agent_message' }], has_more: true };

    it('should get activity feed with default limit', async () => {
      mockApiClient.get.mockResolvedValue(mockActivity);

      const result = await getActivityFeed();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/dashboard/activity?limit=20');
      expect(result.items).toHaveLength(1);
    });

    it('should get activity feed with custom limit', async () => {
      mockApiClient.get.mockResolvedValue(mockActivity);

      await getActivityFeed(50);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/dashboard/activity?limit=50');
    });
  });

  describe('Notifications', () => {
    const mockNotifications = { items: [{ id: 'notif-1', type: 'info' }], unread_count: 2 };

    it('should get notifications', async () => {
      mockApiClient.get.mockResolvedValue(mockNotifications);

      const result = await getNotifications();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/notifications');
      expect(result.unread_count).toBe(2);
    });

    it('should mark notification as read', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await markNotificationRead('notif-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/notifications/notif-1/read', {});
    });

    it('should mark all notifications as read', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await markAllNotificationsRead();

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/notifications/read-all', {});
    });
  });

  describe('Pinned Sessions', () => {
    const mockSessions = [{ id: 'session-1', name: 'Important', pinned: true }];

    it('should get pinned sessions', async () => {
      mockApiClient.get.mockResolvedValue(mockSessions);

      const result = await getPinnedSessions();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/sessions/pinned');
      expect(result[0].pinned).toBe(true);
    });

    it('should pin a session', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await pinSession('session-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/sessions/session-1/pin', {});
    });

    it('should unpin a session', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await unpinSession('session-1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/sessions/session-1/pin');
    });
  });

  describe('Usage History', () => {
    const mockUsageHistory = { daily: [{ date: '2024-01-15', tokens: 50000, cost: 2.5 }] };

    it('should get usage history with default days', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageHistory);

      const result = await getUsageHistory();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/dashboard/usage-history?days=30');
      expect(result.daily).toHaveLength(1);
    });

    it('should get usage history with custom days', async () => {
      mockApiClient.get.mockResolvedValue(mockUsageHistory);

      await getUsageHistory(7);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/dashboard/usage-history?days=7');
    });
  });

  describe('Productivity Tracking', () => {
    const mockProductivitySummary = { total_days: 30, net_lines: 4000, current_streak: 5 };

    it('should get productivity summary with default days', async () => {
      mockApiClient.get.mockResolvedValue(mockProductivitySummary);

      const result = await getProductivitySummary();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/productivity/summary?days=30');
      expect(result.net_lines).toBe(4000);
    });

    it('should get productivity summary with custom days', async () => {
      mockApiClient.get.mockResolvedValue(mockProductivitySummary);

      await getProductivitySummary(7);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/productivity/summary?days=7');
    });

    it('should get productivity trends', async () => {
      const mockTrends = { dates: ['2024-01-15'], lines_written: [500], coding_minutes: [120] };
      mockApiClient.get.mockResolvedValue(mockTrends);

      const result = await getProductivityTrends();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/productivity/trends?days=30');
      expect(result.dates).toHaveLength(1);
    });
  });
});

// ============================================================================
// Skills API Functions
// ============================================================================

describe('API - Skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Available Skills', () => {
    const mockSkillsResponse = { skills: [{ id: 'skill-1', name: 'Debug' }], total: 1 };

    it('should get available skills', async () => {
      mockApiClient.get.mockResolvedValue(mockSkillsResponse);

      const result = await getAvailableSkills();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills/available');
      expect(result.skills).toHaveLength(1);
    });
  });

  describe('User Skills', () => {
    const mockSkills = [{ id: 'skill-1', name: 'Custom Skill' }];

    it('should get user skills', async () => {
      mockApiClient.get.mockResolvedValue({ skills: mockSkills });

      const result = await getUserSkills();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills');
      expect(result).toEqual(mockSkills);
    });

    it('should create user skill', async () => {
      const newSkill = { id: 'skill-2', name: 'New Skill' };
      mockApiClient.post.mockResolvedValue(newSkill);

      const result = await createUserSkill({ name: 'New Skill' });

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/skills', { name: 'New Skill' });
      expect(result).toEqual(newSkill);
    });

    it('should update user skill', async () => {
      const updated = { id: 'skill-1', name: 'Updated Skill' };
      mockApiClient.patch.mockResolvedValue(updated);

      const result = await updateUserSkill('skill-1', { name: 'Updated Skill' });

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/skills/skill-1', {
        name: 'Updated Skill',
      });
      expect(result).toEqual(updated);
    });

    it('should delete user skill', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await deleteUserSkill('skill-1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/skills/skill-1');
    });
  });

  describe('Skill Templates', () => {
    const mockTemplates = {
      templates: [{ id: 'tpl-1', name: 'Debug Template' }],
      total: 1,
      categories: ['debugging'],
    };

    it('should get skill templates', async () => {
      mockApiClient.get.mockResolvedValue(mockTemplates);

      const result = await getSkillTemplates();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skill-templates');
      expect(result.templates).toHaveLength(1);
    });

    it('should get skill templates with category filter', async () => {
      mockApiClient.get.mockResolvedValue(mockTemplates);

      await getSkillTemplates('debugging');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skill-templates?category=debugging');
    });

    it('should get skill templates with search', async () => {
      mockApiClient.get.mockResolvedValue(mockTemplates);

      await getSkillTemplates(undefined, 'debug');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skill-templates?search=debug');
    });

    it('should get specific skill template', async () => {
      const template = { id: 'tpl-1', slug: 'debug-template', name: 'Debug Template' };
      mockApiClient.get.mockResolvedValue(template);

      const result = await getSkillTemplate('debug-template');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skill-templates/debug-template');
      expect(result.name).toBe('Debug Template');
    });

    it('should create skill from template', async () => {
      const newSkill = { id: 'skill-1', name: 'My Debug Skill' };
      mockApiClient.post.mockResolvedValue(newSkill);

      const result = await createSkillFromTemplate('debug-template', {
        name: 'My Debug Skill',
        slug: 'my-debug',
      });

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/skill-templates/debug-template/create-skill',
        {
          name: 'My Debug Skill',
          slug: 'my-debug',
        }
      );
      expect(result).toEqual(newSkill);
    });
  });

  describe('Skill Repositories', () => {
    const mockRepos = [
      { id: 'repo-1', name: 'My Skills', repo_url: 'https://github.com/user/skills' },
    ];

    it('should get skill repositories', async () => {
      mockApiClient.get.mockResolvedValue({ repositories: mockRepos });

      const result = await getSkillRepositories();

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/skill-repositories?include_inactive=false'
      );
      expect(result).toEqual(mockRepos);
    });

    it('should get skill repositories including inactive', async () => {
      mockApiClient.get.mockResolvedValue({ repositories: mockRepos });

      await getSkillRepositories(true);

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/skill-repositories?include_inactive=true'
      );
    });

    it('should create skill repository', async () => {
      const newRepo = {
        id: 'repo-2',
        name: 'New Repo',
        repo_url: 'https://github.com/user/new-skills',
      };
      mockApiClient.post.mockResolvedValue(newRepo);

      const result = await createSkillRepository({
        name: 'New Repo',
        repo_url: 'https://github.com/user/new-skills',
      });

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/skill-repositories', {
        name: 'New Repo',
        repo_url: 'https://github.com/user/new-skills',
      });
      expect(result).toEqual(newRepo);
    });

    it('should update skill repository', async () => {
      const updated = { id: 'repo-1', name: 'Updated Repo' };
      mockApiClient.patch.mockResolvedValue(updated);

      const result = await updateSkillRepository('repo-1', { name: 'Updated Repo' });

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api/skill-repositories/repo-1', {
        name: 'Updated Repo',
      });
      expect(result).toEqual(updated);
    });

    it('should delete skill repository', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await deleteSkillRepository('repo-1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/skill-repositories/repo-1');
    });

    it('should sync skill repository', async () => {
      const syncResult = { sync_id: 'sync-1', status: 'started', message: 'Sync started' };
      mockApiClient.post.mockResolvedValue(syncResult);

      const result = await syncSkillRepository('repo-1');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/skill-repositories/repo-1/sync?force=false',
        {}
      );
      expect(result.status).toBe('started');
    });

    it('should force sync skill repository', async () => {
      mockApiClient.post.mockResolvedValue({ sync_id: 'sync-1', status: 'started' });

      await syncSkillRepository('repo-1', true);

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/skill-repositories/repo-1/sync?force=true',
        {}
      );
    });

    it('should get skill sync logs', async () => {
      const logs = [{ id: 'log-1', status: 'success', skills_added: 2 }];
      mockApiClient.get.mockResolvedValue({ logs });

      const result = await getSkillSyncLogs('repo-1');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/skill-repositories/repo-1/logs?limit=20'
      );
      expect(result).toEqual(logs);
    });

    it('should get skill repository webhook', async () => {
      const webhook = {
        webhook_url: 'https://api.podex.io/webhooks/skills/abc123',
        secret: 'secret',
      };
      mockApiClient.get.mockResolvedValue(webhook);

      const result = await getSkillRepositoryWebhook('repo-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skill-repositories/repo-1/webhook-url');
      expect(result.webhook_url).toContain('webhooks/skills');
    });
  });

  describe('Marketplace Skills', () => {
    const mockMarketplace = { skills: [{ id: 'mp-1', name: 'Popular Skill' }], total: 1 };

    it('should get marketplace skills', async () => {
      mockApiClient.get.mockResolvedValue(mockMarketplace);

      const result = await getMarketplaceSkills();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/marketplace');
      expect(result.skills).toHaveLength(1);
    });

    it('should get marketplace skills with category', async () => {
      mockApiClient.get.mockResolvedValue(mockMarketplace);

      await getMarketplaceSkills('debugging');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/marketplace?category=debugging');
    });

    it('should install marketplace skill', async () => {
      const installed = { id: 'installed-1', skill_slug: 'debug-skill', is_enabled: true };
      mockApiClient.post.mockResolvedValue(installed);

      const result = await installMarketplaceSkill('debug-skill');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/marketplace/debug-skill/install', {});
      expect(result.is_enabled).toBe(true);
    });

    it('should uninstall marketplace skill', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await uninstallMarketplaceSkill('debug-skill');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/marketplace/debug-skill/uninstall');
    });

    it('should get my marketplace skills', async () => {
      const mySkills = [{ id: 'installed-1', skill_slug: 'debug-skill' }];
      mockApiClient.get.mockResolvedValue({ skills: mySkills });

      const result = await getMyMarketplaceSkills();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/marketplace/my/skills');
      expect(result).toEqual(mySkills);
    });

    it('should submit skill to marketplace', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await submitSkillToMarketplace('skill-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/marketplace/submit', {
        skill_id: 'skill-1',
      });
    });

    it('should get my marketplace submissions', async () => {
      const submissions = [{ id: 'sub-1', name: 'Submitted Skill' }];
      mockApiClient.get.mockResolvedValue({ submissions });

      const result = await getMyMarketplaceSubmissions();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/marketplace/my/submissions');
      expect(result).toEqual(submissions);
    });
  });

  describe('Skill Analytics', () => {
    const mockAnalytics = { total_executions: 100, success_rate: 0.95, skills: [] };

    it('should get skill analytics', async () => {
      mockApiClient.get.mockResolvedValue(mockAnalytics);

      const result = await getSkillAnalytics();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills/analytics?days=30');
      expect(result.total_executions).toBe(100);
    });

    it('should get skill analytics with custom days', async () => {
      mockApiClient.get.mockResolvedValue(mockAnalytics);

      await getSkillAnalytics(7);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills/analytics?days=7');
    });

    it('should get skill analytics detail', async () => {
      const detail = { skill_id: 'skill-1', total_executions: 50, timeline: [] };
      mockApiClient.get.mockResolvedValue(detail);

      const result = await getSkillAnalyticsDetail('skill-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills/skill-1/analytics?days=30');
      expect(result.skill_id).toBe('skill-1');
    });

    it('should get skill analytics timeline', async () => {
      const timeline = [{ date: '2024-01-15', executions: 10, successes: 9, failures: 1 }];
      mockApiClient.get.mockResolvedValue({ data: timeline });

      const result = await getSkillAnalyticsTimeline();

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/skills/analytics/timeline?days=30&granularity=day'
      );
      expect(result).toEqual(timeline);
    });

    it('should get skill analytics trends', async () => {
      const trends = [{ skill_slug: 'debug', trend: 0.1, executions: 50 }];
      mockApiClient.get.mockResolvedValue({ trends });

      const result = await getSkillAnalyticsTrends();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/skills/analytics/trends?days=30');
      expect(result).toEqual(trends);
    });
  });
});

// ============================================================================
// Platform API Functions
// ============================================================================

describe('API - Platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Platform Settings', () => {
    const mockSettings = [{ id: 'setting-1', key: 'app_name', value: 'Podex', is_public: true }];

    it('should get all platform settings', async () => {
      mockApiClient.get.mockResolvedValue({ settings: mockSettings });

      const result = await getPlatformSettings();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/settings');
      expect(result).toEqual(mockSettings);
    });

    it('should get platform settings by category', async () => {
      mockApiClient.get.mockResolvedValue({ settings: mockSettings });

      await getPlatformSettings('general');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/settings?category=general');
    });

    it('should get specific platform setting', async () => {
      mockApiClient.get.mockResolvedValue({ value: 'Podex' });

      const result = await getPlatformSetting('app_name');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/settings/app_name');
      expect(result).toBe('Podex');
    });
  });

  describe('Providers', () => {
    const mockProviders = [
      { id: 'provider-1', slug: 'anthropic', name: 'Anthropic', is_enabled: true },
    ];

    it('should get providers', async () => {
      mockApiClient.get.mockResolvedValue({ providers: mockProviders });

      const result = await getProviders();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/providers');
      expect(result).toEqual(mockProviders);
    });

    it('should get specific provider', async () => {
      mockApiClient.get.mockResolvedValue(mockProviders[0]);

      const result = await getProvider('anthropic');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/providers/anthropic');
      expect(result.slug).toBe('anthropic');
    });
  });

  describe('Platform Config', () => {
    const mockConfig = { settings: { app_name: 'Podex' }, providers: [] };

    it('should get platform config', async () => {
      mockApiClient.get.mockResolvedValue(mockConfig);

      const result = await getPlatformConfig();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/platform/config');
      expect(result.settings.app_name).toBe('Podex');
    });
  });
});

// ============================================================================
// Health Check API Functions
// ============================================================================

describe('API - Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Health', () => {
    const mockHealth = { id: 'health-1', overall_score: 85, grade: 'B' };

    it('should get session health', async () => {
      mockApiClient.get.mockResolvedValue(mockHealth);

      const result = await getSessionHealth('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/sessions/session-1/health');
      expect(result?.overall_score).toBe(85);
    });

    it('should return null on error', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Not found'));

      const result = await getSessionHealth('session-1');

      expect(result).toBeNull();
    });
  });

  describe('Health Recommendations', () => {
    const mockRecommendations = {
      total_count: 3,
      recommendations: [{ id: 'rec-1', title: 'Add tests' }],
    };

    it('should get session health recommendations', async () => {
      mockApiClient.get.mockResolvedValue(mockRecommendations);

      const result = await getSessionHealthRecommendations('session-1');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        '/api/v1/sessions/session-1/health/recommendations'
      );
      expect(result?.total_count).toBe(3);
    });

    it('should return null on error', async () => {
      mockApiClient.get.mockRejectedValue(new Error('Not found'));

      const result = await getSessionHealthRecommendations('session-1');

      expect(result).toBeNull();
    });
  });

  describe('Analyze Health', () => {
    it('should start health analysis', async () => {
      mockApiClient.post.mockResolvedValue({ status: 'analyzing' });

      const result = await analyzeSessionHealth('session-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/sessions/session-1/health/analyze', {
        working_directory: null,
      });
      expect(result.status).toBe('analyzing');
    });

    it('should start health analysis with working directory', async () => {
      mockApiClient.post.mockResolvedValue({ status: 'analyzing' });

      await analyzeSessionHealth('session-1', '/workspace/project');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/sessions/session-1/health/analyze', {
        working_directory: '/workspace/project',
      });
    });
  });

  describe('Apply Health Fix', () => {
    it('should apply health fix', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, message: 'Fix applied' });

      const result = await applyHealthFix('session-1', 'rec-1');

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/v1/sessions/session-1/health/fix/rec-1',
        {}
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Health Check Configuration', () => {
    const mockChecks = {
      checks: [{ id: 'check-1', name: 'ESLint', category: 'code_quality' }],
      total: 1,
    };

    it('should get health checks', async () => {
      mockApiClient.get.mockResolvedValue(mockChecks);

      const result = await getHealthChecks();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/health/checks');
      expect(result.checks).toHaveLength(1);
    });

    it('should get health checks with category filter', async () => {
      mockApiClient.get.mockResolvedValue(mockChecks);

      await getHealthChecks('code_quality');

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/health/checks?category=code_quality');
    });

    it('should get default health checks', async () => {
      mockApiClient.get.mockResolvedValue(mockChecks);

      const result = await getDefaultHealthChecks();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/health/checks/defaults');
      expect(result.checks).toHaveLength(1);
    });

    it('should create health check', async () => {
      const newCheck = { id: 'check-2', name: 'Custom Check' };
      mockApiClient.post.mockResolvedValue(newCheck);

      const result = await createHealthCheck({
        category: 'custom',
        name: 'Custom Check',
        command: 'npm test',
        parse_mode: 'json',
        parse_config: {},
      });

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/v1/health/checks',
        expect.objectContaining({ name: 'Custom Check' })
      );
      expect(result).toEqual(newCheck);
    });

    it('should update health check', async () => {
      const updated = { id: 'check-1', name: 'Updated Check' };
      mockApiClient.put.mockResolvedValue(updated);

      const result = await updateHealthCheck('check-1', { name: 'Updated Check' });

      expect(mockApiClient.put).toHaveBeenCalledWith('/api/v1/health/checks/check-1', {
        name: 'Updated Check',
      });
      expect(result).toEqual(updated);
    });

    it('should delete health check', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await deleteHealthCheck('check-1');

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api/v1/health/checks/check-1');
    });

    it('should test health check', async () => {
      const testResult = {
        success: true,
        score: 100,
        raw_output: 'All tests passed',
        execution_time: 500,
      };
      mockApiClient.post.mockResolvedValue(testResult);

      const result = await testHealthCheck('check-1', 'session-1');

      expect(mockApiClient.post).toHaveBeenCalledWith('/api/v1/health/checks/check-1/test', {
        session_id: 'session-1',
      });
      expect(result.success).toBe(true);
    });

    it('should test health command', async () => {
      const testResult = { success: true, score: 100, raw_output: 'OK', execution_time: 100 };
      mockApiClient.post.mockResolvedValue(testResult);

      const result = await testHealthCommand('session-1', 'npm test', 'json', {});

      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/api/v1/health/checks/test-command',
        expect.objectContaining({
          session_id: 'session-1',
          command: 'npm test',
        })
      );
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// Memory API Functions
// ============================================================================

describe('API - Memories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMemories = {
    memories: [{ id: 'mem-1', content: 'Test memory' }],
    total: 1,
    page: 1,
    page_size: 20,
    total_pages: 1,
  };

  it('should get memories', async () => {
    mockApiClient.get.mockResolvedValue(mockMemories);

    const result = await getMemories();

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/memories');
    expect(result.memories).toHaveLength(1);
  });

  it('should get memories with pagination', async () => {
    mockApiClient.get.mockResolvedValue(mockMemories);

    await getMemories({ page: 2, page_size: 50 });

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/memories?page=2&page_size=50');
  });

  it('should get memories with filters', async () => {
    mockApiClient.get.mockResolvedValue(mockMemories);

    await getMemories({ memory_type: 'code', search: 'test' });

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/v1/memories?memory_type=code&search=test');
  });

  it('should delete memory', async () => {
    mockApiClient.delete.mockResolvedValue(undefined);

    await deleteMemory('mem-1');

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/v1/memories/mem-1');
  });

  it('should clear all memories', async () => {
    mockApiClient.delete.mockResolvedValue({ deleted: 50 });

    const result = await clearAllMemories();

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/v1/memories?confirm=true');
    expect(result.deleted).toBe(50);
  });
});

// ============================================================================
// Admin Model API Functions
// ============================================================================

describe('API - Admin Models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockModels = [
    {
      id: 'model-1',
      model_id: 'claude-opus-4.5',
      display_name: 'Claude Opus 4.5',
      is_enabled: true,
    },
  ];

  it('should list admin models', async () => {
    mockApiClient.get.mockResolvedValue(mockModels);

    const result = await adminListModels();

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/models');
    expect(result).toEqual(mockModels);
  });

  it('should list admin models with provider filter', async () => {
    mockApiClient.get.mockResolvedValue(mockModels);

    await adminListModels({ provider: 'anthropic' });

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/models?provider=anthropic');
  });

  it('should list admin models with enabled filter', async () => {
    mockApiClient.get.mockResolvedValue(mockModels);

    await adminListModels({ enabled_only: true });

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/models?enabled_only=true');
  });

  it('should create admin model', async () => {
    const newModel = { id: 'model-2', model_id: 'new-model', display_name: 'New Model' };
    mockApiClient.post.mockResolvedValue(newModel);

    const result = await adminCreateModel({
      model_id: 'new-model',
      display_name: 'New Model',
      provider: 'anthropic',
    });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/api/admin/models',
      expect.objectContaining({ model_id: 'new-model' })
    );
    expect(result).toEqual(newModel);
  });

  it('should get admin model', async () => {
    mockApiClient.get.mockResolvedValue(mockModels[0]);

    const result = await adminGetModel('model-1');

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/models/model-1');
    expect(result.model_id).toBe('claude-opus-4.5');
  });

  it('should update admin model', async () => {
    const updated = { ...mockModels[0], display_name: 'Updated Name' };
    mockApiClient.patch.mockResolvedValue(updated);

    const result = await adminUpdateModel('model-1', { display_name: 'Updated Name' });

    expect(mockApiClient.patch).toHaveBeenCalledWith('/api/admin/models/model-1', {
      display_name: 'Updated Name',
    });
    expect(result.display_name).toBe('Updated Name');
  });

  it('should delete admin model', async () => {
    mockApiClient.delete.mockResolvedValue(undefined);

    await adminDeleteModel('model-1');

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/admin/models/model-1');
  });

  it('should get agent defaults', async () => {
    const defaults = { coder: { model_id: 'claude-opus-4.5' } };
    mockApiClient.get.mockResolvedValue(defaults);

    const result = await adminGetAgentDefaults();

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/models/agent-defaults');
    expect(result).toEqual(defaults);
  });

  it('should update agent defaults', async () => {
    const updated = { coder: { model_id: 'claude-sonnet-4.5' } };
    mockApiClient.put.mockResolvedValue(updated);

    const result = await adminUpdateAgentDefaults('coder', { model_id: 'claude-sonnet-4.5' });

    expect(mockApiClient.put).toHaveBeenCalledWith('/api/admin/models/agent-defaults/coder', {
      model_id: 'claude-sonnet-4.5',
    });
    expect(result).toEqual(updated);
  });

  it('should seed models', async () => {
    const seedResult = { created: 5, updated: 10, total: 15 };
    mockApiClient.post.mockResolvedValue(seedResult);

    const result = await adminSeedModels();

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/admin/models/seed', {});
    expect(result.total).toBe(15);
  });
});

// ============================================================================
// Admin Provider API Functions
// ============================================================================

describe('API - Admin Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockProviders = [
    { id: 'provider-1', slug: 'anthropic', name: 'Anthropic', is_enabled: true },
  ];

  it('should list admin providers', async () => {
    mockApiClient.get.mockResolvedValue({ providers: mockProviders });

    const result = await adminListProviders();

    expect(mockApiClient.get).toHaveBeenCalledWith(
      '/api/admin/settings/providers?include_disabled=true'
    );
    expect(result).toEqual(mockProviders);
  });

  it('should list admin providers excluding disabled', async () => {
    mockApiClient.get.mockResolvedValue({ providers: mockProviders });

    await adminListProviders(false);

    expect(mockApiClient.get).toHaveBeenCalledWith(
      '/api/admin/settings/providers?include_disabled=false'
    );
  });

  it('should get admin provider', async () => {
    mockApiClient.get.mockResolvedValue(mockProviders[0]);

    const result = await adminGetProvider('anthropic');

    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/settings/providers/anthropic');
    expect(result.slug).toBe('anthropic');
  });

  it('should create admin provider', async () => {
    const newProvider = { id: 'provider-2', slug: 'openai', name: 'OpenAI' };
    mockApiClient.post.mockResolvedValue(newProvider);

    const result = await adminCreateProvider({ slug: 'openai', name: 'OpenAI', color: '#000' });

    expect(mockApiClient.post).toHaveBeenCalledWith(
      '/api/admin/settings/providers',
      expect.objectContaining({ slug: 'openai' })
    );
    expect(result).toEqual(newProvider);
  });

  it('should update admin provider', async () => {
    const updated = { ...mockProviders[0], name: 'Updated Anthropic' };
    mockApiClient.patch.mockResolvedValue(updated);

    const result = await adminUpdateProvider('anthropic', { name: 'Updated Anthropic' });

    expect(mockApiClient.patch).toHaveBeenCalledWith('/api/admin/settings/providers/anthropic', {
      name: 'Updated Anthropic',
    });
    expect(result.name).toBe('Updated Anthropic');
  });

  it('should delete admin provider', async () => {
    mockApiClient.delete.mockResolvedValue(undefined);

    await adminDeleteProvider('anthropic');

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/admin/settings/providers/anthropic');
  });
});

// ============================================================================
// Transform Functions
// ============================================================================

describe('Transform Functions', () => {
  describe('transformUsageSummary', () => {
    it('should transform snake_case to camelCase', () => {
      const input = {
        period_start: '2024-01-01',
        period_end: '2024-02-01',
        tokens_input: 100,
        tokens_output: 50,
        tokens_total: 150,
        tokens_cost: 1.5,
        compute_seconds: 3600,
        compute_hours: 1,
        compute_credits_used: 1,
        compute_credits_included: 5,
        compute_cost: 0.5,
        storage_gb: 1,
        storage_cost: 0.1,
        api_calls: 100,
        total_cost: 2.1,
        usage_by_model: {},
        usage_by_agent: {},
        usage_by_session: {},
        usage_by_tier: {},
      };

      const result = transformUsageSummary(input);

      expect(result.periodStart).toBe('2024-01-01');
      expect(result.tokensInput).toBe(100);
      expect(result.computeCreditsUsed).toBe(1);
    });

    it('should handle missing fields with defaults', () => {
      const input = { period_start: '2024-01-01', period_end: '2024-02-01' };

      const result = transformUsageSummary(input);

      expect(result.tokensTotal).toBe(0);
      expect(result.totalCost).toBe(0);
      expect(result.usageByModel).toEqual({});
    });
  });

  describe('transformQuota', () => {
    it('should transform quota to camelCase', () => {
      const input = {
        id: 'quota-1',
        quota_type: 'tokens',
        limit_value: 1000000,
        current_usage: 500000,
        usage_percentage: 50,
        reset_at: '2024-02-01',
        overage_allowed: true,
        is_exceeded: false,
        is_warning: false,
      };

      const result = transformQuota(input);

      expect(result.quotaType).toBe('tokens');
      expect(result.limitValue).toBe(1000000);
      expect(result.currentUsage).toBe(500000);
      expect(result.isExceeded).toBe(false);
    });

    it('should handle missing fields with defaults', () => {
      const input = { id: 'quota-1', quota_type: 'tokens' };

      const result = transformQuota(input);

      expect(result.limitValue).toBe(0);
      expect(result.currentUsage).toBe(0);
      expect(result.overageAllowed).toBe(false);
    });
  });
});

// ============================================================================
// Error Handling Functions
// ============================================================================

describe('Error Handling Functions', () => {
  describe('isBillingError', () => {
    it('should identify 402 errors as billing errors', () => {
      const error = new ApiRequestError('Payment required', 402);
      expect(isBillingError(error)).toBe(true);
    });

    it('should not identify non-402 errors as billing errors', () => {
      const error = new ApiRequestError('Not found', 404);
      expect(isBillingError(error)).toBe(false);
    });

    it('should not identify regular Error as billing error', () => {
      expect(isBillingError(new Error('Random error'))).toBe(false);
    });

    it('should handle non-Error values', () => {
      expect(isBillingError('string error')).toBe(false);
      expect(isBillingError(null)).toBe(false);
      expect(isBillingError(undefined)).toBe(false);
    });
  });

  describe('isWorkspaceError', () => {
    it('should identify 503 as workspace error', () => {
      const error = new ApiRequestError('Service unavailable', 503);
      expect(isWorkspaceError(error)).toBe(true);
    });

    it('should identify 500 as workspace error', () => {
      const error = new ApiRequestError('Internal error', 500);
      expect(isWorkspaceError(error)).toBe(true);
    });

    it('should identify 404 as workspace error', () => {
      const error = new ApiRequestError('Not found', 404);
      expect(isWorkspaceError(error)).toBe(true);
    });

    it('should not identify 401 as workspace error', () => {
      const error = new ApiRequestError('Unauthorized', 401);
      expect(isWorkspaceError(error)).toBe(false);
    });

    it('should handle non-Error values', () => {
      expect(isWorkspaceError('string error')).toBe(false);
      expect(isWorkspaceError(null)).toBe(false);
    });
  });
});
