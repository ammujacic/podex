import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// BeforeInstallPromptEvent type (not in standard lib)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAState {
  // Hydration tracking
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;

  // Install prompt (Chrome/Edge/Samsung)
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstallable: boolean;
  isInstalled: boolean;
  installDismissedAt: number | null;

  // iOS detection
  isIOS: boolean;
  isStandalone: boolean;
  iosInstructionsDismissedAt: number | null;
  showIOSModal: boolean;

  // Offline status
  isOnline: boolean;
  hasPendingSync: boolean;

  // Push notifications
  pushPermission: NotificationPermission | 'unsupported';
  pushSubscription: PushSubscription | null;

  // Actions - Install
  setDeferredPrompt: (event: BeforeInstallPromptEvent | null) => void;
  setIsInstallable: (value: boolean) => void;
  setIsInstalled: (value: boolean) => void;
  dismissInstallPrompt: () => void;
  triggerInstall: () => Promise<boolean>;

  // Actions - iOS
  setIsIOS: (value: boolean) => void;
  setIsStandalone: (value: boolean) => void;
  dismissIOSInstructions: () => void;
  openIOSModal: () => void;
  closeIOSModal: () => void;

  // Actions - Offline
  setOnlineStatus: (value: boolean) => void;
  setHasPendingSync: (value: boolean) => void;

  // Actions - Push
  setPushPermission: (permission: NotificationPermission | 'unsupported') => void;
  setPushSubscription: (subscription: PushSubscription | null) => void;

  // Computed
  shouldShowInstallBanner: () => boolean;
  shouldShowIOSInstructions: () => boolean;
}

// Cooldown before showing dismissed prompts again (7 days)
const BANNER_DISMISS_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

export const usePWAStore = create<PWAState>()(
  devtools(
    persist(
      (set, get) => ({
        // Hydration
        _hasHydrated: false,
        setHasHydrated: (state) => set({ _hasHydrated: state }),

        // Install state
        deferredPrompt: null,
        isInstallable: false,
        isInstalled: false,
        installDismissedAt: null,

        // iOS state
        isIOS: false,
        isStandalone: false,
        iosInstructionsDismissedAt: null,
        showIOSModal: false,

        // Offline state
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        hasPendingSync: false,

        // Push state
        pushPermission: 'unsupported',
        pushSubscription: null,

        // Install actions
        setDeferredPrompt: (event) => set({ deferredPrompt: event, isInstallable: !!event }),
        setIsInstallable: (value) => set({ isInstallable: value }),
        setIsInstalled: (value) => set({ isInstalled: value }),
        dismissInstallPrompt: () => set({ installDismissedAt: Date.now() }),

        triggerInstall: async () => {
          const { deferredPrompt } = get();
          if (!deferredPrompt) return false;

          try {
            await deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;

            set({ deferredPrompt: null, isInstallable: false });

            if (outcome === 'accepted') {
              set({ isInstalled: true });
              return true;
            }
            return false;
          } catch (error) {
            console.error('Install prompt failed:', error);
            return false;
          }
        },

        // iOS actions
        setIsIOS: (value) => set({ isIOS: value }),
        setIsStandalone: (value) => set({ isStandalone: value }),
        dismissIOSInstructions: () =>
          set({ iosInstructionsDismissedAt: Date.now(), showIOSModal: false }),
        openIOSModal: () => set({ showIOSModal: true }),
        closeIOSModal: () => set({ showIOSModal: false }),

        // Offline actions
        setOnlineStatus: (value) => set({ isOnline: value }),
        setHasPendingSync: (value) => set({ hasPendingSync: value }),

        // Push actions
        setPushPermission: (permission) => set({ pushPermission: permission }),
        setPushSubscription: (subscription) => set({ pushSubscription: subscription }),

        // Computed: should show install banner (Chrome/Edge/Samsung)
        shouldShowInstallBanner: () => {
          const state = get();

          // Don't show if already installed or running standalone
          if (state.isInstalled || state.isStandalone) return false;

          // Don't show if not installable (no deferred prompt)
          if (!state.isInstallable) return false;

          // Don't show if iOS (use iOS modal instead)
          if (state.isIOS) return false;

          // Check if dismissed recently
          if (state.installDismissedAt) {
            const elapsed = Date.now() - state.installDismissedAt;
            if (elapsed < BANNER_DISMISS_COOLDOWN) return false;
          }

          return true;
        },

        // Computed: should show iOS instructions
        shouldShowIOSInstructions: () => {
          const state = get();

          // Don't show if already installed or running standalone
          if (state.isInstalled || state.isStandalone) return false;

          // Only show for iOS
          if (!state.isIOS) return false;

          // Check if dismissed recently
          if (state.iosInstructionsDismissedAt) {
            const elapsed = Date.now() - state.iosInstructionsDismissedAt;
            if (elapsed < BANNER_DISMISS_COOLDOWN) return false;
          }

          return true;
        },
      }),
      {
        name: 'podex-pwa',
        // Only persist these fields (not runtime state like deferredPrompt)
        partialize: (state) => ({
          installDismissedAt: state.installDismissedAt,
          iosInstructionsDismissedAt: state.iosInstructionsDismissedAt,
          isInstalled: state.isInstalled,
        }),
        onRehydrateStorage: () => (state) => {
          state?.setHasHydrated(true);
        },
      }
    ),
    { name: 'podex-pwa' }
  )
);
