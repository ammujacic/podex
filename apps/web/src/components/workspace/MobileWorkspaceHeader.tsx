'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Menu, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { MobileMenu, useMobileMenu } from '@/components/ui/MobileNav';

interface MobileWorkspaceHeaderProps {
  sessionId: string;
  showBackButton?: boolean;
  onBack?: () => void;
  subtitle?: string;
}

export function MobileWorkspaceHeader({
  sessionId,
  showBackButton = false,
  onBack,
  subtitle,
}: MobileWorkspaceHeaderProps) {
  const router = useRouter();
  const { isOpen, open, close } = useMobileMenu();
  const session = useSessionStore((state) => state.sessions[sessionId]);

  const workspaceStatus = session?.workspaceStatus ?? 'pending';
  const sessionName = session?.name ?? 'Session';

  const getStatusColor = () => {
    switch (workspaceStatus) {
      case 'running':
        return 'bg-status-success';
      case 'pending':
        return 'bg-status-warning animate-pulse';
      case 'standby':
        return 'bg-status-warning';
      case 'stopped':
      case 'error':
        return 'bg-status-error';
      default:
        return 'bg-text-tertiary';
    }
  };

  const getStatusText = () => {
    switch (workspaceStatus) {
      case 'running':
        return 'Running';
      case 'pending':
        return 'Starting...';
      case 'standby':
        return 'Standby';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const handleBackClick = () => {
    if (showBackButton && onBack) {
      onBack();
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <>
      <header
        className={cn(
          'md:hidden sticky top-0 z-30',
          'h-14 px-2 flex items-center gap-2',
          'bg-surface/95 backdrop-blur-sm border-b border-border-subtle'
        )}
        data-tour="workspace-header"
      >
        {/* Back button */}
        <button
          onClick={handleBackClick}
          className={cn(
            'p-2 rounded-lg',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label={showBackButton ? 'Back to overview' : 'Back to dashboard'}
        >
          {showBackButton ? (
            <ChevronLeft className="h-5 w-5 text-text-primary" />
          ) : (
            <ArrowLeft className="h-5 w-5 text-text-primary" />
          )}
        </button>

        {/* Session info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-text-primary truncate">
              {subtitle || sessionName}
            </h1>

            {/* Pod status indicator - only show when not showing subtitle */}
            {!subtitle && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={cn('w-2 h-2 rounded-full', getStatusColor())} />
                <span className="text-xs text-text-tertiary hidden sm:inline">
                  {getStatusText()}
                </span>
              </div>
            )}
          </div>

          {/* Show session name as subtitle when viewing an agent */}
          {subtitle && <p className="text-xs text-text-tertiary truncate">{sessionName}</p>}
        </div>

        {/* Menu button */}
        <button
          onClick={open}
          data-tour="hamburger-menu"
          className={cn(
            'p-2 rounded-lg',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-text-primary" />
        </button>
      </header>

      {/* Mobile menu */}
      <MobileMenu isOpen={isOpen} onClose={close} />
    </>
  );
}
