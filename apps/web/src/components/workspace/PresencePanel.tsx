'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Users,
  Circle,
  Eye,
  FileCode,
  X,
  Volume2,
  VolumeX,
  MoreHorizontal,
  Link2,
  Copy,
  Check,
  UserPlus,
  Mail,
  Trash2,
  Shield,
  Edit3,
  Eye as EyeIcon,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth';
import {
  listSessionShares,
  createSessionShareLink,
  revokeSessionShareLink,
  shareSession,
  revokeSessionShare,
  updateSessionShare,
  type SessionSharesListResponse,
  type SessionShareResponse,
  type SharingMode,
} from '@/lib/api';
import { onSocketEvent, connectSocket, joinSession as socketJoinSession } from '@/lib/socket';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Store
// ============================================================================

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

// ============================================================================
// Helper functions
// ============================================================================

function getRandomColor(seed: string): string {
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

function getSharingModeLabel(mode: string): string {
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

function getSharingModeIcon(mode: string) {
  switch (mode) {
    case 'view_only':
      return EyeIcon;
    case 'can_edit':
      return Edit3;
    case 'full_control':
      return Shield;
    default:
      return EyeIcon;
  }
}

// ============================================================================
// Status Indicator
// ============================================================================

function StatusIndicator({ status }: { status: UserStatus }) {
  const colors = {
    online: 'bg-green-400',
    away: 'bg-yellow-400',
    busy: 'bg-red-400',
    offline: 'bg-gray-400',
  };

  return <span className={cn('w-2.5 h-2.5 rounded-full', colors[status])} />;
}

// ============================================================================
// User Avatar
// ============================================================================

interface UserAvatarProps {
  user: UserPresence;
  size?: 'sm' | 'md' | 'lg';
  showStatus?: boolean;
}

function UserAvatar({ user, size = 'md', showStatus = true }: UserAvatarProps) {
  const sizes = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
  };

  const sizePixels = {
    sm: 24,
    md: 32,
    lg: 40,
  };

  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="relative">
      {user.avatar ? (
        <Image
          src={user.avatar}
          alt={user.name}
          width={sizePixels[size]}
          height={sizePixels[size]}
          className={cn('rounded-full object-cover', sizes[size])}
        />
      ) : (
        <div
          className={cn(
            'rounded-full flex items-center justify-center font-medium text-white',
            sizes[size]
          )}
          style={{ backgroundColor: user.color }}
        >
          {initials}
        </div>
      )}
      {showStatus && (
        <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-surface rounded-full">
          <StatusIndicator status={user.status} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// User Card
// ============================================================================

interface UserCardProps {
  user: UserPresence;
  isCurrentUser: boolean;
  isFollowing: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
  onMessage?: () => void;
  onRemove?: () => void;
  onChangePermission?: (mode: SharingMode) => void;
  canManage?: boolean;
}

function UserCard({
  user,
  isCurrentUser,
  isFollowing,
  onFollow,
  onUnfollow,
  onRemove,
  onChangePermission,
  canManage,
}: UserCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const ModeIcon = user.sharingMode ? getSharingModeIcon(user.sharingMode) : Shield;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
        isFollowing && 'bg-accent-primary/10 border border-accent-primary/50',
        !isFollowing && 'hover:bg-overlay'
      )}
    >
      <UserAvatar user={user} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">
            {user.name}
            {isCurrentUser && <span className="ml-1 text-xs text-text-muted">(you)</span>}
            {user.isOwner && <span className="ml-1 text-xs text-accent-primary">(owner)</span>}
          </span>
          {user.isTyping && (
            <span className="text-xs text-accent-primary animate-pulse">typing...</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          {user.currentFile ? (
            <div className="flex items-center gap-1">
              <FileCode className="h-3 w-3" />
              <span className="truncate">{user.currentFile.split('/').pop()}</span>
              {user.cursorLine && <span>:{user.cursorLine}</span>}
            </div>
          ) : user.sharingMode && !user.isOwner ? (
            <div className="flex items-center gap-1">
              <ModeIcon className="h-3 w-3" />
              <span>{getSharingModeLabel(user.sharingMode)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {!isCurrentUser && !user.isOwner && (
        <div className="flex items-center gap-1">
          {user.status !== 'offline' && (
            <>
              {isFollowing ? (
                <button
                  onClick={onUnfollow}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-primary text-void"
                >
                  <Eye className="h-3 w-3" />
                  Following
                </button>
              ) : (
                <button
                  onClick={onFollow}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-overlay hover:bg-elevated text-text-muted hover:text-text-secondary"
                >
                  <Eye className="h-3 w-3" />
                  Follow
                </button>
              )}
            </>
          )}
          {canManage && (
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-border-default bg-surface shadow-xl overflow-hidden">
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-xs font-medium text-text-muted">
                      Change permission
                    </div>
                    {(['view_only', 'can_edit', 'full_control'] as SharingMode[]).map((mode) => {
                      const Icon = getSharingModeIcon(mode);
                      return (
                        <button
                          key={mode}
                          onClick={() => {
                            onChangePermission?.(mode);
                            setShowMenu(false);
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-overlay',
                            user.sharingMode === mode
                              ? 'text-accent-primary'
                              : 'text-text-secondary'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {getSharingModeLabel(mode)}
                          {user.sharingMode === mode && <Check className="h-3 w-3 ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-border-subtle py-1">
                    <button
                      onClick={() => {
                        onRemove?.();
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-accent-error hover:bg-overlay"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove access
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Share Link Section
// ============================================================================

interface ShareLinkSectionProps {
  sessionId: string;
  shareLink: string | null;
  shareLinkMode: string | null;
  onRefresh: () => void;
}

function ShareLinkSection({
  sessionId,
  shareLink,
  shareLinkMode,
  onRefresh,
}: ShareLinkSectionProps) {
  const [copied, setCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [selectedMode, setSelectedMode] = useState<SharingMode>('can_edit');

  const fullShareUrl = shareLink
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}${shareLink}`
    : null;

  const handleCopy = async () => {
    if (!fullShareUrl) return;
    await navigator.clipboard.writeText(fullShareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateLink = async () => {
    setIsCreating(true);
    try {
      await createSessionShareLink(sessionId, { sharing_mode: selectedMode });
      onRefresh();
    } catch (error) {
      console.error('Failed to create share link:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeLink = async () => {
    setIsRevoking(true);
    try {
      await revokeSessionShareLink(sessionId);
      onRefresh();
    } catch (error) {
      console.error('Failed to revoke share link:', error);
    } finally {
      setIsRevoking(false);
    }
  };

  if (shareLink) {
    return (
      <div className="px-3 py-2 border-b border-border-subtle bg-elevated/50">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="h-4 w-4 text-accent-primary" />
          <span className="text-xs font-medium text-text-primary">Share link active</span>
          <span className="text-xs text-text-muted">
            ({shareLinkMode ? getSharingModeLabel(shareLinkMode) : 'Can edit'})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={fullShareUrl || ''}
            className="flex-1 px-2 py-1.5 text-xs bg-surface border border-border-default rounded text-text-secondary truncate"
          />
          <button
            onClick={handleCopy}
            className="p-1.5 rounded bg-overlay hover:bg-active text-text-secondary hover:text-text-primary"
            title="Copy link"
          >
            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            onClick={handleRevokeLink}
            disabled={isRevoking}
            className="p-1.5 rounded bg-overlay hover:bg-accent-error/20 text-text-secondary hover:text-accent-error"
            title="Revoke link"
          >
            {isRevoking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-elevated/50">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Create share link</span>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value as SharingMode)}
          className="flex-1 px-2 py-1.5 text-xs bg-surface border border-border-default rounded text-text-secondary"
        >
          <option value="view_only">View only</option>
          <option value="can_edit">Can edit</option>
          <option value="full_control">Full control</option>
        </select>
        <button
          onClick={handleCreateLink}
          disabled={isCreating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent-primary hover:bg-accent-primary/90 text-void text-xs font-medium"
        >
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
          Create
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Invite Section
// ============================================================================

interface InviteSectionProps {
  sessionId: string;
  onRefresh: () => void;
}

function InviteSection({ sessionId, onRefresh }: InviteSectionProps) {
  const [email, setEmail] = useState('');
  const [selectedMode, setSelectedMode] = useState<SharingMode>('can_edit');
  const [isInviting, setIsInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) return;

    setIsInviting(true);
    setError(null);
    try {
      await shareSession(sessionId, {
        email: email.trim(),
        sharing_mode: selectedMode,
      });
      setEmail('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="px-3 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <UserPlus className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Invite by email</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Mail className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            type="email"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface border border-border-default rounded text-text-primary placeholder:text-text-muted"
          />
        </div>
        <select
          value={selectedMode}
          onChange={(e) => setSelectedMode(e.target.value as SharingMode)}
          className="px-2 py-1.5 text-xs bg-surface border border-border-default rounded text-text-secondary"
        >
          <option value="view_only">View</option>
          <option value="can_edit">Edit</option>
          <option value="full_control">Full</option>
        </select>
        <button
          onClick={handleInvite}
          disabled={isInviting || !email.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent-primary hover:bg-accent-primary/90 text-void text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isInviting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : success ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          Invite
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-accent-error">{error}</p>}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface PresencePanelProps {
  sessionId: string;
  className?: string;
}

export function PresencePanel({ sessionId, className }: PresencePanelProps) {
  const {
    users,
    currentUserId,
    followingUserId,
    soundEnabled,
    setUsers,
    setCurrentUserId,
    setFollowingUserId,
    toggleSound,
  } = usePresenceStore();

  const { user: authUser } = useAuthStore();
  const [sharesData, setSharesData] = useState<SessionSharesListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch shares data
  const fetchShares = useCallback(async () => {
    try {
      setError(null);
      const data = await listSessionShares(sessionId);
      setSharesData(data);

      // Convert shares to user presence format
      const presenceUsers: UserPresence[] = [];

      // Add current user (owner) first
      if (authUser) {
        presenceUsers.push({
          id: authUser.id,
          name: authUser.name || 'You',
          email: authUser.email,
          avatar: authUser.avatarUrl || undefined,
          status: 'online',
          color: getRandomColor(authUser.id),
          lastActive: new Date(),
          isOwner: true,
          sharingMode: 'full_control',
        });
        setCurrentUserId(authUser.id);
      }

      // Add shared users
      data.shares.forEach((share) => {
        const userId = share.shared_with_id || share.shared_with_email || share.id;
        const displayName = share.shared_with_email || 'Invited User';

        presenceUsers.push({
          id: userId,
          name: displayName,
          email: share.shared_with_email || '',
          status: 'offline', // Will be updated by WebSocket
          color: getRandomColor(userId),
          lastActive: new Date(share.created_at),
          sharingMode: share.sharing_mode,
        });
      });

      setUsers(presenceUsers);
    } catch (err) {
      console.error('Failed to fetch shares:', err);
      setError(err instanceof Error ? err.message : 'Failed to load collaborators');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, authUser, setUsers, setCurrentUserId]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  // Subscribe to real-time presence events
  useEffect(() => {
    if (!authUser) return;

    // Connect to socket and join session
    connectSocket();
    socketJoinSession(sessionId, authUser.id);

    // Listen for user joined events
    const unsubJoin = onSocketEvent('user_joined', (data) => {
      if (data.session_id === sessionId && data.user_id !== authUser.id) {
        // Update user status to online
        const existingUser = users.find((u) => u.id === data.user_id || u.email === data.user_id);
        if (existingUser) {
          usePresenceStore.getState().updateUser(existingUser.id, { status: 'online' });
        } else {
          // New user joined - refetch shares to get their info
          fetchShares();
        }
      }
    });

    // Listen for user left events
    const unsubLeave = onSocketEvent('user_left', (data) => {
      if (data.session_id === sessionId && data.user_id !== authUser.id) {
        // Update user status to offline
        const existingUser = users.find((u) => u.id === data.user_id || u.email === data.user_id);
        if (existingUser) {
          usePresenceStore.getState().updateUser(existingUser.id, { status: 'offline' });
        }
      }
    });

    return () => {
      unsubJoin();
      unsubLeave();
    };
  }, [sessionId, authUser, users, fetchShares]);

  const handleFollow = useCallback(
    (userId: string) => {
      setFollowingUserId(userId);
    },
    [setFollowingUserId]
  );

  const handleUnfollow = useCallback(() => {
    setFollowingUserId(null);
  }, [setFollowingUserId]);

  const handleRemoveUser = useCallback(
    async (share: SessionShareResponse) => {
      try {
        await revokeSessionShare(sessionId, share.id);
        fetchShares();
      } catch (err) {
        console.error('Failed to remove user:', err);
      }
    },
    [sessionId, fetchShares]
  );

  const handleChangePermission = useCallback(
    async (share: SessionShareResponse, mode: SharingMode) => {
      try {
        await updateSessionShare(sessionId, share.id, mode);
        fetchShares();
      } catch (err) {
        console.error('Failed to update permission:', err);
      }
    },
    [sessionId, fetchShares]
  );

  const onlineUsers = users.filter((u) => u.status === 'online' || u.status === 'busy');
  const offlineUsers = users.filter((u) => u.status === 'offline' || u.status === 'away');

  if (isLoading) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center py-8', className)}>
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        <p className="mt-2 text-sm text-text-muted">Loading collaborators...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center py-8 px-4', className)}>
        <p className="text-sm text-accent-error text-center">{error}</p>
        <button
          onClick={fetchShares}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded bg-overlay hover:bg-elevated text-text-secondary text-sm"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Collaborators</h2>
          <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
            {onlineUsers.length} online
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchShares}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={toggleSound}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title={soundEnabled ? 'Mute notifications' : 'Unmute notifications'}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Share Link Section */}
      <ShareLinkSection
        sessionId={sessionId}
        shareLink={sharesData?.share_link || null}
        shareLinkMode={sharesData?.share_link_mode || null}
        onRefresh={fetchShares}
      />

      {/* Invite Section */}
      <InviteSection sessionId={sessionId} onRefresh={fetchShares} />

      {/* Following indicator */}
      {followingUserId && (
        <div className="flex items-center justify-between px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/30">
          <div className="flex items-center gap-2 text-sm text-accent-primary">
            <Eye className="h-4 w-4" />
            <span>Following {users.find((u) => u.id === followingUserId)?.name}</span>
          </div>
          <button onClick={handleUnfollow} className="p-1 rounded hover:bg-accent-primary/20">
            <X className="h-4 w-4 text-accent-primary" />
          </button>
        </div>
      )}

      {/* User lists */}
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Online users */}
        {onlineUsers.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-muted px-3 py-1.5 flex items-center gap-1">
              <Circle className="h-2 w-2 fill-green-400 text-green-400" />
              Online ({onlineUsers.length})
            </h3>
            <div className="space-y-1">
              {onlineUsers.map((user) => {
                const share = sharesData?.shares.find(
                  (s) => s.shared_with_id === user.id || s.shared_with_email === user.email
                );
                return (
                  <UserCard
                    key={user.id}
                    user={user}
                    isCurrentUser={user.id === currentUserId}
                    isFollowing={followingUserId === user.id}
                    onFollow={() => handleFollow(user.id)}
                    onUnfollow={handleUnfollow}
                    onRemove={share ? () => handleRemoveUser(share) : undefined}
                    onChangePermission={
                      share ? (mode) => handleChangePermission(share, mode) : undefined
                    }
                    canManage={!user.isOwner && user.id !== currentUserId}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Offline/Invited users */}
        {offlineUsers.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-text-muted px-3 py-1.5 flex items-center gap-1">
              <Circle className="h-2 w-2 fill-gray-400 text-gray-400" />
              Invited ({offlineUsers.length})
            </h3>
            <div className="space-y-1">
              {offlineUsers.map((user) => {
                const share = sharesData?.shares.find(
                  (s) => s.shared_with_id === user.id || s.shared_with_email === user.email
                );
                return (
                  <UserCard
                    key={user.id}
                    user={user}
                    isCurrentUser={user.id === currentUserId}
                    isFollowing={false}
                    onFollow={() => {}}
                    onUnfollow={() => {}}
                    onRemove={share ? () => handleRemoveUser(share) : undefined}
                    onChangePermission={
                      share ? (mode) => handleChangePermission(share, mode) : undefined
                    }
                    canManage={true}
                  />
                );
              })}
            </div>
          </div>
        )}

        {users.length === 1 && (
          <div className="text-center py-6 text-text-muted">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No collaborators yet</p>
            <p className="text-xs mt-1">Invite others using the options above</p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-4 py-2 border-t border-border-subtle bg-elevated text-xs text-text-muted">
        Share this session to collaborate in real-time
      </div>
    </div>
  );
}
