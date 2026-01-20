'use client';

import { useCallback } from 'react';
import {
  File,
  Folder,
  FolderOpen,
  Trash2,
  Copy,
  CloudSync,
  ChevronRight,
  ChevronDown,
  Loader2,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSwipeableItem, triggerHaptic, useLongPress } from '@/hooks/useGestures';
import { useUIStore } from '@/stores/ui';
import type { FileNode } from '@/lib/api';

function isHiddenFile(name: string): boolean {
  return name.startsWith('.');
}

interface SyncInfo {
  isSynced: boolean;
  syncType: 'user' | 'session' | null;
}

interface MobileFileItemProps {
  item: FileNode;
  depth: number;
  sessionId: string;
  onFileClick: (path: string) => void;
  onDelete?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  isExpanded?: boolean;
  isLoading?: boolean;
  onToggleFolder?: () => void;
  children?: React.ReactNode;
  getSyncInfo?: (path: string) => SyncInfo;
  onToggleSync?: (path: string) => void;
  isExpandable?: boolean;
}

export function MobileFileItem({
  item,
  depth,
  sessionId: _sessionId,
  onFileClick,
  onDelete,
  onCopyPath,
  isExpanded = false,
  isLoading = false,
  onToggleFolder,
  children,
  getSyncInfo,
  onToggleSync: _onToggleSync,
  isExpandable = true,
}: MobileFileItemProps) {
  const openMobileFileActions = useUIStore((state) => state.openMobileFileActions);
  const syncInfo = getSyncInfo
    ? getSyncInfo(item.path || item.name || '')
    : { isSynced: false, syncType: null };
  const paddingLeft = 12 + depth * 16;

  // Handle swipe gestures
  const handleSwipeLeft = useCallback(() => {
    // Swipe left reveals delete action
    if (onDelete) {
      onDelete(item.path);
    }
  }, [item.path, onDelete]);

  const handleSwipeRight = useCallback(() => {
    // Swipe right copies path
    if (onCopyPath) {
      onCopyPath(item.path);
    }
  }, [item.path, onCopyPath]);

  const { ref, offset, isSwiping, style } = useSwipeableItem<HTMLDivElement>({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    swipeThreshold: 80,
    maxSwipeDistance: 100,
    hapticFeedback: true,
  });

  // Handle long press to open actions sheet
  const handleLongPress = useCallback(() => {
    triggerHaptic('medium');
    openMobileFileActions(item.path, item.name, item.type === 'directory' ? 'directory' : 'file');
  }, [item.path, item.name, item.type, openMobileFileActions]);

  const { ref: longPressRef, isPressed } = useLongPress<HTMLButtonElement>({
    onLongPress: handleLongPress,
    delay: 500,
  });

  // Update action visibility based on swipe offset
  const leftVisible = offset > 40;
  const rightVisible = offset < -40;

  // Handle click
  const handleClick = useCallback(() => {
    if (item.type === 'directory') {
      onToggleFolder?.();
    } else {
      onFileClick(item.path);
    }
  }, [item.type, item.path, onFileClick, onToggleFolder]);

  // Combine refs
  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref]
  );

  const isDirectory = item.type === 'directory';
  const isHidden = isHiddenFile(item.name);

  return (
    <div className="relative overflow-hidden">
      {/* Left action indicator (copy path) */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 flex items-center justify-start pl-4 w-24',
          'bg-accent-primary transition-opacity',
          leftVisible ? 'opacity-100' : 'opacity-0'
        )}
      >
        <Copy className="w-5 h-5 text-white" />
        <span className="ml-1 text-xs text-white font-medium">Copy</span>
      </div>

      {/* Right action indicator (delete) */}
      <div
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-end pr-4 w-24',
          'bg-red-500 transition-opacity',
          rightVisible ? 'opacity-100' : 'opacity-0'
        )}
      >
        <span className="mr-1 text-xs text-white font-medium">Delete</span>
        <Trash2 className="w-5 h-5 text-white" />
      </div>

      {/* Main content with swipe transform */}
      <div
        ref={combinedRef}
        style={style}
        className={cn('relative bg-surface', isSwiping && 'z-10')}
      >
        <button
          ref={longPressRef}
          onClick={handleClick}
          className={cn(
            'flex w-full items-center gap-2 py-3 pr-3 text-left text-sm',
            'active:bg-surface-hover touch-manipulation',
            isPressed && 'bg-surface-hover',
            'border-b border-border-subtle',
            isHidden ? 'text-text-secondary' : 'text-text-primary'
          )}
          style={{ paddingLeft }}
        >
          {/* Folder chevron or file indent */}
          {isDirectory ? (
            <span className="shrink-0 w-5 h-5 flex items-center justify-center">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
              ) : isExpandable ? (
                isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                )
              ) : null}
            </span>
          ) : (
            <span className="shrink-0 w-5" />
          )}

          {/* Icon */}
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen className="h-5 w-5 text-accent-primary shrink-0" />
            ) : (
              <Folder className="h-5 w-5 text-accent-primary shrink-0" />
            )
          ) : (
            <File className="h-5 w-5 text-text-muted shrink-0" />
          )}

          {/* Name */}
          <span
            className={cn(
              'truncate flex-1',
              isHidden ? 'text-text-secondary' : 'text-text-primary'
            )}
          >
            {item.name}
          </span>

          {/* Sync indicator */}
          {syncInfo.isSynced && (
            <CloudSync
              className={cn(
                'h-4 w-4 shrink-0 opacity-70',
                syncInfo.syncType === 'user' ? 'text-blue-500' : 'text-accent-secondary'
              )}
              aria-label={
                syncInfo.syncType === 'user' ? 'Synced to user account' : 'Auto-synced by Podex'
              }
            />
          )}

          {/* More actions button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('light');
              openMobileFileActions(
                item.path,
                item.name,
                item.type === 'directory' ? 'directory' : 'file'
              );
            }}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-hover touch-manipulation"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-5 w-5 text-text-muted" />
          </button>
        </button>
      </div>

      {/* Render children (nested items for directories) */}
      {isDirectory && isExpanded && children}
    </div>
  );
}
