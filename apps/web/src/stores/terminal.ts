import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { UseBoundStore, StoreApi } from 'zustand';

// Types for split terminal layout

export interface TerminalTab {
  id: string;
  name: string;
  shell: string;
}

export interface TerminalPane {
  id: string;
  tabs: TerminalTab[];
  activeTabId: string;
  size: number; // percentage (0-100)
}

export interface TerminalSplit {
  id: string;
  direction: 'horizontal' | 'vertical';
  panes: (TerminalPane | TerminalSplit)[];
  size: number; // percentage (0-100)
}

export type TerminalLayout = TerminalPane | TerminalSplit;

function isTerminalSplit(layout: TerminalLayout): layout is TerminalSplit {
  return 'direction' in layout;
}

function isTerminalPane(layout: TerminalLayout): layout is TerminalPane {
  return 'tabs' in layout;
}

interface TerminalState {
  // Layout per session
  layouts: Record<string, TerminalLayout>;
  // Currently focused pane per session
  activePaneId: Record<string, string>;
  // Tab counter per session
  nextTabId: Record<string, number>;
  // Default shell preference
  defaultShell: string;

  // Actions
  initLayout: (sessionId: string, shell?: string) => void;
  setDefaultShell: (shell: string) => void;
  getLayout: (sessionId: string) => TerminalLayout | null;
  getActivePane: (sessionId: string) => TerminalPane | null;
  setActivePane: (sessionId: string, paneId: string) => void;
  setActiveTab: (sessionId: string, paneId: string, tabId: string) => void;

  // Tab operations
  addTab: (sessionId: string, paneId: string) => TerminalTab;
  closeTab: (sessionId: string, paneId: string, tabId: string) => void;
  renameTab: (sessionId: string, paneId: string, tabId: string, name: string) => void;

  // Split operations
  splitPane: (sessionId: string, paneId: string, direction: 'horizontal' | 'vertical') => void;
  closePane: (sessionId: string, paneId: string) => void;
  resizePane: (sessionId: string, paneId: string, newSize: number) => void;

  // Navigation
  focusNextPane: (sessionId: string) => void;
  focusPrevPane: (sessionId: string) => void;

  // Cleanup
  clearLayout: (sessionId: string) => void;
}

// Helper to generate unique IDs
let idCounter = 0;
const generateId = (prefix: string) => `${prefix}-${++idCounter}-${Date.now().toString(36)}`;

// Helper to find a pane by ID in the layout tree
function findPane(layout: TerminalLayout, paneId: string): TerminalPane | null {
  if (isTerminalPane(layout)) {
    return layout.id === paneId ? layout : null;
  }

  for (const child of layout.panes) {
    const found = findPane(child, paneId);
    if (found) return found;
  }

  return null;
}

// Helper to find parent of a pane/split
function findParent(
  layout: TerminalLayout,
  targetId: string
): { parent: TerminalSplit; index: number } | null {
  if (isTerminalPane(layout)) {
    return null;
  }

  for (let i = 0; i < layout.panes.length; i++) {
    const child = layout.panes[i];
    if (!child) continue;
    if (child.id === targetId) {
      return { parent: layout, index: i };
    }

    const found = findParent(child, targetId);
    if (found) return found;
  }

  return null;
}

// Helper to get all pane IDs in order (for navigation)
function getAllPaneIds(layout: TerminalLayout): string[] {
  if (isTerminalPane(layout)) {
    return [layout.id];
  }

  return layout.panes.flatMap((child) => getAllPaneIds(child));
}

// Helper to update a pane in the layout tree
function updatePane(
  layout: TerminalLayout,
  paneId: string,
  updater: (pane: TerminalPane) => TerminalPane
): TerminalLayout {
  if (isTerminalPane(layout)) {
    return layout.id === paneId ? updater(layout) : layout;
  }

  return {
    ...layout,
    panes: layout.panes.map((child) => updatePane(child, paneId, updater)),
  };
}

