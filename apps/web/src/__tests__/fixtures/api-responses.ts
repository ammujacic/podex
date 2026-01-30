import type {
  Agent,
  AgentMessage,
  ConversationSession,
  Session,
  User,
  Plan,
  Subscription,
} from '@/stores/sessionTypes';
import type {
  SubscriptionPlan,
  Subscription as BillingSubscription,
  UsageSummary,
  Quota,
  CreditBalance,
  CreditTransaction,
  Invoice,
  HardwareSpec,
  UsageRecord,
} from '@/stores/billing';

// User fixtures
export const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: null,
  role: 'user',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

export const mockAdminUser: User = {
  ...mockUser,
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
};

// Auth tokens
export const mockTokens = {
  accessToken: 'mock_access_token_123',
  refreshToken: 'mock_refresh_token_456',
  expiresAt: Date.now() + 3600000, // 1 hour from now
};

// Agent fixtures
export const mockAgent: Agent = {
  id: 'agent-1',
  name: 'Architect',
  role: 'architect',
  model: 'claude-opus-4-5-20251101',
  status: 'idle' as const,
  color: '#7C3AED',
  conversationSessionId: null,
  position: { x: 0, y: 0, width: 400, height: 600, zIndex: 1 },
  gridSpan: { colSpan: 1, rowSpan: 1 },
  mode: 'ask',
};

export const mockAgentWithConversation: Agent = {
  ...mockAgent,
  id: 'agent-2',
  name: 'Developer',
  role: 'coder',
  conversationSessionId: 'conv-1',
};

// Message fixtures
export const mockUserMessage: AgentMessage = {
  id: 'msg-user-1',
  role: 'user',
  content: 'This is a user message',
  timestamp: new Date(),
};

export const mockAssistantMessage: AgentMessage = {
  id: 'msg-assistant-1',
  role: 'assistant',
  content: 'This is an assistant response',
  timestamp: new Date(),
};

// Conversation Session fixtures
export const mockConversationSession = {
  id: 'conv-1',
  name: 'Test Conversation',
  messages: [
    {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello, can you help me?',
      timestamp: new Date(Date.now() - 60000),
    },
    {
      id: 'msg-2',
      role: 'assistant' as const,
      content: "Of course! I'd be happy to help.",
      timestamp: new Date(Date.now() - 30000),
    },
  ],
  attachedToAgentId: 'agent-2',
  attachedAgentIds: ['agent-2'],
  messageCount: 2,
  lastMessageAt: new Date(Date.now() - 30000).toISOString(),
  createdAt: new Date(Date.now() - 60000).toISOString(),
  updatedAt: new Date(Date.now() - 30000).toISOString(),
};

