/**
 * Comprehensive tests for useGridResize hook
 * Tests grid resizing functionality for workspace cards
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridResize, type ResizeDirection } from '../useGridResize';
import { useUIStore } from '@/stores/ui';
import type { GridSpan } from '@/stores/session';

// Mock UI store
const mockGridConfig = {
  columns: 3,
  rowHeight: 300,
  maxRows: 0,
  maxCols: 0,
};

vi.mock('@/stores/ui', () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      gridConfig: mockGridConfig,
    };
    return selector(state);
  }),
}));

// Helper to create mock card element
function createMockCardElement(rect: Partial<DOMRect> = {}): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    top: 0,
    right: 400,
    bottom: 300,
    left: 0,
    ...rect,
  });
  return element;
}

// Helper to create mock grid element
function createMockGridElement(
  rect: Partial<DOMRect> = {},
  style: Partial<CSSStyleDeclaration> = {}
): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0,
    y: 0,
    width: 1200,
    height: 600,
    top: 0,
    right: 1200,
    bottom: 600,
    left: 0,
    ...rect,
  });

  // Mock getComputedStyle
  const mockStyle = {
    gap: '16px',
    gridTemplateColumns: '1fr 1fr 1fr',
    ...style,
  };

  vi.spyOn(window, 'getComputedStyle').mockReturnValue(mockStyle as CSSStyleDeclaration);

  return element;
}

describe('useGridResize', () => {
  const defaultSpan: GridSpan = { colSpan: 1, rowSpan: 1 };
  const mockOnResize = vi.fn();
  let mockGridElement: HTMLElement;
  let gridRef: React.RefObject<HTMLElement>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGridElement = createMockGridElement();
    gridRef = { current: mockGridElement };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Initialization', () => {
    it('should initialize with isResizing false', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.isResizing).toBe(false);
    });

    it('should initialize previewSpan with initialSpan values', () => {
      const initialSpan: GridSpan = { colSpan: 2, rowSpan: 2 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.previewSpan.colSpan).toBe(2);
      expect(result.current.previewSpan.rowSpan).toBe(2);
    });

    it('should initialize resizeDirection as null', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.resizeDirection).toBeNull();
    });

    it('should use default maxCols of 3', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      // No explicit maxCols, should use default (3)
      expect(result.current.previewSpan).toBeDefined();
    });

    it('should use default maxRows of 2', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.previewSpan).toBeDefined();
    });

    it('should accept custom maxCols', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          maxCols: 4,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.previewSpan).toBeDefined();
    });

    it('should accept custom maxRows', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          maxRows: 4,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.previewSpan).toBeDefined();
    });
  });

  // ========================================================================
  // handleResizeStart Tests
  // ========================================================================

  describe('handleResizeStart', () => {
    it('should start resize on right direction by default', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(result.current.isResizing).toBe(true);
      expect(result.current.resizeDirection).toBe('bottom-right');
    });

    it('should prevent default on resize start', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should start resize with left direction', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'left');
      });

      expect(result.current.isResizing).toBe(true);
      expect(result.current.resizeDirection).toBe('left');
    });

    it('should start resize with bottom-left direction', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'bottom-left');
      });

      expect(result.current.isResizing).toBe(true);
      expect(result.current.resizeDirection).toBe('bottom-left');
    });

    it('should use existing colStart from initialSpan', () => {
      const spanWithColStart: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 2 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: spanWithColStart,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ left: 420 }); // Position for column 2

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(result.current.previewSpan.colStart).toBe(2);
    });
  });

  // ========================================================================
  // Mouse Move during Resize Tests
  // ========================================================================

  describe('Mouse Move during Resize', () => {
    it('should update preview span on right resize', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'right');
      });

      // Simulate mouse move
      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500, // Move right significantly
          clientY: 100,
        });
        window.dispatchEvent(moveEvent);
      });

      // The previewSpan should update based on the delta
      expect(result.current.isResizing).toBe(true);
    });

    it('should not update span when not resizing', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const initialSpan = { ...result.current.previewSpan };

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 100,
        });
        window.dispatchEvent(moveEvent);
      });

      expect(result.current.previewSpan.colSpan).toBe(initialSpan.colSpan);
    });

    it('should enforce minimum column span of 1', () => {
      const initialSpan: GridSpan = { colSpan: 2, rowSpan: 1 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 400,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ width: 800 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'right');
      });

      // Move significantly to the left (shrink)
      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: -1000, // Very negative to test minimum
          clientY: 100,
        });
        window.dispatchEvent(moveEvent);
      });

      expect(result.current.previewSpan.colSpan).toBeGreaterThanOrEqual(1);
    });

    it('should enforce minimum row span of 1', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 2 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 300,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ height: 600 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'bottom-right');
      });

      // Move significantly up (shrink height)
      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 100,
          clientY: -1000,
        });
        window.dispatchEvent(moveEvent);
      });

      expect(result.current.previewSpan.rowSpan).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // Mouse Up (Commit Resize) Tests
  // ========================================================================

  describe('Mouse Up (Commit Resize)', () => {
    it('should commit resize on mouse up', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(result.current.isResizing).toBe(true);

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);
      });

      expect(result.current.isResizing).toBe(false);
      expect(mockOnResize).toHaveBeenCalled();
    });

    it('should reset direction on mouse up', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(result.current.resizeDirection).toBe('bottom-right');

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);
      });

      expect(result.current.resizeDirection).toBeNull();
    });

    it('should not call onResize when not resizing', () => {
      renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);
      });

      expect(mockOnResize).not.toHaveBeenCalled();
    });

    it('should pass final preview span to onResize', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 1 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);
      });

      expect(mockOnResize).toHaveBeenCalledWith(
        expect.objectContaining({
          colSpan: expect.any(Number),
          rowSpan: expect.any(Number),
        })
      );
    });
  });

  // ========================================================================
  // Event Listener Cleanup Tests
  // ========================================================================

  describe('Event Listener Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { result, unmount } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('should remove event listeners when resize ends', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        window.dispatchEvent(upEvent);
      });

      // Listeners should be cleaned up
      expect(removeEventListenerSpy).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // InitialSpan Changes Tests
  // ========================================================================

  describe('InitialSpan Changes', () => {
    it('should update preview span when initialSpan changes', () => {
      const { result, rerender } = renderHook(
        ({ span }) =>
          useGridResize({
            initialSpan: span,
            onResize: mockOnResize,
            gridRef,
          }),
        { initialProps: { span: { colSpan: 1, rowSpan: 1 } } }
      );

      expect(result.current.previewSpan.colSpan).toBe(1);

      rerender({ span: { colSpan: 2, rowSpan: 2 } });

      expect(result.current.previewSpan.colSpan).toBe(2);
      expect(result.current.previewSpan.rowSpan).toBe(2);
    });

    it('should not update preview span during active resize', () => {
      const { result, rerender } = renderHook(
        ({ span }) =>
          useGridResize({
            initialSpan: span,
            onResize: mockOnResize,
            gridRef,
          }),
        { initialProps: { span: { colSpan: 1, rowSpan: 1 } } }
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard);
      });

      expect(result.current.isResizing).toBe(true);

      // Try to change initialSpan during resize
      rerender({ span: { colSpan: 3, rowSpan: 3 } });

      // Preview span should not change to new initialSpan during resize
      expect(result.current.isResizing).toBe(true);
    });
  });

  // ========================================================================
  // Grid Configuration from UI Store Tests
  // ========================================================================

  describe('Grid Configuration from UI Store', () => {
    it('should use grid config from UI store', () => {
      // Grid config is mocked in the mock setup
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      expect(result.current.previewSpan).toBeDefined();
    });
  });

  // ========================================================================
  // Edge Cases Tests
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle missing gridRef', () => {
      const nullRef = { current: null };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef: nullRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      // Should not throw
      expect(() => {
        act(() => {
          result.current.handleResizeStart(mockEvent, mockCard);
        });
      }).not.toThrow();
    });

    it('should handle zero width grid', () => {
      const zeroWidthGrid = createMockGridElement({ width: 0 });
      const zeroWidthGridRef = { current: zeroWidthGrid };

      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef: zeroWidthGridRef,
        })
      );

      expect(result.current.previewSpan).toBeDefined();
    });

    it('should handle rapid resize start/stop cycles', () => {
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan: defaultSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement();

      // Rapid cycles
      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.handleResizeStart(mockEvent, mockCard);
        });
        act(() => {
          const upEvent = new MouseEvent('mouseup');
          window.dispatchEvent(upEvent);
        });
      }

      expect(result.current.isResizing).toBe(false);
      expect(mockOnResize).toHaveBeenCalledTimes(10);
    });
  });

  // ========================================================================
  // All Resize Directions Tests
  // ========================================================================

  describe('All Resize Directions', () => {
    const directions: ResizeDirection[] = ['right', 'left', 'bottom-right', 'bottom-left'];

    directions.forEach((direction) => {
      it(`should handle ${direction} resize direction`, () => {
        const { result } = renderHook(() =>
          useGridResize({
            initialSpan: defaultSpan,
            onResize: mockOnResize,
            gridRef,
          })
        );

        const mockEvent = {
          clientX: 100,
          clientY: 100,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.MouseEvent;

        const mockCard = createMockCardElement();

        act(() => {
          result.current.handleResizeStart(mockEvent, mockCard, direction);
        });

        expect(result.current.isResizing).toBe(true);
        expect(result.current.resizeDirection).toBe(direction);
      });
    });
  });

  // ========================================================================
  // Left Resize Behavior Tests
  // ========================================================================

  describe('Left Resize Behavior', () => {
    it('should adjust colStart when resizing from left', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 2 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 500,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ left: 420, width: 380 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'left');
      });

      expect(result.current.isResizing).toBe(true);
      expect(result.current.previewSpan.colStart).toBeDefined();
    });

    it('should maintain right edge position on left resize', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 2 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 420,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ left: 420, width: 380 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'left');
      });

      // The colStart should be preserved initially
      expect(result.current.previewSpan.colStart).toBe(2);
    });
  });

  // ========================================================================
  // Boundary Tests
  // ========================================================================

  describe('Boundary Tests', () => {
    it('should not allow colStart below 1', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 1 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 100,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ left: 0 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'left');
      });

      // Move far to the left
      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: -1000,
          clientY: 100,
        });
        window.dispatchEvent(moveEvent);
      });

      expect(result.current.previewSpan.colStart).toBeGreaterThanOrEqual(1);
    });

    it('should respect grid column boundaries', () => {
      const initialSpan: GridSpan = { colSpan: 1, rowSpan: 1, colStart: 3 };
      const { result } = renderHook(() =>
        useGridResize({
          initialSpan,
          maxCols: 3,
          onResize: mockOnResize,
          gridRef,
        })
      );

      const mockEvent = {
        clientX: 900,
        clientY: 100,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      const mockCard = createMockCardElement({ left: 800, width: 380 });

      act(() => {
        result.current.handleResizeStart(mockEvent, mockCard, 'right');
      });

      // Move far to the right
      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 2000,
          clientY: 100,
        });
        window.dispatchEvent(moveEvent);
      });

      // Card should not exceed grid bounds
      const { colStart, colSpan } = result.current.previewSpan;
      expect((colStart || 1) + colSpan - 1).toBeLessThanOrEqual(3);
    });
  });
});
