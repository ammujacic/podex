import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAdminStore } from '../admin';
import type {
  AdminUser,
  AdminPlan,
  AdminHardwareSpec,
  AdminTemplate,
  PlatformSetting,
  AdminLLMProvider,
  AdminDefaultMCPServer,
  DashboardOverview,
  RevenueMetrics,
  UsageMetrics,
  CostMetrics,
  UserGrowthMetrics,
  UserUsage,
  AwardCreditsResponse,
} from '../admin';
import * as api from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  listAdminMCPServers: vi.fn(),
  createAdminMCPServer: vi.fn(),
  updateAdminMCPServer: vi.fn(),
  deleteAdminMCPServer: vi.fn(),
  toggleAdminMCPServer: vi.fn(),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const mockAdminUser: AdminUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatar_url: null,
  oauth_provider: 'github',
  role: 'user',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  session_count: 5,
  subscription_status: 'active',
  subscription_plan: 'pro',
  credit_balance_cents: 5000,
  is_sponsored: false,
  sponsored_by_name: null,
};

const mockAdminUser2: AdminUser = {
  ...mockAdminUser,
  id: 'user-2',
  email: 'user2@example.com',
  name: 'User Two',
  role: 'admin',
};

const mockPlan: AdminPlan = {
  id: 'plan-1',
  name: 'Pro',
  slug: 'pro',
  description: 'Professional plan',
  price_monthly_cents: 2900,
  price_yearly_cents: 29000,
  currency: 'USD',
  tokens_included: 1000000,
  compute_credits_cents_included: 1000,
  storage_gb_included: 10,
  max_agents: 5,
  max_sessions: 20,
  max_team_members: 5,
  overage_token_rate_cents: 2,
  overage_compute_rate_cents: 50,
  overage_storage_rate_cents: 10,
  overage_allowed: true,
  llm_margin_percent: 20,
  compute_margin_percent: 30,
  features: { gpu_access: true, team_collaboration: true },
  is_active: true,
  is_popular: true,
  is_enterprise: false,
  sort_order: 2,
  stripe_price_id_monthly: 'price_123',
  stripe_price_id_yearly: 'price_456',
  stripe_product_id: 'prod_123',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  subscriber_count: 150,
};

const mockHardwareSpec: AdminHardwareSpec = {
  id: 'hw-1',
  tier: 'basic',
  display_name: 'Basic',
  description: 'Standard CPU workspace',
  architecture: 'x86_64',
  vcpu: 2,
  memory_mb: 4096,
  gpu_type: null,
  gpu_memory_gb: null,
  gpu_count: 0,
  storage_gb: 10,
  hourly_rate_cents: 50,
  is_available: true,
  requires_subscription: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  active_session_count: 10,
  total_usage_hours: 500,
};

const mockTemplate: AdminTemplate = {
  id: 'template-1',
  name: 'Node.js',
  slug: 'nodejs',
  description: 'Node.js development environment',
  icon: 'nodejs',
  icon_url: 'https://example.com/icons/nodejs.png',
  base_image: 'node:20',
  pre_install_commands: ['npm install -g pnpm'],
  environment_variables: { NODE_ENV: 'development' },
  default_ports: [{ port: 3000, name: 'app', protocol: 'http' }],
  packages: ['node', 'npm', 'pnpm'],
  language_versions: { node: '20.0.0' },
  is_public: true,
  is_official: true,
  owner_id: null,
  owner_email: null,
  usage_count: 250,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  active_session_count: 25,
};

const mockSetting: PlatformSetting = {
  key: 'maintenance_mode',
  value: { enabled: false, message: '' },
  description: 'System maintenance mode',
  category: 'system',
  is_public: false,
  updated_at: '2024-01-01T00:00:00Z',
  updated_by: 'admin-1',
};

