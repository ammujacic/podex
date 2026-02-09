/**
 * Presence store - manages collaborative presence state.
 */

import { create } from 'zustand';

export type UserStatus = 'online' | 'away' | 'busy' | 'offline';

export interface UserPresence {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  status: UserStatus;
  color: string;
  currentFile?: string;
  cursorLine?: number;
  lastActive: Date;
  isTyping?: boolean;
  sharingMode?: string;
  isOwner?: boolean;
}

interface PresenceState {
  users: UserPresence[];
  currentUserId: string | null;
  followingUserId: string | null;
  soundEnabled: boolean;

  setUsers: (users: UserPresence[]) => void;
  addUser: (user: UserPresence) => void;
  removeUser: (userId: string) => void;
  updateUser: (userId: string, updates: Partial<UserPresence>) => void;
  setCurrentUserId: (userId: string) => void;
  setFollowingUserId: (userId: string | null) => void;
  toggleSound: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  users: [],
  currentUserId: null,
  followingUserId: null,
  soundEnabled: true,

  setUsers: (users) => set({ users }),
  addUser: (user) => set((state) => ({ users: [...state.users, user] })),
  removeUser: (userId) =>
    set((state) => ({
      users: state.users.filter((u) => u.id !== userId),
      followingUserId: state.followingUserId === userId ? null : state.followingUserId,
    })),
  updateUser: (userId, updates) =>
    set((state) => ({
      users: state.users.map((u) => (u.id === userId ? { ...u, ...updates } : u)),
    })),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setFollowingUserId: (userId) => set({ followingUserId: userId }),
  toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
}));

// Helper functions for presence

export function getRandomColor(seed: string): string {
  const colors = [
    '#3b82f6',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
    '#84cc16',
  ] as const;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? '#3b82f6';
}

export function getSharingModeLabel(mode: string): string {
  switch (mode) {
    case 'view_only':
      return 'View only';
    case 'can_edit':
      return 'Can edit';
    case 'full_control':
      return 'Full control';
    default:
      return mode;
  }
}
