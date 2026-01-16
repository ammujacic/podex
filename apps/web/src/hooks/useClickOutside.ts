'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Hook that detects clicks outside of the specified element.
 * Useful for closing dropdowns, modals, and popovers.
 *
 * @param handler - Callback function to run when click outside is detected
 * @param enabled - Whether the hook is active (default: true)
 * @returns RefObject to attach to the element you want to detect clicks outside of
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: () => void,
  enabled: boolean = true
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      // Check if click was outside the ref element
      if (ref.current && !ref.current.contains(target)) {
        handler();
      }
    };

    // Use mousedown/touchstart for immediate response (before click completes)
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [handler, enabled]);

  return ref;
}

/**
 * Hook that detects clicks outside of multiple elements.
 * Useful when you have a trigger button and a dropdown that are separate elements.
 *
 * @param refs - Array of refs to check against
 * @param handler - Callback function to run when click outside is detected
 * @param enabled - Whether the hook is active (default: true)
 */
export function useClickOutsideMultiple(
  refs: RefObject<HTMLElement | null>[],
  handler: () => void,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      // Check if click was outside all ref elements
      const isOutside = refs.every((ref) => !ref.current?.contains(target));

      if (isOutside) {
        handler();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [refs, handler, enabled]);
}
