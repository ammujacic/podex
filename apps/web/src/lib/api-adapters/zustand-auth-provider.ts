/**
 * Zustand-based auth provider connecting to the auth store.
 */

import type { AuthProvider } from '@podex/api-client';
import { useAuthStore } from '@/stores/auth';

export class ZustandAuthProvider implements AuthProvider {
  getAccessToken(): string | null {
    return useAuthStore.getState().tokens?.accessToken ?? null;
  }

  onUnauthorized(): void {
    useAuthStore.getState().logout();
  }
}
