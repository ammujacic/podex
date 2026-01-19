import { useState, useEffect, useCallback } from 'react';
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
import {
  initiateSubscriptionCheckout,
  openStripePortal,
  initiateCreditsCheckout,
} from '@/lib/billing-utils';

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
    (planSlug: string, billingCycle: 'monthly' | 'yearly') =>
      initiateSubscriptionCheckout(planSlug, billingCycle),
    []
  );

  const handleOpenStripePortal = useCallback(() => openStripePortal(), []);

  const handlePurchaseCredits = useCallback(
    (amount: number) => initiateCreditsCheckout(amount),
    []
  );

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
