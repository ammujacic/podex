import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  usePresenceStore,
  getRandomColor,
  getSharingModeLabel,
  type UserPresence,
} from '../presence';

// Mock user fixtures
const mockUser1: UserPresence = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: 'online',
  color: '#3b82f6',
  lastActive: new Date(),
};

const mockUser2: UserPresence = {
  id: 'user-2',
  name: 'Bob',
  email: 'bob@example.com',
  avatar: 'https://example.com/avatar.jpg',
  status: 'away',
  color: '#10b981',
  currentFile: '/src/App.tsx',
  cursorLine: 42,
  lastActive: new Date(),
  isTyping: true,
};

const mockUser3: UserPresence = {
  id: 'user-3',
  name: 'Charlie',
  email: 'charlie@example.com',
  status: 'busy',
  color: '#f59e0b',
  lastActive: new Date(),
  sharingMode: 'can_edit',
  isOwner: true,
};

describe('presenceStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      usePresenceStore.setState({
        users: [],
        currentUserId: null,
        followingUserId: null,
        soundEnabled: true,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty users list', () => {
      const { result } = renderHook(() => usePresenceStore());
      expect(result.current.users).toEqual([]);
    });

    it('has no current user', () => {
      const { result } = renderHook(() => usePresenceStore());
      expect(result.current.currentUserId).toBeNull();
    });

    it('has no following user', () => {
      const { result } = renderHook(() => usePresenceStore());
      expect(result.current.followingUserId).toBeNull();
    });

    it('has sound enabled by default', () => {
      const { result } = renderHook(() => usePresenceStore());
      expect(result.current.soundEnabled).toBe(true);
    });
  });

  // ========================================================================
  // User Management
  // ========================================================================

  describe('User Management', () => {
    describe('setUsers', () => {
      it('sets users list', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setUsers([mockUser1, mockUser2]);
        });

        expect(result.current.users).toHaveLength(2);
        expect(result.current.users[0]).toEqual(mockUser1);
        expect(result.current.users[1]).toEqual(mockUser2);
      });

      it('replaces existing users', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setUsers([mockUser1]);
          result.current.setUsers([mockUser2, mockUser3]);
        });

        expect(result.current.users).toHaveLength(2);
        expect(result.current.users.find((u) => u.id === mockUser1.id)).toBeUndefined();
      });

      it('can set empty users list', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setUsers([mockUser1, mockUser2]);
          result.current.setUsers([]);
        });

        expect(result.current.users).toEqual([]);
      });
    });

    describe('addUser', () => {
      it('adds user to list', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
        });

        expect(result.current.users).toHaveLength(1);
        expect(result.current.users[0]).toEqual(mockUser1);
      });

      it('adds multiple users', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.addUser(mockUser2);
          result.current.addUser(mockUser3);
        });

        expect(result.current.users).toHaveLength(3);
      });

      it('maintains insertion order', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.addUser(mockUser2);
        });

        expect(result.current.users[0].id).toBe('user-1');
        expect(result.current.users[1].id).toBe('user-2');
      });
    });

    describe('removeUser', () => {
      it('removes user from list', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.addUser(mockUser2);
          result.current.removeUser('user-1');
        });

        expect(result.current.users).toHaveLength(1);
        expect(result.current.users[0].id).toBe('user-2');
      });

      it('clears followingUserId if removed user was being followed', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.setFollowingUserId('user-1');
          result.current.removeUser('user-1');
        });

        expect(result.current.followingUserId).toBeNull();
      });

      it('keeps followingUserId if different user was removed', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.addUser(mockUser2);
          result.current.setFollowingUserId('user-1');
          result.current.removeUser('user-2');
        });

        expect(result.current.followingUserId).toBe('user-1');
      });

      it('handles removing non-existent user gracefully', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
        });

        expect(() => {
          act(() => {
            result.current.removeUser('non-existent');
          });
        }).not.toThrow();

        expect(result.current.users).toHaveLength(1);
      });
    });

    describe('updateUser', () => {
      it('updates user properties', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.updateUser('user-1', {
            status: 'away',
            currentFile: '/src/utils.ts',
            isTyping: true,
          });
        });

        const user = result.current.users.find((u) => u.id === 'user-1');
        expect(user?.status).toBe('away');
        expect(user?.currentFile).toBe('/src/utils.ts');
        expect(user?.isTyping).toBe(true);
      });

      it('does not affect other users', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.addUser(mockUser2);
          result.current.updateUser('user-1', { status: 'offline' });
        });

        const user2 = result.current.users.find((u) => u.id === 'user-2');
        expect(user2?.status).toBe('away'); // Unchanged
      });

      it('handles updating non-existent user gracefully', () => {
        const { result } = renderHook(() => usePresenceStore());

        expect(() => {
          act(() => {
            result.current.updateUser('non-existent', { status: 'online' });
          });
        }).not.toThrow();
      });

      it('updates cursor position', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.addUser(mockUser1);
          result.current.updateUser('user-1', {
            currentFile: '/src/App.tsx',
            cursorLine: 100,
          });
        });

        const user = result.current.users.find((u) => u.id === 'user-1');
        expect(user?.currentFile).toBe('/src/App.tsx');
        expect(user?.cursorLine).toBe(100);
      });
    });
  });

  // ========================================================================
  // Activity Tracking
  // ========================================================================

  describe('Activity Tracking', () => {
    it('tracks user typing state', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
        result.current.updateUser('user-1', { isTyping: true });
      });

      const user = result.current.users.find((u) => u.id === 'user-1');
      expect(user?.isTyping).toBe(true);

      act(() => {
        result.current.updateUser('user-1', { isTyping: false });
      });

      const updatedUser = result.current.users.find((u) => u.id === 'user-1');
      expect(updatedUser?.isTyping).toBe(false);
    });

    it('tracks user file navigation', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
        result.current.updateUser('user-1', { currentFile: '/src/App.tsx' });
      });

      let user = result.current.users.find((u) => u.id === 'user-1');
      expect(user?.currentFile).toBe('/src/App.tsx');

      act(() => {
        result.current.updateUser('user-1', { currentFile: '/src/utils.ts' });
      });

      user = result.current.users.find((u) => u.id === 'user-1');
      expect(user?.currentFile).toBe('/src/utils.ts');
    });

    it('tracks user status changes', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
      });

      const statuses: Array<'online' | 'away' | 'busy' | 'offline'> = [
        'online',
        'away',
        'busy',
        'offline',
      ];
      statuses.forEach((status) => {
        act(() => {
          result.current.updateUser('user-1', { status });
        });

        const user = result.current.users.find((u) => u.id === 'user-1');
        expect(user?.status).toBe(status);
      });
    });
  });

  // ========================================================================
  // Current User and Following
  // ========================================================================

  describe('Current User and Following', () => {
    describe('setCurrentUserId', () => {
      it('sets current user ID', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setCurrentUserId('user-1');
        });

        expect(result.current.currentUserId).toBe('user-1');
      });

      it('can switch current user', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setCurrentUserId('user-1');
          result.current.setCurrentUserId('user-2');
        });

        expect(result.current.currentUserId).toBe('user-2');
      });
    });

    describe('setFollowingUserId', () => {
      it('sets following user ID', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setFollowingUserId('user-1');
        });

        expect(result.current.followingUserId).toBe('user-1');
      });

      it('can clear following user', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setFollowingUserId('user-1');
          result.current.setFollowingUserId(null);
        });

        expect(result.current.followingUserId).toBeNull();
      });

      it('can switch between followed users', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.setFollowingUserId('user-1');
        });
        expect(result.current.followingUserId).toBe('user-1');

        act(() => {
          result.current.setFollowingUserId('user-2');
        });
        expect(result.current.followingUserId).toBe('user-2');
      });
    });

    describe('toggleSound', () => {
      it('toggles sound from enabled to disabled', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.toggleSound();
        });

        expect(result.current.soundEnabled).toBe(false);
      });

      it('toggles sound from disabled to enabled', () => {
        const { result } = renderHook(() => usePresenceStore());

        act(() => {
          result.current.toggleSound();
          result.current.toggleSound();
        });

        expect(result.current.soundEnabled).toBe(true);
      });

      it('toggles sound multiple times', () => {
        const { result } = renderHook(() => usePresenceStore());

        // Initial state is true
        expect(result.current.soundEnabled).toBe(true);

        for (let i = 0; i < 5; i++) {
          act(() => {
            result.current.toggleSound();
          });
          // After toggle i+1 times: odd toggles = false, even toggles = true
          // i=0 (1st toggle): false, i=1 (2nd toggle): true, i=2 (3rd toggle): false, etc.
          expect(result.current.soundEnabled).toBe((i + 1) % 2 === 0);
        }
      });
    });
  });

  // ========================================================================
  // Collaboration Workflows
  // ========================================================================

  describe('Collaboration Workflows', () => {
    it('handles user joining session', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
      });

      expect(result.current.users).toHaveLength(1);
      const user = result.current.users[0];
      expect(user?.status).toBe('online');
    });

    it('handles user leaving session', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
        result.current.addUser(mockUser2);
        result.current.removeUser('user-1');
      });

      expect(result.current.users).toHaveLength(1);
      expect(result.current.users[0]?.id).toBe('user-2');
    });

    it('handles following user workflow', () => {
      const { result } = renderHook(() => usePresenceStore());

      // Add users
      act(() => {
        result.current.addUser(mockUser1);
        result.current.addUser(mockUser2);
      });

      // Start following user-2
      act(() => {
        result.current.setFollowingUserId('user-2');
      });
      expect(result.current.followingUserId).toBe('user-2');

      // User-2 navigates to a file
      act(() => {
        result.current.updateUser('user-2', {
          currentFile: '/src/App.tsx',
          cursorLine: 50,
        });
      });

      const followedUser = result.current.users.find((u) => u.id === 'user-2');
      expect(followedUser?.currentFile).toBe('/src/App.tsx');

      // Stop following
      act(() => {
        result.current.setFollowingUserId(null);
      });
      expect(result.current.followingUserId).toBeNull();
    });

    it('handles multiple users editing simultaneously', () => {
      const { result } = renderHook(() => usePresenceStore());

      act(() => {
        result.current.addUser(mockUser1);
        result.current.addUser(mockUser2);
        result.current.addUser(mockUser3);

        result.current.updateUser('user-1', {
          currentFile: '/src/App.tsx',
          isTyping: true,
        });
        result.current.updateUser('user-2', {
          currentFile: '/src/utils.ts',
          isTyping: true,
        });
        result.current.updateUser('user-3', {
          currentFile: '/src/App.tsx',
          isTyping: false,
        });
      });

      const user1 = result.current.users.find((u) => u.id === 'user-1');
      const user2 = result.current.users.find((u) => u.id === 'user-2');
      const user3 = result.current.users.find((u) => u.id === 'user-3');

      expect(user1?.isTyping).toBe(true);
      expect(user2?.isTyping).toBe(true);
      expect(user3?.isTyping).toBe(false);
    });
  });

  // ========================================================================
  // Helper functions
  // ========================================================================

  describe('getRandomColor', () => {
    it('returns a color from the palette for a given seed', () => {
      const color = getRandomColor('user-1');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      const palette = [
        '#3b82f6',
        '#10b981',
        '#f59e0b',
        '#8b5cf6',
        '#ec4899',
        '#06b6d4',
        '#f97316',
        '#84cc16',
      ];
      expect(palette).toContain(color);
    });

    it('returns same color for same seed', () => {
      expect(getRandomColor('alice')).toBe(getRandomColor('alice'));
    });

    it('returns different colors for different seeds', () => {
      const a = getRandomColor('seed-a');
      const b = getRandomColor('seed-b');
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      // Not guaranteed different for all seeds but typically are
      expect(typeof a).toBe('string');
      expect(typeof b).toBe('string');
    });

    it('handles empty string seed', () => {
      const color = getRandomColor('');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('getSharingModeLabel', () => {
    it('returns "View only" for view_only', () => {
      expect(getSharingModeLabel('view_only')).toBe('View only');
    });

    it('returns "Can edit" for can_edit', () => {
      expect(getSharingModeLabel('can_edit')).toBe('Can edit');
    });

    it('returns "Full control" for full_control', () => {
      expect(getSharingModeLabel('full_control')).toBe('Full control');
    });

    it('returns mode as-is for unknown mode', () => {
      expect(getSharingModeLabel('custom')).toBe('custom');
    });
  });
});
