import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useUIStore } from '../ui';
import type { GridConfig, PanelId, SidebarLayoutState, SidebarSide } from '../ui';

// Mock the API calls
vi.mock('@/lib/api/user-config', () => ({
  getUserConfig: vi.fn(),
  updateUserConfig: vi.fn(),
}));

// Mock the auth store
vi.mock('@/stores/auth', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      user: { id: 'user-1', email: 'test@example.com' },
      tokens: { accessToken: 'token-123' },
    })),
  },
}));

// Mock the config store
vi.mock('@/stores/config', () => ({
  useConfigStore: {
    getState: vi.fn(() => ({
      getSidebarLayoutDefaults: () => null,
      getGridConfigDefaults: () => null,
    })),
  },
}));

// Import mocked functions
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';
import { useAuthStore } from '@/stores/auth';
import { useConfigStore } from '@/stores/config';

const mockedGetUserConfig = vi.mocked(getUserConfig);
const mockedUpdateUserConfig = vi.mocked(updateUserConfig);
const mockedUseAuthStore = vi.mocked(useAuthStore);
const mockedUseConfigStore = vi.mocked(useConfigStore);

describe('uiStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useUIStore.setState({
        _hasHydrated: false,
        isLoading: false,
        lastSyncedAt: null,
        theme: 'dark',
        resolvedTheme: 'dark',
        commandPaletteOpen: false,
        quickOpenOpen: false,
        globalSearchOpen: false,
        sidebarLayout: {
          left: {
            collapsed: false,
            width: 280,
            panels: [
              { panelId: 'files', height: 50 },
              { panelId: 'git', height: 50 },
            ],
          },
          right: {
            collapsed: false,
            width: 360,
            panels: [
              { panelId: 'agents', height: 60 },
              { panelId: 'mcp', height: 40 },
            ],
          },
        },
        gitWidgetSettingsBySession: {},
        githubWidgetFiltersBySession: {},
        githubWidgetRepoBySession: {},
        githubWidgetPanelStatesBySession: {},
        terminalVisible: false,
        terminalHeight: 300,
        pendingTerminalCommand: null,
        panelVisible: false,
        panelHeight: 200,
        activePanel: 'output',
        activeModal: null,
        modalData: {},
        announcement: '',
        isMobileMenuOpen: false,
        mobileActiveWidget: null,
        mobileOpenFile: null,
        mobileFileActionsTarget: null,
        prefersReducedMotion: false,
        focusMode: false,
        showHiddenFiles: false,
        gridConfig: {
          columns: 2,
          rowHeight: 300,
          maxRows: 0,
          maxCols: 0,
        },
      });
    });

    // Reset mocks
    vi.clearAllMocks();

    // Setup default mock implementations
    mockedGetUserConfig.mockResolvedValue(null);
    mockedUpdateUserConfig.mockResolvedValue({});
    mockedUseAuthStore.getState.mockReturnValue({
      user: { id: 'user-1', email: 'test@example.com' },
      tokens: { accessToken: 'token-123' },
    } as any);
    mockedUseConfigStore.getState.mockReturnValue({
      getSidebarLayoutDefaults: () => null,
      getGridConfigDefaults: () => null,
    } as any);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has dark theme by default', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.theme).toBe('dark');
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('has command palette closed', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('has default sidebar layout', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.sidebarLayout.left.collapsed).toBe(false);
      expect(result.current.sidebarLayout.right.collapsed).toBe(false);
      expect(result.current.sidebarLayout.left.panels).toHaveLength(2);
      expect(result.current.sidebarLayout.right.panels).toHaveLength(2);
    });

    it('has terminal hidden by default', () => {
      const { result } = renderHook(() => useUIStore());
      expect(result.current.terminalVisible).toBe(false);
      expect(result.current.terminalHeight).toBe(300);
    });
  });

  // ========================================================================
  // Theme Management
  // ========================================================================

  describe('Theme Management', () => {
    describe('setTheme', () => {
      it('sets theme to dark', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('dark');
        });

        expect(result.current.theme).toBe('dark');
        expect(result.current.resolvedTheme).toBe('dark');
      });

      it('sets theme to light', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('light');
        });

        expect(result.current.theme).toBe('light');
        expect(result.current.resolvedTheme).toBe('light');
      });

      it('sets theme to system', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('system');
        });

        expect(result.current.theme).toBe('system');
        // resolvedTheme will be either dark or light based on system preference
        expect(['dark', 'light']).toContain(result.current.resolvedTheme);
      });

      it('resolves system theme to dark when system prefers dark', () => {
        // Mock matchMedia to return dark preference
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          value: vi.fn().mockImplementation((query) => ({
            matches: query === '(prefers-color-scheme: dark)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
        });

        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('system');
        });

        expect(result.current.theme).toBe('system');
        expect(result.current.resolvedTheme).toBe('dark');
      });

      it('resolves system theme to light when system prefers light', () => {
        // Mock matchMedia to return light preference
        Object.defineProperty(window, 'matchMedia', {
          writable: true,
          value: vi.fn().mockImplementation((query) => ({
            matches: query !== '(prefers-color-scheme: dark)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
        });

        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('system');
        });

        expect(result.current.theme).toBe('system');
        expect(result.current.resolvedTheme).toBe('light');
      });

      it('can switch between themes', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('dark');
        });
        expect(result.current.theme).toBe('dark');

        act(() => {
          result.current.setTheme('light');
        });
        expect(result.current.theme).toBe('light');

        act(() => {
          result.current.setTheme('system');
        });
        expect(result.current.theme).toBe('system');
      });

      it('triggers server sync when theme changes', async () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('light');
        });

        // Fast-forward debounce timer
        act(() => {
          vi.advanceTimersByTime(1000);
        });

        vi.useRealTimers();

        await waitFor(() => {
          expect(mockedUpdateUserConfig).toHaveBeenCalled();
        });
      });
    });
  });

  // ========================================================================
  // Command Palette
  // ========================================================================

  describe('Command Palette', () => {
    it('opens command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
    });

    it('closes command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('toggles command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleCommandPalette();
      });
      expect(result.current.commandPaletteOpen).toBe(true);

      act(() => {
        result.current.toggleCommandPalette();
      });
      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('closes quick open and global search when opening command palette', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.openGlobalSearch();
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });
  });

  // ========================================================================
  // Quick Open
  // ========================================================================

  describe('Quick Open', () => {
    it('opens quick open', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
    });

    it('closes quick open', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.closeQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('toggles quick open', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleQuickOpen();
      });
      expect(result.current.quickOpenOpen).toBe(true);

      act(() => {
        result.current.toggleQuickOpen();
      });
      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('closes command palette and global search when opening quick open', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.openGlobalSearch();
        result.current.openQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });
  });

  // ========================================================================
  // Global Search
  // ========================================================================

  describe('Global Search', () => {
    it('opens global search', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
    });

    it('closes global search', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openGlobalSearch();
        result.current.closeGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('toggles global search', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleGlobalSearch();
      });
      expect(result.current.globalSearchOpen).toBe(true);

      act(() => {
        result.current.toggleGlobalSearch();
      });
      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('closes command palette and quick open when opening global search', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.openQuickOpen();
        result.current.openGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(false);
    });
  });

  // ========================================================================
  // Sidebar Layout
  // ========================================================================

  describe('Sidebar Layout', () => {
    describe('toggleSidebar', () => {
      it('toggles left sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.toggleSidebar('left');
        });

        expect(result.current.sidebarLayout.left.collapsed).toBe(true);

        act(() => {
          result.current.toggleSidebar('left');
        });

        expect(result.current.sidebarLayout.left.collapsed).toBe(false);
      });

      it('toggles right sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.toggleSidebar('right');
        });

        expect(result.current.sidebarLayout.right.collapsed).toBe(true);

        act(() => {
          result.current.toggleSidebar('right');
        });

        expect(result.current.sidebarLayout.right.collapsed).toBe(false);
      });

      it('announces sidebar state change', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.toggleSidebar('left');
        });

        expect(result.current.announcement).toContain('Left sidebar');
        expect(result.current.announcement).toContain('collapsed');
      });
    });

    describe('setSidebarCollapsed', () => {
      it('collapses left sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarCollapsed('left', true);
        });

        expect(result.current.sidebarLayout.left.collapsed).toBe(true);
      });

      it('expands right sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarCollapsed('right', true);
          result.current.setSidebarCollapsed('right', false);
        });

        expect(result.current.sidebarLayout.right.collapsed).toBe(false);
      });
    });

    describe('setSidebarWidth', () => {
      it('sets sidebar width', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarWidth('left', 350);
        });

        expect(result.current.sidebarLayout.left.width).toBe(350);
      });

      it('clamps width to minimum of 200', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarWidth('left', 100);
        });

        expect(result.current.sidebarLayout.left.width).toBe(200);
      });

      it('clamps width to maximum of 500', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarWidth('right', 600);
        });

        expect(result.current.sidebarLayout.right.width).toBe(500);
      });

      it('allows valid widths within range', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarWidth('left', 250);
          result.current.setSidebarWidth('right', 400);
        });

        expect(result.current.sidebarLayout.left.width).toBe(250);
        expect(result.current.sidebarLayout.right.width).toBe(400);
      });
    });

    describe('setSidebarPanelHeight', () => {
      it('sets panel height and normalizes', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarPanelHeight('left', 0, 70);
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        // Heights should be normalized to sum to 100
        const totalHeight = leftPanels.reduce((sum, p) => sum + p.height, 0);
        expect(totalHeight).toBeCloseTo(100, 1);
      });

      it('clamps panel height to minimum of 10', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarPanelHeight('left', 0, 5);
        });

        const panel = result.current.sidebarLayout.left.panels[0];
        expect(panel.height).toBeGreaterThanOrEqual(10);
      });

      it('clamps panel height to maximum of 90', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarPanelHeight('left', 0, 95);
        });

        const panel = result.current.sidebarLayout.left.panels[0];
        expect(panel.height).toBeLessThanOrEqual(90);
      });

      it('handles invalid panel index gracefully', () => {
        const { result } = renderHook(() => useUIStore());

        expect(() => {
          act(() => {
            result.current.setSidebarPanelHeight('left', 99, 50);
          });
        }).not.toThrow();
      });
    });

    describe('movePanel', () => {
      it('moves panel from left to right', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.movePanel('files', 'right');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const rightPanels = result.current.sidebarLayout.right.panels;

        expect(leftPanels.some((p) => p.panelId === 'files')).toBe(false);
        expect(rightPanels.some((p) => p.panelId === 'files')).toBe(true);
      });

      it('moves panel from right to left', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.movePanel('agents', 'left');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const rightPanels = result.current.sidebarLayout.right.panels;

        expect(rightPanels.some((p) => p.panelId === 'agents')).toBe(false);
        expect(leftPanels.some((p) => p.panelId === 'agents')).toBe(true);
      });

      it('does nothing if panel already on target side', () => {
        const { result } = renderHook(() => useUIStore());
        const initialLeftPanels = result.current.sidebarLayout.left.panels;

        act(() => {
          result.current.movePanel('files', 'left');
        });

        expect(result.current.sidebarLayout.left.panels).toEqual(initialLeftPanels);
      });

      it('normalizes panel heights after move', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.movePanel('files', 'right');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const rightPanels = result.current.sidebarLayout.right.panels;

        const leftTotal = leftPanels.reduce((sum, p) => sum + p.height, 0);
        const rightTotal = rightPanels.reduce((sum, p) => sum + p.height, 0);

        expect(leftTotal).toBeCloseTo(100, 1);
        expect(rightTotal).toBeCloseTo(100, 1);
      });

      it('announces panel move', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.movePanel('files', 'right');
        });

        expect(result.current.announcement).toContain('files');
        expect(result.current.announcement).toContain('right');
      });
    });

    describe('removePanel', () => {
      it('removes panel from left sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.removePanel('files');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        expect(leftPanels.some((p) => p.panelId === 'files')).toBe(false);
      });

      it('removes panel from right sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.removePanel('agents');
        });

        const rightPanels = result.current.sidebarLayout.right.panels;
        expect(rightPanels.some((p) => p.panelId === 'agents')).toBe(false);
      });

      it('normalizes remaining panel heights', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.removePanel('files');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const totalHeight = leftPanels.reduce((sum, p) => sum + p.height, 0);

        expect(totalHeight).toBeCloseTo(100, 1);
      });

      it('announces panel removal', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.removePanel('files');
        });

        expect(result.current.announcement).toContain('files');
        expect(result.current.announcement).toContain('closed');
      });
    });

    describe('addPanel', () => {
      it('adds panel to left sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.addPanel('search', 'left');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        expect(leftPanels.some((p) => p.panelId === 'search')).toBe(true);
      });

      it('adds panel to right sidebar', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.addPanel('preview', 'right');
        });

        const rightPanels = result.current.sidebarLayout.right.panels;
        expect(rightPanels.some((p) => p.panelId === 'preview')).toBe(true);
      });

      it('removes panel from other side before adding', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.addPanel('files', 'right');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const rightPanels = result.current.sidebarLayout.right.panels;

        expect(leftPanels.some((p) => p.panelId === 'files')).toBe(false);
        expect(rightPanels.some((p) => p.panelId === 'files')).toBe(true);
      });

      it('normalizes panel heights after adding', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.addPanel('search', 'left');
        });

        const leftPanels = result.current.sidebarLayout.left.panels;
        const totalHeight = leftPanels.reduce((sum, p) => sum + p.height, 0);

        expect(totalHeight).toBeCloseTo(100, 1);
      });

      it('announces panel addition', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.addPanel('search', 'left');
        });

        expect(result.current.announcement).toContain('search');
        expect(result.current.announcement).toContain('left');
      });
    });

    describe('resetSidebarLayout', () => {
      it('resets to default layout', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setSidebarCollapsed('left', true);
          result.current.setSidebarWidth('right', 450);
          result.current.removePanel('files');
          result.current.resetSidebarLayout();
        });

        expect(result.current.sidebarLayout.left.collapsed).toBe(false);
        expect(result.current.sidebarLayout.left.width).toBe(280);
        expect(result.current.sidebarLayout.left.panels).toHaveLength(2);
      });

      it('announces layout reset', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.resetSidebarLayout();
        });

        expect(result.current.announcement).toContain('reset');
      });
    });

    describe('Git Widget Settings', () => {
      it('sets git widget working directory for session', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitWidgetWorkingDirectory('session-1', '/workspace/project');
        });

        expect(result.current.gitWidgetSettingsBySession['session-1'].workingDirectory).toBe(
          '/workspace/project'
        );
      });

      it('can clear git widget working directory', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitWidgetWorkingDirectory('session-1', '/workspace/project');
          result.current.setGitWidgetWorkingDirectory('session-1', null);
        });

        expect(result.current.gitWidgetSettingsBySession['session-1'].workingDirectory).toBeNull();
      });
    });

    describe('GitHub Widget Settings', () => {
      it('sets github widget filters for session', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetFilters('session-1', {
            branch: 'main',
            status: 'open',
          });
        });

        expect(result.current.githubWidgetFiltersBySession['session-1']).toEqual({
          branch: 'main',
          status: 'open',
        });
      });

      it('partially updates github widget filters', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetFilters('session-1', { branch: 'main' });
          result.current.setGitHubWidgetFilters('session-1', { status: 'closed' });
        });

        expect(result.current.githubWidgetFiltersBySession['session-1']).toEqual({
          branch: 'main',
          status: 'closed',
        });
      });

      it('sets github widget repo for session', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetRepo('session-1', {
            owner: 'octocat',
            repo: 'hello-world',
          });
        });

        expect(result.current.githubWidgetRepoBySession['session-1']).toEqual({
          owner: 'octocat',
          repo: 'hello-world',
        });
      });

      it('can clear github widget repo', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetRepo('session-1', {
            owner: 'octocat',
            repo: 'hello-world',
          });
          result.current.setGitHubWidgetRepo('session-1', null);
        });

        expect(result.current.githubWidgetRepoBySession['session-1']).toBeNull();
      });

      it('sets github widget panel state for pull requests', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetPanelState('session-1', 'pullRequests', true);
        });

        expect(result.current.githubWidgetPanelStatesBySession['session-1'].pullRequestsOpen).toBe(
          true
        );
      });

      it('sets github widget panel state for actions', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setGitHubWidgetPanelState('session-1', 'actions', false);
        });

        expect(result.current.githubWidgetPanelStatesBySession['session-1'].actionsOpen).toBe(
          false
        );
      });
    });
  });

  // ========================================================================
  // Terminal
  // ========================================================================

  describe('Terminal', () => {
    it('toggles terminal visibility', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleTerminal();
      });
      expect(result.current.terminalVisible).toBe(true);

      act(() => {
        result.current.toggleTerminal();
      });
      expect(result.current.terminalVisible).toBe(false);
    });

    it('sets terminal visible', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTerminalVisible(true);
      });

      expect(result.current.terminalVisible).toBe(true);
    });

    it('sets terminal height', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTerminalHeight(400);
      });

      expect(result.current.terminalHeight).toBe(400);
    });

    it('clamps terminal height to minimum of 100', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTerminalHeight(50);
      });

      expect(result.current.terminalHeight).toBe(100);
    });

    it('clamps terminal height to maximum of 600', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setTerminalHeight(700);
      });

      expect(result.current.terminalHeight).toBe(600);
    });

    it('sends terminal command and opens terminal', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.sendTerminalCommand('npm install');
      });

      expect(result.current.pendingTerminalCommand).toBe('npm install');
      expect(result.current.terminalVisible).toBe(true);
    });

    it('clears pending terminal command', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.sendTerminalCommand('npm test');
        result.current.clearPendingTerminalCommand();
      });

      expect(result.current.pendingTerminalCommand).toBeNull();
    });

    it('announces terminal state change', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleTerminal();
      });

      expect(result.current.announcement).toContain('Terminal');
    });
  });

  // ========================================================================
  // Bottom Panel
  // ========================================================================

  describe('Bottom Panel', () => {
    it('toggles panel visibility', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.panelVisible).toBe(true);

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.panelVisible).toBe(false);
    });

    it('sets panel visible', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setPanelVisible(true);
      });

      expect(result.current.panelVisible).toBe(true);
    });

    it('sets panel height', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setPanelHeight(250);
      });

      expect(result.current.panelHeight).toBe(250);
    });

    it('clamps panel height to minimum of 100', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setPanelHeight(50);
      });

      expect(result.current.panelHeight).toBe(100);
    });

    it('clamps panel height to maximum of 400', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setPanelHeight(500);
      });

      expect(result.current.panelHeight).toBe(400);
    });

    it('sets active panel and makes panel visible', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setActivePanel('problems');
      });

      expect(result.current.activePanel).toBe('problems');
      expect(result.current.panelVisible).toBe(true);
    });
  });

  // ========================================================================
  // Modals
  // ========================================================================

  describe('Modals', () => {
    it('opens modal without data', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openModal('settings');
      });

      expect(result.current.activeModal).toBe('settings');
      expect(result.current.modalData).toEqual({});
    });

    it('opens modal with data', () => {
      const { result } = renderHook(() => useUIStore());
      const data = { userId: 'user-1', action: 'edit' };

      act(() => {
        result.current.openModal('user-details', data);
      });

      expect(result.current.activeModal).toBe('user-details');
      expect(result.current.modalData).toEqual(data);
    });

    it('closes modal and clears data', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.openModal('settings', { tab: 'general' });
        result.current.closeModal();
      });

      expect(result.current.activeModal).toBeNull();
      expect(result.current.modalData).toEqual({});
    });
  });

  // ========================================================================
  // Mobile
  // ========================================================================

  describe('Mobile', () => {
    describe('Mobile Menu', () => {
      it('sets mobile menu open', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setMobileMenuOpen(true);
        });

        expect(result.current.isMobileMenuOpen).toBe(true);
      });

      it('toggles mobile menu', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.toggleMobileMenu();
        });
        expect(result.current.isMobileMenuOpen).toBe(true);

        act(() => {
          result.current.toggleMobileMenu();
        });
        expect(result.current.isMobileMenuOpen).toBe(false);
      });
    });

    describe('Mobile Widgets', () => {
      it('opens mobile widget', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileWidget('agent-chat');
        });

        expect(result.current.mobileActiveWidget).toBe('agent-chat');
      });

      it('closes mobile widget', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileWidget('files');
          result.current.closeMobileWidget();
        });

        expect(result.current.mobileActiveWidget).toBeNull();
      });
    });

    describe('Mobile File Viewer', () => {
      it('opens mobile file', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileFile('/src/App.tsx', 'const App = () => {}', 'typescript');
        });

        expect(result.current.mobileOpenFile).toEqual({
          path: '/src/App.tsx',
          content: 'const App = () => {}',
          language: 'typescript',
        });
      });

      it('closes mobile file', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileFile('/src/App.tsx', 'content', 'typescript');
          result.current.closeMobileFile();
        });

        expect(result.current.mobileOpenFile).toBeNull();
      });
    });

    describe('Mobile File Actions', () => {
      it('opens mobile file actions for file', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
        });

        expect(result.current.mobileFileActionsTarget).toEqual({
          path: '/src/App.tsx',
          name: 'App.tsx',
          type: 'file',
        });
      });

      it('opens mobile file actions for directory', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileFileActions('/src', 'src', 'directory');
        });

        expect(result.current.mobileFileActionsTarget).toEqual({
          path: '/src',
          name: 'src',
          type: 'directory',
        });
      });

      it('closes mobile file actions', () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.openMobileFileActions('/src/App.tsx', 'App.tsx', 'file');
          result.current.closeMobileFileActions();
        });

        expect(result.current.mobileFileActionsTarget).toBeNull();
      });
    });
  });

  // ========================================================================
  // Preferences
  // ========================================================================

  describe('Preferences', () => {
    it('sets prefers reduced motion', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setPrefersReducedMotion(true);
      });

      expect(result.current.prefersReducedMotion).toBe(true);
    });

    it('toggles focus mode', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleFocusMode();
      });
      expect(result.current.focusMode).toBe(true);

      act(() => {
        result.current.toggleFocusMode();
      });
      expect(result.current.focusMode).toBe(false);
    });

    it('announces focus mode change', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.toggleFocusMode();
      });

      expect(result.current.announcement).toContain('Focus mode');
    });

    it('sets show hidden files', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setShowHiddenFiles(true);
      });

      expect(result.current.showHiddenFiles).toBe(true);
    });
  });

  // ========================================================================
  // Grid Config
  // ========================================================================

  describe('Grid Configuration', () => {
    it('sets grid config columns', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setGridConfig({ columns: 4 });
      });

      expect(result.current.gridConfig.columns).toBe(4);
    });

    it('sets grid config row height', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setGridConfig({ rowHeight: 400 });
      });

      expect(result.current.gridConfig.rowHeight).toBe(400);
    });

    it('partially updates grid config', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setGridConfig({ columns: 3 });
        result.current.setGridConfig({ rowHeight: 350 });
      });

      expect(result.current.gridConfig.columns).toBe(3);
      expect(result.current.gridConfig.rowHeight).toBe(350);
      expect(result.current.gridConfig.maxRows).toBe(0); // Unchanged
    });

    it('resets grid config to defaults', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.setGridConfig({ columns: 6, rowHeight: 500 });
        result.current.resetGridConfig();
      });

      expect(result.current.gridConfig.columns).toBe(2);
      expect(result.current.gridConfig.rowHeight).toBe(300);
      expect(result.current.gridConfig.maxRows).toBe(0);
      expect(result.current.gridConfig.maxCols).toBe(0);
    });
  });

  // ========================================================================
  // Announcements
  // ========================================================================

  describe('Announcements', () => {
    it('announces message for screen readers', () => {
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.announce('File saved successfully');
      });

      expect(result.current.announcement).toBe('File saved successfully');
    });

    it('clears announcement after delay', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useUIStore());

      act(() => {
        result.current.announce('Test message');
      });

      expect(result.current.announcement).toBe('Test message');

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      vi.useRealTimers();

      await waitFor(() => {
        expect(result.current.announcement).toBe('');
      });
    });
  });

  // ========================================================================
  // Server Sync
  // ========================================================================

  describe('Server Sync', () => {
    describe('loadFromServer', () => {
      it('loads preferences from server', async () => {
        mockedGetUserConfig.mockResolvedValue({
          ui_preferences: {
            theme: 'light',
            terminalHeight: 350,
            showHiddenFiles: true,
          },
        } as any);

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.theme).toBe('light');
        expect(result.current.terminalHeight).toBe(350);
        expect(result.current.showHiddenFiles).toBe(true);
      });

      it('handles null response when not authenticated', async () => {
        mockedGetUserConfig.mockResolvedValue(null);

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        // Should silently use localStorage defaults
        expect(result.current.isLoading).toBe(false);
      });

      it('handles server errors gracefully', async () => {
        mockedGetUserConfig.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.loadFromServer();
        });

        expect(result.current.isLoading).toBe(false);
      });

      it('sets loading state during fetch', async () => {
        let resolvePromise: (value: any) => void;
        const promise = new Promise((resolve) => {
          resolvePromise = resolve;
        });
        mockedGetUserConfig.mockReturnValue(promise as any);

        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.loadFromServer();
        });

        expect(result.current.isLoading).toBe(true);

        await act(async () => {
          resolvePromise!(null);
          await promise;
        });

        expect(result.current.isLoading).toBe(false);
      });
    });

    describe('syncToServer', () => {
      it('syncs preferences to server when authenticated', async () => {
        const { result } = renderHook(() => useUIStore());

        act(() => {
          result.current.setTheme('light');
        });

        await act(async () => {
          await result.current.syncToServer();
        });

        expect(mockedUpdateUserConfig).toHaveBeenCalledWith({
          ui_preferences: expect.objectContaining({
            theme: 'light',
          }),
        });
      });

      it('skips sync when not authenticated', async () => {
        mockedUseAuthStore.getState.mockReturnValue({
          user: null,
          tokens: null,
        } as any);

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        expect(mockedUpdateUserConfig).not.toHaveBeenCalled();
      });

      it('handles 401 errors silently', async () => {
        mockedUpdateUserConfig.mockRejectedValue({ status: 401 });

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        // Should not throw
        expect(result.current.isLoading).toBe(false);
      });

      it('handles 403 errors silently', async () => {
        mockedUpdateUserConfig.mockRejectedValue({ status: 403 });

        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        // Should not throw
        expect(result.current.isLoading).toBe(false);
      });

      it('updates lastSyncedAt on successful sync', async () => {
        const { result } = renderHook(() => useUIStore());

        await act(async () => {
          await result.current.syncToServer();
        });

        expect(result.current.lastSyncedAt).toBeGreaterThan(0);
      });
    });
  });
});
