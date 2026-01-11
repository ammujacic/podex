'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface SwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
  preventDefaultOnSwipe?: boolean;
}

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSwiping: boolean;
}

/**
 * Hook for detecting swipe gestures on touch devices
 */
export function useSwipeGesture<T extends HTMLElement = HTMLElement>(options: SwipeGestureOptions) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    preventDefaultOnSwipe = false,
  } = options;

  const ref = useRef<T>(null);
  const [swipeState, setSwipeState] = useState<SwipeState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwiping: false,
  });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    setSwipeState({
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isSwiping: true,
    });
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!swipeState.isSwiping) return;

      const touch = e.touches[0];
      if (!touch) return;
      setSwipeState((prev) => ({
        ...prev,
        currentX: touch.clientX,
        currentY: touch.clientY,
      }));

      if (preventDefaultOnSwipe) {
        const deltaX = Math.abs(touch.clientX - swipeState.startX);
        const deltaY = Math.abs(touch.clientY - swipeState.startY);
        if (deltaX > deltaY && deltaX > 10) {
          e.preventDefault();
        }
      }
    },
    [swipeState.isSwiping, swipeState.startX, swipeState.startY, preventDefaultOnSwipe]
  );

  const handleTouchEnd = useCallback(() => {
    if (!swipeState.isSwiping) return;

    const deltaX = swipeState.currentX - swipeState.startX;
    const deltaY = swipeState.currentY - swipeState.startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Determine if it's a horizontal or vertical swipe
    if (absDeltaX > absDeltaY) {
      // Horizontal swipe
      if (absDeltaX >= threshold) {
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
      }
    } else {
      // Vertical swipe
      if (absDeltaY >= threshold) {
        if (deltaY > 0) {
          onSwipeDown?.();
        } else {
          onSwipeUp?.();
        }
      }
    }

    setSwipeState((prev) => ({ ...prev, isSwiping: false }));
  }, [swipeState, threshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: !preventDefaultOnSwipe });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, preventDefaultOnSwipe]);

  // Calculate swipe progress (0-1)
  const swipeProgress = swipeState.isSwiping
    ? Math.min(Math.abs(swipeState.currentX - swipeState.startX) / threshold, 1)
    : 0;

  const swipeDirection = swipeState.currentX > swipeState.startX ? 'right' : 'left';

  return {
    ref,
    isSwiping: swipeState.isSwiping,
    swipeProgress,
    swipeDirection,
    deltaX: swipeState.currentX - swipeState.startX,
    deltaY: swipeState.currentY - swipeState.startY,
  };
}

interface PinchGestureOptions {
  onPinchIn?: (scale: number) => void;
  onPinchOut?: (scale: number) => void;
  onPinchEnd?: (finalScale: number) => void;
}

/**
 * Hook for detecting pinch gestures (zoom in/out)
 */
export function usePinchGesture<T extends HTMLElement = HTMLElement>(options: PinchGestureOptions) {
  const { onPinchIn, onPinchOut, onPinchEnd } = options;
  const ref = useRef<T>(null);
  const [scale, setScale] = useState(1);
  const initialDistanceRef = useRef<number>(0);

  const getDistance = (touches: TouchList): number => {
    const touch0 = touches[0];
    const touch1 = touches[1];
    if (!touch0 || !touch1) return 0;
    const dx = touch0.clientX - touch1.clientX;
    const dy = touch0.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      initialDistanceRef.current = getDistance(e.touches);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length !== 2 || initialDistanceRef.current === 0) return;

      const currentDistance = getDistance(e.touches);
      const newScale = currentDistance / initialDistanceRef.current;

      setScale(newScale);

      if (newScale < 1) {
        onPinchIn?.(newScale);
      } else if (newScale > 1) {
        onPinchOut?.(newScale);
      }
    },
    [onPinchIn, onPinchOut]
  );

  const handleTouchEnd = useCallback(() => {
    if (initialDistanceRef.current !== 0) {
      onPinchEnd?.(scale);
      initialDistanceRef.current = 0;
      setScale(1);
    }
  }, [scale, onPinchEnd]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { ref, scale };
}

interface LongPressOptions {
  onLongPress: () => void;
  delay?: number;
}

/**
 * Hook for detecting long press gestures
 */
export function useLongPress<T extends HTMLElement = HTMLElement>(options: LongPressOptions) {
  const { onLongPress, delay = 500 } = options;
  const ref = useRef<T>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  const start = useCallback(() => {
    setIsPressed(true);
    timerRef.current = setTimeout(() => {
      onLongPress();
    }, delay);
  }, [delay, onLongPress]);

  const cancel = useCallback(() => {
    setIsPressed(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchend', cancel);
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('mousedown', start);
    element.addEventListener('mouseup', cancel);
    element.addEventListener('mouseleave', cancel);

    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchend', cancel);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('mousedown', start);
      element.removeEventListener('mouseup', cancel);
      element.removeEventListener('mouseleave', cancel);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [start, cancel]);

  return { ref, isPressed };
}

interface DoubleTapOptions {
  onDoubleTap: () => void;
  delay?: number;
}

/**
 * Hook for detecting double tap gestures
 */
export function useDoubleTap<T extends HTMLElement = HTMLElement>(options: DoubleTapOptions) {
  const { onDoubleTap, delay = 300 } = options;
  const ref = useRef<T>(null);
  const lastTapRef = useRef<number>(0);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < delay) {
      onDoubleTap();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [delay, onDoubleTap]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchend', handleTap);
    element.addEventListener('click', handleTap);

    return () => {
      element.removeEventListener('touchend', handleTap);
      element.removeEventListener('click', handleTap);
    };
  }, [handleTap]);

  return { ref };
}

/**
 * Combined hook for swipeable list items with actions
 */
export function useSwipeableItem<T extends HTMLElement = HTMLElement>(options: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeThreshold?: number;
  maxSwipeDistance?: number;
}) {
  const { onSwipeLeft, onSwipeRight, swipeThreshold = 80, maxSwipeDistance = 120 } = options;

  const ref = useRef<T>(null);
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    startXRef.current = touch.clientX;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isSwiping) return;

      const touch = e.touches[0];
      if (!touch) return;
      const currentX = touch.clientX;
      let delta = currentX - startXRef.current;

      // Clamp the offset
      delta = Math.max(-maxSwipeDistance, Math.min(maxSwipeDistance, delta));
      setOffset(delta);
    },
    [isSwiping, maxSwipeDistance]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return;

    if (Math.abs(offset) >= swipeThreshold) {
      if (offset < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    }

    setOffset(0);
    setIsSwiping(false);
  }, [isSwiping, offset, swipeThreshold, onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    ref,
    offset,
    isSwiping,
    style: {
      transform: `translateX(${offset}px)`,
      transition: isSwiping ? 'none' : 'transform 0.2s ease-out',
    },
  };
}