export const mockEmptyConversationSession = {
  id: 'conv-empty',
  name: 'Empty Conversation',
  messages: [],
  attachedToAgentId: null,
  attachedAgentIds: [],
  messageCount: 0,
  lastMessageAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Session fixtures
export const mockSession: Session = {
  id: 'session-1',
  name: 'Test Session',
  agents: [],
  conversationSessions: [],
  workspaceId: 'workspace-1',
  viewMode: 'grid',
  activeAgentId: null,
  filePreviews: [],
  editorGridCardId: null,
  previewGridCardId: null,
  workspaceStatus: 'stopped',
  workspaceStatusChecking: false,
  workspaceError: null,
  branch: 'main',
};

export const mockSessionWithMultipleAgents: Session = {
  ...mockSession,
  id: 'session-2',
  name: 'Multi-Agent Session',
  agents: [mockAgent, mockAgentWithConversation],
  conversationSessions: [mockConversationSession],
};

// Plan fixtures
export const mockFreePlan: Plan = {
  id: 'plan-free',
  name: 'Free',
  slug: 'free',
  price: 0,
  interval: 'month',
  features: ['10 sessions per month', '1 agent per session', 'Basic models only'],
  limits: {
    maxSessions: 10,
    maxAgents: 1,
    maxTokens: 100000,
  },
};

export const mockProPlan: Plan = {
  id: 'plan-pro',
  name: 'Pro',
  slug: 'pro',
  price: 29,
  interval: 'month',
  features: ['Unlimited sessions', '5 agents per session', 'All models', 'Priority support'],
  limits: {
    maxSessions: -1, // unlimited
    maxAgents: 5,
    maxTokens: 1000000,
  },
};

export const mockEnterprisePlan: Plan = {
  id: 'plan-enterprise',
  name: 'Enterprise',
  slug: 'enterprise',
  price: 99,
  interval: 'month',
  features: [
    'Everything in Pro',
    'Unlimited agents',
    'Custom models',
    'Dedicated support',
    'SLA guarantee',
  ],
  limits: {
    maxSessions: -1,
    maxAgents: -1,
    maxTokens: -1,
  },
};

// Subscription fixtures
export const mockSubscription: Subscription = {
  id: 'sub-1',
  userId: 'user-1',
  planId: 'plan-pro',
  status: 'active',
  currentPeriodStart: '2024-01-01T00:00:00Z',
  currentPeriodEnd: '2024-02-01T00:00:00Z',
  cancelAtPeriodEnd: false,
};

// Workspace fixtures
export const mockWorkspace = {
  id: 'workspace-1',
  name: 'Test Workspace',
  status: 'running' as const,
  containerId: 'container-123',
  createdAt: '2024-01-01T00:00:00Z',
};

// File preview fixtures
export const mockFilePreview = {
  id: 'preview-1',
  path: '/src/components/App.tsx',
  content: 'import React from "react";\n\nfunction App() {\n  return <div>Hello</div>;\n}',
  language: 'typescript',
  isPinned: false,
  isDocked: false,
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
};

// Git fixtures
export const mockGitStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  modified: ['src/App.tsx'],
  added: ['src/NewFile.tsx'],
  deleted: [],
  untracked: ['temp.txt'],
};

// Organization fixtures
export const mockOrganization = {
  id: 'org-1',
  name: 'Test Organization',
  slug: 'test-org',
  ownerId: 'user-1',
  createdAt: '2024-01-01T00:00:00Z',
  settings: {
    allowInvitations: true,
    maxMembers: 10,
  },
};

// Billing fixtures
export const mockUsageSummary = {
  period: 'month',
  tokens: 500000,
  tokensLimit: 1000000,
  cost: 15.5,
  costLimit: 100,
};

export const mockQuota = {
  type: 'tokens',
  used: 500000,
  limit: 1000000,
  percentage: 50,
  status: 'normal' as const,
};

// Error fixtures
export const mockApiError = {
  message: 'An error occurred',
  code: 'API_ERROR',
  status: 500,
};

export const mockBillingError = {
  message: 'Billing limit exceeded',
  code: 'BILLING_ERROR',
  status: 402,
  quotaType: 'tokens',
};

export const mockWorkspaceError = {
  message: 'Workspace not found',
  code: 'WORKSPACE_ERROR',
  status: 404,
};

// Billing Store Fixtures (comprehensive)

// Subscription Plan fixtures
export const mockFreeSubscriptionPlan: SubscriptionPlan = {
  id: 'plan-free',
  name: 'Free',
  slug: 'free',
  description: 'Perfect for getting started',
  priceMonthly: 0,
  priceYearly: 0,
  currency: 'USD',
  tokensIncluded: 100000,
  computeHoursIncluded: 1,
  computeCreditsIncluded: 1,
  storageGbIncluded: 1,
  maxAgents: 1,
  maxSessions: 3,
  maxTeamMembers: 1,
  overageAllowed: false,
  overageTokenRate: 0,
  overageComputeRate: 0,
  overageStorageRate: 0,
  features: {
    basic_models: true,
    gpu_access: false,
    team_collaboration: false,
    planning_mode: false,
    priority_support: false,
  },
  isPopular: false,
  isEnterprise: false,
};

export const mockProSubscriptionPlan: SubscriptionPlan = {
  id: 'plan-pro',
  name: 'Pro',
  slug: 'pro',
  description: 'For professional developers',
  priceMonthly: 29,
  priceYearly: 290,
  currency: 'USD',
  tokensIncluded: 1000000,
  computeHoursIncluded: 10,
  computeCreditsIncluded: 10,
  storageGbIncluded: 10,
  maxAgents: 5,
  maxSessions: 20,
  maxTeamMembers: 5,
  overageAllowed: true,
  overageTokenRate: 0.00002,
  overageComputeRate: 0.5,
  overageStorageRate: 0.1,
  features: {
    basic_models: true,
    advanced_models: true,
    gpu_access: true,
    team_collaboration: true,
    planning_mode: true,
    priority_support: true,
  },
  isPopular: true,
  isEnterprise: false,
};

