'use client';

import { useEffect } from 'react';
import { usePWAStore } from '@/stores/pwa';

// BeforeInstallPromptEvent type
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Initialize PWA functionality on app load.
 * - Detects iOS and standalone mode
 * - Captures beforeinstallprompt event for Chrome/Edge/Samsung
 * - Listens for appinstalled event
 * - Tracks online/offline status
 * - Checks notification permission
 */
export function usePWAInit() {
  const {
    setDeferredPrompt,
    setIsInstalled,
    setIsIOS,
    setIsStandalone,
    setOnlineStatus,
    setPushPermission,
  } = usePWAStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Detect iOS
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as Window & { MSStream?: unknown }).MSStream;
    setIsIOS(isIOS);

    // Detect standalone mode (PWA installed)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandalone);

    if (isStandalone) {
      setIsInstalled(true);
    }

    // Listen for beforeinstallprompt (Chrome/Edge/Samsung)
    const handleBeforeInstall = (e: Event) => {
      // Prevent default browser install prompt
      e.preventDefault();
      // Store the event for later use
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Listen for appinstalled
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    // Online/offline detection
    const handleOnline = () => setOnlineStatus(true);
    const handleOffline = () => setOnlineStatus(false);

    // Display mode change detection
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
      if (e.matches) {
        setIsInstalled(true);
      }
    };

    // Add event listeners
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    displayModeQuery.addEventListener('change', handleDisplayModeChange);

    // Check push notification support
    if ('Notification' in window && 'PushManager' in window) {
      setPushPermission(Notification.permission);
    }

    // Cleanup
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      displayModeQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, [
    setDeferredPrompt,
    setIsInstalled,
    setIsIOS,
    setIsStandalone,
    setOnlineStatus,
    setPushPermission,
  ]);
}
