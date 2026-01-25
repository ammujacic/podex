import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../editor';
import type { EditorTab, SplitPane, EditorSettings } from '../editor';

// Mock the config store
vi.mock('@/stores/config', () => ({
  useConfigStore: {
    getState: () => ({
      getEditorDefaults: () => ({
        key_mode: 'default',
        font_size: 13,
        tab_size: 2,
        word_wrap: 'off',
        minimap: false,
        line_numbers: true,
        bracket_pair_colorization: true,
      }),
      getEditorAIConfig: () => ({
        completionsEnabled: true,
        completionsDebounceMs: 300,
        defaultModel: 'claude-opus-4-5-20251101',
      }),
    }),
  },
}));

// Test fixtures
const mockTab1: Omit<EditorTab, 'id' | 'name'> = {
  path: '/src/components/App.tsx',
  language: 'typescript',
  isDirty: false,
  isPreview: false,
  paneId: 'main',
};

const mockTab2: Omit<EditorTab, 'id' | 'name'> = {
  path: '/src/utils/helpers.ts',
  language: 'typescript',
  isDirty: false,
  isPreview: false,
  paneId: 'main',
};

const mockTab3: Omit<EditorTab, 'id' | 'name'> = {
  path: '/src/styles/global.css',
  language: 'css',
  isDirty: false,
  isPreview: false,
  paneId: 'main',
};

const mockPreviewTab: Omit<EditorTab, 'id' | 'name'> = {
  path: '/src/config/settings.json',
  language: 'json',
  isDirty: false,
  isPreview: true,
  paneId: 'main',
};

