'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, Plus, Settings, LayoutGrid, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  useUIStore();

  const navItems: NavItem[] = [
    {
      href: '/dashboard',
      label: 'Home',
      icon: <Home className="h-5 w-5" />,
    },
    {
      href: '/dashboard',
      label: 'Sessions',
      icon: <LayoutGrid className="h-5 w-5" />,
    },
    {
      href: '#',
      label: 'New',
      icon: <Plus className="h-6 w-6" />,
      onClick: () => {
        router.push('/session/new');
      },
    },
    {
      href: '/agents',
      label: 'Agents',
      icon: <Bot className="h-5 w-5" />,
    },
    {
      href: '/settings',
      label: 'Settings',
      icon: <Settings className="h-5 w-5" />,
    },
  ];

  const isActive = (href: string) => {
    if (href === '#') return false;
    if (href === '/dashboard' && pathname === '/dashboard') return true;
    if (href !== '/dashboard' && pathname.startsWith(href)) return true;
    return false;
  };

  return (
    <nav className="mobile-nav md:hidden" role="navigation" aria-label="Mobile navigation">
      <div className="flex items-center justify-around">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const isNewButton = item.label === 'New';

          return (
            <button
              key={item.label}
              onClick={() => {
                if (item.onClick) {
                  item.onClick();
                } else {
                  router.push(item.href);
                }
              }}
              className={cn(
                'mobile-nav-item touch-manipulation',
                active && 'active',
                isNewButton && 'relative'
              )}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              {isNewButton ? (
                <div className="flex items-center justify-center w-12 h-12 -mt-6 rounded-full bg-accent-primary text-text-inverse shadow-glow">
                  {item.icon}
                </div>
              ) : (
                <>
                  {item.icon}
                  <span className="text-2xs font-medium">{item.label}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Safe area spacer for iOS */}
      <div className="h-safe-bottom" />
    </nav>
  );
}

// Bottom sheet component for mobile modals
interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  if (!isOpen) return null;

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
          'max-h-[85vh] overflow-hidden'
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-border-strong rounded-full" />
        </div>

        {/* Header */}
        {title && (
          <div className="px-4 pb-3 border-b border-border-subtle">
            <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(85vh-80px)] overscroll-contain">{children}</div>

        {/* Safe area */}
        <div className="h-safe-bottom" />
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
}

export function FloatingActionButton({
  onClick,
  icon,
  label,
  className,
}: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'fixed right-4 bottom-20 md:bottom-6 z-40',
        'flex items-center justify-center',
        'w-14 h-14 rounded-full',
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
  _onSwipeLeft?: () => void;
  _onSwipeRight?: () => void;
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
  // This is a simplified version - in production you'd use a library like react-swipeable
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
