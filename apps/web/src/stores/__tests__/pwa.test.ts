import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePWAStore } from '../pwa';

// Mock BeforeInstallPromptEvent
class MockBeforeInstallPromptEvent extends Event {
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  private _resolve?: (value: { outcome: 'accepted' | 'dismissed' }) => void;

  constructor(outcome: 'accepted' | 'dismissed' = 'accepted') {
    super('beforeinstallprompt');
    this.userChoice = new Promise((resolve) => {
      this._resolve = resolve;
    });
    // Auto-resolve with outcome after a short delay
    setTimeout(() => this._resolve?.({ outcome }), 0);
  }

  prompt = vi.fn().mockResolvedValue(undefined);
}

// Mock PushSubscription
class MockPushSubscription implements PushSubscription {
  endpoint = 'https://fcm.googleapis.com/fcm/send/test-endpoint';
  expirationTime = null;
  options = {
    applicationServerKey: new ArrayBuffer(0),
    userVisibleOnly: true,
  };

  getKey = vi.fn().mockReturnValue(null);
  toJSON = vi.fn().mockReturnValue({
    endpoint: this.endpoint,
    expirationTime: this.expirationTime,
    keys: {},
  });
  unsubscribe = vi.fn().mockResolvedValue(true);
}

describe('pwaStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      usePWAStore.setState({
        _hasHydrated: false,
        deferredPrompt: null,
        isInstallable: false,
        isInstalled: false,
        installDismissedAt: null,
        isIOS: false,
        isStandalone: false,
        iosInstructionsDismissedAt: null,
        showIOSModal: false,
        isOnline: true,
        hasPendingSync: false,
        pushPermission: 'unsupported',
        pushSubscription: null,
      });
    });

    // Reset time
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has not hydrated by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current._hasHydrated).toBe(false);
    });

    it('is not installable by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.isInstallable).toBe(false);
      expect(result.current.deferredPrompt).toBeNull();
    });

    it('is not installed by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.isInstalled).toBe(false);
    });

    it('is online by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.isOnline).toBe(true);
    });

    it('has no pending sync by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.hasPendingSync).toBe(false);
    });

    it('has unsupported push permission by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.pushPermission).toBe('unsupported');
      expect(result.current.pushSubscription).toBeNull();
    });

    it('is not iOS by default', () => {
      const { result } = renderHook(() => usePWAStore());
      expect(result.current.isIOS).toBe(false);
      expect(result.current.isStandalone).toBe(false);
    });
  });

  // ========================================================================
  // PWA Installation - Basic State
  // ========================================================================

  describe('PWA Installation - Basic State', () => {
    describe('setDeferredPrompt', () => {
      it('sets deferred prompt and marks as installable', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        expect(result.current.deferredPrompt).toBe(mockEvent);
        expect(result.current.isInstallable).toBe(true);
      });

      it('clears installable state when prompt is null', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          result.current.setDeferredPrompt(null);
        });

        expect(result.current.deferredPrompt).toBeNull();
        expect(result.current.isInstallable).toBe(false);
      });
    });

    describe('setIsInstallable', () => {
      it('sets installable flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsInstallable(true);
        });

        expect(result.current.isInstallable).toBe(true);
      });

      it('can toggle installable state', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsInstallable(true);
          result.current.setIsInstallable(false);
        });

        expect(result.current.isInstallable).toBe(false);
      });
    });

    describe('setIsInstalled', () => {
      it('sets installed flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsInstalled(true);
        });

        expect(result.current.isInstalled).toBe(true);
      });

      it('persists installed state', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsInstalled(true);
        });

        expect(result.current.isInstalled).toBe(true);
      });
    });
  });

  // ========================================================================
  // PWA Installation - Prompt and Tracking
  // ========================================================================

  describe('PWA Installation - Prompt and Tracking', () => {
    describe('dismissInstallPrompt', () => {
      it('records dismiss timestamp', () => {
        const { result } = renderHook(() => usePWAStore());
        const beforeDismiss = Date.now();

        act(() => {
          result.current.dismissInstallPrompt();
        });

        const afterDismiss = Date.now();
        expect(result.current.installDismissedAt).toBeGreaterThanOrEqual(beforeDismiss);
        expect(result.current.installDismissedAt).toBeLessThanOrEqual(afterDismiss);
      });

      it('persists dismiss timestamp', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.dismissInstallPrompt();
        });

        const timestamp = result.current.installDismissedAt;
        expect(timestamp).not.toBeNull();
      });
    });

    describe('triggerInstall', () => {
      it('returns false when no deferred prompt exists', async () => {
        const { result } = renderHook(() => usePWAStore());

        let installResult: boolean | undefined;
        await act(async () => {
          installResult = await result.current.triggerInstall();
        });

        expect(installResult).toBe(false);
      });

      it('calls prompt method on deferred event', async () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent('accepted') as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        await act(async () => {
          await result.current.triggerInstall();
        });

        expect(mockEvent.prompt).toHaveBeenCalled();
      });

      it('sets installed to true when user accepts', async () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent('accepted') as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        let installResult: boolean | undefined;
        await act(async () => {
          installResult = await result.current.triggerInstall();
        });

        expect(installResult).toBe(true);
        expect(result.current.isInstalled).toBe(true);
        expect(result.current.deferredPrompt).toBeNull();
        expect(result.current.isInstallable).toBe(false);
      });

      it('returns false when user dismisses', async () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent('dismissed') as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        let installResult: boolean | undefined;
        await act(async () => {
          installResult = await result.current.triggerInstall();
        });

        expect(installResult).toBe(false);
        expect(result.current.isInstalled).toBe(false);
        expect(result.current.deferredPrompt).toBeNull();
        expect(result.current.isInstallable).toBe(false);
      });

      it('handles prompt errors gracefully', async () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;
        mockEvent.prompt = vi.fn().mockRejectedValue(new Error('Prompt failed'));

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        let installResult: boolean | undefined;
        await act(async () => {
          installResult = await result.current.triggerInstall();
        });

        expect(installResult).toBe(false);
      });
    });

    describe('shouldShowInstallBanner', () => {
      it('returns true when installable and not dismissed', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
        });

        expect(result.current.shouldShowInstallBanner()).toBe(true);
      });

      it('returns false when already installed', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          result.current.setIsInstalled(true);
        });

        expect(result.current.shouldShowInstallBanner()).toBe(false);
      });

      it('returns false when running standalone', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          result.current.setIsStandalone(true);
        });

        expect(result.current.shouldShowInstallBanner()).toBe(false);
      });

      it('returns false when not installable', () => {
        const { result } = renderHook(() => usePWAStore());

        expect(result.current.shouldShowInstallBanner()).toBe(false);
      });

      it('returns false when on iOS', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          result.current.setIsIOS(true);
        });

        expect(result.current.shouldShowInstallBanner()).toBe(false);
      });

      it('returns false when recently dismissed', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          result.current.dismissInstallPrompt();
        });

        expect(result.current.shouldShowInstallBanner()).toBe(false);
      });

      it('returns true when dismiss cooldown has expired', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockEvent = new MockBeforeInstallPromptEvent() as any;
        const COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 7 days

        act(() => {
          result.current.setDeferredPrompt(mockEvent);
          // Manually set dismissed time to 8 days ago
          usePWAStore.setState({ installDismissedAt: Date.now() - COOLDOWN - 86400000 });
        });

        expect(result.current.shouldShowInstallBanner()).toBe(true);
      });
    });
  });

  // ========================================================================
  // iOS Support
  // ========================================================================

  describe('iOS Support', () => {
    describe('iOS state management', () => {
      it('sets iOS flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsIOS(true);
        });

        expect(result.current.isIOS).toBe(true);
      });

      it('sets standalone flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsStandalone(true);
        });

        expect(result.current.isStandalone).toBe(true);
      });
    });

    describe('iOS modal management', () => {
      it('opens iOS modal', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.openIOSModal();
        });

        expect(result.current.showIOSModal).toBe(true);
      });

      it('closes iOS modal', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.openIOSModal();
          result.current.closeIOSModal();
        });

        expect(result.current.showIOSModal).toBe(false);
      });

      it('dismisses iOS instructions and closes modal', () => {
        const { result } = renderHook(() => usePWAStore());
        const beforeDismiss = Date.now();

        act(() => {
          result.current.openIOSModal();
          result.current.dismissIOSInstructions();
        });

        const afterDismiss = Date.now();
        expect(result.current.showIOSModal).toBe(false);
        expect(result.current.iosInstructionsDismissedAt).toBeGreaterThanOrEqual(beforeDismiss);
        expect(result.current.iosInstructionsDismissedAt).toBeLessThanOrEqual(afterDismiss);
      });
    });

    describe('shouldShowIOSInstructions', () => {
      it('returns true when on iOS and not installed', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsIOS(true);
        });

        expect(result.current.shouldShowIOSInstructions()).toBe(true);
      });

      it('returns false when not on iOS', () => {
        const { result } = renderHook(() => usePWAStore());

        expect(result.current.shouldShowIOSInstructions()).toBe(false);
      });

      it('returns false when already installed', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsIOS(true);
          result.current.setIsInstalled(true);
        });

        expect(result.current.shouldShowIOSInstructions()).toBe(false);
      });

      it('returns false when running standalone', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsIOS(true);
          result.current.setIsStandalone(true);
        });

        expect(result.current.shouldShowIOSInstructions()).toBe(false);
      });

      it('returns false when recently dismissed', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setIsIOS(true);
          result.current.dismissIOSInstructions();
        });

        expect(result.current.shouldShowIOSInstructions()).toBe(false);
      });

      it('returns true when dismiss cooldown has expired', () => {
        const { result } = renderHook(() => usePWAStore());
        const COOLDOWN = 7 * 24 * 60 * 60 * 1000; // 7 days

        act(() => {
          result.current.setIsIOS(true);
          // Manually set dismissed time to 8 days ago
          usePWAStore.setState({ iosInstructionsDismissedAt: Date.now() - COOLDOWN - 86400000 });
        });

        expect(result.current.shouldShowIOSInstructions()).toBe(true);
      });
    });
  });

  // ========================================================================
  // Offline Support
  // ========================================================================

  describe('Offline Support', () => {
    describe('online status management', () => {
      it('sets online status', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setOnlineStatus(true);
        });

        expect(result.current.isOnline).toBe(true);
      });

      it('sets offline status', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setOnlineStatus(false);
        });

        expect(result.current.isOnline).toBe(false);
      });

      it('can toggle online/offline state', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setOnlineStatus(false);
        });

        expect(result.current.isOnline).toBe(false);

        act(() => {
          result.current.setOnlineStatus(true);
        });

        expect(result.current.isOnline).toBe(true);
      });
    });

    describe('pending sync management', () => {
      it('sets pending sync flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setHasPendingSync(true);
        });

        expect(result.current.hasPendingSync).toBe(true);
      });

      it('clears pending sync flag', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setHasPendingSync(true);
          result.current.setHasPendingSync(false);
        });

        expect(result.current.hasPendingSync).toBe(false);
      });
    });

    describe('offline workflow', () => {
      it('marks sync as pending when going offline', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setOnlineStatus(false);
          result.current.setHasPendingSync(true);
        });

        expect(result.current.isOnline).toBe(false);
        expect(result.current.hasPendingSync).toBe(true);
      });

      it('can clear pending sync when back online', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setOnlineStatus(false);
          result.current.setHasPendingSync(true);
        });

        act(() => {
          result.current.setOnlineStatus(true);
          result.current.setHasPendingSync(false);
        });

        expect(result.current.isOnline).toBe(true);
        expect(result.current.hasPendingSync).toBe(false);
      });
    });
  });

  // ========================================================================
  // Push Notifications
  // ========================================================================

  describe('Push Notifications', () => {
    describe('notification permission management', () => {
      it('sets notification permission to granted', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setPushPermission('granted');
        });

        expect(result.current.pushPermission).toBe('granted');
      });

      it('sets notification permission to denied', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setPushPermission('denied');
        });

        expect(result.current.pushPermission).toBe('denied');
      });

      it('sets notification permission to default', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setPushPermission('default');
        });

        expect(result.current.pushPermission).toBe('default');
      });

      it('can set permission to unsupported', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setPushPermission('granted');
          result.current.setPushPermission('unsupported');
        });

        expect(result.current.pushPermission).toBe('unsupported');
      });
    });

    describe('push subscription management', () => {
      it('sets push subscription', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockSubscription = new MockPushSubscription();

        act(() => {
          result.current.setPushSubscription(mockSubscription);
        });

        expect(result.current.pushSubscription).toBe(mockSubscription);
      });

      it('clears push subscription', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockSubscription = new MockPushSubscription();

        act(() => {
          result.current.setPushSubscription(mockSubscription);
          result.current.setPushSubscription(null);
        });

        expect(result.current.pushSubscription).toBeNull();
      });
    });

    describe('subscribe workflow', () => {
      it('grants permission and creates subscription', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockSubscription = new MockPushSubscription();

        act(() => {
          result.current.setPushPermission('granted');
          result.current.setPushSubscription(mockSubscription);
        });

        expect(result.current.pushPermission).toBe('granted');
        expect(result.current.pushSubscription).toBe(mockSubscription);
      });

      it('handles permission denial', () => {
        const { result } = renderHook(() => usePWAStore());

        act(() => {
          result.current.setPushPermission('denied');
        });

        expect(result.current.pushPermission).toBe('denied');
        expect(result.current.pushSubscription).toBeNull();
      });
    });

    describe('unsubscribe workflow', () => {
      it('removes subscription', () => {
        const { result } = renderHook(() => usePWAStore());
        const mockSubscription = new MockPushSubscription();

        act(() => {
          result.current.setPushPermission('granted');
          result.current.setPushSubscription(mockSubscription);
        });

        act(() => {
          result.current.setPushSubscription(null);
        });

        expect(result.current.pushSubscription).toBeNull();
        expect(result.current.pushPermission).toBe('granted'); // Permission remains
      });
    });
  });

  // ========================================================================
  // Hydration
  // ========================================================================

  describe('Hydration', () => {
    it('tracks hydration state', () => {
      const { result } = renderHook(() => usePWAStore());

      act(() => {
        result.current.setHasHydrated(true);
      });

      expect(result.current._hasHydrated).toBe(true);
    });

    it('can reset hydration state', () => {
      const { result } = renderHook(() => usePWAStore());

      act(() => {
        result.current.setHasHydrated(true);
        result.current.setHasHydrated(false);
      });

      expect(result.current._hasHydrated).toBe(false);
    });
  });
});