export const mockEnterpriseSubscriptionPlan: SubscriptionPlan = {
  id: 'plan-enterprise',
  name: 'Enterprise',
  slug: 'enterprise',
  description: 'Custom solutions for teams',
  priceMonthly: 199,
  priceYearly: 1990,
  currency: 'USD',
  tokensIncluded: 10000000,
  computeHoursIncluded: 100,
  computeCreditsIncluded: 100,
  storageGbIncluded: 100,
  maxAgents: -1,
  maxSessions: -1,
  maxTeamMembers: -1,
  overageAllowed: true,
  overageTokenRate: 0.00001,
  overageComputeRate: 0.3,
  overageStorageRate: 0.05,
  features: {
    basic_models: true,
    advanced_models: true,
    gpu_access: true,
    team_collaboration: true,
    planning_mode: true,
    priority_support: true,
    custom_models: true,
    sla: true,
    dedicated_support: true,
  },
  isPopular: false,
  isEnterprise: true,
};

// Billing Subscription fixtures
export const mockActiveSubscription: BillingSubscription = {
  id: 'sub-1',
  userId: 'user-1',
  plan: mockProSubscriptionPlan,
  status: 'active',
  billingCycle: 'monthly',
  currentPeriodStart: '2024-01-01T00:00:00Z',
  currentPeriodEnd: '2024-02-01T00:00:00Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  trialEnd: null,
  createdAt: '2024-01-01T00:00:00Z',
};

export const mockTrialingSubscription: BillingSubscription = {
  ...mockActiveSubscription,
  id: 'sub-2',
  status: 'trialing',
  trialEnd: '2024-01-15T00:00:00Z',
};

export const mockCanceledSubscription: BillingSubscription = {
  ...mockActiveSubscription,
  id: 'sub-3',
  status: 'canceled',
  cancelAtPeriodEnd: true,
  canceledAt: '2024-01-20T00:00:00Z',
};

export const mockPastDueSubscription: BillingSubscription = {
  ...mockActiveSubscription,
  id: 'sub-4',
  status: 'past_due',
};

export const mockSponsoredSubscription: BillingSubscription = {
  ...mockActiveSubscription,
  id: 'sub-5',
  plan: mockEnterpriseSubscriptionPlan,
  is_sponsored: true,
  sponsor_reason: 'Open source contributor',
};

// Usage Summary fixtures
export const mockUsageSummaryDetailed: UsageSummary = {
  periodStart: '2024-01-01T00:00:00Z',
  periodEnd: '2024-02-01T00:00:00Z',
  tokensInput: 250000,
  tokensOutput: 150000,
  tokensTotal: 400000,
  tokensCost: 8.0,
  computeSeconds: 18000,
  computeHours: 5.0,
  computeCreditsUsed: 5.0,
  computeCreditsIncluded: 10.0,
  computeCost: 5.0,
  storageGb: 3.5,
  storageCost: 0.35,
  apiCalls: 1500,
  totalCost: 13.35,
  usageByModel: {
    'claude-opus-4-5': { input: 150000, output: 100000, cost: 6.0 },
    'claude-sonnet-4-5': { input: 100000, output: 50000, cost: 2.0 },
  },
  usageByAgent: {
    'agent-1': { tokens: 200000, cost: 4.5 },
    'agent-2': { tokens: 200000, cost: 3.5 },
  },
  usageByTier: {
    basic: { seconds: 10800, cost: 3.0 },
    gpu: { seconds: 7200, cost: 2.0 },
  },
};

export const mockHighUsageSummary: UsageSummary = {
  ...mockUsageSummaryDetailed,
  tokensTotal: 950000,
  tokensCost: 19.0,
  computeCreditsUsed: 9.5,
  computeCost: 9.5,
  totalCost: 28.85,
};

