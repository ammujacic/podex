'use client';

import * as Sentry from '@sentry/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { initializeAuth } from '@/lib/api';
import { OnboardingTourProvider } from '@/components/ui/OnboardingTour';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { useSessionSync } from '@/hooks/useSessionSync';
import { usePWAInit } from '@/hooks/usePWAInit';
import { IOSInstallModal, OfflineIndicator } from '@/components/pwa';
import { useInitializeConfig } from '@/stores/config';
import { useEditorStore } from '@/stores/editor';
import { GlobalCreditExhaustedModal } from '@/components/billing/GlobalCreditExhaustedModal';

interface ProvidersProps {
  children: ReactNode;
}

// ARIA live region for screen reader announcements
function AriaLiveRegion() {
  const announcement = useUIStore((state) => state.announcement);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}

// Auth initialization with Sentry user context
function AuthInitializer({ children }: { children: ReactNode }) {
  const { isInitialized, tokens, user } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);

  // Wait for Zustand to hydrate from localStorage
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Initialize auth after hydration
  useEffect(() => {
    if (hydrated && !isInitialized) {
      initializeAuth();
    }
  }, [hydrated, isInitialized, tokens]);

  // Set Sentry user context when user changes
  useEffect(() => {
    if (user) {
      Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.name || undefined,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [user]);

  // Load all user settings from server after auth
  useSettingsSync();

  // Sync localStorage sessions with backend to remove orphaned sessions
  // This fixes the mobile menu showing stale sessions issue
  useSessionSync();

  // Show nothing until hydrated to prevent hydration mismatch
  if (!hydrated) {
    return null;
  }

  return <>{children}</>;
}

// Theme initializer
function ThemeInitializer({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useUIStore();

  useEffect(() => {
    // Apply theme on mount
    setTheme(theme);
  }, [setTheme, theme]);

  return <>{children}</>;
}

// PWA initializer - sets up install prompts, offline detection, etc.
function PWAInitializer({ children }: { children: ReactNode }) {
  usePWAInit();
  return <>{children}</>;
}

// Config gate - loads platform config and blocks rendering until loaded (for authenticated users)
function ConfigGate({ children }: { children: ReactNode }) {
  const { isInitialized, isLoading, error, retry } = useInitializeConfig();
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.isInitialized);
  const initializeEditorSettings = useEditorStore((state) => state.initializeSettings);

  // Initialize editor settings once config is loaded
  useEffect(() => {
    if (isInitialized && !isLoading && !error) {
      initializeEditorSettings();
    }
  }, [isInitialized, isLoading, error, initializeEditorSettings]);

  // For unauthenticated users, don't gate - config isn't needed
  if (!user || !authInitialized) {
    return <>{children}</>;
  }

  // Show loading state while config is loading
  if (isLoading || !isInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
          <p className="text-sm text-text-muted">Loading configuration...</p>
        </div>
      </div>
    );
  }

  // Show error state if config failed to load
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-void p-4">
        <div className="max-w-md rounded-lg border border-accent-error/30 bg-surface p-6 text-center">
          <div className="mb-4 text-4xl">⚠️</div>
          <h2 className="mb-2 text-lg font-semibold text-text-primary">Configuration Error</h2>
          <p className="mb-4 text-sm text-text-secondary">
            Failed to load platform configuration. Please check your connection and try again.
          </p>
          <p className="mb-4 text-xs text-text-muted font-mono bg-elevated p-2 rounded">{error}</p>
          <button
            onClick={retry}
            className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Don't retry on 4xx client errors (400-499)
              if (error instanceof Error) {
                const errorWithStatus = error as Error & { status?: number };
                // Check for status code on error object
                if (
                  errorWithStatus.status &&
                  errorWithStatus.status >= 400 &&
                  errorWithStatus.status < 500
                ) {
                  return false;
                }
                // Fallback: check for HTTP 4xx status codes in message (e.g., "HTTP 404")
                if (
                  /\bHTTP\s*4\d{2}\b/i.test(error.message) ||
                  /\b4\d{2}\s*:/i.test(error.message)
                ) {
                  return false;
                }
              }
              return failureCount < 3;
            },
          },
          mutations: {
            retry: false,
            onError: (error) => {
              // Report mutation errors to Sentry
              Sentry.captureException(error, {
                tags: { reactQuery: true, type: 'mutation' },
              });
            },
          },
        },
      })
  );

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        Sentry.captureException(error, {
          extra: { componentStack: errorInfo.componentStack },
        });
      }}
    >
      <QueryClientProvider client={queryClient}>
        <AuthInitializer>
          <ConfigGate>
            <ThemeInitializer>
              <PWAInitializer>
                <OnboardingTourProvider>
                  {children}

                  {/* Global components */}
                  <AriaLiveRegion />

                  {/* PWA components */}
                  <IOSInstallModal />
                  <OfflineIndicator />

                  {/* Billing components */}
                  <GlobalCreditExhaustedModal />
                </OnboardingTourProvider>
              </PWAInitializer>
            </ThemeInitializer>
          </ConfigGate>
        </AuthInitializer>

        {/* Toast notifications with theme awareness */}
        <ThemedToaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Toaster component that respects user's theme preference
function ThemedToaster() {
  const theme = useUIStore((state) => state.theme);

  // Determine the effective theme (handle 'system' preference)
  const effectiveTheme =
    theme === 'system'
      ? typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  return (
    <Toaster
      theme={effectiveTheme as 'light' | 'dark'}
      position="bottom-right"
      offset={16}
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          color: 'var(--text-primary)',
          borderRadius: 'var(--radius-lg)',
        },
        className: 'animate-slide-up',
      }}
      closeButton
      richColors
    />
  );
}
