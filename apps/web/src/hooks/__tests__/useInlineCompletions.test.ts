/**
 * Comprehensive tests for useInlineCompletions hook
 * Tests Monaco AI-powered inline code completions management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineCompletions } from '../useInlineCompletions';
import * as inlineCompletions from '@/lib/editor/inlineCompletions';

// Mock dependencies
vi.mock('@/lib/editor/inlineCompletions', () => ({
  registerInlineCompletionsProvider: vi.fn(),
  unregisterInlineCompletionsProvider: vi.fn(),
}));

// Mock editor store state
const mockEditorSettings = {
  completionsEnabled: true,
  completionsDebounceMs: 300,
  aiActionModel: 'claude-sonnet-4-5-20250929',
};

const mockUpdateSettings = vi.fn();

vi.mock('@/stores/editor', () => ({
  useEditorStore: (
    selector: (state: {
      settings: typeof mockEditorSettings;
      updateSettings: typeof mockUpdateSettings;
    }) => unknown
  ) => {
    return selector({
      settings: mockEditorSettings,
      updateSettings: mockUpdateSettings,
    });
  },
}));

// Create a mock Monaco instance
const createMockMonaco = () => ({
  languages: {
    registerInlineCompletionsProvider: vi.fn(),
  },
  editor: {
    create: vi.fn(),
  },
});

describe('useInlineCompletions', () => {
  let mockMonaco: ReturnType<typeof createMockMonaco>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMonaco = createMockMonaco();
    mockEditorSettings.completionsEnabled = true;
    mockEditorSettings.completionsDebounceMs = 300;
    mockEditorSettings.aiActionModel = 'claude-sonnet-4-5-20250929';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not register provider when monaco is null', () => {
      renderHook(() => useInlineCompletions({ monaco: null }));

      expect(inlineCompletions.registerInlineCompletionsProvider).not.toHaveBeenCalled();
    });

    it('should register provider when monaco is provided', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);
    });

    it('should register with correct config', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          maxTokens: 256,
          minPrefixLength: 20,
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          enabled: true,
          debounceMs: 300,
          maxTokens: 256,
          minPrefixLength: 20,
          model: 'claude-sonnet-4-5-20250929',
        })
      );
    });

    it('should use default maxTokens of 128', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          maxTokens: 128,
        })
      );
    });

    it('should use default minPrefixLength of 10', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          minPrefixLength: 10,
        })
      );
    });

    it('should pass completionsEnabled from store', () => {
      mockEditorSettings.completionsEnabled = false;

      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          enabled: false,
        })
      );
    });

    it('should pass debounceMs from store', () => {
      mockEditorSettings.completionsDebounceMs = 500;

      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          debounceMs: 500,
        })
      );
    });

    it('should pass aiActionModel from store', () => {
      mockEditorSettings.aiActionModel = 'claude-opus-4-5-20251101';

      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          model: 'claude-opus-4-5-20251101',
        })
      );
    });

    it('should handle null aiActionModel', () => {
      mockEditorSettings.aiActionModel = null as unknown as string;

      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          model: null,
        })
      );
    });
  });

  // ========================================
  // Return Value Tests
  // ========================================

  describe('Return Values', () => {
    it('should return isEnabled from store settings', () => {
      mockEditorSettings.completionsEnabled = true;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(result.current.isEnabled).toBe(true);
    });

    it('should return debounceMs from store settings', () => {
      mockEditorSettings.completionsDebounceMs = 400;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(result.current.debounceMs).toBe(400);
    });

    it('should return toggleEnabled function', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(typeof result.current.toggleEnabled).toBe('function');
    });

    it('should return setEnabled function', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(typeof result.current.setEnabled).toBe('function');
    });

    it('should return setDebounceMs function', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(typeof result.current.setDebounceMs).toBe('function');
    });
  });

  // ========================================
  // Toggle Tests
  // ========================================

  describe('Toggle Enabled', () => {
    it('should toggle from enabled to disabled', () => {
      mockEditorSettings.completionsEnabled = true;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.toggleEnabled();
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsEnabled: false });
    });

    it('should toggle from disabled to enabled', () => {
      mockEditorSettings.completionsEnabled = false;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.toggleEnabled();
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsEnabled: true });
    });

    it('should call toggleEnabled multiple times', () => {
      mockEditorSettings.completionsEnabled = true;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.toggleEnabled();
      });

      mockEditorSettings.completionsEnabled = false;

      act(() => {
        result.current.toggleEnabled();
      });

      expect(mockUpdateSettings).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================
  // Set Enabled Tests
  // ========================================

  describe('Set Enabled', () => {
    it('should set enabled to true', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setEnabled(true);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsEnabled: true });
    });

    it('should set enabled to false', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setEnabled(false);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsEnabled: false });
    });

    it('should handle setting same value', () => {
      mockEditorSettings.completionsEnabled = true;

      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setEnabled(true);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsEnabled: true });
    });
  });

  // ========================================
  // Set Debounce Tests
  // ========================================

  describe('Set Debounce Ms', () => {
    it('should set debounce to specified value', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setDebounceMs(500);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsDebounceMs: 500 });
    });

    it('should set debounce to zero', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setDebounceMs(0);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsDebounceMs: 0 });
    });

    it('should set debounce to large value', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setDebounceMs(5000);
      });

      expect(mockUpdateSettings).toHaveBeenCalledWith({ completionsDebounceMs: 5000 });
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unregister provider on unmount', () => {
      const { unmount } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      expect(inlineCompletions.unregisterInlineCompletionsProvider).not.toHaveBeenCalled();

      unmount();

      expect(inlineCompletions.unregisterInlineCompletionsProvider).toHaveBeenCalledTimes(1);
    });

    it('should not unregister when monaco is null', () => {
      const { unmount } = renderHook(() => useInlineCompletions({ monaco: null }));

      unmount();

      expect(inlineCompletions.unregisterInlineCompletionsProvider).not.toHaveBeenCalled();
    });

    it('should re-register when settings change', () => {
      const { rerender } = renderHook(
        ({ enabled }) => {
          mockEditorSettings.completionsEnabled = enabled;
          return useInlineCompletions({
            monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          });
        },
        { initialProps: { enabled: true } }
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      // Simulate settings change
      rerender({ enabled: false });

      // Should re-register with new settings
      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================
  // Effect Dependencies Tests
  // ========================================

  describe('Effect Dependencies', () => {
    it('should re-register when monaco changes', () => {
      const { rerender } = renderHook(({ monaco }) => useInlineCompletions({ monaco }), {
        initialProps: {
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        },
      });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      const newMonaco = createMockMonaco();
      rerender({
        monaco: newMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
      });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });

    it('should re-register when maxTokens changes', () => {
      const { rerender } = renderHook(
        ({ maxTokens }) =>
          useInlineCompletions({
            monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
            maxTokens,
          }),
        { initialProps: { maxTokens: 128 } }
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      rerender({ maxTokens: 256 });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });

    it('should re-register when minPrefixLength changes', () => {
      const { rerender } = renderHook(
        ({ minPrefixLength }) =>
          useInlineCompletions({
            monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
            minPrefixLength,
          }),
        { initialProps: { minPrefixLength: 10 } }
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      rerender({ minPrefixLength: 5 });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });

    it('should re-register when completionsDebounceMs changes from store', () => {
      const { rerender } = renderHook(
        ({ debounce }) => {
          mockEditorSettings.completionsDebounceMs = debounce;
          return useInlineCompletions({
            monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          });
        },
        { initialProps: { debounce: 300 } }
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      rerender({ debounce: 500 });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });

    it('should re-register when aiActionModel changes from store', () => {
      const { rerender } = renderHook(
        ({ model }) => {
          mockEditorSettings.aiActionModel = model;
          return useInlineCompletions({
            monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          });
        },
        { initialProps: { model: 'claude-sonnet-4-5-20250929' } }
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      rerender({ model: 'claude-opus-4-5-20251101' });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle monaco becoming null after initialization', () => {
      const { rerender, unmount } = renderHook(({ monaco }) => useInlineCompletions({ monaco }), {
        initialProps: {
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        },
      });

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);

      rerender({ monaco: null });

      // Should unregister when monaco becomes null
      expect(inlineCompletions.unregisterInlineCompletionsProvider).toHaveBeenCalled();

      unmount();
    });

    it('should handle rapid setting changes', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.setDebounceMs(100);
        result.current.setDebounceMs(200);
        result.current.setDebounceMs(300);
      });

      expect(mockUpdateSettings).toHaveBeenCalledTimes(3);
    });

    it('should handle toggle and set in quick succession', () => {
      const { result } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      act(() => {
        result.current.toggleEnabled();
        result.current.setEnabled(true);
        result.current.toggleEnabled();
      });

      expect(mockUpdateSettings).toHaveBeenCalledTimes(3);
    });

    it('should preserve callback stability', () => {
      const { result, rerender } = renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
        })
      );

      const toggleEnabled1 = result.current.toggleEnabled;
      const setEnabled1 = result.current.setEnabled;
      const setDebounceMs1 = result.current.setDebounceMs;

      rerender();

      // Callbacks should be memoized
      expect(result.current.toggleEnabled).toBe(toggleEnabled1);
      expect(result.current.setEnabled).toBe(setEnabled1);
      expect(result.current.setDebounceMs).toBe(setDebounceMs1);
    });

    it('should handle undefined maxTokens', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          maxTokens: undefined,
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          maxTokens: 128, // Default
        })
      );
    });

    it('should handle undefined minPrefixLength', () => {
      renderHook(() =>
        useInlineCompletions({
          monaco: mockMonaco as unknown as Parameters<typeof useInlineCompletions>[0]['monaco'],
          minPrefixLength: undefined,
        })
      );

      expect(inlineCompletions.registerInlineCompletionsProvider).toHaveBeenCalledWith(
        mockMonaco,
        expect.objectContaining({
          minPrefixLength: 10, // Default
        })
      );
    });
  });
});
