/**
 * Admin store for managing admin panel state and data.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  api,
  listAdminMCPServers,
  createAdminMCPServer,
  updateAdminMCPServer,
  deleteAdminMCPServer,
  toggleAdminMCPServer,
  getServerWorkspaces,
  type AdminDefaultMCPServer,
  type CreateAdminMCPServerRequest,
  type UpdateAdminMCPServerRequest,
  type ServerWorkspaceInfo,
} from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export interface DashboardOverview {
  total_users: number;
  active_users_30d: number;
  new_users_30d: number;
  user_growth_percent: number;
  total_sessions: number;
  active_sessions: number;
  sessions_today: number;
  mrr_cents: number;
  arr_cents: number;
  mrr_growth_percent: number;
  total_tokens_30d: number;
  total_compute_hours_30d: number;
  total_storage_gb: number;
  paying_customers: number;
  conversion_rate: number;
  churn_rate_30d: number;
}

export interface RevenueMetrics {
  mrr_cents: number;
  arr_cents: number;
  mrr_previous_cents: number;
  mrr_growth_percent: number;
  subscription_revenue_cents: number;
  credit_revenue_cents: number;
  overage_revenue_cents: number;
  revenue_by_plan: Array<{
    plan: string;
    slug: string;
    subscribers: number;
    mrr_cents: number;
  }>;
  nrr_percent: number;
  arpu_cents: number;
  ltv_cents: number;
}

export interface UsageMetrics {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  tokens_by_model: Array<{ model: string; tokens: number }>;
  tokens_by_provider: Array<{ provider: string; tokens: number }>;
  total_compute_hours: number;
  compute_by_tier: Array<{ tier: string; minutes: number }>;
  total_storage_gb: number;
  daily_usage: Array<{ date: string; tokens: number }>;
}

export interface CostMetrics {
  gross_revenue_cents: number;
  llm_cost_cents: number;
  compute_cost_cents: number;
  storage_cost_cents: number;
  total_cost_cents: number;
  gross_margin_percent: number;
  llm_margin_percent: number;
  compute_margin_percent: number;
  cost_breakdown: Array<{ category: string; amount_cents: number }>;
  revenue_breakdown: Array<{ category: string; amount_cents: number }>;
}

export interface UserGrowthMetrics {
  daily_signups: Array<{ date: string; signups: number }>;
  total_signups_30d: number;
  signup_growth_percent: number;
  day_1_retention: number;
  day_7_retention: number;
  day_30_retention: number;
  churned_users_30d: number;
  churn_rate: number;
  activation_rate: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  oauth_provider: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  session_count: number;
  subscription_status: string | null;
  subscription_plan: string | null;
  credit_balance_cents: number;
  is_sponsored: boolean;
  sponsored_by_name: string | null;
}

export interface UserUsage {
  user_id: string;
  tokens_used: number;
  tokens_limit: number;
  compute_cents_used: number;
  compute_cents_limit: number;
  storage_gb_used: number;
  storage_gb_limit: number;
  quotas: Array<{
    quota_type: string;
    current_usage: number;
    limit_value: number;
    usage_percent: number;
    warning_sent: boolean;
    overage_allowed: boolean;
  }>;
  credit_balance_cents: number;
  total_bonus_cents: number;
}

export interface AwardCreditsResponse {
  transaction_id: string;
  amount_cents: number;
  new_balance_cents: number;
  expires_at: string | null;
}

export interface AdminPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly_cents: number;
  price_yearly_cents: number;
  currency: string;
  tokens_included: number;
  compute_credits_cents_included: number;
  storage_gb_included: number;
  max_agents: number;
  max_sessions: number;
  max_team_members: number;
  overage_token_rate_cents: number | null;
  overage_compute_rate_cents: number | null;
  overage_storage_rate_cents: number | null;
  overage_allowed: boolean;
  llm_margin_percent: number;
  compute_margin_percent: number;
  features: Record<string, boolean>;
  is_active: boolean;
  is_popular: boolean;
  is_enterprise: boolean;
  sort_order: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  stripe_product_id: string | null;
  created_at: string;
  updated_at: string;
  subscriber_count: number;
}

export interface AdminHardwareSpec {
  id: string;
  tier: string;
  display_name: string;
  description: string | null;
  architecture: string;
  vcpu: number;
  memory_mb: number;
  gpu_type: string | null;
  gpu_memory_gb: number | null;
  gpu_count: number;
  storage_gb: number;
  bandwidth_mbps: number | null;
  hourly_rate_cents: number;
  is_available: boolean;
  requires_subscription: string | null;
  created_at: string;
  updated_at: string;
  active_session_count: number;
  total_usage_hours: number;
}

export interface AdminTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null;
  base_image: string;
  pre_install_commands: string[] | null;
  environment_variables: Record<string, string> | null;
  default_ports: Array<{ port: number; name: string; protocol: string }> | null;
  packages: string[] | null;
  language_versions: Record<string, string> | null;
  is_public: boolean;
  is_official: boolean;
  owner_id: string | null;
  owner_email: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
  active_session_count: number;
}

export interface PlatformSetting {
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  category: string;
  is_public: boolean;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminLLMProvider {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  logo_url: string | null;
  is_local: boolean;
  default_url: string | null;
  docs_url: string | null;
  setup_guide_url: string | null;
  requires_api_key: boolean;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AdminWorkspaceServer {
  id: string;
  name: string;
  hostname: string;
  ip_address: string;
  docker_port: number;
  status: 'active' | 'draining' | 'maintenance' | 'offline' | 'error';
  total_cpu: number;
  total_memory_mb: number;
  total_disk_gb: number;
  total_bandwidth_mbps: number;
  used_cpu: number;
  used_memory_mb: number;
  used_disk_gb: number;
  used_bandwidth_mbps: number;
  available_cpu: number;
  available_memory_mb: number;
  available_disk_gb: number;
  available_bandwidth_mbps: number;
  active_workspaces: number;
  max_workspaces: number;
  architecture: string;
  region: string | null;
  labels: Record<string, string>;
  has_gpu: boolean;
  gpu_type: string | null;
  gpu_count: number;
  // TLS configuration for Docker API connection
  tls_enabled: boolean;
  tls_cert_path: string | null;
  tls_key_path: string | null;
  tls_ca_path: string | null;
  // Docker workspace images
  workspace_image: string;
  workspace_image_arm64: string | null;
  workspace_image_amd64: string | null;
  workspace_image_gpu: string | null;
  // Compute service URL for multi-region routing
  compute_service_url: string;
  created_at: string;
  last_heartbeat: string | null;
  is_healthy: boolean;
  bandwidth_utilization: number;
}

export interface ClusterStatus {
  total_servers: number;
  active_servers: number;
  healthy_servers: number;
  total_cpu: number;
  used_cpu: number;
  cpu_utilization: number;
  total_memory_mb: number;
  used_memory_mb: number;
  memory_utilization: number;
  total_workspaces: number;
  servers: Array<{
    server_id: string;
    status: string;
    is_healthy: boolean;
    last_heartbeat: string | null;
    cpu_utilization: number;
    memory_utilization: number;
    disk_utilization: number;
    bandwidth_utilization: number;
    active_workspaces: number;
  }>;
}

export interface CreateServerRequest {
  name: string;
  hostname: string;
  ip_address: string;
  docker_port?: number;
  total_cpu: number;
  total_memory_mb: number;
  total_disk_gb: number;
  total_bandwidth_mbps?: number;
  architecture?: string;
  region?: string;
  labels?: Record<string, string>;
  has_gpu?: boolean;
  gpu_type?: string;
  gpu_count?: number;
  // TLS configuration for Docker API connection
  tls_enabled?: boolean;
  tls_cert_path?: string;
  tls_key_path?: string;
  tls_ca_path?: string;
  // Docker workspace images
  workspace_image?: string;
  workspace_image_arm64?: string;
  workspace_image_amd64?: string;
  workspace_image_gpu?: string;
  // Compute service URL for multi-region routing
  compute_service_url?: string;
}

export interface TestServerConnectionRequest {
  ip_address: string;
  docker_port: number;
  tls_enabled: boolean;
  tls_cert_path?: string;
  tls_key_path?: string;
  tls_ca_path?: string;
}

export interface TestServerConnectionResponse {
  success: boolean;
  message: string;
  docker_info?: {
    server_version?: string;
    os?: string;
    architecture?: string;
    containers?: number;
    images?: number;
    memory_total?: number;
    cpus?: number;
  };
  error?: string;
}

export interface DockerImageInfo {
  id: string;
  tags: string[];
  size_mb: number;
  created: string | null;
}

export interface ServerImagesResponse {
  server_id: string;
  images: DockerImageInfo[];
  total_count: number;
  configured_image: string;
  configured_image_arm64: string | null;
  configured_image_amd64: string | null;
  configured_image_gpu: string | null;
}

export interface PullImageResponse {
  success: boolean;
  message: string;
  image: string;
  server_id: string;
}

// ============================================================================
// State
// ============================================================================

interface AdminState {
  // Dashboard
  dashboard: DashboardOverview | null;
  dashboardLoading: boolean;

  // Analytics
  revenueMetrics: RevenueMetrics | null;
  usageMetrics: UsageMetrics | null;
  costMetrics: CostMetrics | null;
  userGrowthMetrics: UserGrowthMetrics | null;
  analyticsLoading: boolean;

  // Users
  users: AdminUser[];
  usersTotal: number;
  usersLoading: boolean;

  // Plans
  plans: AdminPlan[];
  plansLoading: boolean;

  // Hardware
  hardwareSpecs: AdminHardwareSpec[];
  hardwareLoading: boolean;

  // Templates
  templates: AdminTemplate[];
  templatesTotal: number;
  templatesLoading: boolean;

  // Settings
  settings: PlatformSetting[];
  settingsLoading: boolean;

  // LLM Providers
  providers: AdminLLMProvider[];
  providersLoading: boolean;

  // MCP Servers (Default Catalog)
  mcpServers: AdminDefaultMCPServer[];
  mcpServersLoading: boolean;

  // Workspace Servers (Compute Infrastructure)
  workspaceServers: AdminWorkspaceServer[];
  workspaceServersLoading: boolean;
  clusterStatus: ClusterStatus | null;
  clusterStatusLoading: boolean;
  // Per-server workspace details (keyed by server ID)
  serverWorkspaces: Record<string, ServerWorkspaceInfo[]>;
  serverWorkspacesLoading: Record<string, boolean>;
  // Per-server Docker images (keyed by server ID)
  serverImages: Record<string, ServerImagesResponse>;
  serverImagesLoading: Record<string, boolean>;
  imagePullLoading: Record<string, boolean>;

  // Error
  error: string | null;

  // Actions
  fetchDashboard: () => Promise<void>;
  fetchRevenueMetrics: (days?: number) => Promise<void>;
  fetchUsageMetrics: (days?: number) => Promise<void>;
  fetchCostMetrics: (days?: number) => Promise<void>;
  fetchUserGrowthMetrics: (days?: number) => Promise<void>;
  fetchUsers: (page?: number, pageSize?: number, filters?: Record<string, string>) => Promise<void>;
  fetchPlans: (includeInactive?: boolean) => Promise<void>;
  fetchHardwareSpecs: (includeUnavailable?: boolean) => Promise<void>;
  fetchTemplates: (
    page?: number,
    pageSize?: number,
    filters?: Record<string, string | boolean | null>
  ) => Promise<void>;
  fetchSettings: (category?: string) => Promise<void>;
  updateUser: (userId: string, data: Partial<AdminUser>) => Promise<void>;
  updatePlan: (planId: string, data: Partial<AdminPlan>) => Promise<void>;
  createPlan: (
    data: Omit<AdminPlan, 'id' | 'created_at' | 'updated_at' | 'subscriber_count'>
  ) => Promise<AdminPlan>;
  updateHardwareSpec: (specId: string, data: Partial<AdminHardwareSpec>) => Promise<void>;
  createHardwareSpec: (
    data: Omit<
      AdminHardwareSpec,
      'id' | 'created_at' | 'updated_at' | 'active_session_count' | 'total_usage_hours'
    >
  ) => Promise<AdminHardwareSpec>;
  updateTemplate: (templateId: string, data: Partial<AdminTemplate>) => Promise<void>;
  createTemplate: (
    data: Omit<
      AdminTemplate,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'usage_count'
      | 'active_session_count'
      | 'icon_url'
      | 'owner_id'
      | 'owner_email'
    >
  ) => Promise<AdminTemplate>;
  deleteTemplate: (templateId: string) => Promise<void>;
  updateSetting: (key: string, value: Record<string, unknown>) => Promise<void>;
  fetchProviders: (includeDisabled?: boolean) => Promise<void>;
  updateProvider: (slug: string, data: Partial<AdminLLMProvider>) => Promise<void>;
  createProvider: (
    data: Omit<AdminLLMProvider, 'created_at' | 'updated_at' | 'logo_url'>
  ) => Promise<AdminLLMProvider>;
  deleteProvider: (slug: string) => Promise<void>;
  // MCP Servers (Default Catalog)
  fetchMCPServers: () => Promise<void>;
  createMCPServer: (data: CreateAdminMCPServerRequest) => Promise<AdminDefaultMCPServer>;
  updateMCPServer: (serverId: string, data: UpdateAdminMCPServerRequest) => Promise<void>;
  deleteMCPServer: (serverId: string) => Promise<void>;
  toggleMCPServer: (serverId: string) => Promise<void>;
  // User sponsorship and credits actions
  sponsorUser: (userId: string, planId: string, reason?: string) => Promise<void>;
  removeSponsor: (userId: string) => Promise<void>;
  fetchUserUsage: (userId: string) => Promise<UserUsage>;
  awardCredits: (
    userId: string,
    amountCents: number,
    reason: string
  ) => Promise<AwardCreditsResponse>;
  // Workspace Servers (Compute Infrastructure)
  fetchWorkspaceServers: (status?: string, region?: string) => Promise<void>;
  fetchClusterStatus: () => Promise<void>;
  createWorkspaceServer: (data: CreateServerRequest) => Promise<AdminWorkspaceServer>;
  updateWorkspaceServer: (serverId: string, data: Partial<AdminWorkspaceServer>) => Promise<void>;
  deleteWorkspaceServer: (serverId: string, force?: boolean) => Promise<void>;
  drainWorkspaceServer: (serverId: string) => Promise<void>;
  activateWorkspaceServer: (serverId: string) => Promise<void>;
  fetchServerWorkspaces: (serverId: string) => Promise<ServerWorkspaceInfo[]>;
  testServerConnection: (
    data: TestServerConnectionRequest
  ) => Promise<TestServerConnectionResponse>;
  // Docker image management
  fetchServerImages: (serverId: string) => Promise<ServerImagesResponse>;
  pullServerImage: (serverId: string, image: string, tag?: string) => Promise<PullImageResponse>;
  clearError: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useAdminStore = create<AdminState>()(
  devtools(
    (set, get) => ({
      // Initial state
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
      workspaceServers: [],
      workspaceServersLoading: false,
      clusterStatus: null,
      clusterStatusLoading: false,
      serverWorkspaces: {},
      serverWorkspacesLoading: {},
      serverImages: {},
      serverImagesLoading: {},
      imagePullLoading: {},
      error: null,

      // Actions
      fetchDashboard: async () => {
        set({ dashboardLoading: true, error: null });
        try {
          const data = await api.get<DashboardOverview>('/api/admin/analytics/dashboard');
          set({ dashboard: data, dashboardLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, dashboardLoading: false });
        }
      },

      fetchRevenueMetrics: async (days = 30) => {
        set({ analyticsLoading: true, error: null });
        try {
          const data = await api.get<RevenueMetrics>(`/api/admin/analytics/revenue?days=${days}`);
          set({ revenueMetrics: data, analyticsLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, analyticsLoading: false });
        }
      },

      fetchUsageMetrics: async (days = 30) => {
        set({ analyticsLoading: true, error: null });
        try {
          const data = await api.get<UsageMetrics>(`/api/admin/analytics/usage?days=${days}`);
          set({ usageMetrics: data, analyticsLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, analyticsLoading: false });
        }
      },

      fetchCostMetrics: async (days = 30) => {
        set({ analyticsLoading: true, error: null });
        try {
          const data = await api.get<CostMetrics>(`/api/admin/analytics/costs?days=${days}`);
          set({ costMetrics: data, analyticsLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, analyticsLoading: false });
        }
      },

      fetchUserGrowthMetrics: async (days = 30) => {
        set({ analyticsLoading: true, error: null });
        try {
          const data = await api.get<UserGrowthMetrics>(
            `/api/admin/analytics/users/growth?days=${days}`
          );
          set({ userGrowthMetrics: data, analyticsLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, analyticsLoading: false });
        }
      },

      fetchUsers: async (page = 1, pageSize = 50, filters = {}) => {
        set({ usersLoading: true, error: null });
        try {
          const params = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
            ...filters,
          });
          const data = await api.get<{ items: AdminUser[]; total: number }>(
            `/api/admin/users?${params.toString()}`
          );
          set({ users: data.items, usersTotal: data.total, usersLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, usersLoading: false });
        }
      },

      fetchPlans: async (includeInactive = true) => {
        set({ plansLoading: true, error: null });
        try {
          const data = await api.get<AdminPlan[]>(
            `/api/admin/plans?include_inactive=${includeInactive}`
          );
          set({ plans: data, plansLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, plansLoading: false });
        }
      },

      fetchHardwareSpecs: async (includeUnavailable = true) => {
        set({ hardwareLoading: true, error: null });
        try {
          const data = await api.get<AdminHardwareSpec[]>(
            `/api/admin/hardware?include_unavailable=${includeUnavailable}`
          );
          set({ hardwareSpecs: data, hardwareLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, hardwareLoading: false });
        }
      },

      fetchTemplates: async (page = 1, pageSize = 50, filters = {}) => {
        set({ templatesLoading: true, error: null });
        try {
          const params = new URLSearchParams({
            page: String(page),
            page_size: String(pageSize),
          });
          Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              params.set(key, String(value));
            }
          });
          const data = await api.get<{ items: AdminTemplate[]; total: number }>(
            `/api/admin/templates?${params.toString()}`
          );
          set({ templates: data.items, templatesTotal: data.total, templatesLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, templatesLoading: false });
        }
      },

      fetchSettings: async (category?: string) => {
        set({ settingsLoading: true, error: null });
        try {
          const path = category
            ? `/api/admin/settings?category=${category}`
            : '/api/admin/settings';
          const data = await api.get<PlatformSetting[]>(path);
          set({ settings: data, settingsLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, settingsLoading: false });
        }
      },

      updateUser: async (userId: string, data: Partial<AdminUser>) => {
        // Optimistic update - update local state first for instant UI feedback
        const previousUsers = get().users;
        const optimisticUsers = previousUsers.map((user) =>
          user.id === userId ? { ...user, ...data } : user
        );
        set({ error: null, users: optimisticUsers });

        try {
          await api.patch(`/api/admin/users/${userId}`, data);
          // Optionally refresh to ensure consistency (can be skipped for performance)
          // await get().fetchUsers();
        } catch (err) {
          // Rollback on error
          set({ error: (err as Error).message, users: previousUsers });
          throw err;
        }
      },

      updatePlan: async (planId: string, data: Partial<AdminPlan>) => {
        // Optimistic update - update local state first for instant UI feedback
        const previousPlans = get().plans;
        const optimisticPlans = previousPlans.map((plan) =>
          plan.id === planId ? { ...plan, ...data } : plan
        );
        set({ error: null, plans: optimisticPlans });

        try {
          await api.patch(`/api/admin/plans/${planId}`, data);
          // Optionally refresh to ensure consistency (can be skipped for performance)
          // await get().fetchPlans();
        } catch (err) {
          // Rollback on error
          set({ error: (err as Error).message, plans: previousPlans });
          throw err;
        }
      },

      createPlan: async (data) => {
        set({ error: null });
        try {
          const result = await api.post<AdminPlan>('/api/admin/plans', data);
          await get().fetchPlans();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      updateHardwareSpec: async (specId: string, data: Partial<AdminHardwareSpec>) => {
        set({ error: null });
        try {
          await api.patch(`/api/admin/hardware/${specId}`, data);
          await get().fetchHardwareSpecs();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      createHardwareSpec: async (data) => {
        set({ error: null });
        try {
          const result = await api.post<AdminHardwareSpec>('/api/admin/hardware', data);
          await get().fetchHardwareSpecs();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      updateTemplate: async (templateId: string, data: Partial<AdminTemplate>) => {
        set({ error: null });
        try {
          await api.patch(`/api/admin/templates/${templateId}`, data);
          await get().fetchTemplates();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      createTemplate: async (data) => {
        set({ error: null });
        try {
          const result = await api.post<AdminTemplate>('/api/admin/templates', data);
          await get().fetchTemplates();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      deleteTemplate: async (templateId: string) => {
        set({ error: null });
        try {
          await api.delete(`/api/admin/templates/${templateId}`);
          await get().fetchTemplates();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      updateSetting: async (key: string, value: Record<string, unknown>) => {
        set({ error: null });
        try {
          await api.patch(`/api/admin/settings/${key}`, { value });
          await get().fetchSettings();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      fetchProviders: async (includeDisabled = true) => {
        set({ providersLoading: true, error: null });
        try {
          const providers = await api.get<AdminLLMProvider[]>(
            `/api/admin/settings/providers?include_disabled=${includeDisabled}`
          );
          set({ providers, providersLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, providersLoading: false });
        }
      },

      updateProvider: async (slug: string, data: Partial<AdminLLMProvider>) => {
        set({ error: null });
        try {
          await api.patch(`/api/admin/settings/providers/${slug}`, data);
          await get().fetchProviders();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      createProvider: async (data) => {
        set({ error: null });
        try {
          const result = await api.post<AdminLLMProvider>('/api/admin/settings/providers', data);
          await get().fetchProviders();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      deleteProvider: async (slug: string) => {
        set({ error: null });
        try {
          await api.delete(`/api/admin/settings/providers/${slug}`);
          await get().fetchProviders();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      // MCP Servers (Default Catalog)
      fetchMCPServers: async () => {
        set({ mcpServersLoading: true, error: null });
        try {
          const servers = await listAdminMCPServers();
          set({ mcpServers: servers, mcpServersLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, mcpServersLoading: false });
        }
      },

      createMCPServer: async (data: CreateAdminMCPServerRequest) => {
        set({ error: null });
        try {
          const result = await createAdminMCPServer(data);
          await get().fetchMCPServers();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      updateMCPServer: async (serverId: string, data: UpdateAdminMCPServerRequest) => {
        set({ error: null });
        try {
          await updateAdminMCPServer(serverId, data);
          await get().fetchMCPServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      deleteMCPServer: async (serverId: string) => {
        set({ error: null });
        try {
          await deleteAdminMCPServer(serverId);
          await get().fetchMCPServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      toggleMCPServer: async (serverId: string) => {
        set({ error: null });
        try {
          await toggleAdminMCPServer(serverId);
          await get().fetchMCPServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      // Workspace Servers (Compute Infrastructure)
      fetchWorkspaceServers: async (status?: string, region?: string) => {
        set({ workspaceServersLoading: true, error: null });
        try {
          const params = new URLSearchParams();
          if (status) params.set('status', status);
          if (region) params.set('region', region);
          const queryString = params.toString();
          const path = queryString ? `/api/servers?${queryString}` : '/api/servers';
          const servers = await api.get<AdminWorkspaceServer[]>(path);
          set({ workspaceServers: servers, workspaceServersLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, workspaceServersLoading: false });
        }
      },

      fetchClusterStatus: async () => {
        set({ clusterStatusLoading: true, error: null });
        try {
          const status = await api.get<ClusterStatus>('/api/servers/cluster/status');
          set({ clusterStatus: status, clusterStatusLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, clusterStatusLoading: false });
        }
      },

      createWorkspaceServer: async (data: CreateServerRequest) => {
        set({ error: null });
        try {
          const result = await api.post<AdminWorkspaceServer>('/api/servers', data);
          await get().fetchWorkspaceServers();
          await get().fetchClusterStatus();
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      updateWorkspaceServer: async (serverId: string, data: Partial<AdminWorkspaceServer>) => {
        set({ error: null });
        try {
          await api.patch(`/api/servers/${serverId}`, data);
          await get().fetchWorkspaceServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      deleteWorkspaceServer: async (serverId: string, force = false) => {
        set({ error: null });
        try {
          await api.delete(`/api/servers/${serverId}?force=${force}`);
          await get().fetchWorkspaceServers();
          await get().fetchClusterStatus();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      drainWorkspaceServer: async (serverId: string) => {
        set({ error: null });
        try {
          await api.post(`/api/servers/${serverId}/drain`, {});
          await get().fetchWorkspaceServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      activateWorkspaceServer: async (serverId: string) => {
        set({ error: null });
        try {
          await api.post(`/api/servers/${serverId}/activate`, {});
          await get().fetchWorkspaceServers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      fetchServerWorkspaces: async (serverId: string) => {
        // Set loading state for this specific server
        set((state) => ({
          serverWorkspacesLoading: { ...state.serverWorkspacesLoading, [serverId]: true },
          error: null,
        }));
        try {
          const response = await getServerWorkspaces(serverId);
          set((state) => ({
            serverWorkspaces: { ...state.serverWorkspaces, [serverId]: response.workspaces },
            serverWorkspacesLoading: { ...state.serverWorkspacesLoading, [serverId]: false },
          }));
          return response.workspaces;
        } catch (err) {
          set((state) => ({
            error: (err as Error).message,
            serverWorkspacesLoading: { ...state.serverWorkspacesLoading, [serverId]: false },
          }));
          throw err;
        }
      },

      testServerConnection: async (
        data: TestServerConnectionRequest
      ): Promise<TestServerConnectionResponse> => {
        set({ error: null });
        try {
          const result = await api.post<TestServerConnectionResponse>(
            '/api/servers/test-connection',
            data
          );
          return result;
        } catch (err) {
          const errorMessage = (err as Error).message;
          set({ error: errorMessage });
          return {
            success: false,
            message: 'Connection test failed',
            error: errorMessage,
          };
        }
      },

      // Docker image management
      fetchServerImages: async (serverId: string): Promise<ServerImagesResponse> => {
        set((state) => ({
          serverImagesLoading: { ...state.serverImagesLoading, [serverId]: true },
          error: null,
        }));
        try {
          const response = await api.get<ServerImagesResponse>(`/api/servers/${serverId}/images`);
          set((state) => ({
            serverImages: { ...state.serverImages, [serverId]: response },
            serverImagesLoading: { ...state.serverImagesLoading, [serverId]: false },
          }));
          return response;
        } catch (err) {
          set((state) => ({
            error: (err as Error).message,
            serverImagesLoading: { ...state.serverImagesLoading, [serverId]: false },
          }));
          throw err;
        }
      },

      pullServerImage: async (
        serverId: string,
        image: string,
        tag: string = 'latest'
      ): Promise<PullImageResponse> => {
        set((state) => ({
          imagePullLoading: { ...state.imagePullLoading, [serverId]: true },
          error: null,
        }));
        try {
          const response = await api.post<PullImageResponse>(
            `/api/servers/${serverId}/images/pull`,
            { image, tag }
          );
          set((state) => ({
            imagePullLoading: { ...state.imagePullLoading, [serverId]: false },
          }));
          // Refresh images after pull
          await get().fetchServerImages(serverId);
          return response;
        } catch (err) {
          set((state) => ({
            error: (err as Error).message,
            imagePullLoading: { ...state.imagePullLoading, [serverId]: false },
          }));
          throw err;
        }
      },

      // User sponsorship and credits actions
      sponsorUser: async (userId: string, planId: string, reason?: string) => {
        set({ error: null });
        try {
          await api.post(`/api/admin/users/${userId}/sponsor-subscription`, {
            plan_id: planId,
            reason,
          });
          await get().fetchUsers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      removeSponsor: async (userId: string) => {
        set({ error: null });
        try {
          await api.delete(`/api/admin/users/${userId}/sponsor-subscription`);
          await get().fetchUsers();
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      fetchUserUsage: async (userId: string) => {
        set({ error: null });
        try {
          const data = await api.get<UserUsage>(`/api/admin/users/${userId}/usage`);
          return data;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      awardCredits: async (userId: string, amountCents: number, reason: string) => {
        set({ error: null });
        try {
          const data = await api.post<AwardCreditsResponse>(`/api/admin/users/${userId}/credits`, {
            amount_cents: amountCents,
            reason,
          });
          await get().fetchUsers();
          return data;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      clearError: () => set({ error: null }),
    }),
    { name: 'admin-store' }
  )
);

// Selectors
export const useDashboard = () => useAdminStore((state) => state.dashboard);
export const useDashboardLoading = () => useAdminStore((state) => state.dashboardLoading);
export const useAdminUsers = () => useAdminStore((state) => state.users);
export const useAdminPlans = () => useAdminStore((state) => state.plans);
export const useAdminHardware = () => useAdminStore((state) => state.hardwareSpecs);
export const useAdminTemplates = () => useAdminStore((state) => state.templates);
export const useAdminSettings = () => useAdminStore((state) => state.settings);
export const useAdminProviders = () => useAdminStore((state) => state.providers);
export const useAdminMCPServers = () => useAdminStore((state) => state.mcpServers);
export const useAdminWorkspaceServers = () => useAdminStore((state) => state.workspaceServers);
export const useAdminClusterStatus = () => useAdminStore((state) => state.clusterStatus);
export const useAdminServerWorkspaces = (serverId: string) =>
  useAdminStore((state) => state.serverWorkspaces[serverId] ?? []);
export const useAdminServerWorkspacesLoading = (serverId: string) =>
  useAdminStore((state) => state.serverWorkspacesLoading[serverId] ?? false);
export const useAdminServerImages = (serverId: string) =>
  useAdminStore((state) => state.serverImages[serverId] ?? null);
export const useAdminServerImagesLoading = (serverId: string) =>
  useAdminStore((state) => state.serverImagesLoading[serverId] ?? false);
export const useAdminImagePullLoading = (serverId: string) =>
  useAdminStore((state) => state.imagePullLoading[serverId] ?? false);
export const useAdminError = () => useAdminStore((state) => state.error);
