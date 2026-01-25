/**
 * Comprehensive tests for usePWAInit hook
 * Tests PWA initialization, iOS detection, install prompts, and online/offline status
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePWAInit } from '../usePWAInit';

// Mock the PWA store
const mockSetDeferredPrompt = vi.fn();
const mockSetIsInstalled = vi.fn();
const mockSetIsIOS = vi.fn();
const mockSetIsStandalone = vi.fn();
const mockSetOnlineStatus = vi.fn();
const mockSetPushPermission = vi.fn();

vi.mock('@/stores/pwa', () => ({
  usePWAStore: () => ({
    setDeferredPrompt: mockSetDeferredPrompt,
    setIsInstalled: mockSetIsInstalled,
    setIsIOS: mockSetIsIOS,
    setIsStandalone: mockSetIsStandalone,
    setOnlineStatus: mockSetOnlineStatus,
    setPushPermission: mockSetPushPermission,
  }),
}));

describe('usePWAInit', () => {
  let originalNavigator: Navigator;
  let originalWindow: Window & typeof globalThis;
  let matchMediaListeners: Map<string, ((e: MediaQueryListEvent) => void)[]>;
  let mockMatchMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    matchMediaListeners = new Map();

    // Create a mock matchMedia function
    mockMatchMedia = vi.fn((query: string) => {
      const listeners: ((e: MediaQueryListEvent) => void)[] = [];
      matchMediaListeners.set(query, listeners);

      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => listeners.push(cb)),
        removeListener: vi.fn((cb: (e: MediaQueryListEvent) => void) => {
          const idx = listeners.indexOf(cb);
          if (idx > -1) listeners.splice(idx, 1);
        }),
        addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') listeners.push(cb);
        }),
        removeEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            const idx = listeners.indexOf(cb);
            if (idx > -1) listeners.splice(idx, 1);
          }
        }),
        dispatchEvent: vi.fn(),
      };
    });

    // Set up window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    });

    // Reset navigator userAgent
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/100.0.0.0',
    });

    // Reset Notification permission
    if (!('Notification' in window)) {
      Object.defineProperty(window, 'Notification', {
        writable: true,
        configurable: true,
        value: {
          permission: 'default',
          requestPermission: vi.fn(),
        },
      });
    } else {
      Object.defineProperty(Notification, 'permission', {
        writable: true,
        configurable: true,
        value: 'default',
      });
    }

    // Reset PushManager
    Object.defineProperty(window, 'PushManager', {
      writable: true,
      configurable: true,
      value: class PushManager {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should detect non-iOS device', () => {
      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(false);
    });

    it('should detect iPhone device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(true);
    });

    it('should detect iPad device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)',
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(true);
    });

    it('should detect iPod device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value: 'Mozilla/5.0 (iPod; CPU iPhone OS 15_0 like Mac OS X)',
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(true);
    });

    it('should not detect iOS when MSStream is present (Edge on Windows Phone)', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      });
      (window as Window & { MSStream?: unknown }).MSStream = {};

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(false);

      // Cleanup
      delete (window as Window & { MSStream?: unknown }).MSStream;
    });

    it('should detect non-standalone mode', () => {
      renderHook(() => usePWAInit());

      expect(mockSetIsStandalone).toHaveBeenCalledWith(false);
    });

    it('should not set isInstalled when not standalone', () => {
      renderHook(() => usePWAInit());

      expect(mockSetIsInstalled).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Standalone Mode Detection Tests
  // ========================================

  describe('Standalone Mode Detection', () => {
    it('should detect standalone mode via matchMedia', () => {
      mockMatchMedia.mockImplementation((query: string) => {
        const listeners: ((e: MediaQueryListEvent) => void)[] = [];
        matchMediaListeners.set(query, listeners);

        return {
          matches: query === '(display-mode: standalone)',
          media: query,
          onchange: null,
          addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
            if (event === 'change') listeners.push(cb);
          }),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsStandalone).toHaveBeenCalledWith(true);
      expect(mockSetIsInstalled).toHaveBeenCalledWith(true);
    });

    it('should detect standalone mode via Safari navigator.standalone', () => {
      (navigator as Navigator & { standalone?: boolean }).standalone = true;

      renderHook(() => usePWAInit());

      expect(mockSetIsStandalone).toHaveBeenCalledWith(true);
      expect(mockSetIsInstalled).toHaveBeenCalledWith(true);

      // Cleanup
      delete (navigator as Navigator & { standalone?: boolean }).standalone;
    });

    it('should handle display mode change to standalone', async () => {
      let displayModeChangeHandler: ((e: MediaQueryListEvent) => void) | undefined;

      mockMatchMedia.mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === 'change' && query === '(display-mode: standalone)') {
            displayModeChangeHandler = cb;
          }
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      renderHook(() => usePWAInit());

      // Simulate display mode change
      act(() => {
        displayModeChangeHandler?.({ matches: true } as MediaQueryListEvent);
      });

      expect(mockSetIsStandalone).toHaveBeenCalledWith(true);
      expect(mockSetIsInstalled).toHaveBeenCalledWith(true);
    });

    it('should handle display mode change to browser', async () => {
      let displayModeChangeHandler: ((e: MediaQueryListEvent) => void) | undefined;

      mockMatchMedia.mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
          if (event === 'change' && query === '(display-mode: standalone)') {
            displayModeChangeHandler = cb;
          }
        }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      renderHook(() => usePWAInit());

      // Reset mocks
      mockSetIsStandalone.mockClear();
      mockSetIsInstalled.mockClear();

      // Simulate display mode change back to browser
      act(() => {
        displayModeChangeHandler?.({ matches: false } as MediaQueryListEvent);
      });

      expect(mockSetIsStandalone).toHaveBeenCalledWith(false);
      // isInstalled should not be called again when switching away from standalone
    });
  });

  // ========================================
  // Install Prompt Tests
  // ========================================

  describe('Install Prompt Handling', () => {
    it('should capture beforeinstallprompt event', () => {
      renderHook(() => usePWAInit());

      const mockPrompt = vi.fn();
      const mockUserChoice = Promise.resolve({ outcome: 'accepted' as const });

      const event = new Event('beforeinstallprompt');
      Object.defineProperty(event, 'prompt', { value: mockPrompt });
      Object.defineProperty(event, 'userChoice', { value: mockUserChoice });

      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockSetDeferredPrompt).toHaveBeenCalledWith(event);
    });

    it('should handle appinstalled event', () => {
      renderHook(() => usePWAInit());

      const event = new Event('appinstalled');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(mockSetIsInstalled).toHaveBeenCalledWith(true);
      expect(mockSetDeferredPrompt).toHaveBeenCalledWith(null);
    });

    it('should clear deferred prompt on app installed', () => {
      renderHook(() => usePWAInit());

      // First capture the prompt
      const promptEvent = new Event('beforeinstallprompt');
      act(() => {
        window.dispatchEvent(promptEvent);
      });

      mockSetDeferredPrompt.mockClear();

      // Then mark as installed
      const installedEvent = new Event('appinstalled');
      act(() => {
        window.dispatchEvent(installedEvent);
      });

      expect(mockSetDeferredPrompt).toHaveBeenCalledWith(null);
    });
  });

  // ========================================
  // Online/Offline Status Tests
  // ========================================

  describe('Online/Offline Status', () => {
    it('should handle online event', () => {
      renderHook(() => usePWAInit());

      const event = new Event('online');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(mockSetOnlineStatus).toHaveBeenCalledWith(true);
    });

    it('should handle offline event', () => {
      renderHook(() => usePWAInit());

      const event = new Event('offline');

      act(() => {
        window.dispatchEvent(event);
      });

      expect(mockSetOnlineStatus).toHaveBeenCalledWith(false);
    });

    it('should handle multiple online/offline transitions', () => {
      renderHook(() => usePWAInit());

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(mockSetOnlineStatus).toHaveBeenLastCalledWith(false);

      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      expect(mockSetOnlineStatus).toHaveBeenLastCalledWith(true);

      act(() => {
        window.dispatchEvent(new Event('offline'));
      });

      expect(mockSetOnlineStatus).toHaveBeenLastCalledWith(false);
    });
  });

  // ========================================
  // Push Notification Tests
  // ========================================

  describe('Push Notification Permission', () => {
    it('should check notification permission when supported', () => {
      Object.defineProperty(Notification, 'permission', {
        writable: true,
        configurable: true,
        value: 'granted',
      });

      renderHook(() => usePWAInit());

      expect(mockSetPushPermission).toHaveBeenCalledWith('granted');
    });

    it('should handle denied notification permission', () => {
      Object.defineProperty(Notification, 'permission', {
        writable: true,
        configurable: true,
        value: 'denied',
      });

      renderHook(() => usePWAInit());

      expect(mockSetPushPermission).toHaveBeenCalledWith('denied');
    });

    it('should handle default notification permission', () => {
      Object.defineProperty(Notification, 'permission', {
        writable: true,
        configurable: true,
        value: 'default',
      });

      renderHook(() => usePWAInit());

      expect(mockSetPushPermission).toHaveBeenCalledWith('default');
    });

    it('should not check permission when Notification is not supported', () => {
      const originalNotification = window.Notification;
      // @ts-expect-error - Testing unsupported case
      delete window.Notification;

      renderHook(() => usePWAInit());

      expect(mockSetPushPermission).not.toHaveBeenCalled();

      // Restore
      window.Notification = originalNotification;
    });

    it('should not check permission when PushManager is not supported', () => {
      const originalPushManager = window.PushManager;
      // @ts-expect-error - Testing unsupported case
      delete window.PushManager;

      renderHook(() => usePWAInit());

      expect(mockSetPushPermission).not.toHaveBeenCalled();

      // Restore
      window.PushManager = originalPushManager;
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => usePWAInit());

      // Verify listeners were added
      expect(addEventListenerSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(addEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));

      unmount();

      // Verify listeners were removed
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeinstallprompt',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('offline', expect.any(Function));
    });

    it('should remove display mode change listener on unmount', () => {
      let removeEventListenerFn: ReturnType<typeof vi.fn>;

      mockMatchMedia.mockImplementation((query: string) => {
        removeEventListenerFn = vi.fn();
        return {
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: removeEventListenerFn,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        };
      });

      const { unmount } = renderHook(() => usePWAInit());

      unmount();

      expect(removeEventListenerFn!).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('should not trigger handlers after unmount', () => {
      const { unmount } = renderHook(() => usePWAInit());

      unmount();

      // Reset mocks after unmount
      mockSetOnlineStatus.mockClear();

      // Try to trigger events
      act(() => {
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));
      });

      // Handlers should not be called since they were removed
      expect(mockSetOnlineStatus).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle Android device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value:
          'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/100.0.0.0 Mobile Safari/537.36',
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(false);
    });

    it('should handle Mac device (not iOS)', () => {
      Object.defineProperty(navigator, 'userAgent', {
        writable: true,
        configurable: true,
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      });

      renderHook(() => usePWAInit());

      expect(mockSetIsIOS).toHaveBeenCalledWith(false);
    });

    it('should re-run effect when dependencies change', () => {
      const { rerender } = renderHook(() => usePWAInit());

      // First render
      expect(mockSetIsIOS).toHaveBeenCalledTimes(1);

      // Rerender
      rerender();

      // Effect should not re-run with same dependencies
      expect(mockSetIsIOS).toHaveBeenCalledTimes(1);
    });
  });
});
