import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export type SplitDirection = 'horizontal' | 'vertical';
export type SplitLayout = 'single' | 'horizontal' | 'vertical' | 'quad';
export type KeyMode = 'default' | 'vim' | 'emacs';

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  language: string;
  isDirty: boolean;
  isPreview: boolean; // Single-click preview vs double-click permanent
  paneId: string;
  scrollPosition?: { line: number; column: number };
  cursorPosition?: { line: number; column: number };
}

export interface SplitPane {
  id: string;
  tabs: string[]; // Tab IDs
  activeTabId: string | null;
  size: number; // Percentage of available space (0-100)
}

export interface EditorSettings {
  keyMode: KeyMode;
  fontSize: number;
  tabSize: number;
  wordWrap: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  minimap: boolean;
  lineNumbers: 'on' | 'off' | 'relative' | 'interval';
  renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  cursorBlinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
  bracketPairColorization: boolean;
  formatOnSave: boolean;
  formatOnPaste: boolean;
  autoSave: 'off' | 'afterDelay' | 'onFocusChange';
  autoSaveDelay: number; // ms
}

export interface EditorState {
  // Tab management
  tabs: Record<string, EditorTab>;
  tabOrder: string[]; // Ordered tab IDs for display

  // Split view
  splitLayout: SplitLayout;
  panes: Record<string, SplitPane>;
  paneOrder: string[]; // For layout rendering
  activePaneId: string | null;

  // Global editor state
  settings: EditorSettings;

  // Recently closed tabs (for reopening)
  recentlyClosed: EditorTab[];