// Quota fixtures
export const mockTokenQuota: Quota = {
  id: 'quota-1',
  quotaType: 'tokens',
  limitValue: 1000000,
  currentUsage: 400000,
  usagePercentage: 40,
  resetAt: '2024-02-01T00:00:00Z',
  overageAllowed: true,
  isExceeded: false,
  isWarning: false,
};

export const mockTokenQuotaWarning: Quota = {
  ...mockTokenQuota,
  id: 'quota-2',
  currentUsage: 850000,
  usagePercentage: 85,
  isWarning: true,
};

export const mockTokenQuotaExceeded: Quota = {
  ...mockTokenQuota,
  id: 'quota-3',
  currentUsage: 1100000,
  usagePercentage: 110,
  isExceeded: true,
  overageAllowed: false,
};

export const mockComputeQuota: Quota = {
  id: 'quota-4',
  quotaType: 'compute_credits',
  limitValue: 10,
  currentUsage: 5.5,
  usagePercentage: 55,
  resetAt: '2024-02-01T00:00:00Z',
  overageAllowed: true,
  isExceeded: false,
  isWarning: false,
};

export const mockStorageQuota: Quota = {
  id: 'quota-5',
  quotaType: 'storage_gb',
  limitValue: 10,
  currentUsage: 3.5,
  usagePercentage: 35,
  resetAt: null,
  overageAllowed: true,
  isExceeded: false,
  isWarning: false,
};

export const mockSessionQuota: Quota = {
  id: 'quota-6',
  quotaType: 'sessions',
  limitValue: 20,
  currentUsage: 8,
  usagePercentage: 40,
  resetAt: '2024-02-01T00:00:00Z',
  overageAllowed: false,
  isExceeded: false,
  isWarning: false,
};

export const mockAgentQuota: Quota = {
  id: 'quota-7',
  quotaType: 'agents',
  limitValue: 5,
  currentUsage: 3,
  usagePercentage: 60,
  resetAt: null,
  overageAllowed: false,
  isExceeded: false,
  isWarning: false,
};

// Credit Balance fixtures
export const mockCreditBalance: CreditBalance = {
  balance: 5000,
  pending: 100,
  expiringSoon: 500,
  totalPurchased: 10000,
  totalUsed: 4900,
  totalBonus: 1000,
  lastUpdated: '2024-01-20T12:00:00Z',
};

export const mockLowCreditBalance: CreditBalance = {
  ...mockCreditBalance,
  balance: 50,
  expiringSoon: 25,
};

export const mockZeroCreditBalance: CreditBalance = {
  ...mockCreditBalance,
  balance: 0,
  pending: 0,
  expiringSoon: 0,
};

// Credit Transaction fixtures
export const mockCreditPurchase: CreditTransaction = {
  id: 'tx-1',
  amount: 5000,
  currency: 'USD',
  transactionType: 'purchase',
  description: 'Credit purchase - $50.00',
  expiresAt: '2025-01-20T12:00:00Z',
  createdAt: '2024-01-20T12:00:00Z',
};

export const mockCreditBonus: CreditTransaction = {
  id: 'tx-2',
  amount: 1000,
  currency: 'USD',
  transactionType: 'bonus',
  description: 'Welcome bonus',
  expiresAt: '2024-07-20T12:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

export const mockCreditUsage: CreditTransaction = {
  id: 'tx-3',
  amount: -250,
  currency: 'USD',
  transactionType: 'usage',
  description: 'Usage charge - Session #123',
  expiresAt: null,
  createdAt: '2024-01-15T08:30:00Z',
};

export const mockCreditAward: CreditTransaction = {
  id: 'tx-4',
  amount: 500,
  currency: 'USD',
  transactionType: 'award',
  description: 'Admin credit award',
  expiresAt: '2024-12-31T23:59:59Z',
  createdAt: '2024-01-10T10:00:00Z',
  awarded_by_id: 'admin-1',
};

// Invoice fixtures
export const mockPaidInvoice: Invoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-2024-001',
  subtotal: 29.0,
  discount: 0,
  tax: 2.9,
  total: 31.9,
  currency: 'USD',
  status: 'paid',
  lineItems: [
    {
      description: 'Pro Plan - Monthly',
      quantity: 1,
      unitPrice: 29.0,
      total: 29.0,
    },
  ],
  periodStart: '2024-01-01T00:00:00Z',
  periodEnd: '2024-02-01T00:00:00Z',
  dueDate: '2024-01-15T00:00:00Z',
  paidAt: '2024-01-10T12:00:00Z',
  pdfUrl: 'https://example.com/invoices/inv-1.pdf',
  createdAt: '2024-01-01T00:00:00Z',
};

