import { useState, useEffect, useCallback, useRef } from 'react';
import { usePresenceStore, type UserPresence } from '@/components/workspace/PresencePanel';

// ============================================================================
// Types
// ============================================================================

export interface FollowModeState {
  isFollowing: boolean;
  followedUser: UserPresence | null;
  followedFile: string | null;
  followedLine: number | null;
}

export interface FollowModeActions {
  startFollowing: (userId: string) => void;
  stopFollowing: () => void;
  toggleFollowing: (userId: string) => void;
}

export interface UseFollowModeOptions {
  onFileChange?: (filePath: string) => void;
  onLineChange?: (line: number) => void;
  onScrollToLine?: (line: number) => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useFollowMode(
  options: UseFollowModeOptions = {}
): FollowModeState & FollowModeActions {
  const { onFileChange, onLineChange, onScrollToLine } = options;

  const { users, followingUserId, setFollowingUserId } = usePresenceStore();

  const [followedFile, setFollowedFile] = useState<string | null>(null);
  const [followedLine, setFollowedLine] = useState<number | null>(null);

  const previousFileRef = useRef<string | null>(null);
  const previousLineRef = useRef<number | null>(null);

  // Get followed user
  const followedUser = followingUserId ? users.find((u) => u.id === followingUserId) || null : null;

  // Track followed user's position
  useEffect(() => {
    if (!followedUser) {
      setFollowedFile(null);
      setFollowedLine(null);
      return;
    }

    const newFile = followedUser.currentFile || null;
    const newLine = followedUser.cursorLine || null;

    // File changed
    if (newFile !== previousFileRef.current) {
      previousFileRef.current = newFile;
      setFollowedFile(newFile);
      if (newFile && onFileChange) {
        onFileChange(newFile);
      }
    }

    // Line changed
    if (newLine !== previousLineRef.current) {
      previousLineRef.current = newLine;
      setFollowedLine(newLine);
      if (newLine) {
        onLineChange?.(newLine);
        onScrollToLine?.(newLine);
      }
    }
  }, [followedUser, onFileChange, onLineChange, onScrollToLine]);

  // Start following a user
  const startFollowing = useCallback(
    (userId: string) => {
      setFollowingUserId(userId);
    },
    [setFollowingUserId]
  );

  // Stop following
  const stopFollowing = useCallback(() => {
    setFollowingUserId(null);
    setFollowedFile(null);
    setFollowedLine(null);
    previousFileRef.current = null;
    previousLineRef.current = null;
  }, [setFollowingUserId]);

  // Toggle following
  const toggleFollowing = useCallback(
    (userId: string) => {
      if (followingUserId === userId) {
        stopFollowing();
      } else {
        startFollowing(userId);
      }
    },
    [followingUserId, startFollowing, stopFollowing]
  );

  return {
    isFollowing: !!followingUserId,
    followedUser,
    followedFile,
    followedLine,
    startFollowing,
    stopFollowing,
    toggleFollowing,
  };
}

// ============================================================================
// Follow Mode Banner Component
// ============================================================================

import { Eye, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FollowModeBannerProps {
  user: UserPresence;
  onStopFollowing: () => void;
  className?: string;
}

export function FollowModeBanner({ user, onStopFollowing, className }: FollowModeBannerProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2 bg-accent-primary/10 border-b border-accent-primary/30',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Eye className="h-4 w-4 text-accent-primary" />
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
            style={{ backgroundColor: user.color }}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm text-accent-primary">
            Following <strong>{user.name}</strong>
          </span>
        </div>
        {user.currentFile && (
          <span className="text-xs text-text-muted">
            in {user.currentFile.split('/').pop()}
            {user.cursorLine && `:${user.cursorLine}`}
          </span>
        )}
      </div>

      <button
        onClick={onStopFollowing}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary"
      >
        <X className="h-3 w-3" />
        Stop Following
      </button>
    </div>
  );
}
