import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface AuthTokens {
  accessToken: string | null; // null when using httpOnly cookies in production
  refreshToken: string | null; // null when using httpOnly cookies in production
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

const authStoreCreator: StateCreator<AuthState> = (set) => ({
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
});

const persistedAuthStore = persist(authStoreCreator, {
  name: 'podex-auth',
  partialize: (state) => ({
    user: state.user,
    tokens: state.tokens,
  }),
});

// Only enable devtools in development to prevent exposing sensitive auth data in production
export const useAuthStore = create<AuthState>()(
  devtools(persistedAuthStore, {
    name: 'podex-auth',
    enabled: process.env.NODE_ENV === 'development',
  })
);

// Selector hooks for convenience
export const useUser = () => useAuthStore((state) => state.user);
// User presence indicates authentication (tokens may be null when using httpOnly cookies in prod)
export const useIsAuthenticated = () => useAuthStore((state) => !!state.user);
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);
export const useAuthError = () => useAuthStore((state) => state.error);