  // Actions - Tab Management
  openTab: (tab: Omit<EditorTab, 'id'>) => string;
  closeTab: (tabId: string) => void;
  closeAllTabs: (paneId?: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setTabDirty: (tabId: string, isDirty: boolean) => void;
  pinTab: (tabId: string) => void; // Convert preview to permanent
  reorderTabs: (paneId: string, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (tabId: string, targetPaneId: string) => void;
  updateTabScrollPosition: (tabId: string, line: number, column: number) => void;
  updateTabCursorPosition: (tabId: string, line: number, column: number) => void;
  reopenClosedTab: () => EditorTab | null;

  // Actions - Split View
  splitPane: (paneId: string, direction: SplitDirection) => string;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  resizePane: (paneId: string, size: number) => void;
  setSplitLayout: (layout: SplitLayout) => void;

  // Actions - Settings
  updateSettings: (settings: Partial<EditorSettings>) => void;
  setKeyMode: (mode: KeyMode) => void;

  // Selectors
  getActiveTab: () => EditorTab | null;
  getTabsForPane: (paneId: string) => EditorTab[];
  getTabByPath: (path: string) => EditorTab | null;
  hasUnsavedChanges: () => boolean;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_SETTINGS: EditorSettings = {
  keyMode: 'default',
  fontSize: 13,
  tabSize: 2,
  wordWrap: 'off',
  minimap: false,
  lineNumbers: 'on',
  renderWhitespace: 'selection',
  cursorBlinking: 'smooth',
  bracketPairColorization: true,
  formatOnSave: false,
  formatOnPaste: true,
  autoSave: 'off',
  autoSaveDelay: 1000,
};

const DEFAULT_PANE_ID = 'main';

const createDefaultPane = (): SplitPane => ({
  id: DEFAULT_PANE_ID,
  tabs: [],
  activeTabId: null,
  size: 100,
});

// ============================================================================
// Helper Functions
// ============================================================================

const generateId = () => Math.random().toString(36).substring(2, 11);

const getFileName = (path: string): string => {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
};

// ============================================================================
// Store
// ============================================================================

export const useEditorStore = create<EditorState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        tabs: {},
        tabOrder: [],
        splitLayout: 'single',
        panes: { [DEFAULT_PANE_ID]: createDefaultPane() },
        paneOrder: [DEFAULT_PANE_ID],
        activePaneId: DEFAULT_PANE_ID,
        settings: DEFAULT_SETTINGS,
        recentlyClosed: [],

        // ========================================================================
        // Tab Management
        // ========================================================================

        openTab: (tabData) => {
          const state = get();

          // Check if tab with same path already exists
          const existingTab = Object.values(state.tabs).find((t) => t.path === tabData.path);

          if (existingTab) {
            // If existing is preview and new is permanent, upgrade it
            if (existingTab.isPreview && !tabData.isPreview) {
              set((s) => ({
                tabs: {
                  ...s.tabs,
                  [existingTab.id]: { ...existingTab, isPreview: false },
                },
              }));
            }
            // Activate existing tab
            get().setActiveTab(existingTab.id);
            return existingTab.id;
          }

          // Close existing preview tab in the target pane (only one preview at a time)
          const targetPaneId = tabData.paneId || state.activePaneId || DEFAULT_PANE_ID;
          if (tabData.isPreview) {
            const pane = state.panes[targetPaneId];
            if (pane) {
              const previewTab = pane.tabs.map((id) => state.tabs[id]).find((t) => t?.isPreview);
              if (previewTab) {
                get().closeTab(previewTab.id);
              }
            }
          }

          // Create new tab
          const id = generateId();
          const newTab: EditorTab = {
            ...tabData,
            id,
            name: getFileName(tabData.path),
            paneId: targetPaneId,
          };

          set((s) => {
            const pane = s.panes[targetPaneId] || createDefaultPane();
            return {
              tabs: { ...s.tabs, [id]: newTab },
              tabOrder: [...s.tabOrder, id],
              panes: {
                ...s.panes,
                [targetPaneId]: {
                  ...pane,
                  tabs: [...pane.tabs, id],
                  activeTabId: id,
                },
              },
              activePaneId: targetPaneId,
            };
          });

          return id;
        },

        closeTab: (tabId) => {
          const state = get();
          const tab = state.tabs[tabId];
          if (!tab) return;

          const pane = state.panes[tab.paneId];
          if (!pane) return;

          // Add to recently closed (limit to 10)
          const recentlyClosed = [tab, ...state.recentlyClosed].slice(0, 10);

          // Find next tab to activate
          const tabIndex = pane.tabs.indexOf(tabId);
          let newActiveTabId: string | null = null;

          if (pane.activeTabId === tabId && pane.tabs.length > 1) {
            // Prefer tab to the right, then to the left
            newActiveTabId = pane.tabs[tabIndex + 1] || pane.tabs[tabIndex - 1] || null;
          } else if (pane.activeTabId !== tabId) {
            newActiveTabId = pane.activeTabId;
          }

          set((s) => {
            const { [tabId]: _removed, ...remainingTabs } = s.tabs;
            return {
              tabs: remainingTabs,
              tabOrder: s.tabOrder.filter((id) => id !== tabId),
              panes: {
                ...s.panes,
                [tab.paneId]: {
                  ...pane,
                  tabs: pane.tabs.filter((id) => id !== tabId),
                  activeTabId: newActiveTabId,
                },
              },
              recentlyClosed,
            };
          });
        },

        closeAllTabs: (paneId) => {
          const state = get();
          const targetPaneId = paneId || state.activePaneId;
          if (!targetPaneId) return;

          const pane = state.panes[targetPaneId];
          if (!pane) return;

          // Add all tabs to recently closed
          const closedTabs = pane.tabs.map((id) => state.tabs[id]).filter(Boolean) as EditorTab[];

          set((s) => {
            const remainingTabs = { ...s.tabs };
            pane.tabs.forEach((id) => delete remainingTabs[id]);

            return {
              tabs: remainingTabs,
              tabOrder: s.tabOrder.filter((id) => !pane.tabs.includes(id)),
              panes: {
                ...s.panes,
                [targetPaneId]: {
                  ...pane,
                  tabs: [],
                  activeTabId: null,
                },
              },
              recentlyClosed: [...closedTabs, ...s.recentlyClosed].slice(0, 10),
            };
          });
        },

        closeOtherTabs: (tabId) => {
          const state = get();
          const tab = state.tabs[tabId];
          if (!tab) return;

          const pane = state.panes[tab.paneId];
          if (!pane) return;

          const otherTabIds = pane.tabs.filter((id) => id !== tabId);
          const closedTabs = otherTabIds.map((id) => state.tabs[id]).filter(Boolean) as EditorTab[];

          set((s) => {
            const remainingTabs = { ...s.tabs };
            otherTabIds.forEach((id) => delete remainingTabs[id]);

            return {
              tabs: remainingTabs,
              tabOrder: s.tabOrder.filter((id) => id === tabId || !otherTabIds.includes(id)),
              panes: {
                ...s.panes,
                [tab.paneId]: {
                  ...pane,
                  tabs: [tabId],
                  activeTabId: tabId,
                },
              },
              recentlyClosed: [...closedTabs, ...s.recentlyClosed].slice(0, 10),
            };
          });
        },

        closeTabsToRight: (tabId) => {
          const state = get();
          const tab = state.tabs[tabId];
          if (!tab) return;

          const pane = state.panes[tab.paneId];
          if (!pane) return;

          const tabIndex = pane.tabs.indexOf(tabId);
          const tabsToClose = pane.tabs.slice(tabIndex + 1);

          if (tabsToClose.length === 0) return;

          const closedTabs = tabsToClose.map((id) => state.tabs[id]).filter(Boolean) as EditorTab[];

          set((s) => {
            const remainingTabs = { ...s.tabs };
            tabsToClose.forEach((id) => delete remainingTabs[id]);

            const newActiveTabId = tabsToClose.includes(pane.activeTabId || '')
              ? tabId
              : pane.activeTabId;

            return {
              tabs: remainingTabs,
              tabOrder: s.tabOrder.filter((id) => !tabsToClose.includes(id)),
              panes: {
                ...s.panes,
                [tab.paneId]: {
                  ...pane,
                  tabs: pane.tabs.slice(0, tabIndex + 1),
                  activeTabId: newActiveTabId,
                },
              },
              recentlyClosed: [...closedTabs, ...s.recentlyClosed].slice(0, 10),
            };
          });
        },

        setActiveTab: (tabId) => {
          const state = get();
          const tab = state.tabs[tabId];
          if (!tab) return;

          const pane = state.panes[tab.paneId];
          if (!pane) return;

          set((s) => ({
            panes: {
              ...s.panes,
              [tab.paneId]: {
                ...pane,
                activeTabId: tabId,
              },
            },
            activePaneId: tab.paneId,
          }));
        },

        setTabDirty: (tabId, isDirty) => {
          set((s) => {
            const tab = s.tabs[tabId];
            if (!tab) return s;
            return {
              tabs: {
                ...s.tabs,
                [tabId]: { ...tab, isDirty },
              },
            };
          });
        },

        pinTab: (tabId) => {
          set((s) => {
            const tab = s.tabs[tabId];
            if (!tab) return s;
            return {
              tabs: {
                ...s.tabs,
                [tabId]: { ...tab, isPreview: false },
              },
            };
          });
        },

        reorderTabs: (paneId, fromIndex, toIndex) => {
          set((s) => {
            const pane = s.panes[paneId];
            if (!pane) return s;

            const newTabs = [...pane.tabs];
            const [movedTab] = newTabs.splice(fromIndex, 1);
            if (!movedTab) return s;
            newTabs.splice(toIndex, 0, movedTab);

            return {
              panes: {
                ...s.panes,
                [paneId]: {
                  ...pane,
                  tabs: newTabs,
                },
              },
            };
          });
        },

        moveTabToPane: (tabId, targetPaneId) => {
          const state = get();
          const tab = state.tabs[tabId];
          if (!tab || tab.paneId === targetPaneId) return;

          const sourcePane = state.panes[tab.paneId];
          const targetPane = state.panes[targetPaneId];
          if (!sourcePane || !targetPane) return;

          // Determine new active tab for source pane
          const tabIndex = sourcePane.tabs.indexOf(tabId);
          let newSourceActiveTabId: string | null = null;
          if (sourcePane.activeTabId === tabId && sourcePane.tabs.length > 1) {
            newSourceActiveTabId =
              sourcePane.tabs[tabIndex + 1] || sourcePane.tabs[tabIndex - 1] || null;
          }

          set((s) => ({
            tabs: {
              ...s.tabs,
              [tabId]: { ...tab, paneId: targetPaneId },
            },
            panes: {
              ...s.panes,
              [tab.paneId]: {
                ...sourcePane,
                tabs: sourcePane.tabs.filter((id) => id !== tabId),
                activeTabId: newSourceActiveTabId,
              },
              [targetPaneId]: {
                ...targetPane,
                tabs: [...targetPane.tabs, tabId],
                activeTabId: tabId,
              },
            },
            activePaneId: targetPaneId,
          }));
        },

        updateTabScrollPosition: (tabId, line, column) => {
          set((s) => {
            const tab = s.tabs[tabId];
            if (!tab) return s;
            return {
              tabs: {
                ...s.tabs,
                [tabId]: { ...tab, scrollPosition: { line, column } },
              },
            };
          });
        },

        updateTabCursorPosition: (tabId, line, column) => {
          set((s) => {
            const tab = s.tabs[tabId];
            if (!tab) return s;
            return {
              tabs: {
                ...s.tabs,
                [tabId]: { ...tab, cursorPosition: { line, column } },
              },
            };
          });
        },

        reopenClosedTab: () => {
          const state = get();
          if (state.recentlyClosed.length === 0) return null;

          const tabToReopen = state.recentlyClosed[0];
          if (!tabToReopen) return null;

          const remaining = state.recentlyClosed.slice(1);
          set({ recentlyClosed: remaining });

          // Re-open the tab
          get().openTab({
            path: tabToReopen.path,
            name: tabToReopen.name,
            language: tabToReopen.language,
            isDirty: false,
            isPreview: false,
            paneId: state.activePaneId || DEFAULT_PANE_ID,
          });

          return tabToReopen;
        },

        // ========================================================================
        // Split View
        // ========================================================================

        splitPane: (paneId, direction) => {
          const state = get();
          const sourcePane = state.panes[paneId];
          if (!sourcePane) return paneId;

          const newPaneId = generateId();
          const newPane: SplitPane = {
            id: newPaneId,
            tabs: [],
            activeTabId: null,
            size: 50,
          };

          // Update source pane size
          const updatedSourcePane = { ...sourcePane, size: 50 };

          // Determine new layout
          let newLayout: SplitLayout = state.splitLayout;
          if (state.splitLayout === 'single') {
            newLayout = direction === 'horizontal' ? 'horizontal' : 'vertical';
          } else if (
            (state.splitLayout === 'horizontal' && direction === 'vertical') ||
            (state.splitLayout === 'vertical' && direction === 'horizontal')
          ) {
            newLayout = 'quad';
          }

          set((s) => ({
            splitLayout: newLayout,
            panes: {
              ...s.panes,
              [paneId]: updatedSourcePane,
              [newPaneId]: newPane,
            },
            paneOrder: [...s.paneOrder, newPaneId],
            activePaneId: newPaneId,
          }));

          return newPaneId;
        },

        closePane: (paneId) => {
          const state = get();
          if (paneId === DEFAULT_PANE_ID && Object.keys(state.panes).length === 1) {
            return; // Can't close the last pane
          }

          const pane = state.panes[paneId];
          if (!pane) return;

          // Move all tabs to another pane
          const remainingPanes = Object.keys(state.panes).filter((id) => id !== paneId);
          const targetPaneId = remainingPanes[0] || DEFAULT_PANE_ID;

          // Close all tabs in the pane being closed
          pane.tabs.forEach((tabId) => get().closeTab(tabId));

          set((s) => {
            const { [paneId]: _removed, ...remainingPanesObj } = s.panes;

            // Determine new layout
            let newLayout: SplitLayout = s.splitLayout;
            if (Object.keys(remainingPanesObj).length === 1) {
              newLayout = 'single';
            } else if (Object.keys(remainingPanesObj).length === 2) {
              // Could be horizontal or vertical based on remaining
              newLayout = s.splitLayout === 'quad' ? 'horizontal' : s.splitLayout;
            }

            return {
              panes: remainingPanesObj,
              paneOrder: s.paneOrder.filter((id) => id !== paneId),
              activePaneId: s.activePaneId === paneId ? targetPaneId : s.activePaneId,
              splitLayout: newLayout,
            };
          });
        },

        setActivePane: (paneId) => {
          set({ activePaneId: paneId });
        },

        resizePane: (paneId, size) => {
          set((s) => {
            const pane = s.panes[paneId];
            if (!pane) return s;
            return {
              panes: {
                ...s.panes,
                [paneId]: {
                  ...pane,
                  size: Math.max(10, Math.min(90, size)),
                },
              },
            };
          });
        },

        setSplitLayout: (layout) => {
          const state = get();

          if (layout === 'single') {
            // Merge all tabs into the first pane
            const firstPaneId = state.paneOrder[0] || DEFAULT_PANE_ID;
            const allTabs = Object.values(state.tabs);
            const firstPane = state.panes[firstPaneId] || createDefaultPane();

            set(() => ({
              splitLayout: 'single',
              tabs: Object.fromEntries(allTabs.map((t) => [t.id, { ...t, paneId: firstPaneId }])),
              panes: {
                [firstPaneId]: {
                  ...firstPane,
                  id: firstPaneId,
                  tabs: allTabs.map((t) => t.id),
                  size: 100,
                },
              },
              paneOrder: [firstPaneId],
              activePaneId: firstPaneId,
            }));
          } else {
            set({ splitLayout: layout });
          }
        },

        // ========================================================================
        // Settings
        // ========================================================================

        updateSettings: (newSettings) => {
          set((s) => ({
            settings: { ...s.settings, ...newSettings },
          }));
        },

        setKeyMode: (mode) => {
          set((s) => ({
            settings: { ...s.settings, keyMode: mode },
          }));
        },

        // ========================================================================
        // Selectors
        // ========================================================================

        getActiveTab: () => {
          const state = get();
          const activePane = state.panes[state.activePaneId || ''];
          if (!activePane?.activeTabId) return null;
          return state.tabs[activePane.activeTabId] || null;
        },

        getTabsForPane: (paneId) => {
          const state = get();
          const pane = state.panes[paneId];
          if (!pane) return [];
          return pane.tabs.map((id) => state.tabs[id]).filter(Boolean) as EditorTab[];
        },

        getTabByPath: (path) => {
          const state = get();
          return Object.values(state.tabs).find((t) => t.path === path) || null;
        },

        hasUnsavedChanges: () => {
          const state = get();
          return Object.values(state.tabs).some((t) => t.isDirty);
        },
      }),
      {
        name: 'podex-editor',
        partialize: (state) => ({
          settings: state.settings,
          recentlyClosed: state.recentlyClosed.slice(0, 5),
        }),
      }
    )
  )
);

// ============================================================================
// Convenience Hooks
// ============================================================================

export const useActiveTab = () => useEditorStore((s) => s.getActiveTab());
export const useEditorSettings = () => useEditorStore((s) => s.settings);
export const useKeyMode = () => useEditorStore((s) => s.settings.keyMode);
export const useSplitLayout = () => useEditorStore((s) => s.splitLayout);
export const useHasUnsavedChanges = () => useEditorStore((s) => s.hasUnsavedChanges());
