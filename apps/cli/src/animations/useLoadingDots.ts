/**
 * Loading dots animation hook.
 */

import { useState, useEffect } from 'react';

export interface UseLoadingDotsOptions {
  maxDots?: number;
  interval?: number; // milliseconds between updates
  enabled?: boolean;
}

export function useLoadingDots(options: UseLoadingDotsOptions = {}): string {
  const { maxDots = 3, interval = 400, enabled = true } = options;
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (!enabled) {
      setDots('');
      return;
    }

    const timer = setInterval(() => {
      setDots((prev) => {
        if (prev.length >= maxDots) {
          return '';
        }
        return prev + '.';
      });
    }, interval);

    return () => clearInterval(timer);
  }, [maxDots, interval, enabled]);

  return dots;
}
