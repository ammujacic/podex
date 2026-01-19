import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to trap focus within a container element for accessibility.
 * When enabled, Tab/Shift+Tab navigation will cycle through focusable elements
 * within the container, and focus will not escape to elements outside.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(isActive: boolean = true) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Get all focusable elements within the container
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return [];

    const focusableSelectors = [
      'a[href]:not([disabled])',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"]):not([disabled])',
    ].join(', ');

    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(focusableSelectors)
    ).filter((el) => {
      // Filter out hidden elements
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }, []);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    // Store the currently focused element to restore later
    previousActiveElement.current = document.activeElement;

    // Focus the first focusable element or the container itself
    const focusableElements = getFocusableElements();
    const firstFocusable = focusableElements[0];
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      // If no focusable elements, make the container focusable temporarily
      containerRef.current.setAttribute('tabindex', '-1');
      containerRef.current.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) return;

      // If Shift+Tab on first element, move to last
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
      // If Tab on last element, move to first
      else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      // Restore focus to the previously focused element
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, [isActive, getFocusableElements]);

  return containerRef;
}
