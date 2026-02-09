'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Menu, ChevronLeft, Bell, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import { MobileMenu, useMobileMenu } from '@/components/ui/MobileNav';
import { getWorkspaceStatusColor, getWorkspaceStatusText } from '@/lib/ui-utils';
import { getAgentTextColor } from '@/lib/agentConstants';
import { PodexIcon } from '@/components/icons';

interface MobileWorkspaceHeaderProps {
  sessionId: string;
  showBackButton?: boolean;
  onBack?: () => void;
  subtitle?: string;
  /** Agent color for chat icon when showing agent view */
  agentColor?: string;
}

export function MobileWorkspaceHeader({
  sessionId,
  showBackButton = false,
  onBack,
  subtitle,
  agentColor,
}: MobileWorkspaceHeaderProps) {
  const router = useRouter();
  const textColor = agentColor ? getAgentTextColor(agentColor) : 'text-text-primary';
  const { isOpen, open, close } = useMobileMenu();
  const session = useSessionStore((state) => state.sessions[sessionId]);

  // Attention/notification state
  const { getUnreadCount, openPanel } = useAttentionStore();
  const unreadCount = getUnreadCount(sessionId);

  const workspaceStatus = session?.workspaceStatus ?? 'pending';
  const sessionName = session?.name ?? 'Session';

  const statusColor = getWorkspaceStatusColor(workspaceStatus);
  const statusText = getWorkspaceStatusText(workspaceStatus);

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
            'p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
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

        {/* Session info with chat icon when in agent view */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Chat bubble icon - only show when viewing an agent */}
          {subtitle && (
            <div className={cn('rounded-md bg-elevated p-1.5', textColor)} aria-hidden="true">
              <MessageCircle className="h-4 w-4" />
            </div>
          )}

          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-text-primary truncate">
                {subtitle || sessionName}
              </h1>

              {/* Pod status indicator - only show when not showing subtitle */}
              {!subtitle && (
                <div
                  className="flex items-center gap-1.5 flex-shrink-0"
                  role="status"
                  aria-label={`Workspace status: ${statusText}`}
                >
                  <span className={cn('w-2 h-2 rounded-full', statusColor)} aria-hidden="true" />
                  <span className="text-xs text-text-tertiary hidden sm:inline">{statusText}</span>
                </div>
              )}
            </div>

            {/* Show session name as subtitle when viewing an agent */}
            {subtitle && <p className="text-xs text-text-tertiary truncate">{sessionName}</p>}
          </div>
        </div>

        {/* Podex icon - links to dashboard */}
        <button
          onClick={() => router.push('/dashboard')}
          className={cn(
            'p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label="Go to dashboard"
        >
          <PodexIcon size={24} />
        </button>

        {/* Notification button */}
        <button
          onClick={openPanel}
          className={cn(
            'relative p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell className="h-5 w-5 text-text-primary" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            </span>
          )}
        </button>

        {/* Menu button */}
        <button
          onClick={open}
          data-tour="hamburger-menu"
          className={cn(
            'p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center',
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
