/**
 * Fade in effect hook (simulated for terminal).
 * In terminal, we simulate fade by revealing content after delay.
 */

import { useState, useEffect } from 'react';

export interface UseFadeInOptions {
  delay?: number; // milliseconds before showing
  onComplete?: () => void;
}

export function useFadeIn(options: UseFadeInOptions = {}): {
  isVisible: boolean;
  opacity: number;
} {
  const { delay = 0, onComplete } = options;
  const [isVisible, setIsVisible] = useState(delay === 0);
  const [opacity, setOpacity] = useState(delay === 0 ? 1 : 0);

  useEffect(() => {
    if (delay === 0) {
      setIsVisible(true);
      setOpacity(1);
      onComplete?.();
      return;
    }

    const timer = setTimeout(() => {
      setIsVisible(true);
      setOpacity(1);
      onComplete?.();
    }, delay);

    return () => clearTimeout(timer);
  }, [delay, onComplete]);

  return { isVisible, opacity };
}
