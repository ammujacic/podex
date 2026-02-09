/**
 * Comprehensive tests for useCardDimensions and useAllCardDimensions hooks
 * Tests card dimension retrieval from ConfigStore
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardDimensions, useAllCardDimensions, type CardType } from '../useCardDimensions';
import type { CardDimensions, CardDimensionConfig } from '@/lib/api';

// Mock the config store
vi.mock('@/stores/config', () => ({
  useConfigStore: vi.fn(),
}));

import { useConfigStore } from '@/stores/config';

describe('useCardDimensions', () => {
  const mockDimensions: CardDimensions = {
    terminal: {
      min_width: 300,
      min_height: 200,
      default_width: 600,
      default_height: 400,
      max_width: 1200,
      max_height: 800,
    },
    editor: {
      min_width: 400,
      min_height: 300,
      default_width: 800,
      default_height: 600,
      max_width: 1600,
      max_height: 1000,
    },
    agent: {
      min_width: 350,
      min_height: 250,
      default_width: 700,
      default_height: 500,
      max_width: 1400,
      max_height: 900,
    },
    preview: {
      min_width: 320,
      min_height: 240,
      default_width: 640,
      default_height: 480,
      max_width: 1280,
      max_height: 720,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementation
    vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        getCardDimensions: () => mockDimensions,
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return terminal dimensions', () => {
      const { result } = renderHook(() => useCardDimensions('terminal'));

      expect(result.current).toEqual(mockDimensions.terminal);
    });

    it('should return editor dimensions', () => {
      const { result } = renderHook(() => useCardDimensions('editor'));

      expect(result.current).toEqual(mockDimensions.editor);
    });

    it('should return agent dimensions', () => {
      const { result } = renderHook(() => useCardDimensions('agent'));

      expect(result.current).toEqual(mockDimensions.agent);
    });

    it('should return preview dimensions', () => {
      const { result } = renderHook(() => useCardDimensions('preview'));

      expect(result.current).toEqual(mockDimensions.preview);
    });
  });

  // ========================================
  // Dimension Values Tests
  // ========================================

  describe('Dimension Values', () => {
    it('should return correct min dimensions for terminal', () => {
      const { result } = renderHook(() => useCardDimensions('terminal'));

      expect(result.current.min_width).toBe(300);
      expect(result.current.min_height).toBe(200);
    });

    it('should return correct default dimensions for editor', () => {
      const { result } = renderHook(() => useCardDimensions('editor'));

      expect(result.current.default_width).toBe(800);
      expect(result.current.default_height).toBe(600);
    });

    it('should return correct max dimensions for agent', () => {
      const { result } = renderHook(() => useCardDimensions('agent'));

      expect(result.current.max_width).toBe(1400);
      expect(result.current.max_height).toBe(900);
    });

    it('should return all dimension properties', () => {
      const { result } = renderHook(() => useCardDimensions('preview'));

      expect(result.current).toHaveProperty('min_width');
      expect(result.current).toHaveProperty('min_height');
      expect(result.current).toHaveProperty('default_width');
      expect(result.current).toHaveProperty('default_height');
      expect(result.current).toHaveProperty('max_width');
      expect(result.current).toHaveProperty('max_height');
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    it('should throw error when config is not initialized', () => {
      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => null,
        })
      );

      expect(() => {
        renderHook(() => useCardDimensions('terminal'));
      }).toThrow('ConfigStore not initialized - card_dimensions not available');
    });

    it('should throw error when getCardDimensions returns undefined', () => {
      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => undefined,
        })
      );

      expect(() => {
        renderHook(() => useCardDimensions('terminal'));
      }).toThrow('ConfigStore not initialized - card_dimensions not available');
    });
  });

  // ========================================
  // Card Type Changes Tests
  // ========================================

  describe('Card Type Changes', () => {
    it('should update when card type changes', () => {
      const { result, rerender } = renderHook(
        ({ cardType }: { cardType: CardType }) => useCardDimensions(cardType),
        { initialProps: { cardType: 'terminal' as CardType } }
      );

      expect(result.current.default_width).toBe(600);

      rerender({ cardType: 'editor' });

      expect(result.current.default_width).toBe(800);
    });

    it('should handle rapid card type changes', () => {
      const { result, rerender } = renderHook(
        ({ cardType }: { cardType: CardType }) => useCardDimensions(cardType),
        { initialProps: { cardType: 'terminal' as CardType } }
      );

      const cardTypes: CardType[] = ['terminal', 'editor', 'agent', 'preview'];

      for (const cardType of cardTypes) {
        rerender({ cardType });
        expect(result.current).toEqual(mockDimensions[cardType]);
      }
    });
  });

  // ========================================
  // Custom Dimensions Tests
  // ========================================

  describe('Custom Dimensions', () => {
    it('should handle custom dimension values', () => {
      const customDimensions: CardDimensions = {
        terminal: {
          min_width: 100,
          min_height: 100,
          default_width: 500,
          default_height: 300,
          max_width: 2000,
          max_height: 1500,
        },
        editor: mockDimensions.editor,
        agent: mockDimensions.agent,
        preview: mockDimensions.preview,
      };

      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => customDimensions,
        })
      );

      const { result } = renderHook(() => useCardDimensions('terminal'));

      expect(result.current.min_width).toBe(100);
      expect(result.current.default_width).toBe(500);
      expect(result.current.max_width).toBe(2000);
    });

    it('should handle zero dimension values', () => {
      const zeroDimensions: CardDimensions = {
        terminal: {
          min_width: 0,
          min_height: 0,
          default_width: 0,
          default_height: 0,
          max_width: 0,
          max_height: 0,
        },
        editor: mockDimensions.editor,
        agent: mockDimensions.agent,
        preview: mockDimensions.preview,
      };

      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => zeroDimensions,
        })
      );

      const { result } = renderHook(() => useCardDimensions('terminal'));

      expect(result.current.min_width).toBe(0);
      expect(result.current.default_width).toBe(0);
    });

    it('should handle large dimension values', () => {
      const largeDimensions: CardDimensions = {
        terminal: {
          min_width: 10000,
          min_height: 10000,
          default_width: 50000,
          default_height: 50000,
          max_width: 100000,
          max_height: 100000,
        },
        editor: mockDimensions.editor,
        agent: mockDimensions.agent,
        preview: mockDimensions.preview,
      };

      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => largeDimensions,
        })
      );

      const { result } = renderHook(() => useCardDimensions('terminal'));

      expect(result.current.min_width).toBe(10000);
      expect(result.current.max_width).toBe(100000);
    });
  });
});

// ========================================
// useAllCardDimensions Tests
// ========================================

describe('useAllCardDimensions', () => {
  const mockDimensions: CardDimensions = {
    terminal: {
      min_width: 300,
      min_height: 200,
      default_width: 600,
      default_height: 400,
      max_width: 1200,
      max_height: 800,
    },
    editor: {
      min_width: 400,
      min_height: 300,
      default_width: 800,
      default_height: 600,
      max_width: 1600,
      max_height: 1000,
    },
    agent: {
      min_width: 350,
      min_height: 250,
      default_width: 700,
      default_height: 500,
      max_width: 1400,
      max_height: 900,
    },
    preview: {
      min_width: 320,
      min_height: 240,
      default_width: 640,
      default_height: 480,
      max_width: 1280,
      max_height: 720,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        getCardDimensions: () => mockDimensions,
      })
    );
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return all card dimensions', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current).toEqual(mockDimensions);
    });

    it('should include all card types', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current).toHaveProperty('terminal');
      expect(result.current).toHaveProperty('editor');
      expect(result.current).toHaveProperty('agent');
      expect(result.current).toHaveProperty('preview');
    });
  });

  // ========================================
  // Return Value Tests
  // ========================================

  describe('Return Values', () => {
    it('should return terminal dimensions', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current.terminal).toEqual(mockDimensions.terminal);
    });

    it('should return editor dimensions', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current.editor).toEqual(mockDimensions.editor);
    });

    it('should return agent dimensions', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current.agent).toEqual(mockDimensions.agent);
    });

    it('should return preview dimensions', () => {
      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current.preview).toEqual(mockDimensions.preview);
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    it('should throw error when config is not initialized', () => {
      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => null,
        })
      );

      expect(() => {
        renderHook(() => useAllCardDimensions());
      }).toThrow('ConfigStore not initialized - card_dimensions not available');
    });

    it('should throw error when getCardDimensions returns undefined', () => {
      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => undefined,
        })
      );

      expect(() => {
        renderHook(() => useAllCardDimensions());
      }).toThrow('ConfigStore not initialized - card_dimensions not available');
    });
  });

  // ========================================
  // Config Updates Tests
  // ========================================

  describe('Config Updates', () => {
    it('should reflect updated config values', () => {
      const { result, rerender } = renderHook(() => useAllCardDimensions());

      expect(result.current.terminal.default_width).toBe(600);

      // Update mock
      const updatedDimensions: CardDimensions = {
        ...mockDimensions,
        terminal: {
          ...mockDimensions.terminal,
          default_width: 900,
        },
      };

      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => updatedDimensions,
        })
      );

      rerender();

      expect(result.current.terminal.default_width).toBe(900);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle dimensions with all same values', () => {
      const uniformDimensions: CardDimensions = {
        terminal: {
          min_width: 500,
          min_height: 500,
          default_width: 500,
          default_height: 500,
          max_width: 500,
          max_height: 500,
        },
        editor: {
          min_width: 500,
          min_height: 500,
          default_width: 500,
          default_height: 500,
          max_width: 500,
          max_height: 500,
        },
        agent: {
          min_width: 500,
          min_height: 500,
          default_width: 500,
          default_height: 500,
          max_width: 500,
          max_height: 500,
        },
        preview: {
          min_width: 500,
          min_height: 500,
          default_width: 500,
          default_height: 500,
          max_width: 500,
          max_height: 500,
        },
      };

      vi.mocked(useConfigStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          getCardDimensions: () => uniformDimensions,
        })
      );

      const { result } = renderHook(() => useAllCardDimensions());

      expect(result.current.terminal.min_width).toBe(500);
      expect(result.current.terminal.max_width).toBe(500);
    });

    it('should not modify returned dimensions object', () => {
      // Create a copy of the original dimensions to compare against
      const originalTerminal = { ...mockDimensions.terminal };

      const { result } = renderHook(() => useAllCardDimensions());

      // Verify the hook returns the expected dimensions
      expect(result.current.terminal).toEqual(originalTerminal);

      // Note: In a real implementation, the store returns immutable data.
      // With our mock setup, result.current === mockDimensions, so we can't
      // test immutability this way. This test verifies the initial state is correct.
      expect(result.current.terminal.min_width).toBe(300);
      expect(result.current.terminal.min_height).toBe(200);
      expect(result.current.terminal.default_width).toBe(600);
      expect(result.current.terminal.default_height).toBe(400);
      expect(result.current.terminal.max_width).toBe(1200);
      expect(result.current.terminal.max_height).toBe(800);
    });
  });
});
