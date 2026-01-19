import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { getUserConfig, updateUserConfig } from '@/lib/api/user-config';
import { useAuthStore } from '@/stores/auth';

export type Theme = 'dark' | 'light' | 'system';

// Panel layout types
export type PanelId =
  | 'agents'
  | 'files'
  | 'git'
  | 'github'
  | 'preview'
  | 'mcp'
  | 'extensions'
  | 'search'
  | 'problems'
  | 'usage'
  | 'sentry'
  | 'skills';
export type SidebarSide = 'left' | 'right';

export interface PanelSlot {
  panelId: PanelId;
  height: number; // percentage height (0-100), will be normalized
}

export interface SidebarConfig {
  collapsed: boolean;
  width: number;
  panels: PanelSlot[];
}

export interface SidebarLayoutState {
  left: SidebarConfig;
  right: SidebarConfig;
}

const DEFAULT_SIDEBAR_LAYOUT: SidebarLayoutState = {
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
};

// Helper to normalize panel heights to sum to 100
function normalizePanelHeights(panels: PanelSlot[]): PanelSlot[] {
  if (panels.length === 0) return [];
  const total = panels.reduce((sum, p) => sum + p.height, 0);
  if (total === 0) {
    const equalHeight = 100 / panels.length;
    return panels.map((p) => ({ ...p, height: equalHeight }));
  }
  return panels.map((p) => ({ ...p, height: (p.height / total) * 100 }));
}

interface UIState {
  // Hydration tracking
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  // Server sync
  isLoading: boolean;
  lastSyncedAt: number | null;
  loadFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;

  // Theme
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;

  // Command palette
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Quick open (Cmd+P)
  quickOpenOpen: boolean;
  openQuickOpen: () => void;
  closeQuickOpen: () => void;
  toggleQuickOpen: () => void;

  // Global search
  globalSearchOpen: boolean;
  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  toggleGlobalSearch: () => void;

  // Sidebar layout
  sidebarLayout: SidebarLayoutState;
  toggleSidebar: (side: SidebarSide) => void;
  setSidebarCollapsed: (side: SidebarSide, collapsed: boolean) => void;
  setSidebarWidth: (side: SidebarSide, width: number) => void;
  setSidebarPanelHeight: (side: SidebarSide, panelIndex: number, height: number) => void;
  movePanel: (panelId: PanelId, toSide: SidebarSide) => void;
  removePanel: (panelId: PanelId) => void;
  addPanel: (panelId: PanelId, side: SidebarSide) => void;
  resetSidebarLayout: () => void;

  // Legacy compatibility
  sidebarCollapsed: boolean;

  // Terminal
  terminalVisible: boolean;
  terminalHeight: number;
  toggleTerminal: () => void;
  setTerminalVisible: (visible: boolean) => void;
  setTerminalHeight: (height: number) => void;

  // Bottom panel (output, problems, etc.)
  panelVisible: boolean;
  panelHeight: number;
  activePanel: 'output' | 'problems' | 'terminal';
  togglePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  setPanelHeight: (height: number) => void;
  setActivePanel: (panel: 'output' | 'problems' | 'terminal') => void;