describe('editorStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      // First reset the entire store state including settings to null
      useEditorStore.setState({
        tabs: {},
        tabOrder: [],
        splitLayout: 'single',
        panes: { main: { id: 'main', tabs: [], activeTabId: null, size: 100 } },
        paneOrder: ['main'],
        activePaneId: 'main',
        settings: null,
        recentlyClosed: [],
      });
      // Then initialize settings from mocked config store
      useEditorStore.getState().initializeSettings();
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty tabs', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.tabs).toEqual({});
    });

    it('has empty tab order', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.tabOrder).toEqual([]);
    });

    it('has single pane layout by default', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.splitLayout).toBe('single');
    });

    it('has main pane as active pane', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.activePaneId).toBe('main');
    });

    it('has empty recently closed tabs', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.recentlyClosed).toEqual([]);
    });

    it('has default editor settings', () => {
      const { result } = renderHook(() => useEditorStore());
      expect(result.current.settings).toBeDefined();
      expect(result.current.settings.fontSize).toBe(13);
      expect(result.current.settings.tabSize).toBe(2);
    });
  });

  // ========================================================================
  // Tab Management
  // ========================================================================

  describe('Tab Management', () => {
    describe('openTab', () => {
      it('opens a new tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        expect(result.current.tabs[tabId]).toBeDefined();
        expect(result.current.tabs[tabId].path).toBe(mockTab1.path);
      });

      it('extracts file name from path', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        expect(result.current.tabs[tabId].name).toBe('App.tsx');
      });

      it('sets new tab as active', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId);
      });

      it('adds tab to pane tabs list', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).toContain(tabId);
      });

      it('returns existing tab ID if path already open', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        let tabId2: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab1);
        });

        expect(tabId1).toBe(tabId2);
        expect(Object.keys(result.current.tabs)).toHaveLength(1);
      });

      it('upgrades preview tab to permanent when opening same path', () => {
        const { result } = renderHook(() => useEditorStore());

        let previewTabId: string = '';
        act(() => {
          previewTabId = result.current.openTab(mockPreviewTab);
        });

        expect(result.current.tabs[previewTabId].isPreview).toBe(true);

        act(() => {
          result.current.openTab({ ...mockPreviewTab, isPreview: false });
        });

        expect(result.current.tabs[previewTabId].isPreview).toBe(false);
      });

      it('closes existing preview tab when opening new preview', () => {
        const { result } = renderHook(() => useEditorStore());

        let previewTabId1: string = '';
        let previewTabId2: string = '';
        act(() => {
          previewTabId1 = result.current.openTab(mockPreviewTab);
          previewTabId2 = result.current.openTab({
            ...mockTab2,
            isPreview: true,
          });
        });

        expect(result.current.tabs[previewTabId1]).toBeUndefined();
        expect(result.current.tabs[previewTabId2]).toBeDefined();
      });

      it('can open multiple permanent tabs', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
        });

        expect(Object.keys(result.current.tabs)).toHaveLength(3);
      });

      it('adds tab to specified pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        let tabId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          tabId = result.current.openTab({ ...mockTab1, paneId: newPaneId });
        });

        expect(result.current.tabs[tabId].paneId).toBe(newPaneId);
        expect(result.current.panes[newPaneId].tabs).toContain(tabId);
      });

      it('preserves cursor and scroll position if provided', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab({
            ...mockTab1,
            cursorPosition: { line: 10, column: 5 },
            scrollPosition: { line: 5, column: 0 },
          });
        });

        expect(result.current.tabs[tabId].cursorPosition).toEqual({ line: 10, column: 5 });
        expect(result.current.tabs[tabId].scrollPosition).toEqual({ line: 5, column: 0 });
      });
    });

    describe('closeTab', () => {
      it('removes tab from store', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
        });

        expect(result.current.tabs[tabId]).toBeUndefined();
      });

      it('removes tab from pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).not.toContain(tabId);
      });

      it('adds closed tab to recently closed list', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
        });

        expect(result.current.recentlyClosed).toHaveLength(1);
        expect(result.current.recentlyClosed[0].path).toBe(mockTab1.path);
      });

      it('activates next tab when closing active tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        let tabId2: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          result.current.closeTab(tabId1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId2);
      });

      it('activates previous tab when closing last tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        let tabId2: string = '';
        let tabId3: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          tabId3 = result.current.openTab(mockTab3);
          result.current.closeTab(tabId3);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId2);
      });

      it('sets activeTabId to null when closing last tab in pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBeNull();
      });

      it('limits recently closed to 10 tabs', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          for (let i = 0; i < 12; i++) {
            const tabId = result.current.openTab({
              path: `/file${i}.ts`,
              language: 'typescript',
              isDirty: false,
              isPreview: false,
              paneId: 'main',
            });
            result.current.closeTab(tabId);
          }
        });

        expect(result.current.recentlyClosed.length).toBeLessThanOrEqual(10);
      });

      it('handles closing non-existent tab gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.closeTab('non-existent-id');
          });
        }).not.toThrow();
      });
    });

    describe('closeAllTabs', () => {
      it('closes all tabs in specified pane', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeAllTabs('main');
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).toHaveLength(0);
        expect(Object.keys(result.current.tabs)).toHaveLength(0);
      });

      it('closes all tabs in active pane when paneId not specified', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.closeAllTabs();
        });

        expect(Object.keys(result.current.tabs)).toHaveLength(0);
      });

      it('adds all closed tabs to recently closed', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeAllTabs('main');
        });

        expect(result.current.recentlyClosed.length).toBe(3);
      });

      it('does not affect tabs in other panes', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.openTab({ ...mockTab2, paneId: newPaneId });
          result.current.closeAllTabs('main');
        });

        expect(Object.keys(result.current.tabs)).toHaveLength(1);
        expect(result.current.panes[newPaneId].tabs).toHaveLength(1);
      });
    });

    describe('closeOtherTabs', () => {
      it('closes all tabs except specified one', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeOtherTabs(tabId1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).toHaveLength(1);
        expect(mainPane.tabs[0]).toBe(tabId1);
      });

      it('sets specified tab as active', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId2: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeOtherTabs(tabId2);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId2);
      });

      it('adds closed tabs to recently closed', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeOtherTabs(tabId1);
        });

        expect(result.current.recentlyClosed.length).toBe(2);
      });
    });

    describe('closeTabsToRight', () => {
      it('closes tabs to the right of specified tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.closeTabsToRight(tabId1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).toHaveLength(1);
        expect(mainPane.tabs[0]).toBe(tabId1);
      });

      it('does nothing if tab is rightmost', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId3: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          tabId3 = result.current.openTab(mockTab3);
          result.current.closeTabsToRight(tabId3);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs).toHaveLength(3);
      });

      it('adjusts active tab if closed', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
          result.current.setActiveTab(
            result.current.panes['main'].tabs[2] // Set last tab as active
          );
          result.current.closeTabsToRight(tabId1);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId1);
      });
    });

    describe('setActiveTab', () => {
      it('sets specified tab as active in its pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId2: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          result.current.setActiveTab(tabId2);
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.activeTabId).toBe(tabId2);
      });

      it('sets pane as active pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        let tabId: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          tabId = result.current.openTab({ ...mockTab2, paneId: newPaneId });
          result.current.setActivePane('main');
          result.current.setActiveTab(tabId);
        });

        expect(result.current.activePaneId).toBe(newPaneId);
      });

      it('handles setting non-existent tab gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.setActiveTab('non-existent-id');
          });
        }).not.toThrow();
      });
    });

    describe('setTabDirty', () => {
      it('marks tab as dirty', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.setTabDirty(tabId, true);
        });

        expect(result.current.tabs[tabId].isDirty).toBe(true);
      });

      it('marks tab as clean', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab({ ...mockTab1, isDirty: true });
          result.current.setTabDirty(tabId, false);
        });

        expect(result.current.tabs[tabId].isDirty).toBe(false);
      });

      it('handles setting dirty state for non-existent tab gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.setTabDirty('non-existent-id', true);
          });
        }).not.toThrow();
      });
    });

    describe('pinTab', () => {
      it('converts preview tab to permanent', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockPreviewTab);
          result.current.pinTab(tabId);
        });

        expect(result.current.tabs[tabId].isPreview).toBe(false);
      });

      it('has no effect on already permanent tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.pinTab(tabId);
        });

        expect(result.current.tabs[tabId].isPreview).toBe(false);
      });
    });

    describe('reorderTabs', () => {
      it('reorders tabs within pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        let tabId2: string = '';
        let tabId3: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          tabId3 = result.current.openTab(mockTab3);
          result.current.reorderTabs('main', 0, 2); // Move first to last
        });

        const mainPane = result.current.panes['main'];
        expect(mainPane.tabs[0]).toBe(tabId2);
        expect(mainPane.tabs[1]).toBe(tabId3);
        expect(mainPane.tabs[2]).toBe(tabId1);
      });

      it('handles invalid indices gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
        });

        expect(() => {
          act(() => {
            result.current.reorderTabs('main', 0, 10);
          });
        }).not.toThrow();
      });
    });

    describe('moveTabToPane', () => {
      it('moves tab from one pane to another', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        let newPaneId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.moveTabToPane(tabId, newPaneId);
        });

        expect(result.current.tabs[tabId].paneId).toBe(newPaneId);
        expect(result.current.panes[newPaneId].tabs).toContain(tabId);
        expect(result.current.panes['main'].tabs).not.toContain(tabId);
      });

      it('sets moved tab as active in target pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        let newPaneId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.moveTabToPane(tabId, newPaneId);
        });

        expect(result.current.panes[newPaneId].activeTabId).toBe(tabId);
      });

      it('activates another tab in source pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId1: string = '';
        let tabId2: string = '';
        let newPaneId: string = '';
        act(() => {
          tabId1 = result.current.openTab(mockTab1);
          tabId2 = result.current.openTab(mockTab2);
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.moveTabToPane(tabId1, newPaneId);
        });

        expect(result.current.panes['main'].activeTabId).toBe(tabId2);
      });

      it('does nothing if moving to same pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        const tabsBefore = result.current.panes['main'].tabs.length;

        act(() => {
          result.current.moveTabToPane(tabId, 'main');
        });

        expect(result.current.panes['main'].tabs.length).toBe(tabsBefore);
      });
    });

    describe('updateTabScrollPosition', () => {
      it('updates tab scroll position', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.updateTabScrollPosition(tabId, 100, 0);
        });

        expect(result.current.tabs[tabId].scrollPosition).toEqual({ line: 100, column: 0 });
      });

      it('handles updating non-existent tab gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.updateTabScrollPosition('non-existent-id', 10, 5);
          });
        }).not.toThrow();
      });
    });

    describe('updateTabCursorPosition', () => {
      it('updates tab cursor position', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.updateTabCursorPosition(tabId, 42, 15);
        });

        expect(result.current.tabs[tabId].cursorPosition).toEqual({ line: 42, column: 15 });
      });

      it('handles updating non-existent tab gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.updateTabCursorPosition('non-existent-id', 10, 5);
          });
        }).not.toThrow();
      });
    });

    describe('reopenClosedTab', () => {
      it('reopens most recently closed tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
        });

        expect(result.current.recentlyClosed.length).toBe(1);

        act(() => {
          result.current.reopenClosedTab();
        });

        const tabs = Object.values(result.current.tabs);
        expect(tabs).toHaveLength(1);
        expect(tabs[0].path).toBe(mockTab1.path);
      });

      it('removes tab from recently closed list', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
          result.current.reopenClosedTab();
        });

        expect(result.current.recentlyClosed.length).toBe(0);
      });

      it('returns null when no tabs to reopen', () => {
        const { result } = renderHook(() => useEditorStore());

        let reopened;
        act(() => {
          reopened = result.current.reopenClosedTab();
        });

        expect(reopened).toBeNull();
      });

      it('reopens tabs in LIFO order', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          const id1 = result.current.openTab(mockTab1);
          result.current.closeTab(id1);
          const id2 = result.current.openTab(mockTab2);
          result.current.closeTab(id2);
        });

        let reopened;
        act(() => {
          reopened = result.current.reopenClosedTab();
        });

        expect(reopened?.path).toBe(mockTab2.path);
      });
    });

    describe('extractTab', () => {
      it('removes and returns tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        let extracted;
        act(() => {
          tabId = result.current.openTab(mockTab1);
          extracted = result.current.extractTab(tabId);
        });

        expect(extracted).toBeDefined();
        expect(extracted?.path).toBe(mockTab1.path);
        expect(result.current.tabs[tabId]).toBeUndefined();
      });

      it('returns null for non-existent tab', () => {
        const { result } = renderHook(() => useEditorStore());

        let extracted;
        act(() => {
          extracted = result.current.extractTab('non-existent-id');
        });

        expect(extracted).toBeNull();
      });
    });
  });

  // ========================================================================
  // Split View
  // ========================================================================

  describe('Split View', () => {
    describe('splitPane', () => {
      it('creates a new pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.panes[newPaneId]).toBeDefined();
      });

      it('sets split layout to horizontal', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.splitLayout).toBe('horizontal');
      });

      it('sets split layout to vertical', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'vertical');
        });

        expect(result.current.splitLayout).toBe('vertical');
      });

      it('sets split layout to quad when splitting both ways', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'horizontal');
          result.current.splitPane('main', 'vertical');
        });

        expect(result.current.splitLayout).toBe('quad');
      });

      it('sets new pane size to 50%', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.panes[newPaneId].size).toBe(50);
      });

      it('updates source pane size to 50%', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.panes['main'].size).toBe(50);
      });

      it('sets new pane as active', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.activePaneId).toBe(newPaneId);
      });

      it('creates empty pane with no tabs', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
        });

        expect(result.current.panes[newPaneId].tabs).toHaveLength(0);
        expect(result.current.panes[newPaneId].activeTabId).toBeNull();
      });
    });

    describe('closePane', () => {
      it('removes pane from store', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.closePane(newPaneId);
        });

        expect(result.current.panes[newPaneId]).toBeUndefined();
      });

      it('closes all tabs in the pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.openTab({ ...mockTab1, paneId: newPaneId });
          result.current.openTab({ ...mockTab2, paneId: newPaneId });
        });

        const tabCountBefore = Object.keys(result.current.tabs).length;

        act(() => {
          result.current.closePane(newPaneId);
        });

        expect(Object.keys(result.current.tabs).length).toBe(tabCountBefore - 2);
      });

      it('sets layout to single when closing to one pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.closePane(newPaneId);
        });

        expect(result.current.splitLayout).toBe('single');
      });

      it('cannot close last pane', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.closePane('main');
        });

        expect(result.current.panes['main']).toBeDefined();
      });

      it('activates another pane when closing active pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.setActivePane(newPaneId);
          result.current.closePane(newPaneId);
        });

        expect(result.current.activePaneId).not.toBe(newPaneId);
      });
    });

    describe('setActivePane', () => {
      it('sets the active pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.setActivePane('main');
        });

        expect(result.current.activePaneId).toBe('main');
      });

      it('can switch between panes', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.setActivePane('main');
          result.current.setActivePane(newPaneId);
        });

        expect(result.current.activePaneId).toBe(newPaneId);
      });
    });

    describe('resizePane', () => {
      it('updates pane size', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.resizePane('main', 70);
        });

        expect(result.current.panes['main'].size).toBe(70);
      });

      it('clamps size to minimum 10%', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.resizePane('main', 5);
        });

        expect(result.current.panes['main'].size).toBe(10);
      });

      it('clamps size to maximum 90%', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.resizePane('main', 95);
        });

        expect(result.current.panes['main'].size).toBe(90);
      });

      it('handles resizing non-existent pane gracefully', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(() => {
          act(() => {
            result.current.resizePane('non-existent-id', 50);
          });
        }).not.toThrow();
      });
    });

    describe('setSplitLayout', () => {
      it('sets layout to single and merges all tabs to first pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          result.current.openTab({ ...mockTab2, paneId: newPaneId });
          result.current.setSplitLayout('single');
        });

        expect(result.current.splitLayout).toBe('single');
        expect(result.current.panes['main'].tabs).toHaveLength(2);
        expect(result.current.panes[newPaneId]).toBeUndefined();
      });

      it('sets first pane size to 100% when merging', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'horizontal');
          result.current.setSplitLayout('single');
        });

        expect(result.current.panes['main'].size).toBe(100);
      });

      it('sets layout to specified value', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.setSplitLayout('horizontal');
        });

        expect(result.current.splitLayout).toBe('horizontal');
      });
    });
  });

  // ========================================================================
  // Editor Settings
  // ========================================================================

  describe('Editor Settings', () => {
    describe('updateSettings', () => {
      it('updates single setting', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({ fontSize: 16 });
        });

        expect(result.current.settings.fontSize).toBe(16);
      });

      it('updates multiple settings', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({
            fontSize: 14,
            tabSize: 4,
            wordWrap: 'on',
          });
        });

        expect(result.current.settings.fontSize).toBe(14);
        expect(result.current.settings.tabSize).toBe(4);
        expect(result.current.settings.wordWrap).toBe('on');
      });

      it('preserves unchanged settings', () => {
        const { result } = renderHook(() => useEditorStore());

        const originalMinimap = result.current.settings.minimap;

        act(() => {
          result.current.updateSettings({ fontSize: 14 });
        });

        expect(result.current.settings.minimap).toBe(originalMinimap);
      });

      it('updates AI completion settings', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({
            completionsEnabled: false,
            completionsDebounceMs: 500,
          });
        });

        expect(result.current.settings.completionsEnabled).toBe(false);
        expect(result.current.settings.completionsDebounceMs).toBe(500);
      });

      it('updates format settings', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({
            formatOnSave: true,
            formatOnPaste: false,
          });
        });

        expect(result.current.settings.formatOnSave).toBe(true);
        expect(result.current.settings.formatOnPaste).toBe(false);
      });

      it('updates auto save settings', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({
            autoSave: 'afterDelay',
            autoSaveDelay: 2000,
          });
        });

        expect(result.current.settings.autoSave).toBe('afterDelay');
        expect(result.current.settings.autoSaveDelay).toBe(2000);
      });
    });

    describe('setKeyMode', () => {
      it('sets key mode', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.setKeyMode('default');
        });

        expect(result.current.settings.keyMode).toBe('default');
      });
    });
  });

  // ========================================================================
  // Selectors
  // ========================================================================

  describe('Selectors', () => {
    describe('getActiveTab', () => {
      it('returns active tab in active pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
        });

        const activeTab = result.current.getActiveTab();
        expect(activeTab?.id).toBe(tabId);
      });

      it('returns null when no active tab', () => {
        const { result } = renderHook(() => useEditorStore());

        const activeTab = result.current.getActiveTab();
        expect(activeTab).toBeNull();
      });

      it('returns active tab from correct pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        let tabId2: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          tabId2 = result.current.openTab({ ...mockTab2, paneId: newPaneId });
        });

        const activeTab = result.current.getActiveTab();
        expect(activeTab?.id).toBe(tabId2);
      });
    });

    describe('getTabsForPane', () => {
      it('returns all tabs in specified pane', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
        });

        const tabs = result.current.getTabsForPane('main');
        expect(tabs).toHaveLength(2);
      });

      it('returns empty array for empty pane', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        act(() => {
          newPaneId = result.current.splitPane('main', 'horizontal');
        });

        const tabs = result.current.getTabsForPane(newPaneId);
        expect(tabs).toHaveLength(0);
      });

      it('returns empty array for non-existent pane', () => {
        const { result } = renderHook(() => useEditorStore());

        const tabs = result.current.getTabsForPane('non-existent');
        expect(tabs).toHaveLength(0);
      });

      it('returns tabs in correct order', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.openTab(mockTab3);
        });

        const tabs = result.current.getTabsForPane('main');
        expect(tabs[0].path).toBe(mockTab1.path);
        expect(tabs[1].path).toBe(mockTab2.path);
        expect(tabs[2].path).toBe(mockTab3.path);
      });
    });

    describe('getTabByPath', () => {
      it('finds tab by path', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
        });

        const tab = result.current.getTabByPath(mockTab1.path);
        expect(tab?.path).toBe(mockTab1.path);
      });

      it('returns null when path not found', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
        });

        const tab = result.current.getTabByPath('/non/existent/path.ts');
        expect(tab).toBeNull();
      });

      it('returns null when no tabs open', () => {
        const { result } = renderHook(() => useEditorStore());

        const tab = result.current.getTabByPath(mockTab1.path);
        expect(tab).toBeNull();
      });
    });

    describe('hasUnsavedChanges', () => {
      it('returns true when any tab is dirty', () => {
        const { result } = renderHook(() => useEditorStore());

        let tabId: string = '';
        act(() => {
          tabId = result.current.openTab(mockTab1);
          result.current.setTabDirty(tabId, true);
        });

        expect(result.current.hasUnsavedChanges()).toBe(true);
      });

      it('returns false when no tabs are dirty', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
        });

        expect(result.current.hasUnsavedChanges()).toBe(false);
      });

      it('returns false when no tabs open', () => {
        const { result } = renderHook(() => useEditorStore());

        expect(result.current.hasUnsavedChanges()).toBe(false);
      });

      it('checks all tabs across all panes', () => {
        const { result } = renderHook(() => useEditorStore());

        let newPaneId: string = '';
        let tabId: string = '';
        act(() => {
          result.current.openTab(mockTab1);
          newPaneId = result.current.splitPane('main', 'horizontal');
          tabId = result.current.openTab({ ...mockTab2, paneId: newPaneId });
          result.current.setTabDirty(tabId, true);
        });

        expect(result.current.hasUnsavedChanges()).toBe(true);
      });
    });
  });

  // ========================================================================
  // Layout Management
  // ========================================================================

  describe('Layout Management', () => {
    describe('resetLayout', () => {
      it('clears all tabs', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.openTab(mockTab1);
          result.current.openTab(mockTab2);
          result.current.resetLayout();
        });

        expect(Object.keys(result.current.tabs)).toHaveLength(0);
      });

      it('resets to single pane', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.splitPane('main', 'horizontal');
          result.current.resetLayout();
        });

        expect(result.current.splitLayout).toBe('single');
        expect(Object.keys(result.current.panes)).toHaveLength(1);
      });

      it('clears recently closed tabs', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          const tabId = result.current.openTab(mockTab1);
          result.current.closeTab(tabId);
          result.current.resetLayout();
        });

        expect(result.current.recentlyClosed).toHaveLength(0);
      });

      it('preserves editor settings', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.updateSettings({ fontSize: 18 });
          result.current.resetLayout();
        });

        expect(result.current.settings.fontSize).toBe(18);
      });
    });

    describe('setLayout', () => {
      it('replaces entire layout', () => {
        const { result } = renderHook(() => useEditorStore());

        const newTab: EditorTab = {
          id: 'tab-1',
          path: '/new/file.ts',
          name: 'file.ts',
          language: 'typescript',
          isDirty: false,
          isPreview: false,
          paneId: 'pane-1',
        };

        const newPane: SplitPane = {
          id: 'pane-1',
          tabs: ['tab-1'],
          activeTabId: 'tab-1',
          size: 100,
        };

        act(() => {
          result.current.setLayout({
            tabs: { 'tab-1': newTab },
            panes: { 'pane-1': newPane },
            paneOrder: ['pane-1'],
            activePaneId: 'pane-1',
            splitLayout: 'single',
          });
        });

        expect(result.current.tabs['tab-1']).toEqual(newTab);
        expect(result.current.panes['pane-1']).toEqual(newPane);
        expect(result.current.activePaneId).toBe('pane-1');
      });

      it('uses default pane when paneOrder is empty', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.setLayout({
            tabs: {},
            panes: {},
            paneOrder: [],
            activePaneId: null,
            splitLayout: 'single',
          });
        });

        expect(result.current.paneOrder).toEqual(['main']);
      });

      it('uses default pane when activePaneId is null', () => {
        const { result } = renderHook(() => useEditorStore());

        act(() => {
          result.current.setLayout({
            tabs: {},
            panes: {},
            paneOrder: ['main'],
            activePaneId: null,
            splitLayout: 'single',
          });
        });

        expect(result.current.activePaneId).toBe('main');
      });
    });
  });

  // ========================================================================
  // Edge Cases and Integration
  // ========================================================================

  describe('Edge Cases', () => {
    it('handles opening same file in different panes', () => {
      const { result } = renderHook(() => useEditorStore());

      let newPaneId: string = '';
      act(() => {
        result.current.openTab(mockTab1);
        newPaneId = result.current.splitPane('main', 'horizontal');
        result.current.openTab({ ...mockTab1, paneId: newPaneId });
      });

      // Should only have one tab (same path)
      expect(Object.keys(result.current.tabs)).toHaveLength(1);
    });

    it('handles complex tab operations across panes', () => {
      const { result } = renderHook(() => useEditorStore());

      let pane1Id: string = '';
      let pane2Id: string = '';
      act(() => {
        // Create layout with 3 panes
        pane1Id = result.current.splitPane('main', 'horizontal');
        pane2Id = result.current.splitPane('main', 'vertical');

        // Add tabs to each pane
        result.current.openTab({ ...mockTab1, paneId: 'main' });
        result.current.openTab({ ...mockTab2, paneId: pane1Id });
        result.current.openTab({ ...mockTab3, paneId: pane2Id });
      });

      expect(result.current.panes['main'].tabs).toHaveLength(1);
      expect(result.current.panes[pane1Id].tabs).toHaveLength(1);
      expect(result.current.panes[pane2Id].tabs).toHaveLength(1);
    });

    it('maintains state consistency when rapidly opening and closing tabs', () => {
      const { result } = renderHook(() => useEditorStore());

      act(() => {
        for (let i = 0; i < 10; i++) {
          const tabId = result.current.openTab({
            path: `/file${i}.ts`,
            language: 'typescript',
            isDirty: false,
            isPreview: false,
            paneId: 'main',
          });
          if (i % 2 === 0) {
            result.current.closeTab(tabId);
          }
        }
      });

      // Should have 5 open tabs and 5 recently closed
      expect(Object.keys(result.current.tabs)).toHaveLength(5);
      expect(result.current.recentlyClosed).toHaveLength(5);
    });

    it('preserves tab state when moving between panes', () => {
      const { result } = renderHook(() => useEditorStore());

      let tabId: string = '';
      let newPaneId: string = '';
      act(() => {
        tabId = result.current.openTab(mockTab1);
        result.current.setTabDirty(tabId, true);
        result.current.updateTabCursorPosition(tabId, 100, 50);
        newPaneId = result.current.splitPane('main', 'horizontal');
        result.current.moveTabToPane(tabId, newPaneId);
      });

      expect(result.current.tabs[tabId].isDirty).toBe(true);
      expect(result.current.tabs[tabId].cursorPosition).toEqual({ line: 100, column: 50 });
    });
  });
});
