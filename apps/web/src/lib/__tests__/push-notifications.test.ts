/**
 * Tests for push-notifications.ts utility functions
 *
 * Note: These tests mock the browser Push API which behaves differently in Node.js/jsdom.
 * We test the module's behavior given certain browser API states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the PWA store
const mockSetPushPermission = vi.fn();
const mockSetPushSubscription = vi.fn();

vi.mock('@/stores/pwa', () => ({
  usePWAStore: {
    getState: () => ({
      setPushPermission: mockSetPushPermission,
      setPushSubscription: mockSetPushSubscription,
    }),
  },
}));

// Mock the API
const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

describe('push-notifications utilities', () => {
  let mockPushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockSubscription: {
    endpoint: string;
    unsubscribe: ReturnType<typeof vi.fn>;
    toJSON: () => object;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSubscription = {
      endpoint: 'https://push.example.com/abc123',
      unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: () => ({
        endpoint: 'https://push.example.com/abc123',
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        expirationTime: null,
      }),
    };

    mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(mockSubscription),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe('isPushSupported', () => {
    it('returns false when window is undefined', async () => {
      vi.stubGlobal('window', undefined);
      // Re-import the module to get fresh evaluation
      const { isPushSupported } = await import('../push-notifications');
      expect(isPushSupported()).toBe(false);
    });

    it('returns false when serviceWorker is not available', async () => {
      // Mock window but not navigator.serviceWorker
      vi.stubGlobal('navigator', {});
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'default' });

      const { isPushSupported } = await import('../push-notifications');
      expect(isPushSupported()).toBe(false);
    });

    // Note: Testing PushManager/Notification unavailability is tricky in happy-dom since it
    // may have built-in support. The window undefined test above covers the key "unsupported" case.

    it('returns true when all APIs are available', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'default' });

      const { isPushSupported } = await import('../push-notifications');
      expect(isPushSupported()).toBe(true);
    });
  });

  describe('getNotificationPermission', () => {
    it('returns "unsupported" when push is not supported', async () => {
      vi.stubGlobal('PushManager', undefined);

      const { getNotificationPermission } = await import('../push-notifications');
      expect(getNotificationPermission()).toBe('unsupported');
    });

    it('returns current permission status when supported', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      const { getNotificationPermission } = await import('../push-notifications');
      expect(getNotificationPermission()).toBe('granted');
    });

    it('returns "denied" when permission is denied', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'denied' });

      const { getNotificationPermission } = await import('../push-notifications');
      expect(getNotificationPermission()).toBe('denied');
    });

    it('returns "default" when permission not yet requested', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'default' });

      const { getNotificationPermission } = await import('../push-notifications');
      expect(getNotificationPermission()).toBe('default');
    });
  });

  describe('requestNotificationPermission', () => {
    it('returns "denied" when push is not supported', async () => {
      vi.stubGlobal('PushManager', undefined);

      const { requestNotificationPermission } = await import('../push-notifications');
      const result = await requestNotificationPermission();

      expect(result).toBe('denied');
    });

    it('requests permission and returns result', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('granted');
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: mockRequestPermission,
      });

      const { requestNotificationPermission } = await import('../push-notifications');
      const result = await requestNotificationPermission();

      expect(mockRequestPermission).toHaveBeenCalled();
      expect(result).toBe('granted');
    });

    it('updates PWA store with permission', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      });

      const { requestNotificationPermission } = await import('../push-notifications');
      await requestNotificationPermission();

      expect(mockSetPushPermission).toHaveBeenCalledWith('granted');
    });

    it('handles denied permission', async () => {
      vi.stubGlobal('navigator', { serviceWorker: {} });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });

      const { requestNotificationPermission } = await import('../push-notifications');
      const result = await requestNotificationPermission();

      expect(result).toBe('denied');
      expect(mockSetPushPermission).toHaveBeenCalledWith('denied');
    });
  });

  describe('subscribeToPushNotifications', () => {
    it('returns null when push is not supported', async () => {
      vi.stubGlobal('PushManager', undefined);

      const { subscribeToPushNotifications } = await import('../push-notifications');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await subscribeToPushNotifications();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('returns null when permission is denied', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('denied'),
      });

      const { subscribeToPushNotifications } = await import('../push-notifications');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await subscribeToPushNotifications();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('returns null when VAPID key is not configured', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: { ready: Promise.resolve({ pushManager: mockPushManager }) },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'granted',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      });
      vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
      vi.resetModules();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { subscribeToPushNotifications } = await import('../push-notifications');
      const result = await subscribeToPushNotifications();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith('VAPID public key not configured');
      consoleSpy.mockRestore();
    });

    it('subscribes successfully and sends to backend when permission granted', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: {
              getSubscription: vi.fn().mockResolvedValue(null),
              subscribe: vi.fn().mockResolvedValue(mockSubscription),
            },
          }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      });
      vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'dGVzdC12YXBpZC1rZXk=');
      vi.resetModules();
      mockApiPost.mockResolvedValue({});

      const { subscribeToPushNotifications } = await import('../push-notifications');
      const result = await subscribeToPushNotifications();

      expect(result).toBe(mockSubscription);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/api/v1/push/subscribe',
        expect.objectContaining({
          subscription: expect.objectContaining({
            endpoint: mockSubscription.endpoint,
            keys: expect.any(Object),
          }),
        })
      );
      expect(mockSetPushSubscription).toHaveBeenCalledWith(mockSubscription);
    });
  });

  describe('unsubscribeFromPushNotifications', () => {
    it('returns false when push is not supported', async () => {
      vi.stubGlobal('PushManager', undefined);

      const { unsubscribeFromPushNotifications } = await import('../push-notifications');
      const result = await unsubscribeFromPushNotifications();

      expect(result).toBe(false);
    });

    it('returns true when no subscription exists', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockResolvedValue(null);

      const { unsubscribeFromPushNotifications } = await import('../push-notifications');
      const result = await unsubscribeFromPushNotifications();

      expect(result).toBe(true);
    });

    it('unsubscribes and updates store', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockResolvedValue(mockSubscription);
      mockApiPost.mockResolvedValue({});

      const { unsubscribeFromPushNotifications } = await import('../push-notifications');
      const result = await unsubscribeFromPushNotifications();

      expect(result).toBe(true);
      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      expect(mockSetPushSubscription).toHaveBeenCalledWith(null);
    });

    it('continues even if backend fails', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockResolvedValue(mockSubscription);
      mockApiPost.mockRejectedValue(new Error('Backend error'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { unsubscribeFromPushNotifications } = await import('../push-notifications');
      const result = await unsubscribeFromPushNotifications();

      expect(result).toBe(true);
      expect(mockSubscription.unsubscribe).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns false on error', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockRejectedValue(new Error('Error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { unsubscribeFromPushNotifications } = await import('../push-notifications');
      const result = await unsubscribeFromPushNotifications();

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('getCurrentSubscription', () => {
    it('returns null when push is not supported', async () => {
      vi.stubGlobal('PushManager', undefined);

      const { getCurrentSubscription } = await import('../push-notifications');
      const result = await getCurrentSubscription();

      expect(result).toBeNull();
    });

    it('returns current subscription', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

      const { getCurrentSubscription } = await import('../push-notifications');
      const result = await getCurrentSubscription();

      expect(result).toBe(mockSubscription);
    });

    it('returns null when no subscription exists', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockResolvedValue(null);

      const { getCurrentSubscription } = await import('../push-notifications');
      const result = await getCurrentSubscription();

      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      vi.stubGlobal('navigator', {
        serviceWorker: {
          ready: Promise.resolve({ pushManager: mockPushManager }),
        },
      });
      vi.stubGlobal('PushManager', class {});
      vi.stubGlobal('Notification', { permission: 'granted' });

      mockPushManager.getSubscription.mockRejectedValue(new Error('Error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { getCurrentSubscription } = await import('../push-notifications');
      const result = await getCurrentSubscription();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