const mockProvider: AdminLLMProvider = {
  slug: 'anthropic',
  name: 'Anthropic',
  description: 'Claude AI models',
  icon: 'anthropic',
  color: '#7C3AED',
  logo_url: 'https://example.com/logos/anthropic.png',
  is_local: false,
  default_url: null,
  docs_url: 'https://docs.anthropic.com',
  setup_guide_url: 'https://docs.anthropic.com/setup',
  requires_api_key: true,
  supports_streaming: true,
  supports_tools: true,
  supports_vision: true,
  is_enabled: true,
  sort_order: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMCPServer: AdminDefaultMCPServer = {
  id: 'mcp-1',
  name: 'GitHub',
  slug: 'github',
  description: 'GitHub integration',
  category: 'development',
  command: 'npx',
  args: ['@modelcontextprotocol/server-github'],
  env_vars: { GITHUB_TOKEN: '' },
  is_enabled: true,
  is_official: true,
  sort_order: 1,
  icon: 'github',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockDashboard: DashboardOverview = {
  total_users: 1000,
  active_users_30d: 750,
  new_users_30d: 150,
  user_growth_percent: 15,
  total_sessions: 5000,
  active_sessions: 200,
  sessions_today: 50,
  mrr_cents: 2900000,
  arr_cents: 34800000,
  mrr_growth_percent: 10,
  total_tokens_30d: 50000000,
  total_compute_hours_30d: 1000,
  total_storage_gb: 500,
  paying_customers: 500,
  conversion_rate: 5,
  churn_rate_30d: 2,
};

const mockRevenueMetrics: RevenueMetrics = {
  mrr_cents: 2900000,
  arr_cents: 34800000,
  mrr_previous_cents: 2600000,
  mrr_growth_percent: 11.5,
  subscription_revenue_cents: 2500000,
  credit_revenue_cents: 300000,
  overage_revenue_cents: 100000,
  revenue_by_plan: [
    { plan: 'Pro', slug: 'pro', subscribers: 150, mrr_cents: 435000 },
    { plan: 'Enterprise', slug: 'enterprise', subscribers: 50, mrr_cents: 995000 },
  ],
  nrr_percent: 105,
  arpu_cents: 5800,
  ltv_cents: 174000,
};

const mockUsageMetrics: UsageMetrics = {
  total_tokens: 50000000,
  input_tokens: 30000000,
  output_tokens: 20000000,
  tokens_by_model: [
    { model: 'claude-opus-4-5', tokens: 30000000 },
    { model: 'claude-sonnet-4-5', tokens: 20000000 },
  ],
  tokens_by_provider: [
    { provider: 'anthropic', tokens: 45000000 },
    { provider: 'openai', tokens: 5000000 },
  ],
  total_compute_hours: 1000,
  compute_by_tier: [
    { tier: 'basic', minutes: 48000 },
    { tier: 'gpu-t4', minutes: 12000 },
  ],
  total_storage_gb: 500,
  daily_usage: [
    { date: '2024-01-01', tokens: 1500000 },
    { date: '2024-01-02', tokens: 1600000 },
  ],
};

const mockCostMetrics: CostMetrics = {
  gross_revenue_cents: 2900000,
  llm_cost_cents: 1500000,
  compute_cost_cents: 500000,
  storage_cost_cents: 100000,
  total_cost_cents: 2100000,
  gross_margin_percent: 27.6,
  llm_margin_percent: 20,
  compute_margin_percent: 30,
  cost_breakdown: [
    { category: 'LLM', amount_cents: 1500000 },
    { category: 'Compute', amount_cents: 500000 },
  ],
  revenue_breakdown: [
    { category: 'Subscriptions', amount_cents: 2500000 },
    { category: 'Credits', amount_cents: 300000 },
  ],
};

const mockUserGrowthMetrics: UserGrowthMetrics = {
  daily_signups: [
    { date: '2024-01-01', signups: 5 },
    { date: '2024-01-02', signups: 7 },
  ],
  total_signups_30d: 150,
  signup_growth_percent: 15,
  day_1_retention: 80,
  day_7_retention: 65,
  day_30_retention: 50,
  churned_users_30d: 20,
  churn_rate: 2,
  activation_rate: 75,
};

const mockUserUsage: UserUsage = {
  user_id: 'user-1',
  tokens_used: 400000,
  tokens_limit: 1000000,
  compute_cents_used: 500,
  compute_cents_limit: 1000,
  storage_gb_used: 3.5,
  storage_gb_limit: 10,
  quotas: [
    {
      quota_type: 'tokens',
      current_usage: 400000,
      limit_value: 1000000,
      usage_percent: 40,
      warning_sent: false,
      overage_allowed: true,
    },
  ],
  credit_balance_cents: 5000,
  total_bonus_cents: 1000,
};

const mockAwardCreditsResponse: AwardCreditsResponse = {
  transaction_id: 'tx-1',
  amount_cents: 500,
  new_balance_cents: 5500,
  expires_at: '2024-12-31T23:59:59Z',
};

describe('adminStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    // Use replace: false to preserve actions
    act(() => {
      useAdminStore.setState(
        {
          dashboard: null,
          dashboardLoading: false,
          revenueMetrics: null,
          usageMetrics: null,
          costMetrics: null,
          userGrowthMetrics: null,
          analyticsLoading: false,
          users: [],
          usersTotal: 0,
          usersLoading: false,
          plans: [],
          plansLoading: false,
          hardwareSpecs: [],
          hardwareLoading: false,
          templates: [],
          templatesTotal: 0,
          templatesLoading: false,
          settings: [],
          settingsLoading: false,
          providers: [],
          providersLoading: false,
          mcpServers: [],
          mcpServersLoading: false,
          error: null,
        },
        false // Don't replace the entire state, just update these properties
      );
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has null dashboard', () => {
      const { result } = renderHook(() => useAdminStore());
      expect(result.current.dashboard).toBeNull();
    });

    it('has empty users array', () => {
      const { result } = renderHook(() => useAdminStore());
      expect(result.current.users).toEqual([]);
      expect(result.current.usersTotal).toBe(0);
    });

    it('has empty plans array', () => {
      const { result } = renderHook(() => useAdminStore());
      expect(result.current.plans).toEqual([]);
    });

    it('has no error', () => {
      const { result } = renderHook(() => useAdminStore());
      expect(result.current.error).toBeNull();
    });
  });

  // ========================================================================
  // Dashboard & Analytics
  // ========================================================================

  describe('Dashboard and Analytics', () => {
    describe('fetchDashboard', () => {
      it('fetches and sets dashboard data', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockDashboard);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchDashboard();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/dashboard');
        expect(result.current.dashboard).toEqual(mockDashboard);
        expect(result.current.dashboardLoading).toBe(false);
      });

      it('sets loading state during fetch', async () => {
        let resolvePromise: (value: DashboardOverview) => void;
        const promise = new Promise<DashboardOverview>((resolve) => {
          resolvePromise = resolve;
        });
        vi.mocked(api.api.get).mockReturnValueOnce(promise);
        const { result } = renderHook(() => useAdminStore());

        // Start the fetch but don't await yet
        let fetchPromise: Promise<void>;
        act(() => {
          fetchPromise = result.current.fetchDashboard();
        });

        // Check loading state is true
        expect(result.current.dashboardLoading).toBe(true);

        // Resolve the promise and wait for completion
        await act(async () => {
          resolvePromise!(mockDashboard);
          await fetchPromise!;
        });

        expect(result.current.dashboardLoading).toBe(false);
      });

      it('handles errors gracefully', async () => {
        const error = new Error('Failed to fetch dashboard');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchDashboard();
        });

        expect(result.current.error).toBe('Failed to fetch dashboard');
        expect(result.current.dashboardLoading).toBe(false);
      });
    });

    describe('fetchRevenueMetrics', () => {
      it('fetches revenue metrics with default days', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockRevenueMetrics);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchRevenueMetrics();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/revenue?days=30');
        expect(result.current.revenueMetrics).toEqual(mockRevenueMetrics);
      });

      it('fetches revenue metrics with custom days', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockRevenueMetrics);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchRevenueMetrics(90);
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/revenue?days=90');
      });

      it('handles errors during revenue metrics fetch', async () => {
        const error = new Error('Revenue fetch failed');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchRevenueMetrics();
        });

        expect(result.current.error).toBe('Revenue fetch failed');
      });
    });

    describe('fetchUsageMetrics', () => {
      it('fetches usage metrics', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockUsageMetrics);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUsageMetrics();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/usage?days=30');
        expect(result.current.usageMetrics).toEqual(mockUsageMetrics);
      });
    });

    describe('fetchCostMetrics', () => {
      it('fetches cost metrics', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockCostMetrics);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchCostMetrics();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/costs?days=30');
        expect(result.current.costMetrics).toEqual(mockCostMetrics);
      });
    });

    describe('fetchUserGrowthMetrics', () => {
      it('fetches user growth metrics', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockUserGrowthMetrics);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUserGrowthMetrics();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/analytics/users/growth?days=30');
        expect(result.current.userGrowthMetrics).toEqual(mockUserGrowthMetrics);
      });
    });
  });

  // ========================================================================
  // User Management
  // ========================================================================

  describe('User Management', () => {
    describe('fetchUsers', () => {
      it('fetches users with default pagination', async () => {
        const response = { items: [mockAdminUser], total: 1 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUsers();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/users?page=1&page_size=50');
        expect(result.current.users).toEqual([mockAdminUser]);
        expect(result.current.usersTotal).toBe(1);
      });

      it('fetches users with custom pagination', async () => {
        const response = { items: [mockAdminUser, mockAdminUser2], total: 2 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUsers(2, 20);
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/users?page=2&page_size=20');
        expect(result.current.users).toHaveLength(2);
      });

      it('fetches users with filters', async () => {
        const response = { items: [mockAdminUser], total: 1 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUsers(1, 50, { role: 'admin', is_active: 'true' });
        });

        expect(api.api.get).toHaveBeenCalledWith(
          '/api/admin/users?page=1&page_size=50&role=admin&is_active=true'
        );
      });

      it('handles errors during user fetch', async () => {
        const error = new Error('Failed to fetch users');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchUsers();
        });

        expect(result.current.error).toBe('Failed to fetch users');
        expect(result.current.usersLoading).toBe(false);
      });
    });

    describe('updateUser', () => {
      it('updates user optimistically', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        const { result } = renderHook(() => useAdminStore());

        // Set initial users
        act(() => {
          useAdminStore.setState({ users: [mockAdminUser, mockAdminUser2] });
        });

        await act(async () => {
          await result.current.updateUser('user-1', { role: 'admin' });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/users/user-1', { role: 'admin' });
        expect(result.current.users[0].role).toBe('admin');
      });

      it('rolls back on error', async () => {
        const error = new Error('Update failed');
        vi.mocked(api.api.patch).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ users: [mockAdminUser] });
        });

        await act(async () => {
          try {
            await result.current.updateUser('user-1', { role: 'admin' });
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.users[0].role).toBe('user'); // Rolled back
        expect(result.current.error).toBe('Update failed');
      });

      it('updates user status', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ users: [mockAdminUser] });
        });

        await act(async () => {
          await result.current.updateUser('user-1', { is_active: false });
        });

        expect(result.current.users[0].is_active).toBe(false);
      });

      it('does not affect other users', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ users: [mockAdminUser, mockAdminUser2] });
        });

        await act(async () => {
          await result.current.updateUser('user-1', { name: 'Updated Name' });
        });

        expect(result.current.users[0].name).toBe('Updated Name');
        expect(result.current.users[1].name).toBe('User Two');
      });
    });

    describe('sponsorUser', () => {
      it('sponsors user with plan', async () => {
        vi.mocked(api.api.post).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [], total: 0 });
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.sponsorUser('user-1', 'plan-pro', 'Open source contributor');
        });

        expect(api.api.post).toHaveBeenCalledWith('/api/admin/users/user-1/sponsor-subscription', {
          plan_id: 'plan-pro',
          reason: 'Open source contributor',
        });
        expect(api.api.get).toHaveBeenCalled(); // Refreshes users
      });

      it('handles errors during sponsorship', async () => {
        const error = new Error('Sponsorship failed');
        vi.mocked(api.api.post).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.sponsorUser('user-1', 'plan-pro');
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Sponsorship failed');
      });
    });

    describe('removeSponsor', () => {
      it('removes user sponsorship', async () => {
        vi.mocked(api.api.delete).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [], total: 0 });
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.removeSponsor('user-1');
        });

        expect(api.api.delete).toHaveBeenCalledWith('/api/admin/users/user-1/sponsor-subscription');
        expect(api.api.get).toHaveBeenCalled();
      });
    });

    describe('fetchUserUsage', () => {
      it('fetches user usage data', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce(mockUserUsage);
        const { result } = renderHook(() => useAdminStore());

        let usage: UserUsage | undefined;
        await act(async () => {
          usage = await result.current.fetchUserUsage('user-1');
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/users/user-1/usage');
        expect(usage).toEqual(mockUserUsage);
      });

      it('handles errors during usage fetch', async () => {
        const error = new Error('Usage fetch failed');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.fetchUserUsage('user-1');
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Usage fetch failed');
      });
    });

    describe('awardCredits', () => {
      it('awards credits to user', async () => {
        vi.mocked(api.api.post).mockResolvedValueOnce(mockAwardCreditsResponse);
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [], total: 0 });
        const { result } = renderHook(() => useAdminStore());

        let response: AwardCreditsResponse | undefined;
        await act(async () => {
          response = await result.current.awardCredits('user-1', 500, 'Bonus credits');
        });

        expect(api.api.post).toHaveBeenCalledWith('/api/admin/users/user-1/credits', {
          amount_cents: 500,
          reason: 'Bonus credits',
        });
        expect(response).toEqual(mockAwardCreditsResponse);
        expect(api.api.get).toHaveBeenCalled(); // Refreshes users
      });

      it('handles errors during credit award', async () => {
        const error = new Error('Award failed');
        vi.mocked(api.api.post).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.awardCredits('user-1', 500, 'Bonus');
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Award failed');
      });
    });
  });

  // ========================================================================
  // Plan Management
  // ========================================================================

  describe('Plan Management', () => {
    describe('fetchPlans', () => {
      it('fetches plans with inactive included by default', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockPlan]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchPlans();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/plans?include_inactive=true');
        expect(result.current.plans).toEqual([mockPlan]);
      });

      it('fetches only active plans when specified', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockPlan]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchPlans(false);
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/plans?include_inactive=false');
      });

      it('handles errors during plan fetch', async () => {
        const error = new Error('Plans fetch failed');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchPlans();
        });

        expect(result.current.error).toBe('Plans fetch failed');
      });
    });

    describe('updatePlan', () => {
      it('updates plan optimistically', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ plans: [mockPlan] });
        });

        await act(async () => {
          await result.current.updatePlan('plan-1', { price_monthly_cents: 3900 });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/plans/plan-1', {
          price_monthly_cents: 3900,
        });
        expect(result.current.plans[0].price_monthly_cents).toBe(3900);
      });

      it('rolls back on error', async () => {
        const error = new Error('Update failed');
        vi.mocked(api.api.patch).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ plans: [mockPlan] });
        });

        await act(async () => {
          try {
            await result.current.updatePlan('plan-1', { price_monthly_cents: 3900 });
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.plans[0].price_monthly_cents).toBe(2900);
        expect(result.current.error).toBe('Update failed');
      });

      it('updates plan features', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        const { result } = renderHook(() => useAdminStore());

        act(() => {
          useAdminStore.setState({ plans: [mockPlan] });
        });

        await act(async () => {
          await result.current.updatePlan('plan-1', {
            features: { gpu_access: true, custom_models: true },
          });
        });

        expect(result.current.plans[0].features).toEqual({
          gpu_access: true,
          custom_models: true,
        });
      });
    });

    describe('createPlan', () => {
      it('creates new plan', async () => {
        const newPlan = { ...mockPlan, id: 'plan-2', name: 'Enterprise' };
        vi.mocked(api.api.post).mockResolvedValueOnce(newPlan);
        vi.mocked(api.api.get).mockResolvedValueOnce([mockPlan, newPlan]);
        const { result } = renderHook(() => useAdminStore());

        let createdPlan: AdminPlan | undefined;
        await act(async () => {
          createdPlan = await result.current.createPlan({
            name: 'Enterprise',
            slug: 'enterprise',
            description: 'Enterprise plan',
            price_monthly_cents: 19900,
            price_yearly_cents: 199000,
            currency: 'USD',
            tokens_included: 10000000,
            compute_credits_cents_included: 10000,
            storage_gb_included: 100,
            max_agents: -1,
            max_sessions: -1,
            max_team_members: -1,
            overage_token_rate_cents: 1,
            overage_compute_rate_cents: 30,
            overage_storage_rate_cents: 5,
            overage_allowed: true,
            llm_margin_percent: 15,
            compute_margin_percent: 25,
            features: { gpu_access: true, custom_models: true },
            is_active: true,
            is_popular: false,
            is_enterprise: true,
            sort_order: 3,
            stripe_price_id_monthly: null,
            stripe_price_id_yearly: null,
            stripe_product_id: null,
          });
        });

        expect(api.api.post).toHaveBeenCalledWith('/api/admin/plans', expect.any(Object));
        expect(createdPlan).toEqual(newPlan);
        expect(api.api.get).toHaveBeenCalled(); // Refreshes plans
      });

      it('handles errors during plan creation', async () => {
        const error = new Error('Creation failed');
        vi.mocked(api.api.post).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.createPlan({
              name: 'Test',
              slug: 'test',
              description: null,
              price_monthly_cents: 0,
              price_yearly_cents: 0,
              currency: 'USD',
              tokens_included: 0,
              compute_credits_cents_included: 0,
              storage_gb_included: 0,
              max_agents: 1,
              max_sessions: 1,
              max_team_members: 1,
              overage_token_rate_cents: null,
              overage_compute_rate_cents: null,
              overage_storage_rate_cents: null,
              overage_allowed: false,
              llm_margin_percent: 0,
              compute_margin_percent: 0,
              features: {},
              is_active: true,
              is_popular: false,
              is_enterprise: false,
              sort_order: 1,
              stripe_price_id_monthly: null,
              stripe_price_id_yearly: null,
              stripe_product_id: null,
            });
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Creation failed');
      });
    });
  });

  // ========================================================================
  // Hardware Management
  // ========================================================================

  describe('Hardware Management', () => {
    describe('fetchHardwareSpecs', () => {
      it('fetches hardware specs', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockHardwareSpec]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchHardwareSpecs();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/hardware?include_unavailable=true');
        expect(result.current.hardwareSpecs).toEqual([mockHardwareSpec]);
      });

      it('fetches only available specs when specified', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockHardwareSpec]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchHardwareSpecs(false);
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/hardware?include_unavailable=false');
      });
    });

    describe('updateHardwareSpec', () => {
      it('updates hardware spec', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce([
          { ...mockHardwareSpec, hourly_rate_cents: 75 },
        ]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.updateHardwareSpec('hw-1', { hourly_rate_cents: 75 });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/hardware/hw-1', {
          hourly_rate_cents: 75,
        });
      });

      it('handles errors during hardware update', async () => {
        const error = new Error('Update failed');
        vi.mocked(api.api.patch).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.updateHardwareSpec('hw-1', { is_available: false });
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Update failed');
      });
    });

    describe('createHardwareSpec', () => {
      it('creates new hardware spec', async () => {
        const newSpec = { ...mockHardwareSpec, id: 'hw-2', tier: 'gpu-t4' };
        vi.mocked(api.api.post).mockResolvedValueOnce(newSpec);
        vi.mocked(api.api.get).mockResolvedValueOnce([mockHardwareSpec, newSpec]);
        const { result } = renderHook(() => useAdminStore());

        let created: AdminHardwareSpec | undefined;
        await act(async () => {
          created = await result.current.createHardwareSpec({
            tier: 'gpu-t4',
            display_name: 'GPU T4',
            description: 'NVIDIA T4 GPU',
            architecture: 'x86_64',
            vcpu: 4,
            memory_mb: 16384,
            gpu_type: 'nvidia-tesla-t4',
            gpu_memory_gb: 16,
            gpu_count: 1,
            storage_gb: 20,
            hourly_rate_cents: 250,
            is_available: true,
            requires_subscription: 'pro',
          });
        });

        expect(api.api.post).toHaveBeenCalledWith('/api/admin/hardware', expect.any(Object));
        expect(created).toEqual(newSpec);
      });
    });
  });

  // ========================================================================
  // Template Management
  // ========================================================================

  describe('Template Management', () => {
    describe('fetchTemplates', () => {
      it('fetches templates with default pagination', async () => {
        const response = { items: [mockTemplate], total: 1 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchTemplates();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/templates?page=1&page_size=50');
        expect(result.current.templates).toEqual([mockTemplate]);
        expect(result.current.templatesTotal).toBe(1);
      });

      it('fetches templates with filters', async () => {
        const response = { items: [mockTemplate], total: 1 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchTemplates(1, 50, { is_official: true, is_public: true });
        });

        expect(api.api.get).toHaveBeenCalledWith(
          '/api/admin/templates?page=1&page_size=50&is_official=true&is_public=true'
        );
      });

      it('handles null filter values', async () => {
        const response = { items: [], total: 0 };
        vi.mocked(api.api.get).mockResolvedValueOnce(response);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchTemplates(1, 50, { is_official: null });
        });

        // null values should not be added to params
        expect(api.api.get).toHaveBeenCalledWith('/api/admin/templates?page=1&page_size=50');
      });
    });

    describe('updateTemplate', () => {
      it('updates template', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [], total: 0 });
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.updateTemplate('template-1', { is_public: false });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/templates/template-1', {
          is_public: false,
        });
      });
    });

    describe('createTemplate', () => {
      it('creates new template', async () => {
        const newTemplate = { ...mockTemplate, id: 'template-2', name: 'Python' };
        vi.mocked(api.api.post).mockResolvedValueOnce(newTemplate);
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [newTemplate], total: 1 });
        const { result } = renderHook(() => useAdminStore());

        let created: AdminTemplate | undefined;
        await act(async () => {
          created = await result.current.createTemplate({
            name: 'Python',
            slug: 'python',
            description: 'Python development',
            icon: 'python',
            base_image: 'python:3.11',
            pre_install_commands: null,
            environment_variables: null,
            default_ports: null,
            packages: null,
            language_versions: null,
            is_public: true,
            is_official: true,
          });
        });

        expect(api.api.post).toHaveBeenCalledWith('/api/admin/templates', expect.any(Object));
        expect(created).toEqual(newTemplate);
      });
    });

    describe('deleteTemplate', () => {
      it('deletes template', async () => {
        vi.mocked(api.api.delete).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce({ items: [], total: 0 });
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.deleteTemplate('template-1');
        });

        expect(api.api.delete).toHaveBeenCalledWith('/api/admin/templates/template-1');
        expect(api.api.get).toHaveBeenCalled();
      });

      it('handles errors during deletion', async () => {
        const error = new Error('Deletion failed');
        vi.mocked(api.api.delete).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.deleteTemplate('template-1');
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Deletion failed');
      });
    });
  });

  // ========================================================================
  // Settings Management
  // ========================================================================

  describe('Settings Management', () => {
    describe('fetchSettings', () => {
      it('fetches all settings', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockSetting]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchSettings();
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/settings');
        expect(result.current.settings).toEqual([mockSetting]);
      });

      it('fetches settings by category', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockSetting]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchSettings('system');
        });

        expect(api.api.get).toHaveBeenCalledWith('/api/admin/settings?category=system');
      });

      it('handles errors during settings fetch', async () => {
        const error = new Error('Settings fetch failed');
        vi.mocked(api.api.get).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchSettings();
        });

        expect(result.current.error).toBe('Settings fetch failed');
      });
    });

    describe('updateSetting', () => {
      it('updates setting value', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce([
          { ...mockSetting, value: { enabled: true, message: 'Under maintenance' } },
        ]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.updateSetting('maintenance_mode', {
            enabled: true,
            message: 'Under maintenance',
          });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/settings/maintenance_mode', {
          value: { enabled: true, message: 'Under maintenance' },
        });
      });

      it('handles errors during setting update', async () => {
        const error = new Error('Update failed');
        vi.mocked(api.api.patch).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          try {
            await result.current.updateSetting('test_key', { value: true });
          } catch (e) {
            // Expected to throw
          }
        });

        expect(result.current.error).toBe('Update failed');
      });
    });
  });

  // ========================================================================
  // Provider Management
  // ========================================================================

  describe('Provider Management', () => {
    describe('fetchProviders', () => {
      it('fetches providers with disabled included', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockProvider]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchProviders();
        });

        expect(api.api.get).toHaveBeenCalledWith(
          '/api/admin/settings/providers?include_disabled=true'
        );
        expect(result.current.providers).toEqual([mockProvider]);
      });

      it('fetches only enabled providers', async () => {
        vi.mocked(api.api.get).mockResolvedValueOnce([mockProvider]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchProviders(false);
        });

        expect(api.api.get).toHaveBeenCalledWith(
          '/api/admin/settings/providers?include_disabled=false'
        );
      });
    });

    describe('updateProvider', () => {
      it('updates provider', async () => {
        vi.mocked(api.api.patch).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce([mockProvider]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.updateProvider('anthropic', { is_enabled: false });
        });

        expect(api.api.patch).toHaveBeenCalledWith('/api/admin/settings/providers/anthropic', {
          is_enabled: false,
        });
      });
    });

    describe('createProvider', () => {
      it('creates new provider', async () => {
        const newProvider = { ...mockProvider, slug: 'openai', name: 'OpenAI' };
        vi.mocked(api.api.post).mockResolvedValueOnce(newProvider);
        vi.mocked(api.api.get).mockResolvedValueOnce([mockProvider, newProvider]);
        const { result } = renderHook(() => useAdminStore());

        let created: AdminLLMProvider | undefined;
        await act(async () => {
          created = await result.current.createProvider({
            slug: 'openai',
            name: 'OpenAI',
            description: 'OpenAI GPT models',
            icon: 'openai',
            color: '#10A37F',
            is_local: false,
            default_url: null,
            docs_url: 'https://platform.openai.com/docs',
            setup_guide_url: null,
            requires_api_key: true,
            supports_streaming: true,
            supports_tools: true,
            supports_vision: true,
            is_enabled: true,
            sort_order: 2,
          });
        });

        expect(api.api.post).toHaveBeenCalledWith(
          '/api/admin/settings/providers',
          expect.any(Object)
        );
        expect(created).toEqual(newProvider);
      });
    });

    describe('deleteProvider', () => {
      it('deletes provider', async () => {
        vi.mocked(api.api.delete).mockResolvedValueOnce({});
        vi.mocked(api.api.get).mockResolvedValueOnce([]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.deleteProvider('anthropic');
        });

        expect(api.api.delete).toHaveBeenCalledWith('/api/admin/settings/providers/anthropic');
      });
    });
  });

  // ========================================================================
  // MCP Server Management
  // ========================================================================

  describe('MCP Server Management', () => {
    describe('fetchMCPServers', () => {
      it('fetches MCP servers', async () => {
        vi.mocked(api.listAdminMCPServers).mockResolvedValueOnce([mockMCPServer]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchMCPServers();
        });

        expect(api.listAdminMCPServers).toHaveBeenCalled();
        expect(result.current.mcpServers).toEqual([mockMCPServer]);
      });

      it('handles errors during MCP server fetch', async () => {
        const error = new Error('MCP fetch failed');
        vi.mocked(api.listAdminMCPServers).mockRejectedValueOnce(error);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.fetchMCPServers();
        });

        expect(result.current.error).toBe('MCP fetch failed');
      });
    });

    describe('createMCPServer', () => {
      it('creates new MCP server', async () => {
        const newServer = { ...mockMCPServer, id: 'mcp-2', slug: 'gitlab' };
        vi.mocked(api.createAdminMCPServer).mockResolvedValueOnce(newServer);
        vi.mocked(api.listAdminMCPServers).mockResolvedValueOnce([mockMCPServer, newServer]);
        const { result } = renderHook(() => useAdminStore());

        let created: AdminDefaultMCPServer | undefined;
        await act(async () => {
          created = await result.current.createMCPServer({
            name: 'GitLab',
            slug: 'gitlab',
            description: 'GitLab integration',
            category: 'development',
            command: 'npx',
            args: ['@modelcontextprotocol/server-gitlab'],
            env_vars: {},
            is_enabled: true,
            is_official: true,
            sort_order: 2,
            icon: 'gitlab',
          });
        });

        expect(api.createAdminMCPServer).toHaveBeenCalledWith(expect.any(Object));
        expect(created).toEqual(newServer);
      });
    });

    describe('updateMCPServer', () => {
      it('updates MCP server', async () => {
        vi.mocked(api.updateAdminMCPServer).mockResolvedValueOnce(undefined);
        vi.mocked(api.listAdminMCPServers).mockResolvedValueOnce([mockMCPServer]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.updateMCPServer('mcp-1', { is_enabled: false });
        });

        expect(api.updateAdminMCPServer).toHaveBeenCalledWith('mcp-1', { is_enabled: false });
      });
    });

    describe('deleteMCPServer', () => {
      it('deletes MCP server', async () => {
        vi.mocked(api.deleteAdminMCPServer).mockResolvedValueOnce(undefined);
        vi.mocked(api.listAdminMCPServers).mockResolvedValueOnce([]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.deleteMCPServer('mcp-1');
        });

        expect(api.deleteAdminMCPServer).toHaveBeenCalledWith('mcp-1');
      });
    });

    describe('toggleMCPServer', () => {
      it('toggles MCP server enabled state', async () => {
        vi.mocked(api.toggleAdminMCPServer).mockResolvedValueOnce(undefined);
        vi.mocked(api.listAdminMCPServers).mockResolvedValueOnce([
          { ...mockMCPServer, is_enabled: false },
        ]);
        const { result } = renderHook(() => useAdminStore());

        await act(async () => {
          await result.current.toggleMCPServer('mcp-1');
        });

        expect(api.toggleAdminMCPServer).toHaveBeenCalledWith('mcp-1');
      });
    });
  });

  // ========================================================================
  // Error Management
  // ========================================================================

  describe('Error Management', () => {
    it('clears error', () => {
      const { result } = renderHook(() => useAdminStore());

      act(() => {
        useAdminStore.setState({ error: 'Test error' });
      });

      expect(result.current.error).toBe('Test error');

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it('sets error on API failure', async () => {
      const error = new Error('API Error');
      vi.mocked(api.api.get).mockRejectedValueOnce(error);
      const { result } = renderHook(() => useAdminStore());

      await act(async () => {
        await result.current.fetchDashboard();
      });

      expect(result.current.error).toBe('API Error');
    });
  });

  // ========================================================================
  // Loading States
  // ========================================================================

  describe('Loading States', () => {
    it('sets dashboardLoading during dashboard fetch', async () => {
      let resolvePromise: (value: DashboardOverview) => void;
      const promise = new Promise<DashboardOverview>((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(api.api.get).mockReturnValueOnce(promise);
      const { result } = renderHook(() => useAdminStore());

      // Start the fetch but don't await yet
      let fetchPromise: Promise<void>;
      act(() => {
        fetchPromise = result.current.fetchDashboard();
      });

      // Check loading state is true
      expect(result.current.dashboardLoading).toBe(true);

      // Resolve the promise and wait for completion
      await act(async () => {
        resolvePromise!(mockDashboard);
        await fetchPromise!;
      });

      expect(result.current.dashboardLoading).toBe(false);
    });

    it('sets usersLoading during user fetch', async () => {
      let resolvePromise: (value: { items: AdminUser[]; total: number }) => void;
      const promise = new Promise<{ items: AdminUser[]; total: number }>((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(api.api.get).mockReturnValueOnce(promise);
      const { result } = renderHook(() => useAdminStore());

      // Start the fetch but don't await yet
      let fetchPromise: Promise<void>;
      act(() => {
        fetchPromise = result.current.fetchUsers();
      });

      // Check loading state is true
      expect(result.current.usersLoading).toBe(true);

      // Resolve the promise and wait for completion
      await act(async () => {
        resolvePromise!({ items: [], total: 0 });
        await fetchPromise!;
      });

      expect(result.current.usersLoading).toBe(false);
    });

    it('sets analyticsLoading during analytics fetch', async () => {
      let resolvePromise: (value: RevenueMetrics) => void;
      const promise = new Promise<RevenueMetrics>((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(api.api.get).mockReturnValueOnce(promise);
      const { result } = renderHook(() => useAdminStore());

      // Start the fetch but don't await yet
      let fetchPromise: Promise<void>;
      act(() => {
        fetchPromise = result.current.fetchRevenueMetrics();
      });

      // Check loading state is true
      expect(result.current.analyticsLoading).toBe(true);

      // Resolve the promise and wait for completion
      await act(async () => {
        resolvePromise!(mockRevenueMetrics);
        await fetchPromise!;
      });

      expect(result.current.analyticsLoading).toBe(false);
    });

    it('sets plansLoading during plan fetch', async () => {
      let resolvePromise: (value: AdminPlan[]) => void;
      const promise = new Promise<AdminPlan[]>((resolve) => {
        resolvePromise = resolve;
      });
      vi.mocked(api.api.get).mockReturnValueOnce(promise);
      const { result } = renderHook(() => useAdminStore());

      // Start the fetch but don't await yet
      let fetchPromise: Promise<void>;
      act(() => {
        fetchPromise = result.current.fetchPlans();
      });

      // Check loading state is true
      expect(result.current.plansLoading).toBe(true);

      // Resolve the promise and wait for completion
      await act(async () => {
        resolvePromise!([]);
        await fetchPromise!;
      });

      expect(result.current.plansLoading).toBe(false);
    });
  });
});
