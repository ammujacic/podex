'use client';

import { useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Users, Circle, Eye, FileCode, X, Volume2, VolumeX, Loader2, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePresenceStore, type UserPresence, type UserStatus } from './PresencePanel';
import { useAuthStore } from '@/stores/auth';
import { listSessionShares } from '@/lib/api';

interface PresenceSidebarPanelProps {
  sessionId: string;
}

function StatusDot({ status }: { status: UserStatus }) {
  const colors = {
    online: 'bg-green-400',
    away: 'bg-yellow-400',
    busy: 'bg-red-400',
    offline: 'bg-gray-400',
  };

  return <span className={cn('w-2 h-2 rounded-full', colors[status])} />;
}

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

function CompactUserAvatar({ user, size = 24 }: { user: UserPresence; size?: number }) {
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
          width={size}
          height={size}
          className="rounded-full object-cover"
        />
      ) : (
        <div
          className="rounded-full flex items-center justify-center text-white text-[10px] font-medium"
          style={{ backgroundColor: user.color, width: size, height: size }}
        >
          {initials}
        </div>
      )}
      <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-surface rounded-full">
        <StatusDot status={user.status} />
      </div>
    </div>
  );
}

function CompactUserCard({
  user,
  isCurrentUser,
  isFollowing,
  onFollow,
  onUnfollow,
}: {
  user: UserPresence;
  isCurrentUser: boolean;
  isFollowing: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded transition-colors group',
        isFollowing && 'bg-accent-primary/10'
      )}
    >
      <CompactUserAvatar user={user} size={20} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-primary truncate">{user.name}</span>
          {isCurrentUser && <span className="text-[10px] text-text-muted">(you)</span>}
          {user.isOwner && !isCurrentUser && (
            <span className="text-[10px] text-accent-primary">(owner)</span>
          )}
          {user.isTyping && (
            <span className="text-[10px] text-accent-primary animate-pulse">...</span>
          )}
        </div>
        {user.currentFile && (
          <div className="flex items-center gap-1 text-[10px] text-text-muted">
            <FileCode className="h-2.5 w-2.5" />
            <span className="truncate">{user.currentFile.split('/').pop()}</span>
          </div>
        )}
      </div>
      {!isCurrentUser && user.status !== 'offline' && (
        <button
          onClick={isFollowing ? onUnfollow : onFollow}
          className={cn(
            'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity',
            isFollowing
              ? 'bg-accent-primary text-void'
              : 'text-text-muted hover:text-text-primary hover:bg-overlay'
          )}
          title={isFollowing ? 'Stop following' : 'Follow'}
        >
          <Eye className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function PresenceSidebarPanel({ sessionId }: PresenceSidebarPanelProps) {
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

  // Load users from API if not already loaded
  useEffect(() => {
    const loadUsers = async () => {
      // Skip if users are already loaded (by PresencePanel)
      if (users.length > 0) return;

      try {
        const data = await listSessionShares(sessionId);

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
            status: 'offline',
            color: getRandomColor(userId),
            lastActive: new Date(share.created_at),
            sharingMode: share.sharing_mode,
          });
        });

        setUsers(presenceUsers);
      } catch (error) {
        console.error('Failed to load collaborators:', error);
        // Set at least the current user
        if (authUser) {
          setUsers([
            {
              id: authUser.id,
              name: authUser.name || 'You',
              email: authUser.email,
              avatar: authUser.avatarUrl || undefined,
              status: 'online',
              color: getRandomColor(authUser.id),
              lastActive: new Date(),
              isOwner: true,
              sharingMode: 'full_control',
            },
          ]);
          setCurrentUserId(authUser.id);
        }
      }
    };

    loadUsers();
  }, [sessionId, authUser, users.length, setUsers, setCurrentUserId]);

  const handleFollow = useCallback(
    (userId: string) => setFollowingUserId(userId),
    [setFollowingUserId]
  );

  const handleUnfollow = useCallback(() => setFollowingUserId(null), [setFollowingUserId]);

  const onlineUsers = users.filter((u) => u.status === 'online' || u.status === 'busy');
  const offlineUsers = users.filter((u) => u.status === 'away' || u.status === 'offline');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-accent-primary" />
          <span className="text-xs text-success bg-success/20 px-1.5 py-0.5 rounded">
            {onlineUsers.length} online
          </span>
        </div>
        <button
          onClick={toggleSound}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
          title={soundEnabled ? 'Mute' : 'Unmute'}
        >
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Following indicator */}
      {followingUserId && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-accent-primary/10 border-b border-accent-primary/30">
          <div className="flex items-center gap-1 text-xs text-accent-primary">
            <Eye className="h-3 w-3" />
            <span>Following {users.find((u) => u.id === followingUserId)?.name}</span>
          </div>
          <button onClick={handleUnfollow} className="p-0.5 rounded hover:bg-accent-primary/20">
            <X className="h-3 w-3 text-accent-primary" />
          </button>
        </div>
      )}

      {/* User lists */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Online users */}
        {onlineUsers.length > 0 && (
          <div className="px-2">
            <div className="flex items-center gap-1 px-1 py-1 text-[10px] text-text-muted">
              <Circle className="h-1.5 w-1.5 fill-green-400 text-green-400" />
              Online ({onlineUsers.length})
            </div>
            <div className="space-y-0.5">
              {onlineUsers.map((user) => (
                <CompactUserCard
                  key={user.id}
                  user={user}
                  isCurrentUser={user.id === currentUserId || user.isOwner === true}
                  isFollowing={followingUserId === user.id}
                  onFollow={() => handleFollow(user.id)}
                  onUnfollow={handleUnfollow}
                />
              ))}
            </div>
          </div>
        )}

        {/* Invited/Offline users */}
        {offlineUsers.length > 0 && (
          <div className="px-2 mt-2">
            <div className="flex items-center gap-1 px-1 py-1 text-[10px] text-text-muted">
              <Circle className="h-1.5 w-1.5 fill-gray-400 text-gray-400" />
              Invited ({offlineUsers.length})
            </div>
            <div className="space-y-0.5">
              {offlineUsers.map((user) => (
                <CompactUserCard
                  key={user.id}
                  user={user}
                  isCurrentUser={user.id === currentUserId}
                  isFollowing={followingUserId === user.id}
                  onFollow={() => handleFollow(user.id)}
                  onUnfollow={handleUnfollow}
                />
              ))}
            </div>
          </div>
        )}

        {users.length === 0 && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
          </div>
        )}

        {users.length === 1 && (
          <div className="text-center py-4 px-3">
            <p className="text-[10px] text-text-muted">No collaborators yet</p>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-border-subtle text-[10px] text-text-muted text-center flex items-center justify-center gap-1">
        <Link2 className="h-3 w-3" />
        Click header to share
      </div>
    </div>
  );
}
