import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOverlaysUIStore } from '../overlaysUI';

describe('overlaysUIStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useOverlaysUIStore.setState({
        commandPaletteOpen: false,
        quickOpenOpen: false,
        globalSearchOpen: false,
        activeModal: null,
        modalData: {},
      });
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has command palette closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('has quick open closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('has global search closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('has no active modal', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      expect(result.current.activeModal).toBeNull();
    });

    it('has empty modal data', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      expect(result.current.modalData).toEqual({});
    });
  });

  // ========================================================================
  // Command Palette
  // ========================================================================

  describe('Command Palette', () => {
    it('opens command palette', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
    });

    it('closes command palette', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('toggles command palette open', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.toggleCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
    });

    it('toggles command palette closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.toggleCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('closes other overlays when opening command palette', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('closes other overlays when toggling command palette on', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openGlobalSearch();
        result.current.toggleCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
      expect(result.current.globalSearchOpen).toBe(false);
    });
  });

  // ========================================================================
  // Quick Open
  // ========================================================================

  describe('Quick Open', () => {
    it('opens quick open', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
    });

    it('closes quick open', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.closeQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('toggles quick open on', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.toggleQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
    });

    it('toggles quick open off', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.toggleQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('closes other overlays when opening quick open', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.openQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('closes other overlays when toggling quick open on', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openGlobalSearch();
        result.current.toggleQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
      expect(result.current.globalSearchOpen).toBe(false);
    });
  });

  // ========================================================================
  // Global Search
  // ========================================================================

  describe('Global Search', () => {
    it('opens global search', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
    });

    it('closes global search', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openGlobalSearch();
        result.current.closeGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('toggles global search on', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.toggleGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
    });

    it('toggles global search off', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openGlobalSearch();
        result.current.toggleGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('closes other overlays when opening global search', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.openGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(false);
    });

    it('closes other overlays when toggling global search on', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openQuickOpen();
        result.current.toggleGlobalSearch();
      });

      expect(result.current.globalSearchOpen).toBe(true);
      expect(result.current.quickOpenOpen).toBe(false);
    });
  });

  // ========================================================================
  // Modal Management
  // ========================================================================

  describe('Modal Management', () => {
    it('opens modal without data', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('settings-modal');
      });

      expect(result.current.activeModal).toBe('settings-modal');
      expect(result.current.modalData).toEqual({});
    });

    it('opens modal with data', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      const data = { userId: '123', name: 'Test User' };

      act(() => {
        result.current.openModal('user-modal', data);
      });

      expect(result.current.activeModal).toBe('user-modal');
      expect(result.current.modalData).toEqual(data);
    });

    it('closes modal', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('test-modal', { key: 'value' });
        result.current.closeModal();
      });

      expect(result.current.activeModal).toBeNull();
      expect(result.current.modalData).toEqual({});
    });

    it('switches modals', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('modal-1', { data: 'first' });
        result.current.openModal('modal-2', { data: 'second' });
      });

      expect(result.current.activeModal).toBe('modal-2');
      expect(result.current.modalData).toEqual({ data: 'second' });
    });

    it('handles closing when no modal is open', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      expect(() => {
        act(() => {
          result.current.closeModal();
        });
      }).not.toThrow();

      expect(result.current.activeModal).toBeNull();
    });

    it('preserves modal data until modal is closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      const data = { important: 'data' };

      act(() => {
        result.current.openModal('persist-modal', data);
      });

      expect(result.current.modalData).toEqual(data);

      act(() => {
        result.current.closeModal();
      });

      expect(result.current.modalData).toEqual({});
    });
  });

  // ========================================================================
  // Overlay Visibility (Multiple Overlays)
  // ========================================================================

  describe('Overlay Visibility', () => {
    it('only one overlay can be open at a time', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);

      act(() => {
        result.current.openQuickOpen();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(true);
      expect(result.current.globalSearchOpen).toBe(false);

      act(() => {
        result.current.openGlobalSearch();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(true);
    });

    it('all overlays can be closed simultaneously', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });

    it('modals are independent of overlay state', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.openModal('test-modal');
      });

      expect(result.current.commandPaletteOpen).toBe(true);
      expect(result.current.activeModal).toBe('test-modal');

      act(() => {
        result.current.closeCommandPalette();
      });

      expect(result.current.activeModal).toBe('test-modal');
    });
  });

  // ========================================================================
  // Overlay Content
  // ========================================================================

  describe('Overlay Content', () => {
    it('modal data supports complex objects', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      const complexData = {
        user: { id: '123', name: 'Test' },
        items: [1, 2, 3],
        nested: { deep: { value: 'test' } },
      };

      act(() => {
        result.current.openModal('complex-modal', complexData);
      });

      expect(result.current.modalData).toEqual(complexData);
    });

    it('modal data supports arrays', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      const arrayData = { items: ['a', 'b', 'c'] };

      act(() => {
        result.current.openModal('array-modal', arrayData);
      });

      expect(result.current.modalData).toEqual(arrayData);
    });

    it('modal data supports numbers and booleans', () => {
      const { result } = renderHook(() => useOverlaysUIStore());
      const mixedData = { count: 42, enabled: true, ratio: 0.5 };

      act(() => {
        result.current.openModal('mixed-modal', mixedData);
      });

      expect(result.current.modalData).toEqual(mixedData);
    });
  });

  // ========================================================================
  // Z-Index Behavior (Implicit)
  // ========================================================================

  describe('Z-Index Behavior', () => {
    it('most recently opened overlay should be on top', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);

      act(() => {
        result.current.openQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
      expect(result.current.commandPaletteOpen).toBe(false);
    });

    it('modal can be active while overlay is closed', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('test-modal');
      });

      expect(result.current.activeModal).toBe('test-modal');
      expect(result.current.commandPaletteOpen).toBe(false);
      expect(result.current.quickOpenOpen).toBe(false);
      expect(result.current.globalSearchOpen).toBe(false);
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('handles rapid open/close cycles', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
        result.current.openCommandPalette();
        result.current.closeCommandPalette();
        result.current.openCommandPalette();
      });

      expect(result.current.commandPaletteOpen).toBe(true);
    });

    it('handles rapid toggle cycles', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.toggleQuickOpen();
        result.current.toggleQuickOpen();
        result.current.toggleQuickOpen();
      });

      expect(result.current.quickOpenOpen).toBe(true);
    });

    it('handles opening same modal multiple times', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('same-modal', { version: 1 });
        result.current.openModal('same-modal', { version: 2 });
      });

      expect(result.current.activeModal).toBe('same-modal');
      expect(result.current.modalData).toEqual({ version: 2 });
    });

    it('handles empty string modal id', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('');
      });

      expect(result.current.activeModal).toBe('');
    });

    it('handles undefined modal data gracefully', () => {
      const { result } = renderHook(() => useOverlaysUIStore());

      act(() => {
        result.current.openModal('undefined-modal', undefined);
      });

      expect(result.current.modalData).toEqual({});
    });
  });
});
