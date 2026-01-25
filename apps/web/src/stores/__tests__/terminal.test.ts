import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTerminalStore, isTerminalPane, isTerminalSplit } from '../terminal';
import type { TerminalPane, TerminalSplit, TerminalLayout } from '../terminal';

describe('terminalStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useTerminalStore.setState({
        layouts: {},
        activePaneId: {},
        nextTabId: {},
        defaultShell: 'bash',
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty layouts', () => {
      const { result } = renderHook(() => useTerminalStore());
      expect(result.current.layouts).toEqual({});
    });

    it('has no active pane IDs', () => {
      const { result } = renderHook(() => useTerminalStore());
      expect(result.current.activePaneId).toEqual({});
    });

    it('has empty tab ID counters', () => {
      const { result } = renderHook(() => useTerminalStore());
      expect(result.current.nextTabId).toEqual({});
    });

    it('has default shell set to bash', () => {
      const { result } = renderHook(() => useTerminalStore());
      expect(result.current.defaultShell).toBe('bash');
    });
  });

  // ========================================================================
  // Layout Initialization
  // ========================================================================

  describe('Layout Initialization', () => {
    describe('initLayout', () => {
      it('creates initial layout for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        expect(result.current.layouts['session-1']).toBeDefined();
      });

      it('creates pane with single tab', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        const layout = result.current.layouts['session-1'];
        expect(isTerminalPane(layout)).toBe(true);

        if (isTerminalPane(layout)) {
          expect(layout.tabs).toHaveLength(1);
          expect(layout.tabs[0].name).toBe('Terminal 1');
        }
      });

      it('uses default shell when no shell specified', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalPane(layout)) {
          expect(layout.tabs[0].shell).toBe('bash');
        }
      });

      it('uses specified shell when provided', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1', 'zsh');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalPane(layout)) {
          expect(layout.tabs[0].shell).toBe('zsh');
        }
      });

      it('sets active pane ID for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBeDefined();
      });

      it('sets nextTabId counter to 2', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        expect(result.current.nextTabId['session-1']).toBe(2);
      });

      it('does not reinitialize existing layout', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
        });

        const firstLayout = result.current.layouts['session-1'];

        act(() => {
          result.current.initLayout('session-1');
        });

        expect(result.current.layouts['session-1']).toBe(firstLayout);
      });

      it('can initialize layouts for multiple sessions', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-1');
          result.current.initLayout('session-2');
        });

        expect(result.current.layouts['session-1']).toBeDefined();
        expect(result.current.layouts['session-2']).toBeDefined();
      });
    });

    describe('setDefaultShell', () => {
      it('sets default shell', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.setDefaultShell('zsh');
        });

        expect(result.current.defaultShell).toBe('zsh');
      });

      it('affects new layouts', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.setDefaultShell('fish');
          result.current.initLayout('session-1');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalPane(layout)) {
          expect(layout.tabs[0].shell).toBe('fish');
        }
      });
    });
  });

  // ========================================================================
  // Layout Getters
  // ========================================================================

  describe('Layout Getters', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('getLayout', () => {
      it('returns layout for existing session', () => {
        const { result } = renderHook(() => useTerminalStore());

        const layout = result.current.getLayout('session-1');
        expect(layout).toBeDefined();
      });

      it('returns null for non-existent session', () => {
        const { result } = renderHook(() => useTerminalStore());

        const layout = result.current.getLayout('non-existent');
        expect(layout).toBeNull();
      });
    });

    describe('getActivePane', () => {
      it('returns active pane for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        const pane = result.current.getActivePane('session-1');
        expect(pane).toBeDefined();
        expect(isTerminalPane(pane!)).toBe(true);
      });

      it('returns null for non-existent session', () => {
        const { result } = renderHook(() => useTerminalStore());

        const pane = result.current.getActivePane('non-existent');
        expect(pane).toBeNull();
      });

      it('returns null when no active pane set', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-2');
        });

        // Manually clear active pane ID
        act(() => {
          useTerminalStore.setState({
            activePaneId: { ...result.current.activePaneId, 'session-2': '' },
          });
        });

        const pane = result.current.getActivePane('session-2');
        expect(pane).toBeNull();
      });
    });
  });

  // ========================================================================
  // Tab Management
  // ========================================================================

  describe('Tab Management', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('addTab', () => {
      it('adds new tab to pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const initialTabCount = layout.tabs.length;

        act(() => {
          result.current.addTab('session-1', layout.id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs).toHaveLength(initialTabCount + 1);
      });

      it('returns new tab object', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let newTab;
        act(() => {
          newTab = result.current.addTab('session-1', layout.id);
        });

        expect(newTab).toBeDefined();
        expect(newTab!.id).toBeDefined();
        expect(newTab!.name).toBe('Terminal 2');
      });

      it('sets new tab as active', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let newTab;
        act(() => {
          newTab = result.current.addTab('session-1', layout.id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.activeTabId).toBe(newTab!.id);
      });

      it('increments tab counter', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.addTab('session-1', layout.id);
        });

        expect(result.current.nextTabId['session-1']).toBe(3);
      });

      it('uses default shell for new tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let newTab;
        act(() => {
          result.current.setDefaultShell('zsh');
          newTab = result.current.addTab('session-1', layout.id);
        });

        expect(newTab!.shell).toBe('zsh');
      });

      it('can add multiple tabs', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.addTab('session-1', layout.id);
          result.current.addTab('session-1', layout.id);
          result.current.addTab('session-1', layout.id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs).toHaveLength(4); // 1 initial + 3 new
      });

      it('generates sequential tab names', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.addTab('session-1', layout.id); // Terminal 2
          result.current.addTab('session-1', layout.id); // Terminal 3
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs[1].name).toBe('Terminal 2');
        expect(updatedLayout.tabs[2].name).toBe('Terminal 3');
      });
    });

    describe('closeTab', () => {
      it('removes tab from pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const tabId = layout.tabs[0].id;

        act(() => {
          result.current.addTab('session-1', layout.id);
          result.current.closeTab('session-1', layout.id, tabId);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs.find((t) => t.id === tabId)).toBeUndefined();
      });

      it('keeps at least one tab in pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const tabId = layout.tabs[0].id;

        act(() => {
          result.current.closeTab('session-1', layout.id, tabId);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs).toHaveLength(1);
      });

      it('creates new tab when closing last tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const originalTabId = layout.tabs[0].id;

        act(() => {
          result.current.closeTab('session-1', layout.id, originalTabId);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs[0].id).not.toBe(originalTabId);
        expect(updatedLayout.tabs[0].name).toBe('Terminal');
      });

      it('switches to another tab when closing active tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const firstTabId = layout.tabs[0].id;

        let secondTab;
        act(() => {
          secondTab = result.current.addTab('session-1', layout.id);
          result.current.closeTab('session-1', layout.id, secondTab.id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.activeTabId).toBe(firstTabId);
      });

      it('keeps active tab when closing non-active tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const firstTabId = layout.tabs[0].id;

        let secondTab;
        act(() => {
          secondTab = result.current.addTab('session-1', layout.id);
          result.current.closeTab('session-1', layout.id, firstTabId);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.activeTabId).toBe(secondTab!.id);
      });

      it('switches to last remaining tab when closing active tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let tab2, tab3;
        act(() => {
          tab2 = result.current.addTab('session-1', layout.id);
          tab3 = result.current.addTab('session-1', layout.id);
          result.current.closeTab('session-1', layout.id, tab3.id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.activeTabId).toBe(tab2.id);
      });
    });

    describe('renameTab', () => {
      it('renames tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const tabId = layout.tabs[0].id;

        act(() => {
          result.current.renameTab('session-1', layout.id, tabId, 'Custom Name');
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs[0].name).toBe('Custom Name');
      });

      it('only renames specified tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let tab2;
        act(() => {
          tab2 = result.current.addTab('session-1', layout.id);
          result.current.renameTab('session-1', layout.id, tab2.id, 'Renamed');
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.tabs[0].name).toBe('Terminal 1');
        expect(updatedLayout.tabs[1].name).toBe('Renamed');
      });

      it('handles renaming non-existent tab gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        expect(() => {
          act(() => {
            result.current.renameTab('session-1', layout.id, 'non-existent', 'Name');
          });
        }).not.toThrow();
      });
    });

    describe('setActiveTab', () => {
      it('sets active tab in pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        let newTab;
        act(() => {
          newTab = result.current.addTab('session-1', layout.id);
          result.current.setActiveTab('session-1', layout.id, layout.tabs[0].id);
        });

        const updatedLayout = result.current.layouts['session-1'] as TerminalPane;
        expect(updatedLayout.activeTabId).toBe(layout.tabs[0].id);
      });

      it('can switch between tabs', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const firstTabId = layout.tabs[0].id;

        let secondTab;
        act(() => {
          secondTab = result.current.addTab('session-1', layout.id);
          result.current.setActiveTab('session-1', layout.id, firstTabId);
        });

        expect((result.current.layouts['session-1'] as TerminalPane).activeTabId).toBe(firstTabId);

        act(() => {
          result.current.setActiveTab('session-1', layout.id, secondTab!.id);
        });

        expect((result.current.layouts['session-1'] as TerminalPane).activeTabId).toBe(
          secondTab!.id
        );
      });
    });
  });

  // ========================================================================
  // Pane Management
  // ========================================================================

  describe('Pane Management', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('setActivePane', () => {
      it('sets active pane for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.setActivePane('session-1', 'pane-123');
        });

        expect(result.current.activePaneId['session-1']).toBe('pane-123');
      });

      it('can switch between panes', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.setActivePane('session-1', 'pane-1');
          result.current.setActivePane('session-1', 'pane-2');
        });

        expect(result.current.activePaneId['session-1']).toBe('pane-2');
      });
    });
  });

  // ========================================================================
  // Split Operations
  // ========================================================================

  describe('Split Operations', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('splitPane', () => {
      it('creates horizontal split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        expect(isTerminalSplit(layout)).toBe(true);
        if (isTerminalSplit(layout)) {
          expect(layout.direction).toBe('horizontal');
        }
      });

      it('creates vertical split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'vertical');
        });

        const layout = result.current.layouts['session-1'];
        expect(isTerminalSplit(layout)).toBe(true);
        if (isTerminalSplit(layout)) {
          expect(layout.direction).toBe('vertical');
        }
      });

      it('creates split with two panes', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalSplit(layout)) {
          expect(layout.panes).toHaveLength(2);
        }
      });

      it('sets both panes to 50% size', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalSplit(layout)) {
          expect((layout.panes[0] as TerminalPane).size).toBe(50);
          expect((layout.panes[1] as TerminalPane).size).toBe(50);
        }
      });

      it('creates new pane with single tab', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalSplit(layout)) {
          const newPane = layout.panes[1] as TerminalPane;
          expect(newPane.tabs).toHaveLength(1);
        }
      });

      it('focuses new pane after split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalSplit(layout)) {
          const newPane = layout.panes[1] as TerminalPane;
          expect(result.current.activePaneId['session-1']).toBe(newPane.id);
        }
      });

      it('increments tab counter for new pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;
        const initialCounter = result.current.nextTabId['session-1'];

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        expect(result.current.nextTabId['session-1']).toBe(initialCounter + 1);
      });

      it('preserves original pane content', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;
        const originalTabId = originalLayout.tabs[0].id;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const layout = result.current.layouts['session-1'];
        if (isTerminalSplit(layout)) {
          const preservedPane = layout.panes[0] as TerminalPane;
          expect(preservedPane.tabs[0].id).toBe(originalTabId);
        }
      });

      it('can split nested panes', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        let firstSplit = result.current.layouts['session-1'] as TerminalSplit;
        const secondPaneId = (firstSplit.panes[1] as TerminalPane).id;

        act(() => {
          result.current.splitPane('session-1', secondPaneId, 'vertical');
        });

        const layout = result.current.layouts['session-1'];
        expect(isTerminalSplit(layout)).toBe(true);
        if (isTerminalSplit(layout)) {
          expect(isTerminalSplit(layout.panes[1])).toBe(true);
        }
      });

      it('handles splitting non-existent pane gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.splitPane('session-1', 'non-existent', 'horizontal');
          });
        }).not.toThrow();
      });
    });

    describe('closePane', () => {
      it('removes pane from split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        let split = result.current.layouts['session-1'] as TerminalSplit;
        const paneToClose = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.closePane('session-1', paneToClose);
        });

        // After closing one pane, layout should simplify back to single pane
        const layout = result.current.layouts['session-1'];
        expect(isTerminalPane(layout)).toBe(true);
      });

      it('does not close last pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.closePane('session-1', layout.id);
        });

        // Layout should remain unchanged
        expect(result.current.layouts['session-1']).toBeDefined();
        expect(isTerminalPane(result.current.layouts['session-1'])).toBe(true);
      });

      it('simplifies layout when closing leaves one pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        let split = result.current.layouts['session-1'] as TerminalSplit;
        const paneToClose = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.closePane('session-1', paneToClose);
        });

        const layout = result.current.layouts['session-1'];
        expect(isTerminalPane(layout)).toBe(true);
        if (isTerminalPane(layout)) {
          expect(layout.size).toBe(100);
        }
      });

      it('updates active pane when closing active pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const activePaneId = result.current.activePaneId['session-1'];

        act(() => {
          result.current.closePane('session-1', activePaneId);
        });

        // Should switch to remaining pane
        expect(result.current.activePaneId['session-1']).not.toBe(activePaneId);
        expect(result.current.activePaneId['session-1']).toBeDefined();
      });

      it('keeps active pane when closing non-active pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const firstPaneId = (split.panes[0] as TerminalPane).id;
        const activePaneId = result.current.activePaneId['session-1'];

        act(() => {
          result.current.setActivePane('session-1', firstPaneId);
          result.current.closePane('session-1', activePaneId);
        });

        expect(result.current.activePaneId['session-1']).toBe(firstPaneId);
      });

      it('handles closing non-existent pane gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.closePane('session-1', 'non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('resizePane', () => {
      it('resizes pane to specified size', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const paneId = (split.panes[0] as TerminalPane).id;

        act(() => {
          result.current.resizePane('session-1', paneId, 70);
        });

        const updatedSplit = result.current.layouts['session-1'] as TerminalSplit;
        expect((updatedSplit.panes[0] as TerminalPane).size).toBe(70);
      });

      it('clamps size to minimum of 10', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const paneId = (split.panes[0] as TerminalPane).id;

        act(() => {
          result.current.resizePane('session-1', paneId, 5);
        });

        const updatedSplit = result.current.layouts['session-1'] as TerminalSplit;
        expect((updatedSplit.panes[0] as TerminalPane).size).toBe(10);
      });

      it('clamps size to maximum of 90', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const paneId = (split.panes[0] as TerminalPane).id;

        act(() => {
          result.current.resizePane('session-1', paneId, 95);
        });

        const updatedSplit = result.current.layouts['session-1'] as TerminalSplit;
        expect((updatedSplit.panes[0] as TerminalPane).size).toBe(90);
      });

      it('handles resizing non-existent pane gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.resizePane('session-1', 'non-existent', 50);
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Navigation
  // ========================================================================

  describe('Navigation', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('focusNextPane', () => {
      it('focuses next pane in split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const firstPaneId = (split.panes[0] as TerminalPane).id;
        const secondPaneId = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.setActivePane('session-1', firstPaneId);
          result.current.focusNextPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(secondPaneId);
      });

      it('wraps around to first pane from last', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const firstPaneId = (split.panes[0] as TerminalPane).id;
        const secondPaneId = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.setActivePane('session-1', secondPaneId);
          result.current.focusNextPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(firstPaneId);
      });

      it('does nothing with single pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const paneId = layout.id;

        act(() => {
          result.current.focusNextPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(paneId);
      });

      it('handles non-existent session gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.focusNextPane('non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('focusPrevPane', () => {
      it('focuses previous pane in split', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const firstPaneId = (split.panes[0] as TerminalPane).id;
        const secondPaneId = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.setActivePane('session-1', secondPaneId);
          result.current.focusPrevPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(firstPaneId);
      });

      it('wraps around to last pane from first', () => {
        const { result } = renderHook(() => useTerminalStore());
        const originalLayout = result.current.layouts['session-1'] as TerminalPane;

        act(() => {
          result.current.splitPane('session-1', originalLayout.id, 'horizontal');
        });

        const split = result.current.layouts['session-1'] as TerminalSplit;
        const firstPaneId = (split.panes[0] as TerminalPane).id;
        const secondPaneId = (split.panes[1] as TerminalPane).id;

        act(() => {
          result.current.setActivePane('session-1', firstPaneId);
          result.current.focusPrevPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(secondPaneId);
      });

      it('does nothing with single pane', () => {
        const { result } = renderHook(() => useTerminalStore());
        const layout = result.current.layouts['session-1'] as TerminalPane;
        const paneId = layout.id;

        act(() => {
          result.current.focusPrevPane('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBe(paneId);
      });

      it('handles non-existent session gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.focusPrevPane('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  describe('Cleanup', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    describe('clearLayout', () => {
      it('removes layout for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.clearLayout('session-1');
        });

        expect(result.current.layouts['session-1']).toBeUndefined();
      });

      it('removes active pane ID for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.clearLayout('session-1');
        });

        expect(result.current.activePaneId['session-1']).toBeUndefined();
      });

      it('removes tab counter for session', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.clearLayout('session-1');
        });

        expect(result.current.nextTabId['session-1']).toBeUndefined();
      });

      it('does not affect other sessions', () => {
        const { result } = renderHook(() => useTerminalStore());

        act(() => {
          result.current.initLayout('session-2');
          result.current.clearLayout('session-1');
        });

        expect(result.current.layouts['session-1']).toBeUndefined();
        expect(result.current.layouts['session-2']).toBeDefined();
      });

      it('handles clearing non-existent session gracefully', () => {
        const { result } = renderHook(() => useTerminalStore());

        expect(() => {
          act(() => {
            result.current.clearLayout('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Type Guards
  // ========================================================================

  describe('Type Guards', () => {
    describe('isTerminalPane', () => {
      it('identifies terminal pane', () => {
        const pane: TerminalPane = {
          id: 'pane-1',
          tabs: [],
          activeTabId: 'tab-1',
          size: 100,
        };

        expect(isTerminalPane(pane)).toBe(true);
      });

      it('rejects terminal split', () => {
        const split: TerminalSplit = {
          id: 'split-1',
          direction: 'horizontal',
          panes: [],
          size: 100,
        };

        expect(isTerminalPane(split)).toBe(false);
      });
    });

    describe('isTerminalSplit', () => {
      it('identifies terminal split', () => {
        const split: TerminalSplit = {
          id: 'split-1',
          direction: 'horizontal',
          panes: [],
          size: 100,
        };

        expect(isTerminalSplit(split)).toBe(true);
      });

      it('rejects terminal pane', () => {
        const pane: TerminalPane = {
          id: 'pane-1',
          tabs: [],
          activeTabId: 'tab-1',
          size: 100,
        };

        expect(isTerminalSplit(pane)).toBe(false);
      });
    });
  });

  // ========================================================================
  // Complex Scenarios
  // ========================================================================

  describe('Complex Scenarios', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useTerminalStore());
      act(() => {
        result.current.initLayout('session-1');
      });
    });

    it('handles multiple splits and tabs', () => {
      const { result } = renderHook(() => useTerminalStore());
      const originalLayout = result.current.layouts['session-1'] as TerminalPane;

      act(() => {
        // Create horizontal split
        result.current.splitPane('session-1', originalLayout.id, 'horizontal');
      });

      let split = result.current.layouts['session-1'] as TerminalSplit;
      const pane1Id = (split.panes[0] as TerminalPane).id;
      const pane2Id = (split.panes[1] as TerminalPane).id;

      act(() => {
        // Add tabs to both panes
        result.current.addTab('session-1', pane1Id);
        result.current.addTab('session-1', pane2Id);
        result.current.addTab('session-1', pane2Id);
      });

      const updatedSplit = result.current.layouts['session-1'] as TerminalSplit;
      expect((updatedSplit.panes[0] as TerminalPane).tabs).toHaveLength(2);
      expect((updatedSplit.panes[1] as TerminalPane).tabs).toHaveLength(3);
    });

    it('handles deeply nested splits', () => {
      const { result } = renderHook(() => useTerminalStore());
      const originalLayout = result.current.layouts['session-1'] as TerminalPane;

      act(() => {
        result.current.splitPane('session-1', originalLayout.id, 'horizontal');
      });

      let split1 = result.current.layouts['session-1'] as TerminalSplit;
      const pane2Id = (split1.panes[1] as TerminalPane).id;

      act(() => {
        result.current.splitPane('session-1', pane2Id, 'vertical');
      });

      // Get the updated layout after the second split
      const updatedSplit1 = result.current.layouts['session-1'] as TerminalSplit;
      const split2 = (updatedSplit1.panes[1] as TerminalSplit).panes[1] as TerminalPane;

      act(() => {
        result.current.splitPane('session-1', split2.id, 'horizontal');
      });

      // Verify deeply nested structure
      const finalLayout = result.current.layouts['session-1'];
      expect(isTerminalSplit(finalLayout)).toBe(true);
      if (isTerminalSplit(finalLayout)) {
        expect(isTerminalSplit(finalLayout.panes[1])).toBe(true);
      }
    });

    it('maintains consistency across multiple operations', () => {
      const { result } = renderHook(() => useTerminalStore());
      const originalLayout = result.current.layouts['session-1'] as TerminalPane;

      act(() => {
        // Create split
        result.current.splitPane('session-1', originalLayout.id, 'horizontal');
      });

      let split = result.current.layouts['session-1'] as TerminalSplit;
      const pane1Id = (split.panes[0] as TerminalPane).id;
      const pane2Id = (split.panes[1] as TerminalPane).id;

      let tab1, tab2;
      act(() => {
        // Add tabs
        tab1 = result.current.addTab('session-1', pane1Id);
        tab2 = result.current.addTab('session-1', pane2Id);
        // Rename tabs
        result.current.renameTab('session-1', pane1Id, tab1.id, 'Dev Server');
        result.current.renameTab('session-1', pane2Id, tab2.id, 'Tests');
        // Resize
        result.current.resizePane('session-1', pane1Id, 60);
        // Navigate
        result.current.focusPrevPane('session-1');
      });

      const finalSplit = result.current.layouts['session-1'] as TerminalSplit;
      const finalPane1 = finalSplit.panes[0] as TerminalPane;
      const finalPane2 = finalSplit.panes[1] as TerminalPane;

      expect(finalPane1.tabs[1].name).toBe('Dev Server');
      expect(finalPane2.tabs[1].name).toBe('Tests');
      expect(finalPane1.size).toBe(60);
      expect(result.current.activePaneId['session-1']).toBe(pane1Id);
    });

    it('handles session isolation', () => {
      const { result } = renderHook(() => useTerminalStore());

      act(() => {
        result.current.initLayout('session-1');
        result.current.initLayout('session-2');
      });

      const layout1 = result.current.layouts['session-1'] as TerminalPane;
      const layout2 = result.current.layouts['session-2'] as TerminalPane;

      act(() => {
        result.current.splitPane('session-1', layout1.id, 'horizontal');
        result.current.addTab('session-2', layout2.id);
      });

      // Session 1 should be split, Session 2 should be single pane
      expect(isTerminalSplit(result.current.layouts['session-1'])).toBe(true);
      expect(isTerminalPane(result.current.layouts['session-2'])).toBe(true);
    });
  });
});
