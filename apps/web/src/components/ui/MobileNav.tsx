'use client';

import { useRouter, usePathname } from 'next/navigation';
import {
  X,
  Home,
  Settings,
  Plus,
  LogOut,
  User,
  Monitor,
  ChevronRight,
  FolderTree,
  GitBranch,
  Search,
  AlertCircle,
  Bot,
  Puzzle,
  BarChart3,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';

// Widget items for quick access
const widgetItems = [
  { id: 'files', label: 'Files', icon: <FolderTree className="h-4 w-4" /> },
  { id: 'git', label: 'Git', icon: <GitBranch className="h-4 w-4" /> },
  { id: 'search', label: 'Search', icon: <Search className="h-4 w-4" /> },
  { id: 'problems', label: 'Problems', icon: <AlertCircle className="h-4 w-4" /> },
  { id: 'agents', label: 'Agents', icon: <Bot className="h-4 w-4" /> },
  { id: 'mcp', label: 'MCP', icon: <Puzzle className="h-4 w-4" /> },
  { id: 'usage', label: 'Usage', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="h-4 w-4" /> },
];

// Mobile menu component (hamburger slide-out menu)
interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const sessions = useSessionStore((state) => state.sessions);
  const openMobileWidget = useUIStore((state) => state.openMobileWidget);

  // Get sessions as array, sorted by name
  const sessionsList = Object.values(sessions).sort((a, b) => a.name.localeCompare(b.name));

  // Check if currently viewing a session
  const currentSessionId = pathname?.startsWith('/session/') ? pathname.split('/')[2] : null;
  const isInSession = !!currentSessionId;

  const menuItems = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: <Home className="h-5 w-5" />,
    },
    {
      href: '/session/new',
      label: 'New Session',
      icon: <Plus className="h-5 w-5" />,
    },
    {
      href: '/settings',
      label: 'Settings',
      icon: <Settings className="h-5 w-5" />,
    },
  ];

  const handleNavigate = (href: string) => {
    router.push(href);
    onClose();
  };

  const handleLogout = async () => {
    await logout();
    onClose();
    router.push('/');
  };

  const handleOpenWidget = (widgetId: string) => {
    openMobileWidget(widgetId);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-50 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu panel - slides in from right */}
      <div
        className={cn(
          'fixed inset-y-0 right-0 z-50 md:hidden',
          'w-72 bg-surface border-l border-border-default',
          'animate-slide-in-right',
          'flex flex-col'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile menu"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-border-subtle">
          <span className="text-lg font-semibold text-text-primary">Menu</span>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* User info */}
        {user && (
          <div className="px-4 py-3 border-b border-border-subtle">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent-primary/20 flex items-center justify-center">
                <User className="h-5 w-5 text-accent-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {user.name || 'User'}
                </p>
                <p className="text-xs text-text-tertiary truncate">{user.email}</p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation items */}
        <nav className="py-2 border-b border-border-subtle">
          {menuItems.map((item) => (
            <button
              key={item.href}
              onClick={() => handleNavigate(item.href)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3',
                'text-left text-text-primary',
                'hover:bg-surface-hover active:bg-surface-active',
                'transition-colors touch-manipulation'
              )}
            >
              <span className="text-text-secondary">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Quick access widgets - only show when in a session */}
        {isInSession && (
          <div className="py-2 border-b border-border-subtle">
            <p className="px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">
              Tools
            </p>
            <div className="grid grid-cols-4 gap-1 px-3">
              {widgetItems.map((widget) => (
                <button
                  key={widget.id}
                  onClick={() => handleOpenWidget(widget.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-2 rounded-lg',
                    'hover:bg-surface-hover active:bg-surface-active',
                    'transition-colors touch-manipulation'
                  )}
                >
                  <span className="text-text-secondary">{widget.icon}</span>
                  <span className="text-2xs text-text-tertiary">{widget.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto">
          {sessionsList.length > 0 && (
            <div className="py-2">
              <p className="px-4 py-2 text-xs font-medium text-text-tertiary uppercase tracking-wide">
                Open Sessions
              </p>
              {sessionsList.map((session) => {
                const isActive = session.id === currentSessionId;
                const statusColor =
                  session.workspaceStatus === 'running'
                    ? 'bg-status-success'
                    : session.workspaceStatus === 'pending'
                      ? 'bg-status-warning animate-pulse'
                      : session.workspaceStatus === 'standby'
                        ? 'bg-status-warning'
                        : 'bg-status-error';

                return (
                  <button
                    key={session.id}
                    onClick={() => handleNavigate(`/session/${session.id}`)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3',
                      'text-left',
                      'hover:bg-surface-hover active:bg-surface-active',
                      'transition-colors touch-manipulation',
                      isActive && 'bg-accent-primary/10'
                    )}
                  >
                    <Monitor
                      className={cn(
                        'h-5 w-5',
                        isActive ? 'text-accent-primary' : 'text-text-secondary'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'font-medium truncate',
                          isActive ? 'text-accent-primary' : 'text-text-primary'
                        )}
                      >
                        {session.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={cn('w-1.5 h-1.5 rounded-full', statusColor)} />
                        <span className="text-xs text-text-tertiary">{session.branch}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-text-tertiary flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border-subtle p-4">
          <button
            onClick={handleLogout}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-lg',
              'text-status-error hover:bg-status-error/10',
              'transition-colors touch-manipulation'
            )}
          >
            <LogOut className="h-5 w-5" />
            <span className="font-medium">Log out</span>
          </button>
        </div>

        {/* Safe area */}
        <div className="h-safe-bottom" />
      </div>
    </>
  );
}

// Bottom sheet component for mobile modals
interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  height?: 'half' | 'full';
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  height = 'full',
}: BottomSheetProps) {
  if (!isOpen) return null;

  const heightClass = height === 'half' ? 'max-h-[50vh]' : 'max-h-[85vh]';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 md:hidden',
          'bg-surface border-t border-border-default rounded-t-2xl',
          'animate-slide-in-bottom',
          heightClass,
          'overflow-hidden flex flex-col'
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-border-strong rounded-full" />
        </div>

        {/* Header */}
        {title && (
          <div className="px-4 pb-3 border-b border-border-subtle flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
              <button
                onClick={onClose}
                className="p-2 -mr-2 rounded-lg hover:bg-surface-hover transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-text-secondary" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {/* Safe area */}
        <div className="h-safe-bottom flex-shrink-0" />
      </div>
    </>
  );
}

// Floating action button for mobile
interface FloatingActionButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
  expanded?: boolean;
}

export function FloatingActionButton({
  onClick,
  icon,
  label,
  className,
  expanded = false,
}: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed z-40 md:hidden',
        'flex items-center justify-center gap-2',
        expanded ? 'px-4 h-12 rounded-full' : 'w-14 h-14 rounded-full',
        'bg-accent-primary text-text-inverse',
        'shadow-glow hover:shadow-glow-intense',
        'transition-all duration-200',
        'touch-manipulation',
        'focus-ring',
        className
      )}
      aria-label={label}
    >
      {icon}
      {expanded && <span className="font-medium">{label}</span>}
    </button>
  );
}

// Pull to refresh indicator
interface PullToRefreshProps {
  isRefreshing: boolean;
  progress: number; // 0-1
}

export function PullToRefreshIndicator({ isRefreshing, progress }: PullToRefreshProps) {
  if (progress === 0 && !isRefreshing) return null;

  return (
    <div
      className={cn(
        'absolute top-0 left-1/2 -translate-x-1/2 z-30',
        'flex items-center justify-center',
        'w-10 h-10 rounded-full bg-surface border border-border-default',
        'transition-all duration-200'
      )}
      style={{
        transform: `translateX(-50%) translateY(${Math.min(progress * 60, 60)}px)`,
        opacity: Math.min(progress, 1),
      }}
    >
      <div
        className={cn(
          'w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full',
          isRefreshing && 'animate-spin'
        )}
        style={{
          transform: isRefreshing ? undefined : `rotate(${progress * 360}deg)`,
        }}
      />
    </div>
  );
}

// Swipeable list item
interface SwipeableItemProps {
  children: React.ReactNode;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
  className?: string;
}

export function SwipeableItem({
  children,
  leftAction,
  rightAction,
  className,
}: SwipeableItemProps) {
  return (
    <div className={cn('relative overflow-hidden', className)}>
      {/* Left action (swipe right to reveal) */}
      {leftAction && <div className="swipe-action-right">{leftAction}</div>}

      {/* Right action (swipe left to reveal) */}
      {rightAction && <div className="swipe-action-left">{rightAction}</div>}

      {/* Content */}
      <div className="relative bg-surface touch-manipulation">{children}</div>
    </div>
  );
}

// Hook for mobile menu state
export function useMobileMenu() {
  const isOpen = useUIStore((state) => state.isMobileMenuOpen);
  const setOpen = useUIStore((state) => state.setMobileMenuOpen);
  const toggle = useUIStore((state) => state.toggleMobileMenu);

  return {
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle,
  };
}
