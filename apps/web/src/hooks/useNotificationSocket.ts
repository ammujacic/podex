/**
 * Hook for listening to real-time notification WebSocket events.
 */

import { useEffect } from 'react';
import { onSocketEvent } from '@/lib/socket';
import { useNotificationsStore, type AppNotification } from '@/stores/notifications';
import { useNotificationSound } from './useNotificationSound';

export function useNotificationSocket() {
  const addNotification = useNotificationsStore((state) => state.addNotification);
  const { playSound, showDesktopNotification } = useNotificationSound();

  useEffect(() => {
    // Subscribe to notification_created events
    const unsubscribe = onSocketEvent('notification_created', (data: AppNotification) => {
      // Add to store
      addNotification(data);

      // Play sound
      playSound();

      // Show desktop notification if tab is not focused
      showDesktopNotification(data.title, {
        body: data.message,
        tag: data.id,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [addNotification, playSound, showDesktopNotification]);
}
