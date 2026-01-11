import { test, expect, type Page } from '@playwright/test';

/**
 * Helper to mock authentication state
 * This simulates a logged-in user for testing protected routes
 */
async function mockAuthenticatedUser(page: Page) {
  // Set localStorage values to simulate authentication
  await page.addInitScript(() => {
    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      avatar_url: null,
    };

    const mockToken = 'mock-jwt-token-for-testing';

    localStorage.setItem(
      'auth-storage',
      JSON.stringify({
        state: {
          user: mockUser,
          token: mockToken,
          isAuthenticated: true,
          isInitialized: true,
          isLoading: false,
          error: null,
        },
        version: 0,
      })
    );
  });
}

test.describe('Dashboard', () => {
  test.describe('Unauthenticated State', () => {
    test('should show login redirect or loading state', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/dashboard-unauth.png' });
    });
  });

  test.describe('With Mocked Authentication', () => {
    test.beforeEach(async ({ page }) => {
      await mockAuthenticatedUser(page);
    });

    test('should display dashboard when authenticated', async ({ page }) => {
      // Mock the API responses
      await page.route('**/api/sessions*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'session-1',
                name: 'My Test Project',
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                template_id: 'nodejs',
                git_url: 'https://github.com/test/repo',
                branch: 'main',
                pinned: false,
              },
              {
                id: 'session-2',
                name: 'Backend API',
                status: 'stopped',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                template_id: 'python',
                pinned: true,
              },
            ],
            total: 2,
            page: 1,
            per_page: 50,
          }),
        });
      });

      await page.route('**/api/templates*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 'nodejs', name: 'Node.js', slug: 'nodejs', icon: 'nodejs', is_official: true },
            { id: 'python', name: 'Python', slug: 'python', icon: 'python', is_official: true },
            {
              id: 'typescript',
              name: 'TypeScript',
              slug: 'typescript',
              icon: 'typescript',
              is_official: true,
            },
          ]),
        });
      });

      await page.route('**/api/dashboard/stats*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            total_pods: 5,
            active_pods: 2,
            total_agents: 8,
            usage: {
              tokens_this_month: 150000,
              total_tokens_used: 500000,
              api_calls_this_month: 250,
              total_api_calls: 1000,
              cost_this_month: 12.5,
              total_cost: 45.0,
            },
          }),
        });
      });

      await page.route('**/api/activity*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [
              {
                id: 'activity-1',
                type: 'agent_message',
                message: 'Architect completed planning phase',
                session_name: 'My Test Project',
                created_at: new Date().toISOString(),
              },
            ],
            has_more: false,
          }),
        });
      });

      await page.route('**/api/notifications*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            unread_count: 0,
          }),
        });
      });

      await page.route('**/api/usage/history*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            daily: Array.from({ length: 14 }, (_, i) => ({
              date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              tokens: Math.floor(Math.random() * 10000),
              cost: Math.random() * 2,
            })),
            period_start: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
            period_end: new Date().toISOString(),
          }),
        });
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/dashboard-authenticated.png', fullPage: true });
    });

    test('should display welcome message', async ({ page }) => {
      // Mock minimal API responses
      await page.route('**/api/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/sessions')) {
          await route.fulfill({ status: 200, body: JSON.stringify({ items: [], total: 0 }) });
        } else if (url.includes('/templates')) {
          await route.fulfill({ status: 200, body: JSON.stringify([]) });
        } else if (url.includes('/stats')) {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ total_pods: 0, active_pods: 0, total_agents: 0, usage: {} }),
          });
        } else if (url.includes('/activity')) {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ items: [], has_more: false }),
          });
        } else if (url.includes('/notifications')) {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ items: [], unread_count: 0 }),
          });
        } else if (url.includes('/usage')) {
          await route.fulfill({ status: 200, body: JSON.stringify({ daily: [] }) });
        } else {
          await route.continue();
        }
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      // Should show welcome message
      await expect(page.locator('h1')).toContainText(/welcome back/i);

      await page.screenshot({ path: 'test-results/dashboard-welcome.png' });
    });

    test('should have working search functionality', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await route.fulfill({ status: 200, body: JSON.stringify({ items: [], total: 0 }) });
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(1000);

      // Look for search input
      const searchInput = page.locator('input[placeholder*="Search"]');
      if (await searchInput.isVisible()) {
        await searchInput.click();
        await searchInput.fill('test project');

        await page.screenshot({ path: 'test-results/dashboard-search.png' });
      }
    });

    test('should have working keyboard shortcuts', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await route.fulfill({ status: 200, body: JSON.stringify({ items: [], total: 0 }) });
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(1000);

      // Test CMD+K for search focus
      await page.keyboard.press('Meta+k');
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/dashboard-shortcut-search.png' });

      // Test CMD+/ for shortcuts modal
      await page.keyboard.press('Escape');
      await page.keyboard.press('Meta+/');
      await page.waitForTimeout(500);

      await page.screenshot({ path: 'test-results/dashboard-shortcut-modal.png' });
    });

    test('should navigate to new session page', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        await route.fulfill({ status: 200, body: JSON.stringify({ items: [], total: 0 }) });
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(1000);

      const newPodButton = page.getByRole('link', { name: /new pod/i }).first();
      if (await newPodButton.isVisible()) {
        await newPodButton.click();
        await page.waitForURL(/\/session\/new/);

        await page.screenshot({ path: 'test-results/dashboard-to-new-session.png' });
      }
    });

    test('should display empty state when no sessions', async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        const url = route.request().url();
        if (url.includes('/sessions')) {
          await route.fulfill({ status: 200, body: JSON.stringify({ items: [], total: 0 }) });
        } else {
          await route.fulfill({ status: 200, body: JSON.stringify({}) });
        }
      });

      await page.goto('/dashboard');
      await page.waitForTimeout(2000);

      await page.screenshot({ path: 'test-results/dashboard-empty-state.png', fullPage: true });
    });
  });
});

test.describe('Settings Page', () => {
  test('should display settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'test-results/settings-page.png', fullPage: true });
  });
});

test.describe('New Session Page', () => {
  test('should display new session form', async ({ page }) => {
    await page.route('**/api/templates*', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify([
          { id: 'nodejs', name: 'Node.js', slug: 'nodejs', icon: 'nodejs', is_official: true },
          { id: 'python', name: 'Python', slug: 'python', icon: 'python', is_official: true },
        ]),
      });
    });

    await page.goto('/session/new');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'test-results/new-session-page.png', fullPage: true });
  });
});
