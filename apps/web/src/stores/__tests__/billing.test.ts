import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBillingStore } from '../billing';
import type {
  SubscriptionPlan,
  Subscription,
  UsageSummary,
  Quota,
  CreditBalance,
  CreditTransaction,
  Invoice,
  HardwareSpec,
  UsageRecord,
  BillingErrorDetail,
} from '../billing';
import {
  mockFreeSubscriptionPlan,
  mockProSubscriptionPlan,
  mockEnterpriseSubscriptionPlan,
  mockActiveSubscription,
  mockTrialingSubscription,
  mockCanceledSubscription,
  mockPastDueSubscription,
  mockSponsoredSubscription,
  mockUsageSummaryDetailed,
  mockHighUsageSummary,
  mockTokenQuota,
  mockTokenQuotaWarning,
  mockTokenQuotaExceeded,
  mockComputeQuota,
  mockStorageQuota,
  mockSessionQuota,
  mockAgentQuota,
  mockCreditBalance,
  mockLowCreditBalance,
  mockZeroCreditBalance,
  mockCreditPurchase,
  mockCreditBonus,
  mockCreditUsage,
  mockCreditAward,
  mockPaidInvoice,
  mockOpenInvoice,
  mockOverageInvoice,
  mockBasicHardwareSpec,
  mockGpuHardwareSpec,
  mockPremiumHardwareSpec,
  mockTokenUsageRecord,
  mockComputeUsageRecord,
  mockOverageUsageRecord,
} from '@/__tests__/fixtures/api-responses';

