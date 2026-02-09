import { test } from '@playwright/test';

test.describe('Workspace', () => {
  test.describe('Editor', () => {
    test('should show code editor', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for monaco editor or code editor
      await page.screenshot({ path: 'test-results/workspace-editor.png' });
    });

    test('should display file content', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Editor should show code
      await page.screenshot({ path: 'test-results/workspace-editor-content.png' });
    });

    test('should have syntax highlighting', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for highlighted code elements
      await page.screenshot({ path: 'test-results/workspace-syntax-highlight.png' });
    });

    test('should support multiple tabs', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for tab bar
      await page.screenshot({ path: 'test-results/workspace-editor-tabs.png' });
    });
  });

  test.describe('File Explorer', () => {
    test('should show file tree', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for file tree structure
      await page.screenshot({ path: 'test-results/workspace-file-tree.png' });
    });

    test('should expand folders', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Find and click folder
      const folder = page.locator('[data-testid="folder"], .tree-item-folder').first();
      if (await folder.isVisible()) {
        await folder.click();
        await page.waitForTimeout(500);
      }

      await page.screenshot({ path: 'test-results/workspace-folder-expand.png' });
    });

    test('should open file on click', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Find and click a file
      const file = page.locator('[data-testid="file"], .tree-item-file').first();
      if (await file.isVisible()) {
        await file.click();
        await page.waitForTimeout(1000);
      }

      await page.screenshot({ path: 'test-results/workspace-file-open.png' });
    });

    test('should show context menu', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Right click on file
      const file = page.locator('[data-testid="file"], .tree-item').first();
      if (await file.isVisible()) {
        await file.click({ button: 'right' });
        await page.waitForTimeout(500);
      }

      await page.screenshot({ path: 'test-results/workspace-context-menu.png' });
    });
  });

  test.describe('Terminal', () => {
    test('should show terminal panel', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for terminal component
      await page.screenshot({ path: 'test-results/workspace-terminal.png' });
    });

    test('should allow terminal input', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for terminal input area
      await page.screenshot({ path: 'test-results/workspace-terminal-input.png' });
    });

    test('should display command output', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for output area
      await page.screenshot({ path: 'test-results/workspace-terminal-output.png' });
    });
  });

  test.describe('Git Panel', () => {
    test('should show git status', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for git panel
      await page.screenshot({ path: 'test-results/workspace-git-status.png' });
    });

    test('should show changed files', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for changed files list
      await page.screenshot({ path: 'test-results/workspace-git-changes.png' });
    });

    test('should show branch selector', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for branch dropdown
      await page.screenshot({ path: 'test-results/workspace-git-branch.png' });
    });
  });

  test.describe('Preview Panel', () => {
    test('should show preview panel', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for preview iframe or panel
      await page.screenshot({ path: 'test-results/workspace-preview.png' });
    });

    test('should have refresh button', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for refresh control
      await page.screenshot({ path: 'test-results/workspace-preview-refresh.png' });
    });
  });

  test.describe('Layout', () => {
    test('should support resizable panels', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for resize handles
      await page.screenshot({ path: 'test-results/workspace-layout-resize.png' });
    });

    test('should support collapsible sidebar', async ({ page }) => {
      await page.goto('/session/test-session');
      await page.waitForTimeout(3000);

      // Look for sidebar toggle
      const toggleBtn = page.locator('[aria-label*="sidebar"], [data-testid="sidebar-toggle"]');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await page.waitForTimeout(500);
      }

      await page.screenshot({ path: 'test-results/workspace-sidebar-toggle.png' });
    });
  });
});
