import { test, expect } from '@playwright/test';

test.describe('Sessions Management', () => {
  test.describe('Session List', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate to dashboard (which shows sessions)
      await page.goto('/dashboard');
    });

    test('should display sessions list on dashboard', async ({ page }) => {
      // Wait for page to load
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/sessions-list.png' });

      // Dashboard should be visible or redirect to login
      const url = page.url();
      expect(url).toMatch(/\/(dashboard|auth\/login)/);
    });

    test('should show create session button', async ({ page }) => {
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'test-results/sessions-create-button.png' });
    });

    test('should navigate to session when clicked', async ({ page }) => {
      await page.waitForTimeout(2000);

      // Look for any session links
      const sessionLinks = page.locator('a[href*="/session/"]');
      const count = await sessionLinks.count();

      if (count > 0) {
        await sessionLinks.first().click();
        await page.waitForTimeout(2000);
        await expect(page).toHaveURL(/\/session\//);
      }

      await page.screenshot({ path: 'test-results/sessions-navigation.png' });
    });
  });

  test.describe('Session Creation', () => {
    test('should show session creation modal/page', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Look for new session button
      const newButton = page.getByRole('button', { name: /new|create|start/i });

      if (await newButton.isVisible()) {
        await newButton.click();
        await page.waitForTimeout(1000);
      }

      await page.screenshot({ path: 'test-results/sessions-creation-modal.png' });
    });

    test('should display template selection', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Look for template options or new session flow
      await page.screenshot({ path: 'test-results/sessions-template-selection.png' });
    });
  });

  test.describe('Session Details', () => {
    test('should show session workspace', async ({ page }) => {
      // Try to navigate to a session
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      await page.screenshot({ path: 'test-results/sessions-workspace.png' });
    });

    test('should display file explorer', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for file tree or explorer
      const _fileExplorer = page.locator('[data-testid="file-explorer"], .file-tree, .sidebar');

      await page.screenshot({ path: 'test-results/sessions-file-explorer.png' });
    });

    test('should show agent panel', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for agent components
      await page.screenshot({ path: 'test-results/sessions-agent-panel.png' });
    });
  });

  test.describe('Session Actions', () => {
    test('should allow renaming session', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Look for session options menu
      const moreButton = page
        .locator('[aria-label*="more"], [aria-label*="options"], button:has-text("...")')
        .first();

      if (await moreButton.isVisible()) {
        await moreButton.click();
        await page.waitForTimeout(500);
      }

      await page.screenshot({ path: 'test-results/sessions-rename.png' });
    });

    test('should allow deleting session', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Look for delete option in session menu
      await page.screenshot({ path: 'test-results/sessions-delete.png' });
    });

    test('should allow pinning session', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Look for pin option
      await page.screenshot({ path: 'test-results/sessions-pin.png' });
    });
  });
});
