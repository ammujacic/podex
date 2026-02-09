'use client';

import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileMenu, useMobileMenu } from './MobileNav';
import { Logo } from './Logo';

interface MobileHeaderProps {
  title?: string;
  showLogo?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function MobileHeader({ title, showLogo = true, className, children }: MobileHeaderProps) {
  const { isOpen, open, close } = useMobileMenu();

  return (
    <>
      <header
        className={cn(
          'md:hidden sticky top-0 z-30',
          'h-14 px-4 flex items-center justify-between',
          'bg-surface/95 backdrop-blur-sm border-b border-border-subtle',
          className
        )}
      >
        {/* Left side - Logo or title */}
        <div className="flex items-center gap-3">
          {showLogo ? (
            <Logo size="sm" href="/dashboard" />
          ) : title ? (
            <h1 className="text-lg font-semibold text-text-primary truncate">{title}</h1>
          ) : null}
        </div>

        {/* Center - Optional children */}
        {children && <div className="flex-1 flex justify-center px-4">{children}</div>}

        {/* Right side - Hamburger menu */}
        <button
          onClick={open}
          className={cn(
            'p-2 -mr-2 rounded-lg',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6 text-text-primary" />
        </button>
      </header>

      {/* Mobile menu */}
      <MobileMenu isOpen={isOpen} onClose={close} />
    </>
  );
}
