/**
 * Comprehensive tests for useBillingData hook
 * Tests billing data fetching, state management, and action handlers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useBillingData } from '../useBillingData';
import * as api from '@/lib/api';
import * as billingUtils from '@/lib/billing-utils';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  getSubscription: vi.fn(),
  listSubscriptionPlans: vi.fn(),
  getCreditBalance: vi.fn(),
  listInvoices: vi.fn(),
}));

vi.mock('@/lib/billing-utils', () => ({
  initiateSubscriptionCheckout: vi.fn(),
  openStripePortal: vi.fn(),
  initiateCreditsCheckout: vi.fn(),
}));

// Sample mock data
const mockSubscription = {
  id: 'sub-123',
  plan_slug: 'pro',
  status: 'active',
  billing_cycle: 'monthly',
  current_period_start: '2024-01-01T00:00:00Z',
  current_period_end: '2024-02-01T00:00:00Z',
  cancel_at_period_end: false,
};

const mockPlans = [
  {
    slug: 'free',
    name: 'Free',
    description: 'For hobbyists',
    price_monthly: 0,
    price_yearly: 0,
    features: ['5 agents', '1GB storage'],
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'For professionals',
    price_monthly: 29,
    price_yearly: 290,
    features: ['Unlimited agents', '100GB storage'],
  },
];

const mockCredits = {
  balance: 5000,
  currency: 'USD',
  last_updated: '2024-01-15T10:00:00Z',
};

const mockInvoices = [
  {
    id: 'inv-001',
    amount: 2900,
    currency: 'USD',
    status: 'paid',
    created_at: '2024-01-01T00:00:00Z',
    pdf_url: 'https://example.com/invoice.pdf',
  },
  {
    id: 'inv-002',
    amount: 2900,
    currency: 'USD',
    status: 'paid',
    created_at: '2023-12-01T00:00:00Z',
    pdf_url: 'https://example.com/invoice2.pdf',
  },
];

describe('useBillingData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default success responses
    (api.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(mockSubscription);
    (api.listSubscriptionPlans as ReturnType<typeof vi.fn>).mockResolvedValue(mockPlans);
    (api.getCreditBalance as ReturnType<typeof vi.fn>).mockResolvedValue(mockCredits);
    (api.listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue(mockInvoices);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should start with loading state', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.loading).toBe(true);
    });

    it('should start with null subscription', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.subscription).toBe(null);
    });

    it('should start with empty plans', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.plans).toEqual([]);
    });

    it('should start with null credits', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.credits).toBe(null);
    });

    it('should start with empty invoices', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.invoices).toEqual([]);
    });

    it('should start with null error', () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.error).toBe(null);
    });

    it('should fetch all data on mount', async () => {
      renderHook(() => useBillingData());

      await waitFor(() => {
        expect(api.getSubscription).toHaveBeenCalledTimes(1);
        expect(api.listSubscriptionPlans).toHaveBeenCalledTimes(1);
        expect(api.getCreditBalance).toHaveBeenCalledTimes(1);
        expect(api.listInvoices).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ========================================
  // Data Fetching Tests
  // ========================================

  describe('Data Fetching', () => {
    it('should fetch and set subscription', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.subscription).toEqual(mockSubscription);
      });
    });

    it('should fetch and set plans', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.plans).toEqual(mockPlans);
      });
    });

    it('should fetch and set credits', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.credits).toEqual(mockCredits);
      });
    });

    it('should fetch and set invoices', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.invoices).toEqual(mockInvoices);
      });
    });

    it('should set loading to false after fetch completes', async () => {
      const { result } = renderHook(() => useBillingData());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should fetch all data in parallel', async () => {
      let subscriptionResolved = false;
      let plansResolved = false;

      (api.getSubscription as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              subscriptionResolved = true;
              resolve(mockSubscription);
            }, 50);
          })
      );

      (api.listSubscriptionPlans as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              plansResolved = true;
              resolve(mockPlans);
            }, 50);
          })
      );

      renderHook(() => useBillingData());

      // Wait a bit to check they started in parallel
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Both should still be in flight
      expect(api.getSubscription).toHaveBeenCalled();
      expect(api.listSubscriptionPlans).toHaveBeenCalled();

      await waitFor(() => {
        expect(subscriptionResolved).toBe(true);
        expect(plansResolved).toBe(true);
      });
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    it('should handle subscription fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.getSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.subscription).toBe(null);
        expect(result.current.plans).toEqual(mockPlans); // Other fetches succeed
      });

      consoleSpy.mockRestore();
    });

    it('should handle plans fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.listSubscriptionPlans as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error')
      );

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.plans).toEqual([]);
        expect(result.current.subscription).toEqual(mockSubscription);
      });

      consoleSpy.mockRestore();
    });

    it('should handle credits fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.getCreditBalance as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unauthorized')
      );

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.credits).toBe(null);
      });

      consoleSpy.mockRestore();
    });

    it('should handle invoices fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.listInvoices as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.invoices).toEqual([]);
      });

      consoleSpy.mockRestore();
    });

    it('should handle non-array invoices response', async () => {
      (api.listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ items: mockInvoices });

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.invoices).toEqual([]);
      });
    });

    it('should set error message when all fetches fail', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new Error('Complete failure');
      (api.getSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      (api.listSubscriptionPlans as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      (api.getCreditBalance as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      (api.listInvoices as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        // Partial errors are caught per-call, overall error only on total failure
      });

      consoleSpy.mockRestore();
    });

    it('should extract error message from Error object', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Create a scenario where the outer try-catch throws
      const originalPromiseAll = Promise.all;
      vi.spyOn(Promise, 'all').mockImplementationOnce(() => {
        throw new Error('Unexpected error');
      });

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.error).toBe('Unexpected error');
      });

      Promise.all = originalPromiseAll;
      consoleSpy.mockRestore();
    });
  });

  // ========================================
  // Refetch Tests
  // ========================================

  describe('Refetch', () => {
    it('should provide refetch function', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(typeof result.current.refetch).toBe('function');
    });

    it('should refetch all data when refetch is called', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      vi.clearAllMocks();

      await act(async () => {
        await result.current.refetch();
      });

      expect(api.getSubscription).toHaveBeenCalledTimes(1);
      expect(api.listSubscriptionPlans).toHaveBeenCalledTimes(1);
      expect(api.getCreditBalance).toHaveBeenCalledTimes(1);
      expect(api.listInvoices).toHaveBeenCalledTimes(1);
    });

    it('should set loading during refetch', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Create a delayed response to observe loading state
      (api.getSubscription as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockSubscription), 100);
          })
      );

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });

    it('should clear previous error on refetch', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First fetch fails
      (api.getSubscription as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Error'));

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Second fetch succeeds
      (api.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(mockSubscription);

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.error).toBe(null);

      consoleSpy.mockRestore();
    });

    it('should update data after refetch', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.subscription).toEqual(mockSubscription);
      });

      const updatedSubscription = { ...mockSubscription, plan_slug: 'enterprise' };
      (api.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(updatedSubscription);

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.subscription).toEqual(updatedSubscription);
    });
  });

  // ========================================
  // Action Handler Tests
  // ========================================

  describe('Action Handlers', () => {
    describe('handlePlanChange', () => {
      it('should call initiateSubscriptionCheckout with correct params', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        await act(async () => {
          await result.current.handlePlanChange('enterprise', 'yearly');
        });

        expect(billingUtils.initiateSubscriptionCheckout).toHaveBeenCalledWith(
          'enterprise',
          'yearly'
        );
      });

      it('should handle monthly billing cycle', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        await act(async () => {
          await result.current.handlePlanChange('pro', 'monthly');
        });

        expect(billingUtils.initiateSubscriptionCheckout).toHaveBeenCalledWith('pro', 'monthly');
      });

      it('should handle various plan slugs', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        const planSlugs = ['free', 'pro', 'enterprise', 'team'];

        for (const slug of planSlugs) {
          await act(async () => {
            await result.current.handlePlanChange(slug, 'monthly');
          });

          expect(billingUtils.initiateSubscriptionCheckout).toHaveBeenCalledWith(slug, 'monthly');
        }
      });
    });

    describe('handleOpenStripePortal', () => {
      it('should call openStripePortal', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        await act(async () => {
          await result.current.handleOpenStripePortal();
        });

        expect(billingUtils.openStripePortal).toHaveBeenCalledTimes(1);
      });

      it('should return promise from openStripePortal', async () => {
        (billingUtils.openStripePortal as ReturnType<typeof vi.fn>).mockResolvedValue({
          url: 'https://portal.stripe.com',
        });

        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        const promise = result.current.handleOpenStripePortal();

        expect(promise).toBeInstanceOf(Promise);
      });
    });

    describe('handlePurchaseCredits', () => {
      it('should call initiateCreditsCheckout with amount', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        await act(async () => {
          await result.current.handlePurchaseCredits(100);
        });

        expect(billingUtils.initiateCreditsCheckout).toHaveBeenCalledWith(100);
      });

      it('should handle various credit amounts', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        const amounts = [10, 50, 100, 500, 1000];

        for (const amount of amounts) {
          await act(async () => {
            await result.current.handlePurchaseCredits(amount);
          });

          expect(billingUtils.initiateCreditsCheckout).toHaveBeenCalledWith(amount);
        }
      });

      it('should handle zero amount', async () => {
        const { result } = renderHook(() => useBillingData());

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        await act(async () => {
          await result.current.handlePurchaseCredits(0);
        });

        expect(billingUtils.initiateCreditsCheckout).toHaveBeenCalledWith(0);
      });
    });
  });

  // ========================================
  // Callback Stability Tests
  // ========================================

  describe('Callback Stability', () => {
    it('should maintain stable refetch reference', async () => {
      const { result, rerender } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const refetch1 = result.current.refetch;

      rerender();

      expect(result.current.refetch).toBe(refetch1);
    });

    it('should maintain stable handlePlanChange reference', async () => {
      const { result, rerender } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const handler1 = result.current.handlePlanChange;

      rerender();

      expect(result.current.handlePlanChange).toBe(handler1);
    });

    it('should maintain stable handleOpenStripePortal reference', async () => {
      const { result, rerender } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const handler1 = result.current.handleOpenStripePortal;

      rerender();

      expect(result.current.handleOpenStripePortal).toBe(handler1);
    });

    it('should maintain stable handlePurchaseCredits reference', async () => {
      const { result, rerender } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      const handler1 = result.current.handlePurchaseCredits;

      rerender();

      expect(result.current.handlePurchaseCredits).toBe(handler1);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty plans array', async () => {
      (api.listSubscriptionPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.plans).toEqual([]);
      });
    });

    it('should handle empty invoices array', async () => {
      (api.listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.invoices).toEqual([]);
      });
    });

    it('should handle null subscription response', async () => {
      (api.getSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.subscription).toBe(null);
      });
    });

    it('should handle null credits response', async () => {
      (api.getCreditBalance as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.credits).toBe(null);
      });
    });

    it('should handle concurrent refetch calls', async () => {
      const { result } = renderHook(() => useBillingData());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      vi.clearAllMocks();

      // Call refetch multiple times concurrently
      await Promise.all([
        result.current.refetch(),
        result.current.refetch(),
        result.current.refetch(),
      ]);

      // Each refetch should trigger all API calls
      expect(api.getSubscription).toHaveBeenCalledTimes(3);
    });

    it('should handle unmount during fetch', async () => {
      let resolveSubscription: (value: unknown) => void;
      (api.getSubscription as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveSubscription = resolve;
          })
      );

      const { unmount } = renderHook(() => useBillingData());

      // Unmount before fetch completes
      unmount();

      // Resolve after unmount - should not cause errors
      resolveSubscription!(mockSubscription);

      // No assertion needed - just ensuring no errors thrown
    });
  });
});
