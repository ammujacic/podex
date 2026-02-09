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

/**
 * Hook for detecting swipe gestures on touch devices
 * Uses refs for touch coordinates to avoid stale closure issues
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

  // Use refs for touch tracking to avoid stale closures
  const touchRef = useRef({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isSwiping: false,
  });

  // State for visual feedback only (triggers re-renders)
  const [visualState, setVisualState] = useState({
    isSwiping: false,
    deltaX: 0,
    deltaY: 0,
  });

  // Store callbacks in refs to avoid recreating handlers
  const callbacksRef = useRef({ onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown });
  callbacksRef.current = { onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown };

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    touchRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      currentY: touch.clientY,
      isSwiping: true,
    };

    setVisualState({
      isSwiping: true,
      deltaX: 0,
      deltaY: 0,
    });
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!touchRef.current.isSwiping) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchRef.current.currentX = touch.clientX;
      touchRef.current.currentY = touch.clientY;

      const deltaX = touch.clientX - touchRef.current.startX;
      const deltaY = touch.clientY - touchRef.current.startY;

      if (preventDefaultOnSwipe) {
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        if (absDeltaX > absDeltaY && absDeltaX > 10) {
          e.preventDefault();
        }
      }

      setVisualState({
        isSwiping: true,
        deltaX,
        deltaY,
      });
    },
    [preventDefaultOnSwipe]
  );

  const handleTouchEnd = useCallback(() => {
    if (!touchRef.current.isSwiping) return;

    const { startX, startY, currentX, currentY } = touchRef.current;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Determine if it's a horizontal or vertical swipe
    if (absDeltaX > absDeltaY) {
      // Horizontal swipe
      if (absDeltaX >= threshold) {
        if (deltaX > 0) {
          callbacksRef.current.onSwipeRight?.();
        } else {
          callbacksRef.current.onSwipeLeft?.();
        }
      }
    } else {
      // Vertical swipe
      if (absDeltaY >= threshold) {
        if (deltaY > 0) {
          callbacksRef.current.onSwipeDown?.();
        } else {
          callbacksRef.current.onSwipeUp?.();
        }
      }
    }

    touchRef.current.isSwiping = false;
    setVisualState({
      isSwiping: false,
      deltaX: 0,
      deltaY: 0,
    });
  }, [threshold]);

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
  const swipeProgress = visualState.isSwiping
    ? Math.min(Math.abs(visualState.deltaX) / threshold, 1)
    : 0;

  const swipeDirection = visualState.deltaX > 0 ? 'right' : 'left';

  return {
    ref,
    isSwiping: visualState.isSwiping,
    swipeProgress,
    swipeDirection,
    deltaX: visualState.deltaX,
    deltaY: visualState.deltaY,
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
 * Uses pointer events to avoid double-firing on touch devices
 */
export function useDoubleTap<T extends HTMLElement = HTMLElement>(options: DoubleTapOptions) {
  const { onDoubleTap, delay = 300 } = options;
  const ref = useRef<T>(null);
  const lastTapRef = useRef<number>(0);
  const lastTapTypeRef = useRef<string>('');

  const handleTap = useCallback(
    (e: Event) => {
      const now = Date.now();
      const eventType = e.type;

      // Prevent double-firing: if we just handled a touchend, ignore the subsequent click
      if (
        eventType === 'click' &&
        lastTapTypeRef.current === 'touchend' &&
        now - lastTapRef.current < 50
      ) {
        return;
      }

      lastTapTypeRef.current = eventType;

      if (now - lastTapRef.current < delay) {
        onDoubleTap();
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
    },
    [delay, onDoubleTap]
  );

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
/**
 * Trigger haptic feedback on supported devices
 */
export function triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'selection' = 'light') {
  if (typeof navigator === 'undefined') return;

  // Use Vibration API with different durations based on style
  if ('vibrate' in navigator) {
    const duration =
      style === 'selection' ? 10 : style === 'light' ? 20 : style === 'medium' ? 40 : 60;
    navigator.vibrate(duration);
  }
}

export function useSwipeableItem<T extends HTMLElement = HTMLElement>(options: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  swipeThreshold?: number;
  maxSwipeDistance?: number;
  hapticFeedback?: boolean;
}) {
  const {
    onSwipeLeft,
    onSwipeRight,
    swipeThreshold = 80,
    maxSwipeDistance = 120,
    hapticFeedback = true,
  } = options;

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
      if (hapticFeedback) {
        triggerHaptic('medium');
      }
      if (offset < 0) {
        onSwipeLeft?.();
      } else {
        onSwipeRight?.();
      }
    }

    setOffset(0);
    setIsSwiping(false);
  }, [isSwiping, offset, swipeThreshold, onSwipeLeft, onSwipeRight, hapticFeedback]);

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
