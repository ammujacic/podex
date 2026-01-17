'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768; // md breakpoint in Tailwind
const RESIZE_DEBOUNCE_MS = 100;

// Shared state for mobile detection - single listener for all hook instances
let mobileState = typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false;
let viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getMobileSnapshot(): boolean {
  return mobileState;
}

function getWidthSnapshot(): number {
  return viewportWidth;
}

function getServerMobileSnapshot(): boolean {
  return false;
}

function getServerWidthSnapshot(): number {
  return 1024;
}

// Initialize shared resize listener once
if (typeof window !== 'undefined') {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const handleResize = () => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      const newWidth = window.innerWidth;
      const newIsMobile = newWidth < MOBILE_BREAKPOINT;

      if (newWidth !== viewportWidth || newIsMobile !== mobileState) {
        viewportWidth = newWidth;
        mobileState = newIsMobile;
        listeners.forEach((callback) => callback());
      }
    }, RESIZE_DEBOUNCE_MS);
  };

  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('orientationchange', handleResize, { passive: true });
}

/**
 * Hook to detect if the current viewport is mobile-sized.
 * Uses a shared listener to avoid multiple event subscriptions.
 * Uses the md breakpoint (768px) as the threshold.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getMobileSnapshot, getServerMobileSnapshot);
}

/**
 * Hook to get the current viewport width.
 * Uses a shared listener with debouncing for performance.
 */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribe, getWidthSnapshot, getServerWidthSnapshot);
}

/**
 * Hook to check if the device is a touch device
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    setIsTouch(
      typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    );
  }, []);

  return isTouch;
}
