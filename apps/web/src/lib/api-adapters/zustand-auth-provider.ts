/**
 * Zustand-based auth provider connecting to the auth store.
 */

import type { AuthProvider } from '@podex/api-client';
import { useAuthStore } from '@/stores/auth';

export class ZustandAuthProvider implements AuthProvider {
  private isRedirecting = false;

  getAccessToken(): string | null {
    return useAuthStore.getState().tokens?.accessToken ?? null;
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

    // Redirect to login if we had auth state and in browser (not already on login page)
    if (typeof window !== 'undefined') {
      const isOnAuthPage = window.location.pathname.startsWith('/auth/');

      if (hadAuthState && !isOnAuthPage) {
        this.isRedirecting = true;
        // Use window.location for immediate redirect that stops all pending requests
        window.location.href = '/auth/login';
      }
    }
  }
}
