/**
 * Zustand-based auth provider connecting to the auth store.
 */

import type { AuthProvider } from '@podex/api-client';
import { calculateExpiry } from '@podex/api-client';
import { useAuthStore } from '@/stores/auth';
import { getApiBaseUrlSync } from '@/lib/api-url';

export class ZustandAuthProvider implements AuthProvider {
  private isRedirecting = false;

  getAccessToken(): string | null {
    return useAuthStore.getState().tokens?.accessToken ?? null;
  }

  async refreshToken(): Promise<boolean> {
    const store = useAuthStore.getState();
    const tokens = store.tokens;

    try {
      const apiBaseUrl = getApiBaseUrlSync();
      const body = tokens?.refreshToken ? { refresh_token: tokens.refreshToken } : {};

      // Call refresh endpoint directly to avoid circular dependency
      const response = await fetch(`${apiBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include httpOnly cookies
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();

      // Update tokens in store
      store.setTokens({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: calculateExpiry(data.expires_in),
      });

      return true;
    } catch {
      // Refresh failed
      return false;
    }
  }

  onUnauthorized(): void {
    // Prevent multiple redirects from concurrent 401 responses
    if (this.isRedirecting) {
      return;
    }

    const store = useAuthStore.getState();

    // Check if we had auth state (user OR tokens) - tokens may exist even if user fetch failed
    const hadAuthState = !!store.user || !!store.tokens;

    // Clear auth state
    store.logout();

    // Only redirect to login if we had auth state and are on a page that requires authentication
    if (typeof window !== 'undefined' && hadAuthState) {
      const isOnAuthPage = window.location.pathname.startsWith('/auth/');

      // Pages that require authentication and should redirect to login on 401
      const requiresAuth =
        window.location.pathname.startsWith('/dashboard') ||
        window.location.pathname.startsWith('/session/') ||
        window.location.pathname.startsWith('/settings') ||
        window.location.pathname.startsWith('/admin') ||
        window.location.pathname === '/agents' ||
        window.location.pathname.startsWith('/join/');

      if (requiresAuth && !isOnAuthPage) {
        this.isRedirecting = true;
        // Use window.location for immediate redirect that stops all pending requests
        window.location.href = '/auth/login';
      }
    }
  }
}