export const mockOpenInvoice: Invoice = {
  ...mockPaidInvoice,
  id: 'inv-2',
  invoiceNumber: 'INV-2024-002',
  status: 'open',
  paidAt: null,
  dueDate: '2024-02-15T00:00:00Z',
};

export const mockOverageInvoice: Invoice = {
  ...mockPaidInvoice,
  id: 'inv-3',
  invoiceNumber: 'INV-2024-003',
  subtotal: 45.5,
  tax: 4.55,
  total: 50.05,
  lineItems: [
    {
      description: 'Pro Plan - Monthly',
      quantity: 1,
      unitPrice: 29.0,
      total: 29.0,
    },
    {
      description: 'Token Overage - 825,000 tokens',
      quantity: 825000,
      unitPrice: 0.00002,
      total: 16.5,
    },
  ],
};

// Hardware Spec fixtures
export const mockBasicHardwareSpec: HardwareSpec = {
  id: 'hw-1',
  tier: 'basic',
  displayName: 'Basic',
  description: 'Standard CPU workspace',
  architecture: 'x86_64',
  vcpu: 2,
  memoryMb: 4096,
  gpuType: null,
  gpuMemoryGb: null,
  gpuCount: 0,
  storageGb: 10,
  hourlyRate: 0.5,
  isAvailable: true,
  requiresSubscription: null,
  regionAvailability: ['us-central1', 'us-east1'],
};

export const mockGpuHardwareSpec: HardwareSpec = {
  id: 'hw-2',
  tier: 'gpu-t4',
  displayName: 'GPU T4',
  description: 'NVIDIA T4 GPU workspace',
  architecture: 'x86_64',
  vcpu: 4,
  memoryMb: 16384,
  gpuType: 'nvidia-tesla-t4',
  gpuMemoryGb: 16,
  gpuCount: 1,
  storageGb: 20,
  hourlyRate: 2.5,
  isAvailable: true,
  requiresSubscription: 'pro',
  regionAvailability: ['us-central1'],
};

export const mockPremiumHardwareSpec: HardwareSpec = {
  id: 'hw-3',
  tier: 'gpu-a100',
  displayName: 'GPU A100',
  description: 'NVIDIA A100 GPU workspace',
  architecture: 'x86_64',
  vcpu: 8,
  memoryMb: 32768,
  gpuType: 'nvidia-tesla-a100',
  gpuMemoryGb: 40,
  gpuCount: 1,
  storageGb: 50,
  hourlyRate: 5.0,
  isAvailable: true,
  requiresSubscription: 'enterprise',
  regionAvailability: ['us-central1', 'us-west1'],
};

// Usage Record fixtures
export const mockTokenUsageRecord: UsageRecord = {
  id: 'usage-1',
  usageType: 'tokens',
  quantity: 50000,
  unit: 'tokens',
  cost: 1.0,
  model: 'claude-opus-4-5',
  tier: null,
  sessionId: 'session-1',
  agentId: 'agent-1',
  isOverage: false,
  createdAt: '2024-01-15T10:30:00Z',
};

export const mockComputeUsageRecord: UsageRecord = {
  id: 'usage-2',
  usageType: 'compute',
  quantity: 3600,
  unit: 'seconds',
  cost: 0.5,
  model: null,
  tier: 'basic',
  sessionId: 'session-1',
  agentId: null,
  isOverage: false,
  createdAt: '2024-01-15T11:00:00Z',
};

export const mockOverageUsageRecord: UsageRecord = {
  ...mockTokenUsageRecord,
  id: 'usage-3',
  quantity: 100000,
  cost: 2.0,
  isOverage: true,
};
