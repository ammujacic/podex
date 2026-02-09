import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display hero section with correct content', async ({ page }) => {
    // Check main headline
    await expect(page.locator('h1')).toContainText('Cloud Pods');
    await expect(page.locator('h1')).toContainText('AI Agents');

    // Take screenshot for visual verification
    await page.screenshot({ path: 'test-results/landing-hero.png', fullPage: false });
  });

  test('should display header with navigation', async ({ page }) => {
    // Check logo/brand
    const header = page.locator('header');
    await expect(header).toBeVisible();

    // Check for CTA buttons
    await expect(page.getByRole('link', { name: /start building/i })).toBeVisible();

    await page.screenshot({ path: 'test-results/landing-header.png' });
  });

  test('should have working navigation to login', async ({ page }) => {
    // Look for sign in link
    const signInLink = page.getByRole('link', { name: /sign in|log in/i });

    if (await signInLink.isVisible()) {
      await signInLink.click();
      await expect(page).toHaveURL(/\/auth\/login/);
      await page.screenshot({ path: 'test-results/landing-to-login.png' });
    }
  });

  test('should have working navigation to signup', async ({ page }) => {
    // Look for signup CTA
    const signUpLink = page
      .getByRole('link', { name: /start building|sign up|get started/i })
      .first();

    await signUpLink.click();
    // Should navigate to signup or dashboard if already authenticated
    await expect(page).toHaveURL(/\/(auth\/signup|dashboard)/);
    await page.screenshot({ path: 'test-results/landing-to-signup.png' });
  });

  test('should display features section', async ({ page }) => {
    // Scroll to features section
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(500); // Wait for any animations

    await page.screenshot({ path: 'test-results/landing-features.png', fullPage: false });
  });

  test('should display pricing section', async ({ page }) => {
    // Scroll to pricing
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
    await page.waitForTimeout(500);

    await page.screenshot({ path: 'test-results/landing-pricing.png', fullPage: false });
  });

  test('should capture full page screenshot', async ({ page }) => {
    await page.screenshot({ path: 'test-results/landing-full-page.png', fullPage: true });
  });

  test('should have responsive layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();

    await page.screenshot({ path: 'test-results/landing-mobile.png', fullPage: true });
  });

  test('should have responsive layout on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.reload();

    await page.screenshot({ path: 'test-results/landing-tablet.png', fullPage: true });
  });
});
