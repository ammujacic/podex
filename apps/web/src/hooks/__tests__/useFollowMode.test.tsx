/**
 * Comprehensive tests for useFollowMode hook
 * Tests follow mode state management, user tracking, and file/line navigation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFollowMode, type FollowModeState, type FollowModeActions } from '../useFollowMode';
import { usePresenceStore, type UserPresence } from '@/stores/presence';

// Mock the presence store
vi.mock('@/stores/presence', () => {
  const mockStore = {
    users: [] as UserPresence[],
    followingUserId: null as string | null,
    setFollowingUserId: vi.fn(),
  };

  return {
    usePresenceStore: vi.fn((selector?: (state: typeof mockStore) => unknown) => {
      if (typeof selector === 'function') {
        return selector(mockStore);
      }
      return mockStore;
    }),
  };
});

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Eye: () => null,
  X: () => null,
}));

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

// Get the mocked module for direct state manipulation
const getMockStore = () => {
  const mockFn = usePresenceStore as unknown as vi.Mock;
  // Get the internal mock state by calling with undefined selector
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store: any = {};

  // Track what the mock returns
  mockFn.mockImplementation((selector?: (state: typeof store) => unknown) => {
    if (typeof selector === 'function') {
      return selector(store);
    }
    return store;
  });

  return store;
};

describe('useFollowMode', () => {
  let mockStore: {
    users: UserPresence[];
    followingUserId: string | null;
    setFollowingUserId: ReturnType<typeof vi.fn>;
  };

  const createMockUser = (overrides: Partial<UserPresence> = {}): UserPresence => ({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    status: 'online',
    color: '#ff0000',
    lastActive: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockStore = {
      users: [],
      followingUserId: null,
      setFollowingUserId: vi.fn(),
    };

    (usePresenceStore as unknown as vi.Mock).mockImplementation(
      (selector?: (state: typeof mockStore) => unknown) => {
        if (typeof selector === 'function') {
          return selector(mockStore);
        }
        return mockStore;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should initialize with isFollowing as false', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(result.current.isFollowing).toBe(false);
    });

    it('should initialize with followedUser as null', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(result.current.followedUser).toBeNull();
    });

    it('should initialize with followedFile as null', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(result.current.followedFile).toBeNull();
    });

    it('should initialize with followedLine as null', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(result.current.followedLine).toBeNull();
    });

    it('should return startFollowing function', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(typeof result.current.startFollowing).toBe('function');
    });

    it('should return stopFollowing function', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(typeof result.current.stopFollowing).toBe('function');
    });

    it('should return toggleFollowing function', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(typeof result.current.toggleFollowing).toBe('function');
    });
  });

  // ========================================
  // Start Following Tests
  // ========================================

  describe('startFollowing', () => {
    it('should call setFollowingUserId with user id', () => {
      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.startFollowing('user-123');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith('user-123');
    });

    it('should start following a different user', () => {
      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.startFollowing('user-abc');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith('user-abc');

      act(() => {
        result.current.startFollowing('user-xyz');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith('user-xyz');
    });
  });

  // ========================================
  // Stop Following Tests
  // ========================================

  describe('stopFollowing', () => {
    it('should call setFollowingUserId with null', () => {
      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.stopFollowing();
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith(null);
    });

    it('should reset followedFile to null', () => {
      mockStore.followingUserId = 'user-1';
      mockStore.users = [createMockUser({ currentFile: '/test.ts' })];

      const { result, rerender } = renderHook(() => useFollowMode());

      // Force a rerender to pick up the file
      rerender();

      act(() => {
        result.current.stopFollowing();
      });

      // After stopping, the state should reset
      expect(result.current.followedFile).toBeNull();
    });

    it('should reset followedLine to null', () => {
      mockStore.followingUserId = 'user-1';
      mockStore.users = [createMockUser({ cursorLine: 42 })];

      const { result, rerender } = renderHook(() => useFollowMode());

      rerender();

      act(() => {
        result.current.stopFollowing();
      });

      expect(result.current.followedLine).toBeNull();
    });
  });

  // ========================================
  // Toggle Following Tests
  // ========================================

  describe('toggleFollowing', () => {
    it('should start following if not currently following', () => {
      mockStore.followingUserId = null;

      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.toggleFollowing('user-123');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith('user-123');
    });

    it('should stop following if currently following the same user', () => {
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.toggleFollowing('user-123');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith(null);
    });

    it('should switch to following different user', () => {
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      act(() => {
        result.current.toggleFollowing('user-456');
      });

      expect(mockStore.setFollowingUserId).toHaveBeenCalledWith('user-456');
    });
  });

  // ========================================
  // Following State Tests
  // ========================================

  describe('Following State', () => {
    it('should return isFollowing true when followingUserId is set', () => {
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.isFollowing).toBe(true);
    });

    it('should return isFollowing false when followingUserId is null', () => {
      mockStore.followingUserId = null;

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.isFollowing).toBe(false);
    });

    it('should return followedUser when user exists', () => {
      const testUser = createMockUser({ id: 'user-123', name: 'Jane Doe' });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedUser).toEqual(testUser);
    });

    it('should return null followedUser when user does not exist', () => {
      mockStore.users = [createMockUser({ id: 'user-456' })];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedUser).toBeNull();
    });
  });

  // ========================================
  // File Tracking Tests
  // ========================================

  describe('File Tracking', () => {
    it('should track followed user current file', () => {
      const testUser = createMockUser({
        id: 'user-123',
        currentFile: '/path/to/file.ts',
      });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      // Effect runs after render, wait for state update
      expect(result.current.followedFile).toBe('/path/to/file.ts');
    });

    it('should call onFileChange when file changes', async () => {
      const onFileChange = vi.fn();
      const testUser = createMockUser({ id: 'user-123', currentFile: '/initial/file.ts' });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      renderHook(() => useFollowMode({ onFileChange }));

      // Initial file should trigger callback
      await waitFor(() => {
        expect(onFileChange).toHaveBeenCalledWith('/initial/file.ts');
      });
    });

    it('should not call onFileChange when file is same', async () => {
      const onFileChange = vi.fn();
      const testUser = createMockUser({
        id: 'user-123',
        currentFile: '/same/file.ts',
      });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { rerender } = renderHook(() => useFollowMode({ onFileChange }));

      // Clear any initial calls
      onFileChange.mockClear();

      // Rerender with same file
      rerender();

      expect(onFileChange).not.toHaveBeenCalled();
    });

    it('should handle user with no current file', () => {
      const testUser = createMockUser({ id: 'user-123', currentFile: undefined });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedFile).toBeNull();
    });

    it('should reset file when user no longer followed', () => {
      const testUser = createMockUser({
        id: 'user-123',
        currentFile: '/test.ts',
      });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result, rerender } = renderHook(() => useFollowMode());

      // Initially following
      expect(result.current.followedFile).toBe('/test.ts');

      // Stop following
      act(() => {
        mockStore.followingUserId = null;
      });
      rerender();

      expect(result.current.followedFile).toBeNull();
    });
  });

  // ========================================
  // Line Tracking Tests
  // ========================================

  describe('Line Tracking', () => {
    it('should track followed user cursor line', () => {
      const testUser = createMockUser({
        id: 'user-123',
        cursorLine: 42,
      });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedLine).toBe(42);
    });

    it('should call onLineChange when line changes', async () => {
      const onLineChange = vi.fn();
      const testUser = createMockUser({ id: 'user-123', cursorLine: 50 });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      renderHook(() => useFollowMode({ onLineChange }));

      // Initial line should trigger callback
      await waitFor(() => {
        expect(onLineChange).toHaveBeenCalledWith(50);
      });
    });

    it('should call onScrollToLine when line changes', async () => {
      const onScrollToLine = vi.fn();
      const testUser = createMockUser({ id: 'user-123', cursorLine: 75 });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      renderHook(() => useFollowMode({ onScrollToLine }));

      // Initial line should trigger callback
      await waitFor(() => {
        expect(onScrollToLine).toHaveBeenCalledWith(75);
      });
    });

    it('should handle user with no cursor line', () => {
      const testUser = createMockUser({ id: 'user-123', cursorLine: undefined });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedLine).toBeNull();
    });

    it('should not call line callbacks when line is null', () => {
      const onLineChange = vi.fn();
      const onScrollToLine = vi.fn();
      const testUser = createMockUser({
        id: 'user-123',
        cursorLine: 10,
      });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { rerender } = renderHook(() => useFollowMode({ onLineChange, onScrollToLine }));

      // Clear initial calls
      onLineChange.mockClear();
      onScrollToLine.mockClear();

      // Update to no line
      act(() => {
        mockStore.users = [{ ...testUser, cursorLine: undefined }];
      });
      rerender();

      expect(onLineChange).not.toHaveBeenCalled();
      expect(onScrollToLine).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Callback Options Tests
  // ========================================

  describe('Callback Options', () => {
    it('should accept empty options', () => {
      const { result } = renderHook(() => useFollowMode());
      expect(result.current).toBeDefined();
    });

    it('should accept onFileChange callback only', () => {
      const onFileChange = vi.fn();
      const { result } = renderHook(() => useFollowMode({ onFileChange }));
      expect(result.current).toBeDefined();
    });

    it('should accept onLineChange callback only', () => {
      const onLineChange = vi.fn();
      const { result } = renderHook(() => useFollowMode({ onLineChange }));
      expect(result.current).toBeDefined();
    });

    it('should accept onScrollToLine callback only', () => {
      const onScrollToLine = vi.fn();
      const { result } = renderHook(() => useFollowMode({ onScrollToLine }));
      expect(result.current).toBeDefined();
    });

    it('should accept all callbacks together', () => {
      const onFileChange = vi.fn();
      const onLineChange = vi.fn();
      const onScrollToLine = vi.fn();
      const { result } = renderHook(() =>
        useFollowMode({ onFileChange, onLineChange, onScrollToLine })
      );
      expect(result.current).toBeDefined();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty users list', () => {
      mockStore.users = [];
      mockStore.followingUserId = 'user-123';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedUser).toBeNull();
      expect(result.current.isFollowing).toBe(true); // Still "following" even if user not found
    });

    it('should handle user leaving while being followed', () => {
      const testUser = createMockUser({ id: 'user-123' });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { result, rerender } = renderHook(() => useFollowMode());

      expect(result.current.followedUser).not.toBeNull();

      // User leaves
      act(() => {
        mockStore.users = [];
      });
      rerender();

      expect(result.current.followedUser).toBeNull();
    });

    it('should handle rapid file changes', async () => {
      const onFileChange = vi.fn();
      const testUser = createMockUser({ id: 'user-123' });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { rerender } = renderHook(() => useFollowMode({ onFileChange }));

      // Rapid file changes
      for (let i = 0; i < 5; i++) {
        act(() => {
          mockStore.users = [{ ...testUser, currentFile: `/file${i}.ts` }];
        });
        rerender();
      }

      await waitFor(() => {
        expect(onFileChange.mock.calls.length).toBeGreaterThan(0);
      });
    });

    it('should handle multiple users correctly', () => {
      const user1 = createMockUser({ id: 'user-1', name: 'User 1', currentFile: '/file1.ts' });
      const user2 = createMockUser({ id: 'user-2', name: 'User 2', currentFile: '/file2.ts' });
      mockStore.users = [user1, user2];
      mockStore.followingUserId = 'user-2';

      const { result } = renderHook(() => useFollowMode());

      expect(result.current.followedUser?.id).toBe('user-2');
      expect(result.current.followedFile).toBe('/file2.ts');
    });

    it('should maintain stability with callback changes', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const { result, rerender } = renderHook(
        ({ onFileChange }) => useFollowMode({ onFileChange }),
        { initialProps: { onFileChange: callback1 } }
      );

      const initialStartFollowing = result.current.startFollowing;

      rerender({ onFileChange: callback2 });

      // Functions should be stable (memoized)
      expect(result.current.startFollowing).toBe(initialStartFollowing);
    });

    it('should handle switching between users', () => {
      const user1 = createMockUser({ id: 'user-1', currentFile: '/file1.ts', cursorLine: 10 });
      const user2 = createMockUser({ id: 'user-2', currentFile: '/file2.ts', cursorLine: 20 });
      mockStore.users = [user1, user2];
      mockStore.followingUserId = 'user-1';

      const { result, rerender } = renderHook(() => useFollowMode());

      expect(result.current.followedFile).toBe('/file1.ts');
      expect(result.current.followedLine).toBe(10);

      // Switch to user 2
      act(() => {
        mockStore.followingUserId = 'user-2';
      });
      rerender();

      expect(result.current.followedFile).toBe('/file2.ts');
      expect(result.current.followedLine).toBe(20);
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should not call callbacks after unmount', async () => {
      const onFileChange = vi.fn();
      const testUser = createMockUser({ id: 'user-123' });
      mockStore.users = [testUser];
      mockStore.followingUserId = 'user-123';

      const { unmount } = renderHook(() => useFollowMode({ onFileChange }));

      unmount();

      // Update after unmount
      act(() => {
        mockStore.users = [{ ...testUser, currentFile: '/new/file.ts' }];
      });

      // Callback should not be called after unmount
      expect(onFileChange).not.toHaveBeenCalled();
    });
  });
});
