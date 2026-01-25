import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAuthStore, type User, type AuthTokens } from '../auth';

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  avatarUrl: 'https://example.com/avatar.jpg',
  role: 'user',
};

const mockAdminUser: User = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin User',
  avatarUrl: null,
  role: 'admin',
};

const mockTokens: AuthTokens = {
  accessToken: 'mock_access_token_abc123',
  refreshToken: 'mock_refresh_token_xyz789',
  expiresAt: Date.now() + 3600000, // 1 hour from now
};

describe('authStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useAuthStore.setState({
        user: null,
        tokens: null,
        isLoading: false,
        error: null,
        isInitialized: false,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has no user', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.user).toBeNull();
    });

    it('has no tokens', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.tokens).toBeNull();
    });

    it('is not loading', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.isLoading).toBe(false);
    });

    it('has no error', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.error).toBeNull();
    });

    it('is not initialized', () => {
      const { result } = renderHook(() => useAuthStore());
      expect(result.current.isInitialized).toBe(false);
    });
  });

  // ========================================================================
  // User Management
  // ========================================================================

  describe('User Management', () => {
    describe('setUser', () => {
      it('sets user data', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setUser(mockUser);
        });

        expect(result.current.user).toEqual(mockUser);
      });

      it('can update user data', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setUser(mockUser);
          result.current.setUser({
            ...mockUser,
            name: 'Updated Name',
          });
        });

        expect(result.current.user?.name).toBe('Updated Name');
      });

      it('can clear user by setting to null', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setUser(mockUser);
          result.current.setUser(null);
        });

        expect(result.current.user).toBeNull();
      });

      it('handles different user roles', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setUser(mockAdminUser);
        });

        expect(result.current.user?.role).toBe('admin');
      });
    });
  });

  // ========================================================================
  // Token Management
  // ========================================================================

  describe('Token Management', () => {
    describe('setTokens', () => {
      it('sets auth tokens', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setTokens(mockTokens);
        });

        expect(result.current.tokens).toEqual(mockTokens);
      });

      it('can update tokens', () => {
        const { result } = renderHook(() => useAuthStore());
        const newTokens: AuthTokens = {
          ...mockTokens,
          accessToken: 'new_access_token',
          expiresAt: Date.now() + 7200000,
        };

        act(() => {
          result.current.setTokens(mockTokens);
          result.current.setTokens(newTokens);
        });

        expect(result.current.tokens?.accessToken).toBe('new_access_token');
      });

      it('can clear tokens by setting to null', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setTokens(mockTokens);
          result.current.setTokens(null);
        });

        expect(result.current.tokens).toBeNull();
      });

      it('handles tokens with null access token (httpOnly cookies)', () => {
        const { result } = renderHook(() => useAuthStore());
        const httpOnlyTokens: AuthTokens = {
          accessToken: null,
          refreshToken: null,
          expiresAt: Date.now() + 3600000,
        };

        act(() => {
          result.current.setTokens(httpOnlyTokens);
        });

        expect(result.current.tokens?.accessToken).toBeNull();
        expect(result.current.tokens?.refreshToken).toBeNull();
      });
    });
  });

  // ========================================================================
  // Loading State
  // ========================================================================

  describe('Loading State', () => {
    describe('setLoading', () => {
      it('sets loading to true', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setLoading(true);
        });

        expect(result.current.isLoading).toBe(true);
      });

      it('sets loading to false', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setLoading(true);
          result.current.setLoading(false);
        });

        expect(result.current.isLoading).toBe(false);
      });

      it('can toggle loading state multiple times', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setLoading(true);
        });
        expect(result.current.isLoading).toBe(true);

        act(() => {
          result.current.setLoading(false);
        });
        expect(result.current.isLoading).toBe(false);

        act(() => {
          result.current.setLoading(true);
        });
        expect(result.current.isLoading).toBe(true);
      });
    });
  });

  // ========================================================================
  // Error State
  // ========================================================================

  describe('Error State', () => {
    describe('setError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setError('Authentication failed');
        });

        expect(result.current.error).toBe('Authentication failed');
      });

      it('can update error message', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setError('First error');
          result.current.setError('Second error');
        });

        expect(result.current.error).toBe('Second error');
      });

      it('can clear error by setting to null', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setError('An error occurred');
          result.current.setError(null);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('clearError', () => {
      it('clears error message', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setError('An error occurred');
          result.current.clearError();
        });

        expect(result.current.error).toBeNull();
      });

      it('handles clearing when no error exists', () => {
        const { result } = renderHook(() => useAuthStore());

        expect(() => {
          act(() => {
            result.current.clearError();
          });
        }).not.toThrow();

        expect(result.current.error).toBeNull();
      });
    });
  });

  // ========================================================================
  // Initialization State
  // ========================================================================

  describe('Initialization State', () => {
    describe('setInitialized', () => {
      it('sets initialized to true', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setInitialized(true);
        });

        expect(result.current.isInitialized).toBe(true);
      });

      it('sets initialized to false', () => {
        const { result } = renderHook(() => useAuthStore());

        act(() => {
          result.current.setInitialized(true);
          result.current.setInitialized(false);
        });

        expect(result.current.isInitialized).toBe(false);
      });
    });
  });

  // ========================================================================
  // Logout
  // ========================================================================

  describe('Logout', () => {
    it('clears user and tokens', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setUser(mockUser);
        result.current.setTokens(mockTokens);
        result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();
    });

    it('clears error on logout', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setUser(mockUser);
        result.current.setError('Some error');
        result.current.logout();
      });

      expect(result.current.error).toBeNull();
    });

    it('preserves isLoading and isInitialized on logout', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setUser(mockUser);
        result.current.setLoading(true);
        result.current.setInitialized(true);
        result.current.logout();
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isInitialized).toBe(true);
    });

    it('handles logout when already logged out', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(() => {
        act(() => {
          result.current.logout();
        });
      }).not.toThrow();

      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();
    });
  });

  // ========================================================================
  // Authentication Workflows
  // ========================================================================

  describe('Authentication Workflows', () => {
    it('handles complete login flow', () => {
      const { result } = renderHook(() => useAuthStore());

      // Start loading
      act(() => {
        result.current.setLoading(true);
      });
      expect(result.current.isLoading).toBe(true);

      // Set user and tokens on successful login
      act(() => {
        result.current.setUser(mockUser);
        result.current.setTokens(mockTokens);
        result.current.setLoading(false);
        result.current.setInitialized(true);
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.tokens).toEqual(mockTokens);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isInitialized).toBe(true);
    });

    it('handles login error flow', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setLoading(true);
      });

      // Handle error
      act(() => {
        result.current.setError('Invalid credentials');
        result.current.setLoading(false);
      });

      expect(result.current.error).toBe('Invalid credentials');
      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('handles token refresh flow', () => {
      const { result } = renderHook(() => useAuthStore());

      // Initial login
      act(() => {
        result.current.setUser(mockUser);
        result.current.setTokens(mockTokens);
      });

      // Refresh tokens
      const newTokens: AuthTokens = {
        ...mockTokens,
        accessToken: 'refreshed_access_token',
        expiresAt: Date.now() + 3600000,
      };

      act(() => {
        result.current.setTokens(newTokens);
      });

      expect(result.current.tokens?.accessToken).toBe('refreshed_access_token');
      expect(result.current.user).toEqual(mockUser); // User unchanged
    });

    it('handles session restoration from storage', () => {
      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.setLoading(true);
        result.current.setUser(mockUser);
        result.current.setTokens(mockTokens);
        result.current.setLoading(false);
        result.current.setInitialized(true);
      });

      expect(result.current.isInitialized).toBe(true);
      expect(result.current.user).toEqual(mockUser);
    });

    it('handles logout and re-login', () => {
      const { result } = renderHook(() => useAuthStore());

      // Initial login
      act(() => {
        result.current.setUser(mockUser);
        result.current.setTokens(mockTokens);
      });
      expect(result.current.user).toEqual(mockUser);

      // Logout
      act(() => {
        result.current.logout();
      });
      expect(result.current.user).toBeNull();
      expect(result.current.tokens).toBeNull();

      // Re-login with different user
      act(() => {
        result.current.setUser(mockAdminUser);
        result.current.setTokens(mockTokens);
      });
      expect(result.current.user).toEqual(mockAdminUser);
    });
  });
});
