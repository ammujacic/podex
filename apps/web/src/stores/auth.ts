import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;

  // Actions
  setUser: (user: User | null) => void;
  setTokens: (tokens: AuthTokens | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  logout: () => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set) => ({
        user: null,
        tokens: null,
        isLoading: false,
        error: null,
        isInitialized: false,

        setUser: (user) => set({ user }),

        setTokens: (tokens) => set({ tokens }),

        setLoading: (isLoading) => set({ isLoading }),

        setError: (error) => set({ error }),

        setInitialized: (isInitialized) => set({ isInitialized }),

        logout: () =>
          set({
            user: null,
            tokens: null,
            error: null,
          }),

        clearError: () => set({ error: null }),
      }),
      {
        name: 'podex-auth',
        partialize: (state) => ({
          user: state.user,
          tokens: state.tokens,
        }),
      }
    )
  )
);

// Selector hooks for convenience
export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () => useAuthStore((state) => !!state.user && !!state.tokens);
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);
export const useAuthError = () => useAuthStore((state) => state.error);
