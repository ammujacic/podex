'use client';

import * as Sentry from '@sentry/nextjs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { initializeAuth } from '@/lib/api';
import { OnboardingTourProvider } from '@/components/ui/OnboardingTour';
import { MobileNav } from '@/components/ui/MobileNav';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useSettingsSync } from '@/hooks/useSettingsSync';

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

// Keyboard shortcuts handler
function KeyboardShortcuts({ children }: { children: ReactNode }) {
  const { toggleCommandPalette, toggleQuickOpen, toggleTerminal, toggleGlobalSearch } =
    useUIStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Require modifier key
      const isModifierKey = e.metaKey || e.ctrlKey;
      if (!isModifierKey) return;

      // Cmd/Ctrl + Shift + P - Command palette
      if (e.shiftKey && e.key === 'p') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Cmd/Ctrl + P - Quick open (only if not in input)
      if (e.key === 'p' && !e.shiftKey && !isInput) {
        e.preventDefault();
        toggleQuickOpen();
        return;
      }

      // Cmd/Ctrl + K - Global search
      if (e.key === 'k') {
        e.preventDefault();
        toggleGlobalSearch();
        return;
      }

      // Cmd/Ctrl + ` - Toggle terminal
      if (e.key === '`') {
        e.preventDefault();
        toggleTerminal();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCommandPalette, toggleQuickOpen, toggleTerminal, toggleGlobalSearch]);

  return <>{children}</>;
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

// Mobile navigation wrapper - only shows on dashboard/non-workspace pages
function MobileNavWrapper() {
  const [mounted, setMounted] = useState(false);
  const [pathname, setPathname] = useState('');

  useEffect(() => {
    setMounted(true);
    setPathname(window.location.pathname);

    // Listen for route changes
    const handleRouteChange = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  if (!mounted) return null;

  // Pages that should show mobile nav
  const showMobileNav =
    pathname === '/dashboard' ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/agents' ||
    pathname.startsWith('/agents/');

  if (!showMobileNav) return null;

  return <MobileNav />;
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
              // Don't retry on 4xx errors
              if (error instanceof Error && error.message.includes('4')) {
                return false;
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
          <ThemeInitializer>
            <OnboardingTourProvider>
              <KeyboardShortcuts>
                {children}

                {/* Global components */}
                <MobileNavWrapper />
                <AriaLiveRegion />
              </KeyboardShortcuts>
            </OnboardingTourProvider>
          </ThemeInitializer>
        </AuthInitializer>

        {/* Toast notifications */}
        <Toaster
          theme="dark"
          position="bottom-right"
          offset={80} // Above mobile nav
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
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