export const useTerminalStore: UseBoundStore<StoreApi<TerminalState>> = create<TerminalState>()(
  immer((set, get) => ({
    layouts: {},
    activePaneId: {},
    nextTabId: {},
    defaultShell: 'bash',

    initLayout: (sessionId, shell) => {
      const state = get();
      if (state.layouts[sessionId]) return;

      const shellToUse = shell || state.defaultShell;
      const paneId = generateId('pane');
      const tabId = generateId('tab');

      set((draft) => {
        draft.layouts[sessionId] = {
          id: paneId,
          tabs: [{ id: tabId, name: 'Terminal 1', shell: shellToUse }],
          activeTabId: tabId,
          size: 100,
        };
        draft.activePaneId[sessionId] = paneId;
        draft.nextTabId[sessionId] = 2;
      });
    },

    setDefaultShell: (shell) => {
      set((draft) => {
        draft.defaultShell = shell;
      });
    },

    getLayout: (sessionId) => {
      return get().layouts[sessionId] || null;
    },

    getActivePane: (sessionId) => {
      const layout = get().layouts[sessionId];
      const activePaneId = get().activePaneId[sessionId];
      if (!layout || !activePaneId) return null;

      return findPane(layout, activePaneId);
    },

    setActivePane: (sessionId, paneId) => {
      set((draft) => {
        draft.activePaneId[sessionId] = paneId;
      });
    },

    setActiveTab: (sessionId, paneId, tabId) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        draft.layouts[sessionId] = updatePane(layout, paneId, (pane) => ({
          ...pane,
          activeTabId: tabId,
        }));
      });
    },

    addTab: (sessionId, paneId) => {
      const state = get();
      const tabNum = state.nextTabId[sessionId] || 1;
      const tabId = generateId('tab');
      const newTab: TerminalTab = {
        id: tabId,
        name: `Terminal ${tabNum}`,
        shell: state.defaultShell,
      };

      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        draft.layouts[sessionId] = updatePane(layout, paneId, (pane) => ({
          ...pane,
          tabs: [...pane.tabs, newTab],
          activeTabId: tabId,
        }));
        draft.nextTabId[sessionId] = tabNum + 1;
      });

      return newTab;
    },

    closeTab: (sessionId, paneId, tabId) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        draft.layouts[sessionId] = updatePane(layout, paneId, (pane) => {
          const newTabs = pane.tabs.filter((t) => t.id !== tabId);

          // If no tabs left, keep at least one
          if (newTabs.length === 0) {
            const newTabId = generateId('tab');
            return {
              ...pane,
              tabs: [{ id: newTabId, name: 'Terminal', shell: draft.defaultShell }],
              activeTabId: newTabId,
            };
          }

          // If we closed the active tab, switch to another
          let newActiveTabId = pane.activeTabId;
          if (pane.activeTabId === tabId) {
            const lastTab = newTabs[newTabs.length - 1];
            newActiveTabId = lastTab?.id ?? '';
          }

          return {
            ...pane,
            tabs: newTabs,
            activeTabId: newActiveTabId,
          };
        });
      });
    },

    renameTab: (sessionId, paneId, tabId, name) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        draft.layouts[sessionId] = updatePane(layout, paneId, (pane) => ({
          ...pane,
          tabs: pane.tabs.map((t) => (t.id === tabId ? { ...t, name } : t)),
        }));
      });
    },

    splitPane: (sessionId, paneId, direction) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        const pane = findPane(layout, paneId);
        if (!pane) return;

        // Create a new pane
        const newPaneId = generateId('pane');
        const newTabId = generateId('tab');
        const tabNum = draft.nextTabId[sessionId] || 1;
        const newPane: TerminalPane = {
          id: newPaneId,
          tabs: [{ id: newTabId, name: `Terminal ${tabNum}`, shell: draft.defaultShell }],
          activeTabId: newTabId,
          size: 50,
        };

        draft.nextTabId[sessionId] = tabNum + 1;

        // Create a new split containing the original pane and the new pane
        const newSplit: TerminalSplit = {
          id: generateId('split'),
          direction,
          panes: [{ ...pane, size: 50 }, newPane],
          size: pane.size, // Inherit size from original pane
        };

        // Replace the original pane with the new split in the layout
        const parentInfo = findParent(layout, paneId);
        if (parentInfo) {
          // Pane is inside a split - replace it
          parentInfo.parent.panes[parentInfo.index] = newSplit;
        } else {
          // Pane is the root - make the split the new root
          draft.layouts[sessionId] = newSplit;
        }

        // Focus the new pane
        draft.activePaneId[sessionId] = newPaneId;
      });
    },

    closePane: (sessionId, paneId) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        // If layout is just a single pane, don't close it
        if (isTerminalPane(layout)) {
          return;
        }

        const parentInfo = findParent(layout, paneId);
        if (!parentInfo) return;

        const { parent, index } = parentInfo;

        // Remove the pane from parent
        parent.panes.splice(index, 1);

        // If parent now has only one child, simplify
        if (parent.panes.length === 1) {
          const remaining = parent.panes[0];
          if (!remaining) return;
          const grandParentInfo = findParent(layout, parent.id);

          if (grandParentInfo) {
            // Replace parent split with the remaining child in grandparent
            // Use type assertion since both TerminalPane and TerminalSplit have size
            const updatedChild = isTerminalPane(remaining)
              ? { ...remaining, size: parent.size }
              : { ...remaining, size: parent.size };
            grandParentInfo.parent.panes[grandParentInfo.index] = updatedChild;
          } else {
            // Parent was root, make remaining child the new root
            if (isTerminalPane(remaining)) {
              draft.layouts[sessionId] = { ...remaining, size: 100 };
            } else {
              draft.layouts[sessionId] = remaining;
            }
          }
        }

        // Update active pane if we closed it
        if (draft.activePaneId[sessionId] === paneId) {
          const currentLayout = draft.layouts[sessionId];
          if (currentLayout) {
            const allPanes = getAllPaneIds(currentLayout);
            draft.activePaneId[sessionId] = allPanes[0] || '';
          }
        }
      });
    },

    resizePane: (sessionId, paneId, newSize) => {
      set((draft) => {
        const layout = draft.layouts[sessionId];
        if (!layout) return;

        draft.layouts[sessionId] = updatePane(layout, paneId, (pane) => ({
          ...pane,
          size: Math.max(10, Math.min(90, newSize)),
        }));
      });
    },

    focusNextPane: (sessionId) => {
      const state = get();
      const layout = state.layouts[sessionId];
      if (!layout) return;

      const allPanes = getAllPaneIds(layout);
      if (allPanes.length === 0) return;

      const currentPaneId = state.activePaneId[sessionId] || '';
      const currentIndex = allPanes.indexOf(currentPaneId);
      const nextIndex = (currentIndex + 1) % allPanes.length;
      const nextPaneId = allPanes[nextIndex];

      if (nextPaneId) {
        set((draft) => {
          draft.activePaneId[sessionId] = nextPaneId;
        });
      }
    },

    focusPrevPane: (sessionId) => {
      const state = get();
      const layout = state.layouts[sessionId];
      if (!layout) return;

      const allPanes = getAllPaneIds(layout);
      if (allPanes.length === 0) return;

      const currentPaneId = state.activePaneId[sessionId] || '';
      const currentIndex = allPanes.indexOf(currentPaneId);
      const prevIndex = (currentIndex - 1 + allPanes.length) % allPanes.length;
      const prevPaneId = allPanes[prevIndex];

      if (prevPaneId) {
        set((draft) => {
          draft.activePaneId[sessionId] = prevPaneId;
        });
      }
    },

    clearLayout: (sessionId) => {
      set((draft) => {
        delete draft.layouts[sessionId];
        delete draft.activePaneId[sessionId];
        delete draft.nextTabId[sessionId];
      });
    },
  }))
);

// Export helper type guards
export { isTerminalPane, isTerminalSplit };
