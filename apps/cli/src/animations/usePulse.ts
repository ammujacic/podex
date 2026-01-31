/**
 * Pulsing animation hook for status indicators.
 */

import { useState, useEffect } from 'react';

export interface UsePulseOptions {
  interval?: number; // milliseconds between pulses
  enabled?: boolean;
}

export function usePulse(options: UsePulseOptions = {}): boolean {
  const { interval = 500, enabled = true } = options;
  const [isPulsed, setIsPulsed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsPulsed(false);
      return;
    }

    const timer = setInterval(() => {
      setIsPulsed((prev) => !prev);
    }, interval);

    return () => clearInterval(timer);
  }, [interval, enabled]);

  return isPulsed;
}
