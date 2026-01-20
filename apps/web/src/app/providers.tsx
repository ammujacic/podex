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
import { usePWAInit } from '@/hooks/usePWAInit';
import { IOSInstallModal, OfflineIndicator } from '@/components/pwa';
import { useInitializeConfig } from '@/stores/config';
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

// Config initializer - loads platform config, providers, and agent roles
function ConfigInitializer({ children }: { children: ReactNode }) {
  useInitializeConfig();
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
          <ConfigInitializer>
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
          </ConfigInitializer>
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
