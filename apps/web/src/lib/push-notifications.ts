/**
 * Push notification service for managing Web Push subscriptions.
 *
 * This module handles:
 * - Requesting notification permission from the user
 * - Subscribing to push notifications via the Push API
 * - Sending subscription to backend for storage
 * - Unsubscribing from push notifications
 */

import { usePWAStore } from '@/stores/pwa';
import { api } from '@/lib/api';

// VAPID public key from environment
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

/**
 * Check if push notifications are supported in this browser.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Get the current notification permission status.
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * Request notification permission from the user.
 * Updates the PWA store with the new permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isPushSupported()) {
    return 'denied';
  }

  const permission = await Notification.requestPermission();
  usePWAStore.getState().setPushPermission(permission);
  return permission;
}

/**
 * Subscribe to push notifications.
 * This will:
 * 1. Request permission if not already granted
 * 2. Get or create a push subscription from the browser
 * 3. Send the subscription to the backend for storage
 *
 * @returns The push subscription if successful, null otherwise
 */
export async function subscribeToPushNotifications(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.warn('Push notifications not supported in this browser');
    return null;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('VAPID public key not configured');
    return null;
  }

  try {
    // Request permission first
    const permission = await requestNotificationPermission();
    if (permission !== 'granted') {
      console.warn('Push notification permission denied');
      return null;
    }

    // Wait for service worker to be ready
    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // Send subscription to backend
    const subscriptionJson = subscription.toJSON();
    await api.post('/api/v1/push/subscribe', {
      subscription: {
        endpoint: subscriptionJson.endpoint,
        keys: subscriptionJson.keys,
        expirationTime: subscriptionJson.expirationTime,
      },
    });

    // Update store
    usePWAStore.getState().setPushSubscription(subscription);

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe to push notifications:', error);
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 * This will:
 * 1. Unsubscribe from the browser's push service
 * 2. Notify the backend to deactivate the subscription
 */
export async function unsubscribeFromPushNotifications(): Promise<boolean> {
  if (!isPushSupported()) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Notify backend first
      try {
        await api.post('/api/v1/push/unsubscribe', {
          endpoint: subscription.endpoint,
        });
      } catch (error) {
        // Continue even if backend fails - we still want to unsubscribe locally
        console.warn('Failed to notify backend of unsubscribe:', error);
      }

      // Unsubscribe from browser
      await subscription.unsubscribe();
    }

    // Update store
    usePWAStore.getState().setPushSubscription(null);

    return true;
  } catch (error) {
    console.error('Failed to unsubscribe from push notifications:', error);
    return false;
  }
}

/**
 * Get the current push subscription if it exists.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (error) {
    console.error('Failed to get push subscription:', error);
    return null;
  }
}

/**
 * Convert a base64 URL-encoded string to a Uint8Array.
 * Used for converting VAPID public key for the Push API.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
