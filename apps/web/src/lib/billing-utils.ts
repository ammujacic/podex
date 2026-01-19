/**
 * Billing utility functions for Stripe checkout and portal redirects.
 */

import { api } from '@/lib/api';

interface StripeRedirectOptions {
  /** API endpoint to call for the redirect URL */
  endpoint: string;
  /** Request payload */
  payload: Record<string, unknown>;
  /** Error message prefix for logging/display */
  errorContext: string;
}

/**
 * Initiates a redirect to a Stripe-hosted page (checkout, portal, etc.).
 *
 * This is a shared utility for the common pattern of:
 * 1. Making an API call to get a Stripe URL
 * 2. Redirecting the browser to that URL
 * 3. Handling errors consistently
 *
 * @throws Error if the API call fails or no URL is returned
 */
export async function redirectToStripeUrl({
  endpoint,
  payload,
  errorContext,
}: StripeRedirectOptions): Promise<void> {
  try {
    const response = await api.post<{ url: string }>(endpoint, payload);

    if (response.url) {
      window.location.href = response.url;
    } else {
      throw new Error('No URL returned from Stripe');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : `Failed to ${errorContext}`;
    console.error(`Error: ${errorContext}:`, err);
    throw new Error(message);
  }
}

/**
 * Initiate a subscription checkout flow.
 */
export async function initiateSubscriptionCheckout(
  planSlug: string,
  billingCycle: 'monthly' | 'yearly'
): Promise<void> {
  return redirectToStripeUrl({
    endpoint: '/api/billing/checkout/subscription',
    payload: {
      plan_slug: planSlug,
      billing_cycle: billingCycle,
      success_url: `${window.location.origin}/settings/billing?success=true`,
      cancel_url: `${window.location.origin}/settings/plans`,
    },
    errorContext: 'initiate checkout',
  });
}

/**
 * Open the Stripe customer portal for managing subscriptions.
 */
export async function openStripePortal(): Promise<void> {
  return redirectToStripeUrl({
    endpoint: '/api/billing/portal',
    payload: {
      return_url: `${window.location.origin}/settings/billing`,
    },
    errorContext: 'open billing portal',
  });
}

/**
 * Initiate a credit purchase checkout flow.
 */
export async function initiateCreditsCheckout(amountDollars: number): Promise<void> {
  return redirectToStripeUrl({
    endpoint: '/api/billing/checkout/credits',
    payload: {
      amount_cents: amountDollars * 100,
      success_url: `${window.location.origin}/settings/billing?credits_success=true`,
      cancel_url: `${window.location.origin}/settings/billing`,
    },
    errorContext: 'initiate credit purchase',
  });
}
