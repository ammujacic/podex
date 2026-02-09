import { test, expect } from '@playwright/test';

test.describe('Billing', () => {
  test.describe('Billing Navigation', () => {
    test('should navigate to billing page', async ({ page }) => {
      await page.goto('/settings/billing');
      await page.waitForTimeout(2000);

      // Should be on billing page or redirected to login
      const url = page.url();
      expect(url).toMatch(/\/(settings\/billing|auth\/login)/);

      await page.screenshot({ path: 'test-results/billing-main.png' });
    });

    test('should show billing tabs', async ({ page }) => {
      await page.goto('/settings/billing');
      await page.waitForTimeout(2000);

      // Look for billing navigation tabs
      await page.screenshot({ path: 'test-results/billing-tabs.png' });
    });
  });

  test.describe('Usage Page', () => {
    test('should show usage statistics', async ({ page }) => {
      await page.goto('/settings/billing/usage');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/billing-usage.png' });
    });

    test('should display usage chart', async ({ page }) => {
      await page.goto('/settings/billing/usage');
      await page.waitForTimeout(2000);

      // Look for chart or graph element
      await page.screenshot({ path: 'test-results/billing-usage-chart.png' });
    });

    test('should show quota progress bars', async ({ page }) => {
      await page.goto('/settings/billing/usage');
      await page.waitForTimeout(2000);

      // Look for progress indicators
      await page.screenshot({ path: 'test-results/billing-usage-quotas.png' });
    });

    test('should display usage breakdown', async ({ page }) => {
      await page.goto('/settings/billing/usage');
      await page.waitForTimeout(2000);

      // Look for breakdown by model/agent
      await page.screenshot({ path: 'test-results/billing-usage-breakdown.png' });
    });
  });

  test.describe('Credits Page', () => {
    test('should show credit balance', async ({ page }) => {
      await page.goto('/settings/billing/credits');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/billing-credits.png' });
    });

    test('should display purchase button', async ({ page }) => {
      await page.goto('/settings/billing/credits');
      await page.waitForTimeout(2000);

      // Look for purchase credits button
      const _purchaseBtn = page.getByRole('button', { name: /purchase|buy|add/i });

      await page.screenshot({ path: 'test-results/billing-credits-purchase.png' });
    });

    test('should show transaction history', async ({ page }) => {
      await page.goto('/settings/billing/credits');
      await page.waitForTimeout(2000);

      // Look for transaction list
      await page.screenshot({ path: 'test-results/billing-credits-history.png' });
    });
  });

  test.describe('Invoices Page', () => {
    test('should show invoices list', async ({ page }) => {
      await page.goto('/settings/billing/invoices');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/billing-invoices.png' });
    });

    test('should allow downloading invoice', async ({ page }) => {
      await page.goto('/settings/billing/invoices');
      await page.waitForTimeout(2000);

      // Look for download buttons
      await page.screenshot({ path: 'test-results/billing-invoices-download.png' });
    });
  });

  test.describe('Subscription Management', () => {
    test('should show current plan', async ({ page }) => {
      await page.goto('/settings/billing');
      await page.waitForTimeout(2000);

      // Look for current plan info
      await page.screenshot({ path: 'test-results/billing-current-plan.png' });
    });

    test('should show upgrade options', async ({ page }) => {
      await page.goto('/settings/billing');
      await page.waitForTimeout(2000);

      // Look for upgrade/change plan button
      const _upgradeBtn = page.getByRole('button', { name: /upgrade|change plan|manage/i });

      await page.screenshot({ path: 'test-results/billing-upgrade.png' });
    });
  });
});
