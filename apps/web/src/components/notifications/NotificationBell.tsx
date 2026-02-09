'use client';

import { useEffect, useRef } from 'react';
import { Bell, Check, CheckCheck, ExternalLink, Trash2, X } from 'lucide-react';
import { useNotificationsStore, type AppNotification } from '@/stores/notifications';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: AppNotification;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  const typeStyles = {
    info: 'border-l-blue-500',
    warning: 'border-l-yellow-500',
    error: 'border-l-red-500',
    success: 'border-l-green-500',
  };

  return (
    <div
      className={cn(
        'px-4 py-3 border-l-2 hover:bg-elevated/50 transition-colors',
        typeStyles[notification.type],
        !notification.read && 'bg-elevated/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm font-medium truncate',
              notification.read ? 'text-text-secondary' : 'text-text-primary'
            )}
          >
            {notification.title}
          </p>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{notification.message}</p>
          <p className="text-xs text-text-muted mt-1">
            {formatDistanceToNow(new Date(notification.created_at), {
              addSuffix: true,
            })}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {notification.action_url && (
            <Link
              href={notification.action_url}
              className="p-1 text-text-muted hover:text-text-primary transition-colors"
              title={notification.action_label || 'View'}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
          {!notification.read && (
            <button
              onClick={onMarkRead}
              className="p-1 text-text-muted hover:text-accent-primary transition-colors"
              title="Mark as read"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 text-text-muted hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    isOpen,
    isLoading,
    toggle,
    setIsOpen,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotificationsStore();

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={toggle}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          'text-text-secondary hover:text-text-primary hover:bg-overlay',
          isOpen && 'bg-overlay text-text-primary'
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-accent-primary rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-h-[400px] overflow-hidden rounded-xl bg-surface border border-border-default shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <h3 className="font-medium text-text-primary">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-accent-primary hover:text-accent-hover transition-colors flex items-center gap-1"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto max-h-[320px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-muted">
                <Bell className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkRead={() => markAsRead(notification.id)}
                    onDelete={() => deleteNotification(notification.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-border-subtle">
              <Link
                href="/settings/notifications"
                className="text-xs text-text-muted hover:text-accent-primary transition-colors"
                onClick={() => setIsOpen(false)}
              >
                Notification settings
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
