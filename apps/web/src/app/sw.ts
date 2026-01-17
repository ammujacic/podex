/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const runtimeCaching: RuntimeCaching[] = [
  ...defaultCache,
  // Cache API responses with network-first strategy
  {
    matcher: /^https?:\/\/.*\/api\/v1\/(sessions|agents|billing|user)/,
    handler: new NetworkFirst({
      cacheName: 'api-cache',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 60 * 5, // 5 minutes
        }),
      ],
      networkTimeoutSeconds: 10,
    }),
  },
  // Cache static assets with cache-first
  {
    matcher: /\.(?:js|css|woff2?)$/i,
    handler: new CacheFirst({
      cacheName: 'static-assets',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        }),
      ],
    }),
  },
  // Cache images
  {
    matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
    handler: new CacheFirst({
      cacheName: 'image-cache',
      plugins: [
        new ExpirationPlugin({
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

// Handle push notifications
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options: NotificationOptions & { actions?: Array<{ action: string; title: string }> } = {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'podex-notification',
      data: { url: data.url || '/' },
    };

    // Add actions if provided (supported in some browsers)
    if (data.actions?.length) {
      options.actions = data.actions;
    }

    event.waitUntil(self.registration.showNotification(data.title || 'Podex', options));
  } catch (error) {
    console.error('Failed to parse push notification:', error);
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      // Focus existing window if available
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) {
            (client as WindowClient).navigate(url);
          }
          return undefined;
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
      return undefined;
    })
  );
});

// Handle notification close
self.addEventListener('notificationclose', (_event: NotificationEvent) => {
  // Analytics or cleanup could be added here if needed
});

serwist.addEventListeners();
