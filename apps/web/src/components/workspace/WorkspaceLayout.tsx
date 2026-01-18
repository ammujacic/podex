'use client';

import { type ReactNode } from 'react';
import { useUIStore } from '@/stores/ui';
import { useUser, useAuthStore } from '@/stores/auth';
import { useKeybindings } from '@/hooks/useKeybindings';
import { useAgentSocket } from '@/hooks/useAgentSocket';
import { useContextSocket } from '@/hooks/useContextSocket';
import { useCheckpointSocket } from '@/hooks/useCheckpointSocket';
import { useWorktreeSocket } from '@/hooks/useWorktreeSocket';
import { useSessionStore } from '@/stores/session';
import { useIsMobile } from '@/hooks/useIsMobile';
import { WorkspaceHeader } from './WorkspaceHeader';
import { SidebarContainer } from './SidebarContainer';
import { TerminalPanel } from './TerminalPanel';
import { FilePreviewLayer } from './FilePreviewLayer';
import { ModalLayer } from './ModalLayer';
import { LayoutSyncProvider } from './LayoutSyncProvider';
import { CommandPalette } from './CommandPalette';
import { QuickOpen } from './QuickOpen';
import { NotificationCenter } from './NotificationCenter';
import { MobileWorkspaceLayout } from './MobileWorkspaceLayout';

interface WorkspaceLayoutProps {
  sessionId: string;
  children: ReactNode;
}

export function WorkspaceLayout({ sessionId, children }: WorkspaceLayoutProps) {
  const { terminalVisible, terminalHeight } = useUIStore();
  const user = useUser();
  const tokens = useAuthStore((state) => state.tokens);
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const agentIds = session?.agents?.map((a) => a.id) ?? [];
  const isMobile = useIsMobile();

  // Initialize keyboard shortcuts (desktop only)
  useKeybindings();

  // Connect to WebSocket for real-time agent updates
  useAgentSocket({
    sessionId,
    userId: user?.id ?? '',
    authToken: tokens?.accessToken ?? undefined,
  });

  // Connect to context window events and fetch initial usage
  useContextSocket({
    sessionId,
    agentIds,
  });

  // Connect to checkpoint events for undo/restore functionality
  useCheckpointSocket({ sessionId });

  // Connect to worktree events for parallel agent execution
  useWorktreeSocket({ sessionId });

  // Render mobile layout on small screens
  if (isMobile) {
    return (
      <LayoutSyncProvider sessionId={sessionId}>
        <MobileWorkspaceLayout sessionId={sessionId} />
        {/* Keep modal layer for dialogs */}
        <ModalLayer sessionId={sessionId} />
      </LayoutSyncProvider>
    );
  }

  // Desktop layout
  return (
    <LayoutSyncProvider sessionId={sessionId}>
      <div className="flex h-screen flex-col bg-void">
        {/* Header */}
        <WorkspaceHeader sessionId={sessionId} />

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar */}
          <SidebarContainer side="left" sessionId={sessionId} />

          {/* Main workspace */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Agent grid / content */}
            <div
              className="flex-1 overflow-hidden"
              style={{
                height: terminalVisible ? `calc(100% - ${terminalHeight}px)` : '100%',
              }}
            >
              {children}
            </div>

            {/* Terminal */}
            {terminalVisible && (
              <div className="border-t border-border-subtle" style={{ height: terminalHeight }}>
                <TerminalPanel sessionId={sessionId} />
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <SidebarContainer side="right" sessionId={sessionId} />
        </div>

        {/* Floating file previews */}
        <FilePreviewLayer sessionId={sessionId} />

        {/* Modal layer */}
        <ModalLayer sessionId={sessionId} />

        {/* Command palette */}
        <CommandPalette />

        {/* Quick open (Cmd+P) */}
        <QuickOpen />

        {/* Notification center panel */}
        <NotificationCenter sessionId={sessionId} />
      </div>
    </LayoutSyncProvider>
  );
}
