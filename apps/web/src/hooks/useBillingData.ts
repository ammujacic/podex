import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  getSubscription,
  listSubscriptionPlans,
  getCreditBalance,
  listInvoices,
  type SubscriptionResponse,
  type SubscriptionPlanResponse,
  type CreditBalanceResponse,
  type InvoiceResponse,
} from '@/lib/api';

interface UseBillingDataReturn {
  subscription: SubscriptionResponse | null;
  plans: SubscriptionPlanResponse[];
  credits: CreditBalanceResponse | null;
  invoices: InvoiceResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  handlePlanChange: (planSlug: string, billingCycle: 'monthly' | 'yearly') => Promise<void>;
  handleOpenStripePortal: () => Promise<void>;
  handlePurchaseCredits: (amount: number) => Promise<void>;
}

export function useBillingData(): UseBillingDataReturn {
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlanResponse[]>([]);
  const [credits, setCredits] = useState<CreditBalanceResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [subscriptionData, plansData, creditsData, invoicesData] = await Promise.all([
        getSubscription().catch((err) => {
          console.error('Failed to fetch subscription:', err);
          return null;
        }),
        listSubscriptionPlans().catch((err) => {
          console.error('Failed to fetch plans:', err);
          return [];
        }),
        getCreditBalance().catch((err) => {
          console.error('Failed to fetch credit balance:', err);
          return null;
        }),
        listInvoices().catch((err) => {
          console.error('Failed to fetch invoices:', err);
          return [];
        }),
      ]);

      setSubscription(subscriptionData);
      setPlans(plansData);
      setCredits(creditsData);
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load billing data';
      setError(message);
      console.error('Error loading billing data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePlanChange = useCallback(
    async (planSlug: string, billingCycle: 'monthly' | 'yearly') => {
      try {
        const response = await api.post<{ url: string }>('/api/billing/checkout/subscription', {
          plan_slug: planSlug,
          billing_cycle: billingCycle,
          success_url: `${window.location.origin}/settings/billing?success=true`,
          cancel_url: `${window.location.origin}/settings/plans`,
        });

        if (response.url) {
          window.location.href = response.url;
        } else {
          throw new Error('No checkout URL returned');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate checkout';
        console.error('Error initiating plan change:', err);
        throw new Error(message);
      }
    },
    []
  );

  const handleOpenStripePortal = useCallback(async () => {
    try {
      const response = await api.post<{ url: string }>('/api/billing/portal', {
        return_url: `${window.location.origin}/settings/billing`,
      });

      if (response.url) {
        window.location.href = response.url;
      } else {
        throw new Error('No portal URL returned');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open billing portal';
      console.error('Error opening Stripe portal:', err);
      throw new Error(message);
    }
  }, []);

  const handlePurchaseCredits = useCallback(async (amount: number) => {
    try {
      const response = await api.post<{ url: string }>('/api/billing/checkout/credits', {
        amount_cents: amount * 100, // Convert dollars to cents
        success_url: `${window.location.origin}/settings/billing?credits_success=true`,
        cancel_url: `${window.location.origin}/settings/billing`,
      });

      if (response.url) {
        window.location.href = response.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate credit purchase';
      console.error('Error purchasing credits:', err);
      throw new Error(message);
    }
  }, []);

  return {
    subscription,
    plans,
    credits,
    invoices,
    loading,
    error,
    refetch: fetchData,
    handlePlanChange,
    handleOpenStripePortal,
    handlePurchaseCredits,
  };
}