describe('billingStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useBillingStore.getState().reset();
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty plans array', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.plans).toEqual([]);
    });

    it('has no subscription', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.subscription).toBeNull();
    });

    it('has no usage summary', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.usageSummary).toBeNull();
    });

    it('has empty quotas array', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.quotas).toEqual([]);
    });

    it('has no credit balance', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.creditBalance).toBeNull();
    });

    it('has empty invoices array', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.invoices).toEqual([]);
    });

    it('has empty hardware specs array', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.hardwareSpecs).toEqual([]);
    });

    it('has credit exhausted modal closed', () => {
      const { result } = renderHook(() => useBillingStore());
      expect(result.current.creditExhaustedModalOpen).toBe(false);
      expect(result.current.creditExhaustedErrorDetail).toBeNull();
    });
  });

  // ========================================================================
  // Subscription Management
  // ========================================================================

  describe('Subscription Management', () => {
    describe('setSubscription', () => {
      it('sets subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
        });

        expect(result.current.subscription).toEqual(mockActiveSubscription);
      });

      it('can clear subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
          result.current.setSubscription(null);
        });

        expect(result.current.subscription).toBeNull();
      });

      it('can update subscription to different plan', () => {
        const { result } = renderHook(() => useBillingStore());
        const upgradedSubscription: Subscription = {
          ...mockActiveSubscription,
          plan: mockEnterpriseSubscriptionPlan,
        };

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
          result.current.setSubscription(upgradedSubscription);
        });

        expect(result.current.subscription?.plan.slug).toBe('enterprise');
      });
    });

    describe('subscription status', () => {
      it('handles active subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
        });

        expect(result.current.subscription?.status).toBe('active');
        expect(result.current.subscription?.cancelAtPeriodEnd).toBe(false);
      });

      it('handles trialing subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockTrialingSubscription);
        });

        expect(result.current.subscription?.status).toBe('trialing');
        expect(result.current.subscription?.trialEnd).toBeDefined();
      });

      it('handles canceled subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockCanceledSubscription);
        });

        expect(result.current.subscription?.status).toBe('canceled');
        expect(result.current.subscription?.cancelAtPeriodEnd).toBe(true);
        expect(result.current.subscription?.canceledAt).toBeDefined();
      });

      it('handles past due subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockPastDueSubscription);
        });

        expect(result.current.subscription?.status).toBe('past_due');
      });

      it('handles paused subscription', () => {
        const { result } = renderHook(() => useBillingStore());
        const pausedSubscription: Subscription = {
          ...mockActiveSubscription,
          status: 'paused',
        };

        act(() => {
          result.current.setSubscription(pausedSubscription);
        });

        expect(result.current.subscription?.status).toBe('paused');
      });
    });

    describe('cancelAtPeriodEnd handling', () => {
      it('sets cancelAtPeriodEnd when subscription canceled', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
          result.current.setSubscription({
            ...mockActiveSubscription,
            cancelAtPeriodEnd: true,
            canceledAt: '2024-01-20T00:00:00Z',
          });
        });

        expect(result.current.subscription?.cancelAtPeriodEnd).toBe(true);
      });

      it('retains access until period end when canceled', () => {
        const { result } = renderHook(() => useBillingStore());
        const canceledButActive: Subscription = {
          ...mockActiveSubscription,
          status: 'active',
          cancelAtPeriodEnd: true,
          canceledAt: '2024-01-20T00:00:00Z',
        };

        act(() => {
          result.current.setSubscription(canceledButActive);
        });

        expect(result.current.subscription?.status).toBe('active');
        expect(result.current.subscription?.cancelAtPeriodEnd).toBe(true);
      });
    });

    describe('subscription renewal', () => {
      it('updates period dates on renewal', () => {
        const { result } = renderHook(() => useBillingStore());
        const renewedSubscription: Subscription = {
          ...mockActiveSubscription,
          currentPeriodStart: '2024-02-01T00:00:00Z',
          currentPeriodEnd: '2024-03-01T00:00:00Z',
        };

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
          result.current.setSubscription(renewedSubscription);
        });

        expect(result.current.subscription?.currentPeriodStart).toBe('2024-02-01T00:00:00Z');
        expect(result.current.subscription?.currentPeriodEnd).toBe('2024-03-01T00:00:00Z');
      });

      it('clears cancelAtPeriodEnd on renewal after cancellation', () => {
        const { result } = renderHook(() => useBillingStore());
        const renewedAfterCancel: Subscription = {
          ...mockCanceledSubscription,
          status: 'active',
          cancelAtPeriodEnd: false,
          canceledAt: null,
          currentPeriodStart: '2024-02-01T00:00:00Z',
          currentPeriodEnd: '2024-03-01T00:00:00Z',
        };

        act(() => {
          result.current.setSubscription(mockCanceledSubscription);
          result.current.setSubscription(renewedAfterCancel);
        });

        expect(result.current.subscription?.cancelAtPeriodEnd).toBe(false);
        expect(result.current.subscription?.status).toBe('active');
      });
    });

    describe('sponsored subscriptions', () => {
      it('handles sponsored subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockSponsoredSubscription);
        });

        expect(result.current.subscription?.is_sponsored).toBe(true);
        expect(result.current.subscription?.sponsor_reason).toBeDefined();
      });
    });

    describe('loading and error states', () => {
      it('sets subscription loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscriptionLoading(true);
        });

        expect(result.current.subscriptionLoading).toBe(true);

        act(() => {
          result.current.setSubscriptionLoading(false);
        });

        expect(result.current.subscriptionLoading).toBe(false);
      });

      it('sets subscription error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscriptionError('Failed to load subscription');
        });

        expect(result.current.subscriptionError).toBe('Failed to load subscription');

        act(() => {
          result.current.setSubscriptionError(null);
        });

        expect(result.current.subscriptionError).toBeNull();
      });
    });
  });

  // ========================================================================
  // Plan Management
  // ========================================================================

  describe('Plan Management', () => {
    describe('setPlans', () => {
      it('sets plans', () => {
        const { result } = renderHook(() => useBillingStore());
        const plans = [
          mockFreeSubscriptionPlan,
          mockProSubscriptionPlan,
          mockEnterpriseSubscriptionPlan,
        ];

        act(() => {
          result.current.setPlans(plans);
        });

        expect(result.current.plans).toEqual(plans);
        expect(result.current.plans).toHaveLength(3);
      });

      it('can update plans', () => {
        const { result } = renderHook(() => useBillingStore());
        const initialPlans = [mockFreeSubscriptionPlan];
        const updatedPlans = [mockFreeSubscriptionPlan, mockProSubscriptionPlan];

        act(() => {
          result.current.setPlans(initialPlans);
          result.current.setPlans(updatedPlans);
        });

        expect(result.current.plans).toHaveLength(2);
      });
    });

    describe('getPlanBySlug', () => {
      beforeEach(() => {
        act(() => {
          useBillingStore
            .getState()
            .setPlans([
              mockFreeSubscriptionPlan,
              mockProSubscriptionPlan,
              mockEnterpriseSubscriptionPlan,
            ]);
        });
      });

      it('finds plan by slug', () => {
        const { result } = renderHook(() => useBillingStore());
        const plan = result.current.getPlanBySlug('pro');

        expect(plan).toBeDefined();
        expect(plan?.slug).toBe('pro');
      });

      it('returns undefined for non-existent slug', () => {
        const { result } = renderHook(() => useBillingStore());
        const plan = result.current.getPlanBySlug('non-existent');

        expect(plan).toBeUndefined();
      });
    });

    describe('plan comparison', () => {
      it('differentiates free and pro plans', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockFreeSubscriptionPlan, mockProSubscriptionPlan]);
        });

        const freePlan = result.current.getPlanBySlug('free');
        const proPlan = result.current.getPlanBySlug('pro');

        expect(freePlan?.tokensIncluded).toBeLessThan(proPlan?.tokensIncluded ?? 0);
        expect(freePlan?.maxAgents).toBeLessThan(proPlan?.maxAgents ?? 0);
        expect(freePlan?.overageAllowed).toBe(false);
        expect(proPlan?.overageAllowed).toBe(true);
      });

      it('identifies popular plan', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockFreeSubscriptionPlan, mockProSubscriptionPlan]);
        });

        const proPlan = result.current.getPlanBySlug('pro');
        expect(proPlan?.isPopular).toBe(true);
      });

      it('identifies enterprise plan', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockProSubscriptionPlan, mockEnterpriseSubscriptionPlan]);
        });

        const enterprisePlan = result.current.getPlanBySlug('enterprise');
        expect(enterprisePlan?.isEnterprise).toBe(true);
        expect(enterprisePlan?.maxAgents).toBe(-1); // unlimited
      });
    });

    describe('feature availability checks', () => {
      it('checks if user has feature access', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setSubscription(mockActiveSubscription);
        });

        expect(result.current.hasFeature('gpu_access')).toBe(true);
        expect(result.current.hasFeature('team_collaboration')).toBe(true);
        expect(result.current.hasFeature('planning_mode')).toBe(true);
      });

      it('returns false for features not in plan', () => {
        const { result } = renderHook(() => useBillingStore());
        const freeSubscription: Subscription = {
          ...mockActiveSubscription,
          plan: mockFreeSubscriptionPlan,
        };

        act(() => {
          result.current.setSubscription(freeSubscription);
        });

        expect(result.current.hasFeature('gpu_access')).toBe(false);
        expect(result.current.hasFeature('team_collaboration')).toBe(false);
        expect(result.current.hasFeature('custom_models')).toBe(false);
      });

      it('returns false when no subscription', () => {
        const { result } = renderHook(() => useBillingStore());

        expect(result.current.hasFeature('gpu_access')).toBe(false);
      });
    });

    describe('plan limits', () => {
      it('enforces agent limits per plan', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockFreeSubscriptionPlan, mockProSubscriptionPlan]);
        });

        const freePlan = result.current.getPlanBySlug('free');
        const proPlan = result.current.getPlanBySlug('pro');

        expect(freePlan?.maxAgents).toBe(1);
        expect(proPlan?.maxAgents).toBe(5);
      });

      it('enforces session limits per plan', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockFreeSubscriptionPlan, mockProSubscriptionPlan]);
        });

        const freePlan = result.current.getPlanBySlug('free');
        const proPlan = result.current.getPlanBySlug('pro');

        expect(freePlan?.maxSessions).toBe(3);
        expect(proPlan?.maxSessions).toBe(20);
      });

      it('supports unlimited limits with -1', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setPlans([mockEnterpriseSubscriptionPlan]);
        });

        const enterprisePlan = result.current.getPlanBySlug('enterprise');
        expect(enterprisePlan?.maxAgents).toBe(-1);
        expect(enterprisePlan?.maxSessions).toBe(-1);
      });
    });

    describe('loading and error states', () => {
      it('sets plans loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setPlansLoading(true);
        });

        expect(result.current.plansLoading).toBe(true);
      });

      it('sets plans error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setPlansError('Failed to load plans');
        });

        expect(result.current.plansError).toBe('Failed to load plans');
      });
    });
  });

  // ========================================================================
  // Usage Tracking
  // ========================================================================

  describe('Usage Tracking', () => {
    describe('setUsageSummary', () => {
      it('sets usage summary', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary).toEqual(mockUsageSummaryDetailed);
      });

      it('can update usage summary', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
          result.current.setUsageSummary(mockHighUsageSummary);
        });

        expect(result.current.usageSummary?.tokensTotal).toBe(950000);
      });

      it('can clear usage summary', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
          result.current.setUsageSummary(null);
        });

        expect(result.current.usageSummary).toBeNull();
      });
    });

    describe('token usage tracking', () => {
      it('tracks input and output tokens separately', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.tokensInput).toBe(250000);
        expect(result.current.usageSummary?.tokensOutput).toBe(150000);
        expect(result.current.usageSummary?.tokensTotal).toBe(400000);
      });

      it('tracks usage by model', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.usageByModel).toBeDefined();
        expect(result.current.usageSummary?.usageByModel['claude-opus-4.5']).toBeDefined();
        expect(result.current.usageSummary?.usageByModel['claude-sonnet-4.5']).toBeDefined();
      });

      it('tracks usage by agent', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.usageByAgent).toBeDefined();
        expect(result.current.usageSummary?.usageByAgent['agent-1']?.tokens).toBe(200000);
        expect(result.current.usageSummary?.usageByAgent['agent-2']?.tokens).toBe(200000);
      });
    });

    describe('compute usage tracking', () => {
      it('tracks compute seconds and hours', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.computeSeconds).toBe(18000);
        expect(result.current.usageSummary?.computeHours).toBe(5.0);
      });

      it('tracks compute credits used and included', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.computeCreditsUsed).toBe(5.0);
        expect(result.current.usageSummary?.computeCreditsIncluded).toBe(10.0);
      });

      it('tracks usage by tier', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.usageByTier).toBeDefined();
        expect(result.current.usageSummary?.usageByTier.basic?.seconds).toBe(10800);
        expect(result.current.usageSummary?.usageByTier.gpu?.seconds).toBe(7200);
      });
    });

    describe('cost calculations', () => {
      it('calculates token costs', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.tokensCost).toBe(8.0);
      });

      it('calculates compute costs', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.computeCost).toBe(5.0);
      });

      it('calculates storage costs', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.storageCost).toBe(0.35);
      });

      it('calculates total costs', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageSummary(mockUsageSummaryDetailed);
        });

        expect(result.current.usageSummary?.totalCost).toBe(13.35);
      });
    });

    describe('usage history', () => {
      it('sets usage history', () => {
        const { result } = renderHook(() => useBillingStore());
        const records = [mockTokenUsageRecord, mockComputeUsageRecord];

        act(() => {
          result.current.setUsageHistory(records);
        });

        expect(result.current.usageHistory).toHaveLength(2);
      });

      it('tracks overage usage', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageHistory([mockOverageUsageRecord]);
        });

        expect(result.current.usageHistory[0].isOverage).toBe(true);
      });
    });

    describe('loading and error states', () => {
      it('sets usage loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageLoading(true);
        });

        expect(result.current.usageLoading).toBe(true);
      });

      it('sets usage error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setUsageError('Failed to load usage');
        });

        expect(result.current.usageError).toBe('Failed to load usage');
      });
    });
  });

  // ========================================================================
  // Quota Enforcement
  // ========================================================================

  describe('Quota Enforcement', () => {
    describe('setQuotas', () => {
      it('sets quotas', () => {
        const { result } = renderHook(() => useBillingStore());
        const quotas = [mockTokenQuota, mockComputeQuota, mockStorageQuota];

        act(() => {
          result.current.setQuotas(quotas);
        });

        expect(result.current.quotas).toHaveLength(3);
      });
    });

    describe('getQuotaByType', () => {
      beforeEach(() => {
        act(() => {
          useBillingStore
            .getState()
            .setQuotas([
              mockTokenQuota,
              mockComputeQuota,
              mockStorageQuota,
              mockSessionQuota,
              mockAgentQuota,
            ]);
        });
      });

      it('finds token quota', () => {
        const { result } = renderHook(() => useBillingStore());
        const quota = result.current.getQuotaByType('tokens');

        expect(quota).toBeDefined();
        expect(quota?.quotaType).toBe('tokens');
      });

      it('finds compute quota', () => {
        const { result } = renderHook(() => useBillingStore());
        const quota = result.current.getQuotaByType('compute_credits');

        expect(quota).toBeDefined();
        expect(quota?.quotaType).toBe('compute_credits');
      });

      it('finds session quota', () => {
        const { result } = renderHook(() => useBillingStore());
        const quota = result.current.getQuotaByType('sessions');

        expect(quota).toBeDefined();
        expect(quota?.quotaType).toBe('sessions');
      });

      it('finds agent quota', () => {
        const { result } = renderHook(() => useBillingStore());
        const quota = result.current.getQuotaByType('agents');

        expect(quota).toBeDefined();
        expect(quota?.quotaType).toBe('agents');
      });

      it('returns undefined for non-existent quota type', () => {
        const { result } = renderHook(() => useBillingStore());
        const quota = result.current.getQuotaByType('non-existent');

        expect(quota).toBeUndefined();
      });
    });

    describe('isQuotaExceeded', () => {
      it('returns false when quota not exceeded', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuota]);
        });

        expect(result.current.isQuotaExceeded('tokens')).toBe(false);
      });

      it('returns true when quota exceeded', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuotaExceeded]);
        });

        expect(result.current.isQuotaExceeded('tokens')).toBe(true);
      });

      it('returns false when quota type not found', () => {
        const { result } = renderHook(() => useBillingStore());

        expect(result.current.isQuotaExceeded('non-existent')).toBe(false);
      });
    });

    describe('quota warnings', () => {
      it('detects warning at 85% usage', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuotaWarning]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.isWarning).toBe(true);
        expect(quota?.usagePercentage).toBe(85);
      });

      it('no warning below 80% usage', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuota]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.isWarning).toBe(false);
        expect(quota?.usagePercentage).toBe(40);
      });

      it('exceeded quota also triggers warning', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuotaExceeded]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.isExceeded).toBe(true);
        expect(quota?.usagePercentage).toBeGreaterThan(100);
      });
    });

    describe('usage percentage calculations', () => {
      it('calculates correct percentage for normal usage', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuota]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.usagePercentage).toBe(40);
      });

      it('calculates percentage over 100% when exceeded', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuotaExceeded]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.usagePercentage).toBe(110);
      });
    });

    describe('overage allowed', () => {
      it('allows overage when plan permits', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuota]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.overageAllowed).toBe(true);
      });

      it('blocks overage when plan does not permit', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuotaExceeded]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.overageAllowed).toBe(false);
      });
    });

    describe('quota reset', () => {
      it('includes reset date for periodic quotas', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockTokenQuota]);
        });

        const quota = result.current.getQuotaByType('tokens');
        expect(quota?.resetAt).toBeDefined();
      });

      it('has no reset date for non-periodic quotas', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotas([mockStorageQuota]);
        });

        const quota = result.current.getQuotaByType('storage_gb');
        expect(quota?.resetAt).toBeNull();
      });
    });

    describe('loading and error states', () => {
      it('sets quotas loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotasLoading(true);
        });

        expect(result.current.quotasLoading).toBe(true);
      });

      it('sets quotas error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setQuotasError('Failed to load quotas');
        });

        expect(result.current.quotasError).toBe('Failed to load quotas');
      });
    });
  });

  // ========================================================================
  // Credits Management
  // ========================================================================

  describe('Credits Management', () => {
    describe('setCreditBalance', () => {
      it('sets credit balance', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditBalance(mockCreditBalance);
        });

        expect(result.current.creditBalance).toEqual(mockCreditBalance);
      });

      it('tracks balance and usage', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditBalance(mockCreditBalance);
        });

        expect(result.current.creditBalance?.balance).toBe(5000);
        expect(result.current.creditBalance?.totalUsed).toBe(4900);
        expect(result.current.creditBalance?.totalPurchased).toBe(10000);
      });

      it('tracks pending and expiring credits', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditBalance(mockCreditBalance);
        });

        expect(result.current.creditBalance?.pending).toBe(100);
        expect(result.current.creditBalance?.expiringSoon).toBe(500);
      });

      it('handles low credit balance', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditBalance(mockLowCreditBalance);
        });

        expect(result.current.creditBalance?.balance).toBe(50);
        expect(result.current.creditBalance?.balance).toBeLessThan(100);
      });

      it('handles zero credit balance', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditBalance(mockZeroCreditBalance);
        });

        expect(result.current.creditBalance?.balance).toBe(0);
      });
    });

    describe('setCreditHistory', () => {
      it('sets credit history', () => {
        const { result } = renderHook(() => useBillingStore());
        const transactions = [mockCreditPurchase, mockCreditBonus, mockCreditUsage];

        act(() => {
          result.current.setCreditHistory(transactions);
        });

        expect(result.current.creditHistory).toHaveLength(3);
      });

      it('tracks purchase transactions', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditHistory([mockCreditPurchase]);
        });

        expect(result.current.creditHistory[0].transactionType).toBe('purchase');
        expect(result.current.creditHistory[0].amount).toBeGreaterThan(0);
      });

      it('tracks usage transactions', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditHistory([mockCreditUsage]);
        });

        expect(result.current.creditHistory[0].transactionType).toBe('usage');
        expect(result.current.creditHistory[0].amount).toBeLessThan(0);
      });

      it('tracks bonus transactions', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditHistory([mockCreditBonus]);
        });

        expect(result.current.creditHistory[0].transactionType).toBe('bonus');
      });

      it('tracks admin awarded credits', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditHistory([mockCreditAward]);
        });

        expect(result.current.creditHistory[0].transactionType).toBe('award');
        expect(result.current.creditHistory[0].awarded_by_id).toBe('admin-1');
      });
    });

    describe('loading and error states', () => {
      it('sets credits loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditsLoading(true);
        });

        expect(result.current.creditsLoading).toBe(true);
      });

      it('sets credits error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setCreditsError('Failed to load credits');
        });

        expect(result.current.creditsError).toBe('Failed to load credits');
      });
    });
  });

  // ========================================================================
  // Billing History
  // ========================================================================

  describe('Billing History', () => {
    describe('setInvoices', () => {
      it('sets invoices', () => {
        const { result } = renderHook(() => useBillingStore());
        const invoices = [mockPaidInvoice, mockOpenInvoice];

        act(() => {
          result.current.setInvoices(invoices);
        });

        expect(result.current.invoices).toHaveLength(2);
      });

      it('can update invoices', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockOpenInvoice]);
          result.current.setInvoices([mockPaidInvoice, mockOpenInvoice]);
        });

        expect(result.current.invoices).toHaveLength(2);
      });
    });

    describe('payment status tracking', () => {
      it('tracks paid invoices', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockPaidInvoice]);
        });

        expect(result.current.invoices[0].status).toBe('paid');
        expect(result.current.invoices[0].paidAt).toBeDefined();
      });

      it('tracks open invoices', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockOpenInvoice]);
        });

        expect(result.current.invoices[0].status).toBe('open');
        expect(result.current.invoices[0].paidAt).toBeNull();
      });

      it('tracks overage charges in invoice', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockOverageInvoice]);
        });

        expect(result.current.invoices[0].lineItems).toHaveLength(2);
        expect(result.current.invoices[0].lineItems[1].description).toContain('Overage');
      });

      it('includes tax and totals', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockPaidInvoice]);
        });

        const invoice = result.current.invoices[0];
        expect(invoice.subtotal).toBe(29.0);
        expect(invoice.tax).toBe(2.9);
        expect(invoice.total).toBe(31.9);
      });
    });

    describe('invoice details', () => {
      it('includes invoice number', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockPaidInvoice]);
        });

        expect(result.current.invoices[0].invoiceNumber).toBe('INV-2024-001');
      });

      it('includes PDF URL for paid invoices', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoices([mockPaidInvoice]);
        });

        expect(result.current.invoices[0].pdfUrl).toBeDefined();
      });
    });

    describe('loading and error states', () => {
      it('sets invoices loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoicesLoading(true);
        });

        expect(result.current.invoicesLoading).toBe(true);
      });

      it('sets invoices error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setInvoicesError('Failed to load invoices');
        });

        expect(result.current.invoicesError).toBe('Failed to load invoices');
      });
    });
  });

  // ========================================================================
  // Hardware Specs
  // ========================================================================

  describe('Hardware Specs', () => {
    describe('setHardwareSpecs', () => {
      it('sets hardware specs', () => {
        const { result } = renderHook(() => useBillingStore());
        const specs = [mockBasicHardwareSpec, mockGpuHardwareSpec, mockPremiumHardwareSpec];

        act(() => {
          result.current.setHardwareSpecs(specs);
        });

        expect(result.current.hardwareSpecs).toHaveLength(3);
      });
    });

    describe('getHardwareSpecByTier', () => {
      beforeEach(() => {
        act(() => {
          useBillingStore
            .getState()
            .setHardwareSpecs([
              mockBasicHardwareSpec,
              mockGpuHardwareSpec,
              mockPremiumHardwareSpec,
            ]);
        });
      });

      it('finds basic tier', () => {
        const { result } = renderHook(() => useBillingStore());
        const spec = result.current.getHardwareSpecByTier('basic');

        expect(spec).toBeDefined();
        expect(spec?.tier).toBe('basic');
        expect(spec?.gpuCount).toBe(0);
      });

      it('finds GPU tier', () => {
        const { result } = renderHook(() => useBillingStore());
        const spec = result.current.getHardwareSpecByTier('gpu-t4');

        expect(spec).toBeDefined();
        expect(spec?.gpuType).toBe('nvidia-tesla-t4');
        expect(spec?.gpuCount).toBe(1);
      });

      it('returns undefined for non-existent tier', () => {
        const { result } = renderHook(() => useBillingStore());
        const spec = result.current.getHardwareSpecByTier('non-existent');

        expect(spec).toBeUndefined();
      });
    });

    describe('hardware pricing', () => {
      it('has different rates per tier', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setHardwareSpecs([mockBasicHardwareSpec, mockGpuHardwareSpec]);
        });

        const basic = result.current.getHardwareSpecByTier('basic');
        const gpu = result.current.getHardwareSpecByTier('gpu-t4');

        expect(basic?.hourlyRate).toBe(0.5);
        expect(gpu?.hourlyRate).toBe(2.5);
      });
    });

    describe('subscription requirements', () => {
      it('basic tier requires no subscription', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setHardwareSpecs([mockBasicHardwareSpec]);
        });

        const spec = result.current.getHardwareSpecByTier('basic');
        expect(spec?.requiresSubscription).toBeNull();
      });

      it('GPU tier requires pro subscription', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setHardwareSpecs([mockGpuHardwareSpec]);
        });

        const spec = result.current.getHardwareSpecByTier('gpu-t4');
        expect(spec?.requiresSubscription).toBe('pro');
      });

      it('premium tier requires enterprise subscription', () => {
        const { result } = renderHook(() => useBillingStore());
        act(() => {
          result.current.setHardwareSpecs([mockPremiumHardwareSpec]);
        });

        const spec = result.current.getHardwareSpecByTier('gpu-a100');
        expect(spec?.requiresSubscription).toBe('enterprise');
      });
    });

    describe('loading and error states', () => {
      it('sets hardware specs loading state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setHardwareSpecsLoading(true);
        });

        expect(result.current.hardwareSpecsLoading).toBe(true);
      });

      it('sets hardware specs error state', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.setHardwareSpecsError('Failed to load hardware specs');
        });

        expect(result.current.hardwareSpecsError).toBe('Failed to load hardware specs');
      });
    });
  });

  // ========================================================================
  // Credit Exhausted Modal
  // ========================================================================

  describe('Credit Exhausted Modal', () => {
    const mockErrorDetail: BillingErrorDetail = {
      error_code: 'CREDITS_EXHAUSTED',
      message: 'Your credit balance is exhausted',
      quota_remaining: 0,
      credits_remaining: 0,
      resource_type: 'tokens',
      upgrade_url: '/settings/billing',
      add_credits_url: '/settings/billing/credits',
    };

    describe('showCreditExhaustedModal', () => {
      it('opens modal with error detail', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.showCreditExhaustedModal(mockErrorDetail);
        });

        expect(result.current.creditExhaustedModalOpen).toBe(true);
        expect(result.current.creditExhaustedErrorDetail).toEqual(mockErrorDetail);
      });

      it('includes upgrade and credit URLs', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.showCreditExhaustedModal(mockErrorDetail);
        });

        expect(result.current.creditExhaustedErrorDetail?.upgrade_url).toBe('/settings/billing');
        expect(result.current.creditExhaustedErrorDetail?.add_credits_url).toBe(
          '/settings/billing/credits'
        );
      });
    });

    describe('hideCreditExhaustedModal', () => {
      it('closes modal and clears error detail', () => {
        const { result } = renderHook(() => useBillingStore());

        act(() => {
          result.current.showCreditExhaustedModal(mockErrorDetail);
          result.current.hideCreditExhaustedModal();
        });

        expect(result.current.creditExhaustedModalOpen).toBe(false);
        expect(result.current.creditExhaustedErrorDetail).toBeNull();
      });
    });
  });

  // ========================================================================
  // Reset
  // ========================================================================

  describe('Reset', () => {
    it('resets all state to initial values', () => {
      const { result } = renderHook(() => useBillingStore());

      act(() => {
        // Set various state
        result.current.setPlans([mockProSubscriptionPlan]);
        result.current.setSubscription(mockActiveSubscription);
        result.current.setUsageSummary(mockUsageSummaryDetailed);
        result.current.setQuotas([mockTokenQuota]);
        result.current.setCreditBalance(mockCreditBalance);
        result.current.setInvoices([mockPaidInvoice]);

        // Reset
        result.current.reset();
      });

      expect(result.current.plans).toEqual([]);
      expect(result.current.subscription).toBeNull();
      expect(result.current.usageSummary).toBeNull();
      expect(result.current.quotas).toEqual([]);
      expect(result.current.creditBalance).toBeNull();
      expect(result.current.invoices).toEqual([]);
    });
  });
});
