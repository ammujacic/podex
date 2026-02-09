'use client';

import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAttentionTypeStyles, getAttentionTypeLabel, type AttentionType } from '@/lib/ui-utils';

interface AttentionBadgeProps {
  type: AttentionType;
  count?: number;
  hasUnread?: boolean;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
}

/**
 * Shared attention badge component for displaying notifications/alerts.
 * Used across mobile and desktop components for consistent styling.
 */
export function AttentionBadge({
  type,
  count = 0,
  hasUnread = false,
  showLabel = true,
  size = 'md',
  onClick,
  className,
}: AttentionBadgeProps) {
  const styles = getAttentionTypeStyles(type);
  const label = getAttentionTypeLabel(type);

  const sizeClasses = {
    sm: 'text-2xs px-1 py-0.5',
    md: 'text-xs px-1.5 py-0.5',
    lg: 'text-sm px-2 py-1',
  };

  const iconSizes = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  };

  const content = (
    <>
      <Bell className={iconSizes[size]} aria-hidden="true" />
      {showLabel && label && <span>{label}</span>}
      {count > 0 && <span className="font-semibold">{count > 99 ? '99+' : count}</span>}
      {hasUnread && (
        <span
          className={cn(
            'rounded-full bg-orange-400',
            size === 'sm' ? 'h-1 w-1' : 'h-1.5 w-1.5',
            hasUnread && 'animate-pulse'
          )}
          aria-label="Unread notifications"
        />
      )}
    </>
  );

  const baseClasses = cn(
    'inline-flex items-center gap-1 rounded font-medium transition-colors',
    sizeClasses[size],
    styles.bg,
    styles.text,
    hasUnread && 'animate-pulse',
    className
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={cn(
          baseClasses,
          'hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-offset-1'
        )}
        aria-label={`${count} ${label} notifications${hasUnread ? ', unread' : ''}`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={baseClasses} role="status" aria-label={`${count} ${label} notifications`}>
      {content}
    </span>
  );
}

/**
 * Avatar badge overlay for agent cards
 */
interface AvatarAttentionBadgeProps {
  count: number;
  hasUnread?: boolean;
}

export function AvatarAttentionBadge({ count, hasUnread = false }: AvatarAttentionBadgeProps) {
  if (count === 0 && !hasUnread) return null;

  return (
    <span
      className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center"
      role="status"
      aria-label={`${count} notifications${hasUnread ? ', unread' : ''}`}
    >
      {hasUnread && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75"
          aria-hidden="true"
        />
      )}
      <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
        {count > 9 ? '9+' : count}
      </span>
    </span>
  );
}
