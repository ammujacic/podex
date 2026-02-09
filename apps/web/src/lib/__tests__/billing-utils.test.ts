/**
 * Tests for billing-utils (Stripe redirect, checkout, portal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  redirectToStripeUrl,
  initiateSubscriptionCheckout,
  openStripePortal,
  initiateCreditsCheckout,
} from '../billing-utils';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    post: vi.fn(),
  },
}));

describe('billing-utils', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation });
  });

  describe('redirectToStripeUrl', () => {
    it('redirects when response has url', async () => {
      vi.mocked(api.post).mockResolvedValue({ url: 'https://checkout.stripe.com/session' });

      await redirectToStripeUrl({
        endpoint: '/api/checkout',
        payload: {},
        errorContext: 'test',
      });

      expect(api.post).toHaveBeenCalledWith('/api/checkout', {});
      expect(window.location.href).toBe('https://checkout.stripe.com/session');
    });

    it('throws when response has no url', async () => {
      vi.mocked(api.post).mockResolvedValue({});

      await expect(
        redirectToStripeUrl({
          endpoint: '/api/checkout',
          payload: {},
          errorContext: 'test',
        })
      ).rejects.toThrow('No URL returned from Stripe');
    });

    it('throws with error message when api.post fails', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Network error'));

      await expect(
        redirectToStripeUrl({
          endpoint: '/api/checkout',
          payload: {},
          errorContext: 'test',
        })
      ).rejects.toThrow('Network error');
    });

    it('throws generic message when error is not Error instance', async () => {
      vi.mocked(api.post).mockRejectedValue('string error');

      await expect(
        redirectToStripeUrl({
          endpoint: '/api/checkout',
          payload: {},
          errorContext: 'test',
        })
      ).rejects.toThrow('Failed to test');
    });
  });

  describe('initiateSubscriptionCheckout', () => {
    it('calls redirectToStripeUrl with subscription payload', async () => {
      vi.mocked(api.post).mockResolvedValue({ url: 'https://checkout.stripe.com/sub' });

      await initiateSubscriptionCheckout('pro-monthly', 'monthly');

      expect(api.post).toHaveBeenCalledWith(
        '/api/billing/checkout/subscription',
        expect.objectContaining({
          plan_slug: 'pro-monthly',
          billing_cycle: 'monthly',
          success_url: expect.stringContaining('/settings/billing?success=true'),
          cancel_url: expect.stringContaining('/settings/plans'),
        })
      );
      expect(window.location.href).toBe('https://checkout.stripe.com/sub');
    });
  });

  describe('openStripePortal', () => {
    it('redirects when portal_url is returned', async () => {
      vi.mocked(api.post).mockResolvedValue({
        portal_url: 'https://billing.stripe.com/portal',
      });

      await openStripePortal();

      expect(api.post).toHaveBeenCalledWith('/api/billing/portal', {
        return_url: expect.stringContaining('/settings/billing'),
      });
      expect(window.location.href).toBe('https://billing.stripe.com/portal');
    });

    it('throws when no portal_url returned', async () => {
      vi.mocked(api.post).mockResolvedValue({});

      await expect(openStripePortal()).rejects.toThrow('No URL returned from Stripe');
    });

    it('throws with error message when api fails', async () => {
      vi.mocked(api.post).mockRejectedValue(new Error('Unauthorized'));

      await expect(openStripePortal()).rejects.toThrow('Unauthorized');
    });
  });

  describe('initiateCreditsCheckout', () => {
    it('calls redirectToStripeUrl with amount in cents', async () => {
      vi.mocked(api.post).mockResolvedValue({ url: 'https://checkout.stripe.com/credits' });

      await initiateCreditsCheckout(25);

      expect(api.post).toHaveBeenCalledWith(
        '/api/billing/checkout/credits',
        expect.objectContaining({
          amount_cents: 2500,
          success_url: expect.stringContaining('credits_success=true'),
          cancel_url: expect.stringContaining('/settings/billing'),
        })
      );
    });
  });
});
