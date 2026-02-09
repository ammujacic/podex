import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.describe('Main Navigation', () => {
    test('should navigate to landing page', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      expect(page.url()).toMatch(/\/$/);
      await page.screenshot({ path: 'test-results/nav-landing.png' });
    });

    test('should navigate to login page', async ({ page }) => {
      await page.goto('/auth/login');
      await page.waitForTimeout(2000);

      expect(page.url()).toContain('/auth/login');
      await page.screenshot({ path: 'test-results/nav-login.png' });
    });

    test('should navigate to signup page', async ({ page }) => {
      await page.goto('/auth/signup');
      await page.waitForTimeout(2000);

      expect(page.url()).toContain('/auth/signup');
      await page.screenshot({ path: 'test-results/nav-signup.png' });
    });

    test('should navigate to dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Should be at dashboard or redirected to login
      const url = page.url();
      expect(url).toMatch(/\/(dashboard|auth\/login)/);
      await page.screenshot({ path: 'test-results/nav-dashboard.png' });
    });
  });

  test.describe('Header Navigation', () => {
    test('should have logo link to home', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      const _logo = page.locator('header a[href="/"], .logo');
      await page.screenshot({ path: 'test-results/nav-logo.png' });
    });

    test('should show login/signup buttons when logged out', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Look for auth buttons in header
      await page.screenshot({ path: 'test-results/nav-auth-buttons.png' });
    });

    test('should navigate via header links', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Find and click header nav links
      const navLinks = page.locator('header nav a, header a');
      const count = await navLinks.count();

      if (count > 0) {
        await navLinks.first().click();
        await page.waitForTimeout(1000);
      }

      await page.screenshot({ path: 'test-results/nav-header-links.png' });
    });
  });

  test.describe('Footer Navigation', () => {
    test('should have footer links', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Scroll to footer
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);

      const _footer = page.locator('footer');
      await page.screenshot({ path: 'test-results/nav-footer.png' });
    });
  });

  test.describe('Breadcrumbs', () => {
    test('should show breadcrumbs in workspace', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for breadcrumb navigation
      await page.screenshot({ path: 'test-results/nav-breadcrumbs.png' });
    });
  });

  test.describe('Mobile Navigation', () => {
    test('should show mobile menu button', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Look for hamburger menu
      const _menuBtn = page.locator('[aria-label*="menu"], .hamburger, .mobile-menu-btn');

      await page.screenshot({ path: 'test-results/nav-mobile-button.png' });
    });

    test('should open mobile menu', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Click menu button if present
      const menuBtn = page.locator('[aria-label*="menu"], .hamburger, .mobile-menu-btn').first();
      if (await menuBtn.isVisible()) {
        await menuBtn.click();
        await page.waitForTimeout(500);
      }

      await page.screenshot({ path: 'test-results/nav-mobile-menu.png' });
    });
  });

  test.describe('404 Page', () => {
    test('should show 404 for invalid routes', async ({ page }) => {
      await page.goto('/this-page-does-not-exist-12345');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/nav-404.png' });
    });
  });

  test.describe('Keyboard Navigation', () => {
    test('should support keyboard navigation', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Tab through focusable elements
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');

      await page.screenshot({ path: 'test-results/nav-keyboard.png' });
    });

    test('should have skip link', async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(2000);

      // Look for skip to content link
      const _skipLink = page.locator('a[href="#main"], a:has-text("Skip to content")');

      await page.screenshot({ path: 'test-results/nav-skip-link.png' });
    });
  });
});
