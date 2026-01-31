/**
 * Hook for playing notification sounds with preference support.
 */

import { useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

interface NotificationPreferences {
  soundEnabled?: boolean;
  desktopEnabled?: boolean;
}

export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preferencesRef = useRef<NotificationPreferences>({
    soundEnabled: true,
    desktopEnabled: true,
  });

  // Load preferences on mount
  useEffect(() => {
    async function loadPreferences() {
      try {
        const config = (await api.get('/api/user/config')) as {
          ui_preferences?: {
            notifications?: NotificationPreferences;
          };
        };
        if (config?.ui_preferences?.notifications) {
          preferencesRef.current = config.ui_preferences.notifications;
        }
      } catch (error) {
        console.error('Failed to load notification preferences:', error);
      }
    }
    loadPreferences();
  }, []);

  // Initialize audio element
  useEffect(() => {
    // Use a simple notification sound
    audioRef.current = new Audio('/sounds/notification.mp3');
    audioRef.current.volume = 0.5;

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playSound = useCallback(() => {
    if (preferencesRef.current.soundEnabled && audioRef.current) {
      // Reset and play
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        // Autoplay might be blocked - this is expected behavior
      });
    }
  }, []);

  const showDesktopNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (!preferencesRef.current.desktopEnabled) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    // Don't show if tab is focused
    if (document.hasFocus()) return;

    new Notification(title, {
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      ...options,
    });
  }, []);

  return {
    playSound,
    showDesktopNotification,
  };
}
