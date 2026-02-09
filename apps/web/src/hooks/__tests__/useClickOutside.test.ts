/**
 * Comprehensive tests for useClickOutside and useClickOutsideMultiple hooks
 * Tests click detection, touch events, and multi-element handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClickOutside, useClickOutsideMultiple } from '../useClickOutside';
import { createRef } from 'react';

describe('useClickOutside', () => {
  let container: HTMLDivElement;
  let outsideElement: HTMLDivElement;

  beforeEach(() => {
    // Create container element
    container = document.createElement('div');
    container.setAttribute('data-testid', 'container');
    document.body.appendChild(container);

    // Create element outside container
    outsideElement = document.createElement('div');
    outsideElement.setAttribute('data-testid', 'outside');
    document.body.appendChild(outsideElement);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return a ref object', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      expect(result.current).toBeDefined();
      expect(result.current.current).toBeNull();
    });

    it('should be enabled by default', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler when disabled', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler, false));

      result.current.current = container;

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Mouse Event Tests
  // ========================================

  describe('Mouse Events', () => {
    it('should call handler on mousedown outside', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler on mousedown inside', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        container.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not call handler on mousedown inside nested element', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      // Add nested element
      const nestedButton = document.createElement('button');
      container.appendChild(nestedButton);

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        nestedButton.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple outside clicks', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      // Multiple clicks
      for (let i = 0; i < 5; i++) {
        act(() => {
          const event = new MouseEvent('mousedown', { bubbles: true });
          outsideElement.dispatchEvent(event);
        });
      }

      expect(handler).toHaveBeenCalledTimes(5);
    });
  });

  // ========================================
  // Touch Event Tests
  // ========================================

  describe('Touch Events', () => {
    it('should call handler on touchstart outside', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler on touchstart inside', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        container.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not call handler on touchstart inside nested element', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      const nestedDiv = document.createElement('div');
      container.appendChild(nestedDiv);

      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        nestedDiv.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Enable/Disable Tests
  // ========================================

  describe('Enable/Disable', () => {
    it('should enable when enabled changes to true', () => {
      const handler = vi.fn();
      const { result, rerender } = renderHook(({ enabled }) => useClickOutside(handler, enabled), {
        initialProps: { enabled: false },
      });

      result.current.current = container;

      // Click outside - should not trigger
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();

      // Enable
      rerender({ enabled: true });

      // Click outside - should trigger
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should disable when enabled changes to false', () => {
      const handler = vi.fn();
      const { result, rerender } = renderHook(({ enabled }) => useClickOutside(handler, enabled), {
        initialProps: { enabled: true },
      });

      result.current.current = container;

      // Click outside - should trigger
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);

      // Disable
      rerender({ enabled: false });

      // Click outside - should not trigger
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const handler = vi.fn();
      const { result, unmount } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    });

    it('should not call handler after unmount', () => {
      const handler = vi.fn();
      const { result, unmount } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      unmount();

      // Click outside after unmount
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle null ref', () => {
      const handler = vi.fn();
      renderHook(() => useClickOutside(handler));

      // Click anywhere - ref is null
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        document.body.dispatchEvent(event);
      });

      // Handler should not be called when ref is null
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle handler changes', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const { result, rerender } = renderHook(({ handler }) => useClickOutside(handler), {
        initialProps: { handler: handler1 },
      });

      result.current.current = container;

      // Click with first handler
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();

      // Change handler
      rerender({ handler: handler2 });

      // Click with second handler
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should handle clicks on document body', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside(handler));

      result.current.current = container;

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        document.body.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should work with custom HTML element types', () => {
      const handler = vi.fn();
      const { result } = renderHook(() => useClickOutside<HTMLButtonElement>(handler));

      const button = document.createElement('button');
      document.body.appendChild(button);

      result.current.current = button;

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

// ========================================
// useClickOutsideMultiple Tests
// ========================================

describe('useClickOutsideMultiple', () => {
  let container1: HTMLDivElement;
  let container2: HTMLDivElement;
  let outsideElement: HTMLDivElement;

  beforeEach(() => {
    container1 = document.createElement('div');
    container1.setAttribute('data-testid', 'container-1');
    document.body.appendChild(container1);

    container2 = document.createElement('div');
    container2.setAttribute('data-testid', 'container-2');
    document.body.appendChild(container2);

    outsideElement = document.createElement('div');
    outsideElement.setAttribute('data-testid', 'outside');
    document.body.appendChild(outsideElement);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ========================================
  // Multiple Refs Tests
  // ========================================

  describe('Multiple Refs', () => {
    it('should call handler when clicking outside all refs', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      // Manually set refs
      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler when clicking inside first ref', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        container1.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not call handler when clicking inside second ref', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        container2.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle nested elements in any ref', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      // Add nested element
      const nestedButton = document.createElement('button');
      container2.appendChild(nestedButton);

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        nestedButton.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Touch Events Tests
  // ========================================

  describe('Touch Events', () => {
    it('should call handler on touchstart outside all refs', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler on touchstart inside any ref', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      // Touch first container
      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        container1.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();

      // Touch second container
      act(() => {
        const event = new TouchEvent('touchstart', { bubbles: true });
        container2.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Enable/Disable Tests
  // ========================================

  describe('Enable/Disable', () => {
    it('should not call handler when disabled', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler, false));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should respond to enabled changes', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;
      (ref2 as { current: HTMLDivElement }).current = container2;

      const { rerender } = renderHook(
        ({ enabled }) => useClickOutsideMultiple([ref1, ref2], handler, enabled),
        { initialProps: { enabled: false } }
      );

      // Click outside - disabled
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();

      // Enable
      rerender({ enabled: true });

      // Click outside - enabled
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty refs array', () => {
      const handler = vi.fn();

      renderHook(() => useClickOutsideMultiple([], handler));

      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      // All clicks are "outside" when no refs
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle single ref in array', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;

      renderHook(() => useClickOutsideMultiple([ref1], handler));

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);

      // Click inside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        container1.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should handle refs with null values', () => {
      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();
      const ref2 = createRef<HTMLDivElement>();

      // Only set first ref
      (ref1 as { current: HTMLDivElement }).current = container1;
      // ref2 remains null

      renderHook(() => useClickOutsideMultiple([ref1, ref2], handler));

      // Click inside first ref
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        container1.dispatchEvent(event);
      });

      expect(handler).not.toHaveBeenCalled();

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle many refs', () => {
      const handler = vi.fn();
      const refs: React.RefObject<HTMLDivElement | null>[] = [];
      const containers: HTMLDivElement[] = [];

      // Create 10 refs and containers
      for (let i = 0; i < 10; i++) {
        const ref = createRef<HTMLDivElement>();
        const el = document.createElement('div');
        el.setAttribute('data-testid', `container-${i}`);
        document.body.appendChild(el);
        (ref as { current: HTMLDivElement }).current = el;
        refs.push(ref);
        containers.push(el);
      }

      renderHook(() => useClickOutsideMultiple(refs, handler));

      // Click inside each container
      for (const container of containers) {
        act(() => {
          const event = new MouseEvent('mousedown', { bubbles: true });
          container.dispatchEvent(event);
        });
      }

      expect(handler).not.toHaveBeenCalled();

      // Click outside
      act(() => {
        const event = new MouseEvent('mousedown', { bubbles: true });
        outsideElement.dispatchEvent(event);
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should cleanup listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const handler = vi.fn();
      const ref1 = createRef<HTMLDivElement>();

      (ref1 as { current: HTMLDivElement }).current = container1;

      const { unmount } = renderHook(() => useClickOutsideMultiple([ref1], handler));

      expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    });
  });
});
