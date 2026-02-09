/**
 * Comprehensive tests for useGestures hooks
 * Tests all gesture types: swipe, pinch, long press, double tap, and swipeable items
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useSwipeGesture,
  usePinchGesture,
  useLongPress,
  useDoubleTap,
  useSwipeableItem,
  triggerHaptic,
} from '../useGestures';

// Helper function to create touch event
function createTouchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
  options: Partial<TouchEvent> = {}
): TouchEvent {
  const touchList = touches.map((touch, index) => ({
    clientX: touch.clientX,
    clientY: touch.clientY,
    identifier: index,
    pageX: touch.clientX,
    pageY: touch.clientY,
    screenX: touch.clientX,
    screenY: touch.clientY,
    radiusX: 0,
    radiusY: 0,
    rotationAngle: 0,
    force: 1,
    target: document.body,
  })) as unknown as TouchList;

  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, 'touches', { value: touchList, writable: true });
  Object.defineProperty(event, 'changedTouches', { value: touchList, writable: true });
  Object.defineProperty(event, 'targetTouches', { value: touchList, writable: true });

  return Object.assign(event, options);
}

describe('useSwipeGesture', () => {
  let element: HTMLDivElement;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
  });

  afterEach(() => {
    document.body.removeChild(element);
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // Helper to set up the hook with an element
  const setupWithElement = (options: Parameters<typeof useSwipeGesture>[0]) => {
    const { result, rerender, unmount } = renderHook(
      (props) => {
        const hook = useSwipeGesture(props);
        // Set the ref to our element - this simulates what happens in JSX
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: options }
    );
    return { result, rerender, unmount };
  };

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useSwipeGesture({}));

    expect(result.current.isSwiping).toBe(false);
    expect(result.current.swipeProgress).toBe(0);
    expect(result.current.deltaX).toBe(0);
    expect(result.current.deltaY).toBe(0);
    expect(result.current.ref).toBeDefined();
  });

  it('should detect swipe right gesture', async () => {
    const onSwipeRight = vi.fn();
    const { result } = setupWithElement({ onSwipeRight, threshold: 50 });

    // Allow effects to run
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Verify listeners were attached
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      expect.anything()
    );

    // Dispatch events
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    expect(result.current.isSwiping).toBe(true);

    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 100 }]));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 100 }]));
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(result.current.isSwiping).toBe(false);
  });

  it('should detect swipe left gesture', async () => {
    const onSwipeLeft = vi.fn();
    const { result } = setupWithElement({ onSwipeLeft, threshold: 50 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 200, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 120, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 120, clientY: 100 }]));
    });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('should detect swipe up gesture', async () => {
    const onSwipeUp = vi.fn();
    const { result } = setupWithElement({ onSwipeUp, threshold: 50 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 200 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 120 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 120 }]));
    });

    expect(onSwipeUp).toHaveBeenCalledTimes(1);
  });

  it('should detect swipe down gesture', async () => {
    const onSwipeDown = vi.fn();
    const { result } = setupWithElement({ onSwipeDown, threshold: 50 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 180 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 180 }]));
    });

    expect(onSwipeDown).toHaveBeenCalledTimes(1);
  });

  it('should not trigger swipe if below threshold', async () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeRight, threshold: 50 }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 130, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 130, clientY: 100 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('should prioritize horizontal swipe over vertical', async () => {
    const onSwipeRight = vi.fn();
    const onSwipeDown = vi.fn();
    const { result } = setupWithElement({ onSwipeRight, onSwipeDown, threshold: 50 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 130 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 130 }]));
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
    expect(onSwipeDown).not.toHaveBeenCalled();
  });

  it('should calculate swipe progress correctly', async () => {
    const { result } = setupWithElement({ threshold: 100 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]));
    });

    expect(result.current.swipeProgress).toBeCloseTo(0.5);
    expect(result.current.deltaX).toBe(50);
  });

  it('should determine swipe direction', async () => {
    const { result } = setupWithElement({ threshold: 50 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]));
    });

    expect(result.current.swipeDirection).toBe('right');
  });

  it('should prevent default when preventDefaultOnSwipe is true', async () => {
    const { result } = setupWithElement({ threshold: 50, preventDefaultOnSwipe: true });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const moveEvent = createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]);
    const preventDefaultSpy = vi.spyOn(moveEvent, 'preventDefault');

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(moveEvent);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('should handle custom threshold', async () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeRight, threshold: 100 }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 100 }]));
    });

    // Should not trigger with only 80px move when threshold is 100
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('should cleanup event listeners on unmount', async () => {
    const { unmount } = setupWithElement({});

    // Wait for effect to attach listeners
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
  });

  it('should handle touchend without touchstart', async () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeRight }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 100 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('should handle touchmove without touchstart', async () => {
    const { result } = renderHook(() => useSwipeGesture({}));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 100 }]));
    });

    expect(result.current.isSwiping).toBe(false);
  });

  it('should reset state after swipe completes', async () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeGesture({ onSwipeRight, threshold: 50 }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 100 }]));
    });

    expect(result.current.isSwiping).toBe(false);
    expect(result.current.deltaX).toBe(0);
    expect(result.current.deltaY).toBe(0);
    expect(result.current.swipeProgress).toBe(0);
  });

  it('should handle multiple callback updates', async () => {
    let onSwipeRight = vi.fn();
    const { result, rerender } = renderHook(
      ({ callback }) => {
        const hook = useSwipeGesture({ onSwipeRight: callback, threshold: 50 });
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: { callback: onSwipeRight } }
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Change callback
    onSwipeRight = vi.fn();
    rerender({ callback: onSwipeRight });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 180, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 180, clientY: 100 }]));
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });
});

describe('usePinchGesture', () => {
  let element: HTMLDivElement;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
  });

  afterEach(() => {
    document.body.removeChild(element);
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  // Helper to set up the hook with an element
  const setupWithElement = (options: Parameters<typeof usePinchGesture>[0]) => {
    const { result, rerender, unmount } = renderHook(
      (props) => {
        const hook = usePinchGesture(props);
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: options }
    );
    return { result, rerender, unmount };
  };

  it('should initialize with default state', () => {
    const { result } = renderHook(() => usePinchGesture({}));

    expect(result.current.scale).toBe(1);
    expect(result.current.ref).toBeDefined();
  });

  it('should detect pinch out (zoom in)', async () => {
    const onPinchOut = vi.fn();
    const { result } = setupWithElement({ onPinchOut });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ])
      );
      element.dispatchEvent(
        createTouchEvent('touchmove', [
          { clientX: 50, clientY: 100 },
          { clientX: 250, clientY: 100 },
        ])
      );
    });

    expect(onPinchOut).toHaveBeenCalled();
    expect(result.current.scale).toBeGreaterThan(1);
  });

  it('should detect pinch in (zoom out)', async () => {
    const onPinchIn = vi.fn();
    const { result } = setupWithElement({ onPinchIn });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 50, clientY: 100 },
          { clientX: 250, clientY: 100 },
        ])
      );
      element.dispatchEvent(
        createTouchEvent('touchmove', [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ])
      );
    });

    expect(onPinchIn).toHaveBeenCalled();
    expect(result.current.scale).toBeLessThan(1);
  });

  it('should call onPinchEnd when pinch completes', async () => {
    const onPinchEnd = vi.fn();
    const { result } = setupWithElement({ onPinchEnd });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ])
      );
      element.dispatchEvent(
        createTouchEvent('touchmove', [
          { clientX: 50, clientY: 100 },
          { clientX: 250, clientY: 100 },
        ])
      );
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 50, clientY: 100 }]));
    });

    expect(onPinchEnd).toHaveBeenCalledWith(expect.any(Number));
  });

  it('should reset scale after pinch ends', async () => {
    const { result } = renderHook(() => usePinchGesture({}));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 100 },
        ])
      );
      element.dispatchEvent(
        createTouchEvent('touchmove', [
          { clientX: 50, clientY: 100 },
          { clientX: 250, clientY: 100 },
        ])
      );
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 50, clientY: 100 }]));
    });

    expect(result.current.scale).toBe(1);
  });

  it('should ignore single touch', () => {
    const onPinchOut = vi.fn();
    const { result } = renderHook(() => usePinchGesture({ onPinchOut }));

    act(() => {
      result.current.ref.current = element;
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 100 }]));
    });

    expect(onPinchOut).not.toHaveBeenCalled();
  });

  it('should cleanup event listeners on unmount', async () => {
    const { unmount } = setupWithElement({});

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchstart', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
  });

  it('should handle diagonal pinch correctly', async () => {
    const onPinchOut = vi.fn();
    const { result } = setupWithElement({ onPinchOut });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(
        createTouchEvent('touchstart', [
          { clientX: 100, clientY: 100 },
          { clientX: 150, clientY: 150 },
        ])
      );
      element.dispatchEvent(
        createTouchEvent('touchmove', [
          { clientX: 50, clientY: 50 },
          { clientX: 200, clientY: 200 },
        ])
      );
    });

    expect(onPinchOut).toHaveBeenCalled();
    expect(result.current.scale).toBeGreaterThan(1);
  });
});

describe('useLongPress', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.removeChild(element);
    vi.useRealTimers();
  });

  // Helper to set up the hook with an element
  const setupWithElement = (options: Parameters<typeof useLongPress>[0]) => {
    const { result, rerender, unmount } = renderHook(
      (props) => {
        const hook = useLongPress(props);
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: options }
    );
    return { result, rerender, unmount };
  };

  it('should initialize with default state', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));

    expect(result.current.isPressed).toBe(false);
    expect(result.current.ref).toBeDefined();
  });

  it('should trigger onLongPress after delay (touch)', async () => {
    const onLongPress = vi.fn();
    const { result } = setupWithElement({ onLongPress, delay: 500 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    expect(result.current.isPressed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('should trigger onLongPress after delay (mouse)', async () => {
    const onLongPress = vi.fn();
    const { result } = setupWithElement({ onLongPress, delay: 500 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(result.current.isPressed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('should cancel long press on touchend', async () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, delay: 500 }));

    act(() => {
      result.current.ref.current = element;
    });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    expect(result.current.isPressed).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('should cancel long press on mouseup', async () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, delay: 500 }));

    act(() => {
      result.current.ref.current = element;
    });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(result.current.isPressed).toBe(false);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('should cancel long press on mouseleave', async () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, delay: 500 }));

    act(() => {
      result.current.ref.current = element;
    });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });

    expect(result.current.isPressed).toBe(false);
  });

  it('should cancel long press on touchcancel', async () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress, delay: 500 }));

    act(() => {
      result.current.ref.current = element;
    });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      const cancelEvent = new Event('touchcancel', { bubbles: true });
      element.dispatchEvent(cancelEvent);
    });

    expect(result.current.isPressed).toBe(false);
  });

  it('should use default delay of 500ms', async () => {
    const onLongPress = vi.fn();
    const { result } = setupWithElement({ onLongPress });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(499);
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('should support custom delay', async () => {
    const onLongPress = vi.fn();
    const { result } = setupWithElement({ onLongPress, delay: 1000 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(999);
    });

    expect(onLongPress).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('should cleanup timer on unmount', async () => {
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress({ onLongPress, delay: 500 }));

    act(() => {
      result.current.ref.current = element;
    });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('useDoubleTap', () => {
  let element: HTMLDivElement;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.removeChild(element);
    removeEventListenerSpy.mockRestore();
    vi.useRealTimers();
  });

  // Helper to set up the hook with an element
  const setupWithElement = (options: Parameters<typeof useDoubleTap>[0]) => {
    const { result, rerender, unmount } = renderHook(
      (props) => {
        const hook = useDoubleTap(props);
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: options }
    );
    return { result, rerender, unmount };
  };

  it('should initialize correctly', () => {
    const onDoubleTap = vi.fn();
    const { result } = renderHook(() => useDoubleTap({ onDoubleTap }));

    expect(result.current.ref).toBeDefined();
  });

  it('should detect double tap with touch events', async () => {
    const onDoubleTap = vi.fn();
    const { result } = setupWithElement({ onDoubleTap, delay: 300 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it('should detect double tap with click events', async () => {
    const onDoubleTap = vi.fn();
    const { result } = setupWithElement({ onDoubleTap, delay: 300 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it('should not trigger double tap if delay exceeded', async () => {
    const onDoubleTap = vi.fn();
    const { result } = setupWithElement({ onDoubleTap, delay: 300 });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(400);
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    expect(onDoubleTap).not.toHaveBeenCalled();
  });

  it('should use default delay of 300ms', async () => {
    const onDoubleTap = vi.fn();
    const { result } = setupWithElement({ onDoubleTap });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    expect(onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it('should cleanup event listeners on unmount', async () => {
    const onDoubleTap = vi.fn();
    const { unmount } = setupWithElement({ onDoubleTap });

    // Use real timers temporarily for the async effect
    vi.useRealTimers();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    vi.useFakeTimers();

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
  });
});

describe('useSwipeableItem', () => {
  let element: HTMLDivElement;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    // Mock vibrate
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.removeChild(element);
  });

  // Helper to set up the hook with an element
  const setupWithElement = (options: Parameters<typeof useSwipeableItem>[0]) => {
    const { result, rerender, unmount } = renderHook(
      (props) => {
        const hook = useSwipeableItem(props);
        if (!hook.ref.current) {
          hook.ref.current = element;
        }
        return hook;
      },
      { initialProps: options }
    );
    return { result, rerender, unmount };
  };

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useSwipeableItem({}));

    expect(result.current.offset).toBe(0);
    expect(result.current.isSwiping).toBe(false);
    expect(result.current.ref).toBeDefined();
    expect(result.current.style).toBeDefined();
  });

  it('should track swipe offset during move', async () => {
    const { result } = setupWithElement({ maxSwipeDistance: 120 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    expect(result.current.isSwiping).toBe(true);

    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]));
    });

    expect(result.current.offset).toBe(50);
  });

  it('should clamp offset to maxSwipeDistance', async () => {
    const { result } = setupWithElement({ maxSwipeDistance: 100 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dispatch touchstart first to set isSwiping state
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    // Then dispatch touchmove in a separate act block so isSwiping is true
    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 250, clientY: 100 }]));
    });

    expect(result.current.offset).toBe(100);
  });

  it('should trigger onSwipeRight when threshold exceeded', async () => {
    const onSwipeRight = vi.fn();
    const { result } = setupWithElement({ onSwipeRight, swipeThreshold: 80 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dispatch touchstart first to set isSwiping state
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    // Then dispatch touchmove and touchend in separate act blocks
    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 100 }]));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 200, clientY: 100 }]));
    });

    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('should trigger onSwipeLeft when threshold exceeded', async () => {
    const onSwipeLeft = vi.fn();
    const { result } = setupWithElement({ onSwipeLeft, swipeThreshold: 80 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dispatch touchstart first to set isSwiping state
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 200, clientY: 100 }]));
    });

    // Then dispatch touchmove and touchend in separate act blocks
    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 100, clientY: 100 }]));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 100, clientY: 100 }]));
    });

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('should not trigger callback if below threshold', async () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeableItem({ onSwipeRight, swipeThreshold: 80 }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 150, clientY: 100 }]));
    });

    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('should reset offset after swipe', async () => {
    const { result } = renderHook(() => useSwipeableItem({ swipeThreshold: 80 }));

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 200, clientY: 100 }]));
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.isSwiping).toBe(false);
  });

  it('should provide correct transform style', async () => {
    const { result } = setupWithElement({});

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dispatch touchstart first to set isSwiping state
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    // Then dispatch touchmove in a separate act block so isSwiping is true
    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 150, clientY: 100 }]));
    });

    expect(result.current.style.transform).toBe('translateX(50px)');
    expect(result.current.style.transition).toBe('none');
  });

  it('should provide transition style when not swiping', () => {
    const { result } = renderHook(() => useSwipeableItem({}));

    act(() => {
      result.current.ref.current = element;
    });

    expect(result.current.style.transition).toBe('transform 0.2s ease-out');
  });

  it('should trigger haptic feedback when enabled', async () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    const { result } = setupWithElement({
      onSwipeRight: vi.fn(),
      swipeThreshold: 80,
      hapticFeedback: true,
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dispatch touchstart first to set isSwiping state
    act(() => {
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    });

    // Then dispatch touchmove and touchend in separate act blocks
    act(() => {
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 100 }]));
    });

    act(() => {
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 200, clientY: 100 }]));
    });

    expect(vibrateMock).toHaveBeenCalledWith(40);
  });

  it('should not trigger haptic feedback when disabled', async () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() =>
      useSwipeableItem({ onSwipeRight: vi.fn(), swipeThreshold: 80, hapticFeedback: false })
    );

    act(() => {
      result.current.ref.current = element;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 200, clientY: 100 }]));
      element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 200, clientY: 100 }]));
    });

    expect(vibrateMock).not.toHaveBeenCalled();
  });
});

describe('triggerHaptic', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  it('should trigger light haptic feedback', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    triggerHaptic('light');

    expect(vibrateMock).toHaveBeenCalledWith(20);
  });

  it('should trigger medium haptic feedback', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    triggerHaptic('medium');

    expect(vibrateMock).toHaveBeenCalledWith(40);
  });

  it('should trigger heavy haptic feedback', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    triggerHaptic('heavy');

    expect(vibrateMock).toHaveBeenCalledWith(60);
  });

  it('should trigger selection haptic feedback', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true,
    });

    triggerHaptic('selection');

    expect(vibrateMock).toHaveBeenCalledWith(10);
  });

  it('should handle missing vibrate API gracefully', () => {
    const originalVibrate = navigator.vibrate;
    delete (navigator as any).vibrate;

    // Should not throw
    expect(() => triggerHaptic('light')).not.toThrow();

    // Restore
    if (originalVibrate) {
      (navigator as any).vibrate = originalVibrate;
    }
  });
});
