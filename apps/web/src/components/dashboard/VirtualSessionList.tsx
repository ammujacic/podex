'use client';

import { useRef, useCallback, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { Pin, PinOff, Trash2, Clock, Bot, Star, GitBranch } from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import { undoableAction, showError } from '@/lib/toast';

interface Session {
  id: string;
  name: string;
  branch?: string;
  lastAccessed: Date;
  agentCount: number;
  isPinned: boolean;
  status: 'active' | 'stopped' | 'error';
  tokensUsed?: number;
}

interface VirtualSessionListProps {
  sessions: Session[];
  onPin: (id: string) => Promise<void>;
  onUnpin: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  viewMode?: 'grid' | 'list';
  className?: string;
}

export function VirtualSessionList({
  sessions,
  onPin,
  onUnpin,
  onDelete,
  viewMode = 'grid',
  className,
}: VirtualSessionListProps) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);

  // Calculate row height based on view mode
  const estimateSize = useCallback(() => {
    return viewMode === 'grid' ? 180 : 80;
  }, [viewMode]);

  // For grid view, calculate how many items per row
  const itemsPerRow = viewMode === 'grid' ? 3 : 1;

  // Group sessions into rows for grid view
  const rows = useMemo(() => {
    if (viewMode === 'list') return sessions.map((s) => [s]);

    const result: Session[][] = [];
    for (let i = 0; i < sessions.length; i += itemsPerRow) {
      result.push(sessions.slice(i, i + itemsPerRow));
    }
    return result;
  }, [sessions, viewMode, itemsPerRow]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 5,
  });

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      router.push(`/session/${sessionId}`);
    },
    [router]
  );

  const handlePinToggle = useCallback(
    async (session: Session, e: React.MouseEvent) => {
      e.stopPropagation();

      if (session.isPinned) {
        await undoableAction({
          action: () => onUnpin(session.id),
          undo: () => onPin(session.id),
          message: `Unpinned "${session.name}"`,
          undoMessage: `"${session.name}" pinned again`,
        });
      } else {
        await undoableAction({
          action: () => onPin(session.id),
          undo: () => onUnpin(session.id),
          message: `Pinned "${session.name}"`,
          undoMessage: `"${session.name}" unpinned`,
        });
      }
    },
    [onPin, onUnpin]
  );

  const handleDelete = useCallback(
    async (session: Session, e: React.MouseEvent) => {
      e.stopPropagation();

      // Store session data for potential undo (in a real app you'd need proper restore)
      await undoableAction({
        action: () => onDelete(session.id),
        undo: () => {
          showError('Cannot restore deleted session');
          return Promise.resolve();
        },
        message: `Deleted "${session.name}"`,
        undoMessage: 'Deletion cannot be undone',
      });
    },
    [onDelete]
  );

  // Memoized formatters to prevent SessionCard re-renders
  const formatTimeAgo = useCallback((date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }, []);

  const formatTokens = useCallback((tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  }, []);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto', viewMode === 'grid' ? 'h-[600px]' : 'h-[400px]', className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowSessions = rows[virtualRow.index];
          if (!rowSessions) return null;

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={cn(
                viewMode === 'grid'
                  ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-1'
                  : 'px-1'
              )}
            >
              {rowSessions.map((session) => (
                <VirtualSessionCard
                  key={session.id}
                  session={session}
                  viewMode={viewMode}
                  onClick={() => handleSessionClick(session.id)}
                  onPinToggle={(e) => handlePinToggle(session, e)}
                  onDelete={(e) => handleDelete(session, e)}
                  formatTimeAgo={formatTimeAgo}
                  formatTokens={formatTokens}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SessionCardProps {
  session: Session;
  viewMode: 'grid' | 'list';
  onClick: () => void;
  onPinToggle: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  formatTimeAgo: (date: Date) => string;
  formatTokens: (tokens: number) => string;
}

// Memoized status colors - defined outside component
const statusColors = {
  active: 'bg-accent-success',
  stopped: 'bg-text-muted',
  error: 'bg-accent-error',
} as const;

const VirtualSessionCard = memo(function VirtualSessionCard({
  session,
  viewMode,
  onClick,
  onPinToggle,
  onDelete,
  formatTimeAgo,
  formatTokens,
}: SessionCardProps) {
  if (viewMode === 'list') {
    return (
      <div
        onClick={onClick}
        className={cn(
          'flex items-center gap-4 p-4 bg-surface border border-border-default rounded-lg',
          'hover:border-border-strong hover:shadow-panel transition-all cursor-pointer',
          'min-h-touch'
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClick()}
      >
        {/* Status indicator */}
        <div className={cn('w-2.5 h-2.5 rounded-full', statusColors[session.status])} />

        {/* Session info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-text-primary truncate">{session.name}</h3>
            {session.isPinned && (
              <Star className="w-4 h-4 text-accent-warning fill-accent-warning" />
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-text-muted mt-0.5">
            {session.branch && (
              <span className="flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                {session.branch}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(session.lastAccessed)}
            </span>
          </div>
        </div>

        {/* Agents count */}
        <div className="flex items-center gap-1 text-sm text-text-secondary">
          <Bot className="w-4 h-4" />
          {session.agentCount}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPinToggle}
            aria-label={session.isPinned ? 'Unpin session' : 'Pin session'}
          >
            {session.isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete session"
            className="hover:text-accent-error"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Grid view card
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex flex-col p-4 bg-surface border border-border-default rounded-xl',
        'hover:border-border-strong hover:shadow-panel transition-all cursor-pointer',
        'card-interactive h-full'
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', statusColors[session.status])} />
          {session.isPinned && <Star className="w-4 h-4 text-accent-warning fill-accent-warning" />}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPinToggle}
            className="h-8 w-8 p-0"
            aria-label={session.isPinned ? 'Unpin session' : 'Pin session'}
          >
            {session.isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="h-8 w-8 p-0 hover:text-accent-error"
            aria-label="Delete session"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Title */}
      <h3 className="font-medium text-text-primary mb-1 truncate">{session.name}</h3>

      {/* Branch */}
      {session.branch && (
        <div className="flex items-center gap-1 text-sm text-text-muted mb-3">
          <GitBranch className="w-3 h-3" />
          <span className="truncate">{session.branch}</span>
        </div>
      )}

      {/* Footer */}
      <div className="mt-auto pt-3 flex items-center justify-between text-sm text-text-muted">
        <div className="flex items-center gap-1">
          <Bot className="w-4 h-4" />
          <span>{session.agentCount} agents</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{formatTimeAgo(session.lastAccessed)}</span>
        </div>
      </div>

      {/* Tokens used */}
      {session.tokensUsed !== undefined && (
        <div className="mt-2 text-xs text-text-muted">
          {formatTokens(session.tokensUsed)} tokens used
        </div>
      )}
    </div>
  );
});
