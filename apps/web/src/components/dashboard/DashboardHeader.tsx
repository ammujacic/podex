'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Bell, ChevronDown, HelpCircle, LogOut, Plus, Settings, User } from 'lucide-react';
import { Button } from '@podex/ui';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: Date;
}

interface DashboardHeaderProps {
  notifications: Notification[];
  onMarkNotificationRead: (id: string) => void;
  onMarkAllRead: () => void;
  onNewPod: () => void;
}

export function DashboardHeader({
  notifications,
  onMarkNotificationRead,
  onMarkAllRead,
  onNewPod,
}: DashboardHeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <header
      className="sticky top-0 z-sticky bg-void/80 backdrop-blur-lg border-b border-border-subtle"
      data-tour="dashboard-header"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Logo */}
          <Logo href="/dashboard" />

          {/* Right actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Help */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:flex"
              onClick={() => window.open('https://docs.podex.dev', '_blank')}
              aria-label="Help"
            >
              <HelpCircle className="w-5 h-5" />
            </Button>

            {/* Notifications */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                aria-expanded={showNotifications}
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-accent-error rounded-full" />
                )}
              </Button>

              {/* Notifications dropdown */}
              {showNotifications && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowNotifications(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-surface border border-border-default rounded-xl shadow-dropdown z-20 animate-dropdown-enter">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                      <h3 className="font-medium text-text-primary">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          onClick={onMarkAllRead}
                          className="text-sm text-accent-primary hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-text-muted text-sm">
                          No notifications
                        </div>
                      ) : (
                        notifications.slice(0, 10).map((notification) => (
                          <button
                            key={notification.id}
                            onClick={() => onMarkNotificationRead(notification.id)}
                            className={cn(
                              'w-full text-left px-4 py-3 hover:bg-overlay transition-colors',
                              !notification.read && 'bg-elevated'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className={cn(
                                  'w-2 h-2 mt-2 rounded-full flex-shrink-0',
                                  notification.type === 'success' && 'bg-accent-success',
                                  notification.type === 'error' && 'bg-accent-error',
                                  notification.type === 'warning' && 'bg-accent-warning',
                                  notification.type === 'info' && 'bg-accent-primary'
                                )}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-text-primary truncate">
                                  {notification.title}
                                </p>
                                <p className="text-sm text-text-muted truncate">
                                  {notification.message}
                                </p>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Settings */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/settings')}
              aria-label="Settings"
            >
              <Settings className="w-5 h-5" />
            </Button>

            {/* New Pod button */}
            <Button onClick={onNewPod} className="hidden sm:flex" data-tour="new-session-btn">
              <Plus className="w-4 h-4" />
              <span className="hidden md:inline">New Pod</span>
            </Button>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-overlay transition-colors"
                aria-expanded={showUserMenu}
                aria-label="User menu"
              >
                <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center overflow-hidden">
                  {user?.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name || 'User'}
                      width={32}
                      height={32}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-4 h-4 text-text-muted" />
                  )}
                </div>
                <ChevronDown className="w-4 h-4 text-text-muted hidden sm:block" />
              </button>

              {/* User dropdown */}
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-surface border border-border-default rounded-xl shadow-dropdown z-20 animate-dropdown-enter">
                    <div className="px-4 py-3 border-b border-border-subtle">
                      <p className="font-medium text-text-primary truncate">
                        {user?.name || 'User'}
                      </p>
                      <p className="text-sm text-text-muted truncate">{user?.email}</p>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setShowUserMenu(false);
                          router.push('/settings');
                        }}
                        className="dropdown-item w-full"
                      >
                        <Settings className="w-4 h-4" />
                        Settings
                      </button>
                      <button
                        onClick={handleLogout}
                        className="dropdown-item w-full text-accent-error"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