  // Modals
  activeModal: string | null;
  modalData: Record<string, unknown>;
  openModal: (modalId: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Announcements (for screen readers)
  announcement: string;
  announce: (message: string) => void;

  // Mobile
  isMobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;

  // Mobile widgets (for workspace bottom sheets)
  mobileActiveWidget: string | null;
  openMobileWidget: (widgetId: string) => void;
  closeMobileWidget: () => void;

  // Mobile file viewer
  mobileOpenFile: { path: string; content: string; language: string } | null;
  openMobileFile: (path: string, content: string, language: string) => void;
  closeMobileFile: () => void;

  // Mobile file actions (quick actions sheet)
  mobileFileActionsTarget: { path: string; name: string; type: 'file' | 'directory' } | null;
  openMobileFileActions: (path: string, name: string, type: 'file' | 'directory') => void;
  closeMobileFileActions: () => void;

  // Reduced motion preference
  prefersReducedMotion: boolean;
  setPrefersReducedMotion: (prefers: boolean) => void;

  // Focus mode (hides distractions)
  focusMode: boolean;
  toggleFocusMode: () => void;
}

// Helper to get system theme preference
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Helper to apply theme to document
function applyTheme(theme: 'dark' | 'light') {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

// Debounce helper
let uiSyncTimeout: NodeJS.Timeout | null = null;
const debouncedSync = (get: () => UIState) => {
  if (uiSyncTimeout) clearTimeout(uiSyncTimeout);
  uiSyncTimeout = setTimeout(() => {
    get().syncToServer().catch(console.error);
  }, 500);
};

const uiStoreCreator: StateCreator<UIState, [], [['zustand/persist', unknown]]> = (set, get) => ({
  // Hydration tracking
  _hasHydrated: false,
  setHasHydrated: (state: boolean) => set({ _hasHydrated: state }),

  // Server sync
  isLoading: false,
  lastSyncedAt: null,

  loadFromServer: async () => {
    set({ isLoading: true });
    try {
      const config = await getUserConfig();

      // If null (not authenticated), silently use localStorage defaults
      if (!config) {
        set({ isLoading: false });
        return;
      }

      const serverPrefs = config.ui_preferences || {};

      // Merge server preferences with current state
      const updates: Partial<UIState> = {
        isLoading: false,
        lastSyncedAt: Date.now(),
      };

      if (serverPrefs.theme) {
        const resolved = serverPrefs.theme === 'system' ? getSystemTheme() : serverPrefs.theme;
        applyTheme(resolved);
        updates.theme = serverPrefs.theme;
        updates.resolvedTheme = resolved;
      }

      if (serverPrefs.sidebarLayout) {
        updates.sidebarLayout = serverPrefs.sidebarLayout;
      }

      if (serverPrefs.terminalHeight !== undefined) {
        updates.terminalHeight = serverPrefs.terminalHeight;
      }

      if (serverPrefs.panelHeight !== undefined) {
        updates.panelHeight = serverPrefs.panelHeight;
      }

      if (serverPrefs.prefersReducedMotion !== undefined) {
        updates.prefersReducedMotion = serverPrefs.prefersReducedMotion;
      }

      if (serverPrefs.focusMode !== undefined) {
        updates.focusMode = serverPrefs.focusMode;
      }

      set(updates);
    } catch (error) {
      console.error('Failed to load UI preferences from server:', error);
      set({ isLoading: false });
    }
  },

  syncToServer: async () => {
    const state = get();

    // Check if user is authenticated before attempting to sync
    const authState = useAuthStore.getState();
    if (!authState.user || !authState.tokens) {
      // User is not authenticated, silently skip sync
      return;
    }

    const prefsToSync = {
      theme: state.theme,
      sidebarLayout: state.sidebarLayout,
      terminalHeight: state.terminalHeight,
      panelHeight: state.panelHeight,
      prefersReducedMotion: state.prefersReducedMotion,
      focusMode: state.focusMode,
    };

    try {
      const result = await updateUserConfig({ ui_preferences: prefsToSync });
      // If null, user is not authenticated - silently skip
      if (result !== null) {
        set({ lastSyncedAt: Date.now() });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // Silently ignore auth errors (401/403) and network errors (503)
      // User has been logged out automatically by the API client
      if (error?.status === 401 || error?.status === 403 || error?.status === 503) {
        console.warn('Skipping UI sync - user not authenticated or network error');
        return;
      }
      // Log other errors but don't throw to avoid breaking the UI
      console.error('Failed to sync UI preferences to server:', error);
    }
  },

  // Theme
  theme: 'dark' as Theme,
  resolvedTheme: 'dark' as 'dark' | 'light',
  setTheme: (theme) => {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    applyTheme(resolved);
    set({ theme, resolvedTheme: resolved });
    debouncedSync(get);
  },

  // Command palette
  commandPaletteOpen: false,
  openCommandPalette: () =>
    set({
      commandPaletteOpen: true,
      quickOpenOpen: false,
      globalSearchOpen: false,
    }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () =>
    set((state) => ({
      commandPaletteOpen: !state.commandPaletteOpen,
      quickOpenOpen: false,
      globalSearchOpen: false,
    })),

  // Quick open
  quickOpenOpen: false,
  openQuickOpen: () =>
    set({
      quickOpenOpen: true,
      commandPaletteOpen: false,
      globalSearchOpen: false,
    }),
  closeQuickOpen: () => set({ quickOpenOpen: false }),
  toggleQuickOpen: () =>
    set((state) => ({
      quickOpenOpen: !state.quickOpenOpen,
      commandPaletteOpen: false,
      globalSearchOpen: false,
    })),

  // Global search
  globalSearchOpen: false,
  openGlobalSearch: () =>
    set({
      globalSearchOpen: true,
      commandPaletteOpen: false,
      quickOpenOpen: false,
    }),
  closeGlobalSearch: () => set({ globalSearchOpen: false }),
  toggleGlobalSearch: () =>
    set((state) => ({
      globalSearchOpen: !state.globalSearchOpen,
      commandPaletteOpen: false,
      quickOpenOpen: false,
    })),

  // Sidebar layout
  sidebarLayout: DEFAULT_SIDEBAR_LAYOUT,

  // Legacy compatibility getter - must be safe during rehydration
  get sidebarCollapsed() {
    return get()?.sidebarLayout?.left?.collapsed ?? false;
  },

  toggleSidebar: (side: SidebarSide) => {
    const layout = get().sidebarLayout;
    const newCollapsed = !layout[side].collapsed;
    set({
      sidebarLayout: {
        ...layout,
        [side]: { ...layout[side], collapsed: newCollapsed },
      },
    });
    get().announce(
      `${side === 'left' ? 'Left' : 'Right'} sidebar ${newCollapsed ? 'collapsed' : 'expanded'}`
    );
    debouncedSync(get);
  },

  setSidebarCollapsed: (side: SidebarSide, collapsed: boolean) => {
    const layout = get().sidebarLayout;
    set({
      sidebarLayout: {
        ...layout,
        [side]: { ...layout[side], collapsed },
      },
    });
    debouncedSync(get);
  },

  setSidebarWidth: (side: SidebarSide, width: number) => {
    const layout = get().sidebarLayout;
    set({
      sidebarLayout: {
        ...layout,
        [side]: { ...layout[side], width: Math.max(200, Math.min(500, width)) },
      },
    });
    debouncedSync(get);
  },

  setSidebarPanelHeight: (side: SidebarSide, panelIndex: number, height: number) => {
    const layout = get().sidebarLayout;
    const panels = [...layout[side].panels];
    const panel = panels[panelIndex];
    if (!panel) return;

    // Update the height of the target panel
    panels[panelIndex] = {
      panelId: panel.panelId,
      height: Math.max(10, Math.min(90, height)),
    };

    // Normalize heights to sum to 100
    const normalized = normalizePanelHeights(panels);

    set({
      sidebarLayout: {
        ...layout,
        [side]: { ...layout[side], panels: normalized },
      },
    });
    debouncedSync(get);
  },

  movePanel: (panelId: PanelId, toSide: SidebarSide) => {
    const layout = get().sidebarLayout;
    const fromSide = layout.left.panels.some((p) => p.panelId === panelId) ? 'left' : 'right';

    if (fromSide === toSide) return; // No-op if already on target side

    // Remove from current location
    const newFromPanels = layout[fromSide].panels.filter((p) => p.panelId !== panelId);

    // Add to new sidebar at the bottom with equal share
    const newToPanels = [...layout[toSide].panels, { panelId, height: 100 }];

    set({
      sidebarLayout: {
        ...layout,
        [fromSide]: {
          ...layout[fromSide],
          panels: normalizePanelHeights(newFromPanels),
        },
        [toSide]: {
          ...layout[toSide],
          panels: normalizePanelHeights(newToPanels),
        },
      },
    });
    get().announce(`${panelId} moved to ${toSide} sidebar`);
  },

  removePanel: (panelId: PanelId) => {
    const layout = get().sidebarLayout;
    const side = layout.left.panels.some((p) => p.panelId === panelId) ? 'left' : 'right';
    const newPanels = layout[side].panels.filter((p) => p.panelId !== panelId);

    set({
      sidebarLayout: {
        ...layout,
        [side]: { ...layout[side], panels: normalizePanelHeights(newPanels) },
      },
    });
    get().announce(`${panelId} panel closed`);
  },

  addPanel: (panelId: PanelId, side: SidebarSide) => {
    const layout = get().sidebarLayout;

    // First remove from any existing location
    let leftPanels = layout.left.panels.filter((p) => p.panelId !== panelId);
    let rightPanels = layout.right.panels.filter((p) => p.panelId !== panelId);

    // Add to target sidebar at the bottom
    if (side === 'left') {
      leftPanels = [...leftPanels, { panelId, height: 100 }];
    } else {
      rightPanels = [...rightPanels, { panelId, height: 100 }];
    }

    set({
      sidebarLayout: {
        left: {
          ...layout.left,
          panels: normalizePanelHeights(leftPanels),
          collapsed: side === 'left' ? false : layout.left.collapsed,
        },
        right: {
          ...layout.right,
          panels: normalizePanelHeights(rightPanels),
          collapsed: side === 'right' ? false : layout.right.collapsed,
        },
      },
    });
    get().announce(`${panelId} added to ${side} sidebar`);
  },

  resetSidebarLayout: () => {
    set({ sidebarLayout: DEFAULT_SIDEBAR_LAYOUT });
    get().announce('Sidebar layout reset to default');
  },

  // Terminal
  terminalVisible: false,
  terminalHeight: 300,
  toggleTerminal: () => {
    const newState = !get().terminalVisible;
    set({ terminalVisible: newState });
    get().announce(newState ? 'Terminal opened' : 'Terminal closed');
  },
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  setTerminalHeight: (height) => {
    set({ terminalHeight: Math.max(100, Math.min(600, height)) });
    debouncedSync(get);
  },

  // Bottom panel
  panelVisible: false,
  panelHeight: 200,
  activePanel: 'output',
  togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
  setPanelVisible: (visible) => set({ panelVisible: visible }),
  setPanelHeight: (height) => {
    set({ panelHeight: Math.max(100, Math.min(400, height)) });
    debouncedSync(get);
  },
  setActivePanel: (panel) => set({ activePanel: panel, panelVisible: true }),

  // Modals
  activeModal: null,
  modalData: {},
  openModal: (modalId, data = {}) => set({ activeModal: modalId, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: {} }),

  // Announcements (for screen readers)
  announcement: '',
  announce: (message) => {
    set({ announcement: message });
    // Clear after a short delay to allow re-announcement of same message
    setTimeout(() => set({ announcement: '' }), 1000);
  },

  // Mobile
  isMobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ isMobileMenuOpen: open }),
  toggleMobileMenu: () => set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),

  // Mobile widgets (for workspace bottom sheets)
  mobileActiveWidget: null,
  openMobileWidget: (widgetId) => set({ mobileActiveWidget: widgetId }),
  closeMobileWidget: () => set({ mobileActiveWidget: null }),

  // Mobile file viewer
  mobileOpenFile: null,
  openMobileFile: (path, content, language) => set({ mobileOpenFile: { path, content, language } }),
  closeMobileFile: () => set({ mobileOpenFile: null }),

  // Mobile file actions (quick actions sheet)
  mobileFileActionsTarget: null,
  openMobileFileActions: (path, name, type) =>
    set({ mobileFileActionsTarget: { path, name, type } }),
  closeMobileFileActions: () => set({ mobileFileActionsTarget: null }),

  // Reduced motion preference
  prefersReducedMotion: false,
  setPrefersReducedMotion: (prefers) => set({ prefersReducedMotion: prefers }),

  // Focus mode
  focusMode: false,
  toggleFocusMode: () => {
    const newState = !get().focusMode;
    set({ focusMode: newState });
    get().announce(newState ? 'Focus mode enabled' : 'Focus mode disabled');
    debouncedSync(get);
  },
});

const persistedUIStore = persist(uiStoreCreator, {
  name: 'podex-ui-settings',
  partialize: (state) => ({
    theme: state.theme,
    sidebarLayout: state.sidebarLayout,
    terminalVisible: state.terminalVisible,
    terminalHeight: state.terminalHeight,
    panelVisible: state.panelVisible,
    panelHeight: state.panelHeight,
    activePanel: state.activePanel,
    prefersReducedMotion: state.prefersReducedMotion,
    focusMode: state.focusMode,
  }),
  onRehydrateStorage: () => (state) => {
    state?.setHasHydrated(true);
  },
  // Migration from old sidebarCollapsed to new sidebarLayout
  migrate: (persistedState: unknown, _version: number) => {
    const state = persistedState as Record<string, unknown>;
    if (state.sidebarCollapsed !== undefined && !state.sidebarLayout) {
      return {
        ...state,
        sidebarLayout: {
          ...DEFAULT_SIDEBAR_LAYOUT,
          left: {
            ...DEFAULT_SIDEBAR_LAYOUT.left,
            collapsed: state.sidebarCollapsed as boolean,
          },
        },
      };
    }
    return state;
  },
  version: 1,
});

// Only enable devtools in development to prevent exposing state in production
export const useUIStore = create<UIState>()(
  devtools(persistedUIStore, {
    name: 'podex-ui',
    enabled: process.env.NODE_ENV === 'development',
  })
);

// Initialize theme on load
if (typeof window !== 'undefined') {
  // Listen for system theme changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    const state = useUIStore.getState();
    if (state.theme === 'system') {
      const resolved = e.matches ? 'dark' : 'light';
      applyTheme(resolved);
      useUIStore.setState({ resolvedTheme: resolved });
    }
  });

  // Listen for reduced motion preference
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  useUIStore.setState({ prefersReducedMotion: motionQuery.matches });
  motionQuery.addEventListener('change', (e) => {
    useUIStore.setState({ prefersReducedMotion: e.matches });
  });
}

// Convenience hooks
export const useTheme = () => {
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  return { theme, setTheme };
};
export const useAnnounce = () => useUIStore((state) => state.announce);
export const useFocusMode = () => {
  const focusMode = useUIStore((state) => state.focusMode);
  const toggle = useUIStore((state) => state.toggleFocusMode);
  return { focusMode, toggle };
};
