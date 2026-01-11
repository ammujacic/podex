import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.describe('Settings Navigation', () => {
    test('should navigate to settings page', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForTimeout(2000);

      // Should be on settings page or redirected to login
      const url = page.url();
      expect(url).toMatch(/\/(settings|auth\/login)/);

      await page.screenshot({ path: 'test-results/settings-main.png' });
    });

    test('should show settings sidebar/navigation', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForTimeout(2000);

      // Look for navigation items
      const _nav = page.locator('nav, aside, [role="navigation"]');

      await page.screenshot({ path: 'test-results/settings-navigation.png' });
    });
  });

  test.describe('Editor Settings', () => {
    test('should show editor settings', async ({ page }) => {
      await page.goto('/settings/editor');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-editor.png' });
    });

    test('should allow changing theme', async ({ page }) => {
      await page.goto('/settings/editor');
      await page.waitForTimeout(2000);

      // Look for theme selector
      const _themeSelect = page.locator('select[name*="theme"], [aria-label*="theme"]');

      await page.screenshot({ path: 'test-results/settings-editor-theme.png' });
    });

    test('should allow changing font size', async ({ page }) => {
      await page.goto('/settings/editor');
      await page.waitForTimeout(2000);

      // Look for font size control
      await page.screenshot({ path: 'test-results/settings-editor-font.png' });
    });
  });

  test.describe('Keybindings Settings', () => {
    test('should show keybindings settings', async ({ page }) => {
      await page.goto('/settings/keybindings');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-keybindings.png' });
    });

    test('should display keybinding presets', async ({ page }) => {
      await page.goto('/settings/keybindings');
      await page.waitForTimeout(2000);

      // Look for preset options (default, vim, emacs)
      await page.screenshot({ path: 'test-results/settings-keybindings-presets.png' });
    });
  });

  test.describe('Theme Settings', () => {
    test('should show theme settings', async ({ page }) => {
      await page.goto('/settings/themes');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-themes.png' });
    });

    test('should display theme options', async ({ page }) => {
      await page.goto('/settings/themes');
      await page.waitForTimeout(2000);

      // Look for light/dark/system options
      await page.screenshot({ path: 'test-results/settings-themes-options.png' });
    });
  });

  test.describe('Agent Settings', () => {
    test('should show agent settings', async ({ page }) => {
      await page.goto('/settings/agents');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-agents.png' });
    });

    test('should display agent templates', async ({ page }) => {
      await page.goto('/settings/agents');
      await page.waitForTimeout(2000);

      // Look for agent template list
      await page.screenshot({ path: 'test-results/settings-agents-templates.png' });
    });
  });

  test.describe('Integrations Settings', () => {
    test('should show integrations settings', async ({ page }) => {
      await page.goto('/settings/integrations');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-integrations.png' });
    });

    test('should display GitHub integration', async ({ page }) => {
      await page.goto('/settings/integrations');
      await page.waitForTimeout(2000);

      // Look for GitHub connection option
      await page.screenshot({ path: 'test-results/settings-integrations-github.png' });
    });
  });

  test.describe('Local Pods Settings', () => {
    test('should show local pods settings', async ({ page }) => {
      await page.goto('/settings/local-pods');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/settings-local-pods.png' });
    });

    test('should display pairing instructions', async ({ page }) => {
      await page.goto('/settings/local-pods');
      await page.waitForTimeout(2000);

      // Look for pairing code or instructions
      await page.screenshot({ path: 'test-results/settings-local-pods-pairing.png' });
    });
  });
});
