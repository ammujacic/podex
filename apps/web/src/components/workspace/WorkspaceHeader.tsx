'use client';

import { useState, useRef, useEffect } from 'react';
import {
  AlertCircle,
  Bell,
  Clock,
  GitBranch,
  Grid3X3,
  Layout,
  Loader2,
  LogOut,
  Mic,
  Move,
  Pause,
  Server,
  Settings,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { useAttentionStore } from '@/stores/attention';
import { useVoiceCommands } from '@/hooks/useVoiceCommands';
import { cn } from '@/lib/utils';
import { GitPanel } from './GitPanel';
import { GridConfigDropdown } from './GridConfigDropdown';
import { PresencePanel, usePresenceStore } from './PresencePanel';
import { CreditWarningIndicator } from './CreditWarningIndicator';
import { Logo } from '@/components/ui/Logo';
import { getHardwareSpecs, logout } from '@/lib/api';
import type { HardwareSpec } from '@podex/shared';

interface WorkspaceHeaderProps {
  sessionId: string;
}

type WorkspaceStatus =
  | 'pending'
  | 'running'
  | 'standby'
  | 'stopped'
  | 'error'
  | 'offline'
  | undefined;

// Cache for hardware specs to avoid refetching
let hardwareSpecsCache: HardwareSpec[] | null = null;
let hardwareSpecsFetchPromise: Promise<HardwareSpec[]> | null = null;

function useHardwareSpecs() {
  const [specs, setSpecs] = useState<HardwareSpec[]>(hardwareSpecsCache || []);

  useEffect(() => {
    if (hardwareSpecsCache) {
      setSpecs(hardwareSpecsCache);
      return;
    }

    if (!hardwareSpecsFetchPromise) {
      hardwareSpecsFetchPromise = getHardwareSpecs()
        .then((data) => {
          hardwareSpecsCache = data;
          return data;
        })
        .catch(() => []);
    }

    hardwareSpecsFetchPromise.then(setSpecs);
  }, []);

  return specs;
}

function PodStatusIndicator({
  status,
  tier,
  isLocalPod,
  localPodName,
}: {
  status?: WorkspaceStatus;
  tier?: string;
  isLocalPod?: boolean;
  localPodName?: string | null;
}) {
  const { openModal } = useUIStore();
  const hardwareSpecs = useHardwareSpecs();

  const statusConfig: Record<
    NonNullable<WorkspaceStatus>,
    { color: string; bgColor: string; label: string; icon: React.ReactNode }
  > = {
    running: {
      color: 'text-green-400',
      bgColor: 'bg-green-500',
      label: 'Running',
      icon: null,
    },
    standby: {
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500',
      label: 'Standby',
      icon: <Pause className="h-3 w-3" />,
    },
    pending: {
      color: 'text-blue-400',
      bgColor: 'bg-blue-500',
      label: 'Starting',
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    stopped: {
      color: 'text-gray-400',
      bgColor: 'bg-gray-500',
      label: 'Stopped',
      icon: <Pause className="h-3 w-3" />,
    },
    error: {
      color: 'text-red-400',
      bgColor: 'bg-red-500',
      label: 'Error',
      icon: <AlertCircle className="h-3 w-3" />,
    },
    offline: {
      color: 'text-red-400',
      bgColor: 'bg-red-500',
      label: 'Offline',
      icon: <WifiOff className="h-3 w-3" />,
    },
  };

  if (!status) return null;

  const config = statusConfig[status];

  // For local pods, show local pod name instead of tier (scaling not available)
  if (isLocalPod) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-4 w-px bg-border-subtle" />
        <div className={`flex items-center gap-1.5 ${config.color}`}>
          <div className={`w-2 h-2 rounded-full ${config.bgColor}`} />
          <span className="text-xs">{config.label}</span>
          {config.icon}
        </div>
        <div
          className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded bg-surface-hover text-text-secondary border border-border-subtle"
          title={`Local pod: ${localPodName || 'Unknown'}`}
        >
          <Server className="h-3 w-3 text-accent-secondary" />
          <span className="truncate max-w-[100px]">{localPodName || 'Local Pod'}</span>
        </div>
      </div>
    );
  }

  // Get display name from hardware specs, fallback to tier name with capitalization
  const spec = hardwareSpecs.find((s) => s.tier === tier);
  const tierDisplayName =
    spec?.display_name ||
    (tier ? tier.charAt(0).toUpperCase() + tier.slice(1).replace(/_/g, ' ') : 'Starter');

  return (
    <div className="flex items-center gap-2">
      <div className="h-4 w-px bg-border-subtle" />
      <div className={`flex items-center gap-1.5 ${config.color}`}>
        <div className={`w-2 h-2 rounded-full ${config.bgColor}`} />
        <span className="text-xs">{config.label}</span>
        {config.icon}
      </div>
      <button
        onClick={() => openModal('workspace-scaling')}
        className="text-xs px-2 py-0.5 rounded bg-surface-hover text-text-secondary hover:bg-overlay hover:text-text-primary transition-colors border border-border-subtle"
        title="Click to scale workspace"
      >
        {tierDisplayName}
      </button>
    </div>
  );
}

export function WorkspaceHeader({ sessionId }: WorkspaceHeaderProps) {
  const router = useRouter();
  const { openCommandPalette, openModal } = useUIStore();
  const { sessions, setViewMode } = useSessionStore();
  const { getUnreadCount, openPanel } = useAttentionStore();
  const unreadCount = getUnreadCount(sessionId);
  const session = sessions[sessionId];
  const viewMode = session?.viewMode ?? 'grid';
  const localPodId = session?.localPodId;
  const localPodName = session?.localPodName;
  const mountPath = session?.mount_path;
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const { users } = usePresenceStore();
  const onlineCount = users.filter((u) => u.status === 'online' || u.status === 'busy').length;
  const gitPanelRef = useRef<HTMLDivElement>(null);
  const collaboratorsPanelRef = useRef<HTMLDivElement>(null);

  // Voice commands
  const {
    isListening,
    isProcessing,
    transcript,
    error: voiceError,
    startListening,
    stopListening,
    cancelListening,
  } = useVoiceCommands({
    sessionId,
    onCommandExecuted: () => {
      // Voice command successfully executed
    },
    onError: (error) => {
      console.error('Voice command error:', error);
    },
  });

  // Close panels when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (gitPanelRef.current && !gitPanelRef.current.contains(event.target as Node)) {
        setShowGitPanel(false);
      }
      if (
        collaboratorsPanelRef.current &&
        !collaboratorsPanelRef.current.contains(event.target as Node)
      ) {
        setShowCollaborators(false);
      }
    }
    if (showGitPanel || showCollaborators) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [showGitPanel, showCollaborators]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (showGitPanel) setShowGitPanel(false);
        if (showCollaborators) setShowCollaborators(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showGitPanel, showCollaborators]);

  const handleGitClick = () => {
    setShowGitPanel(!showGitPanel);
  };

  return (
    <header
      className="flex h-12 items-center justify-between border-b border-border-subtle bg-surface px-4"
      data-tour="workspace-header"
    >
      {/* Left section */}
      <div className="flex items-center gap-4">
        <Logo href="/dashboard" size="sm" />

        <div className="h-4 w-px bg-border-subtle" />

        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-primary">{session?.name ?? 'Untitled'}</span>
          <div className="relative" ref={gitPanelRef}>
            <button
              onClick={handleGitClick}
              aria-label="Open Git panel"
              aria-expanded={showGitPanel}
              aria-haspopup="true"
              className={`flex items-center gap-1 rounded px-2 py-1 text-text-secondary hover:bg-overlay hover:text-text-primary ${
                showGitPanel ? 'bg-overlay text-text-primary' : ''
              }`}
            >
              <GitBranch className="h-3.5 w-3.5" />
              {session?.branch ?? 'main'}
            </button>

            {/* Git Panel Dropdown */}
            {showGitPanel && (
              <div
                className="absolute left-0 top-full mt-1 w-80 bg-surface border border-border-default rounded-xl shadow-xl z-50 overflow-hidden"
                role="dialog"
                aria-label="Git operations"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated">
                  <h3 className="text-sm font-medium text-text-primary">Source Control</h3>
                  <button
                    onClick={() => setShowGitPanel(false)}
                    className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
                    aria-label="Close Git panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <GitPanel sessionId={sessionId} localPodId={localPodId} mountPath={mountPath} />
                </div>
              </div>
            )}
          </div>

          {/* Pod Status Indicator */}
          <PodStatusIndicator
            status={session?.workspaceStatus}
            tier={session?.workspaceTier}
            isLocalPod={!!localPodId}
            localPodName={localPodName}
          />
        </div>
      </div>

      {/* Center section - View mode toggle and grid config */}
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1 rounded-lg border border-border-default bg-elevated p-1"
          role="tablist"
          aria-label="Workspace view mode"
        >
          <button
            onClick={() => setViewMode(sessionId, 'grid')}
            role="tab"
            aria-selected={viewMode === 'grid'}
            aria-label="Grid view - show agents in a grid layout"
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors ${
              viewMode === 'grid'
                ? 'bg-accent-primary text-text-inverse shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <Grid3X3 className="h-4 w-4" aria-hidden="true" />
            Grid
          </button>
          <button
            onClick={() => setViewMode(sessionId, 'focus')}
            role="tab"
            aria-selected={viewMode === 'focus'}
            aria-label="Focus view - show one agent at a time"
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors ${
              viewMode === 'focus'
                ? 'bg-accent-primary text-text-inverse shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <Layout className="h-4 w-4" aria-hidden="true" />
            Focus
          </button>
          <button
            onClick={() => setViewMode(sessionId, 'freeform')}
            role="tab"
            aria-selected={viewMode === 'freeform'}
            aria-label="Freeform view - freely position agents"
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm transition-colors ${
              viewMode === 'freeform'
                ? 'bg-accent-primary text-text-inverse shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <Move className="h-4 w-4" aria-hidden="true" />
            Freeform
          </button>
        </div>

        {/* Grid configuration button - only show in grid mode */}
        {viewMode === 'grid' && <GridConfigDropdown />}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2" role="toolbar" aria-label="Workspace actions">
        {/* Voice command button */}
        <div className="relative">
          <button
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onMouseLeave={() => {
              if (isListening) cancelListening();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              startListening();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopListening();
            }}
            aria-label={isListening ? 'Listening for voice command...' : 'Hold to speak a command'}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors touch-none',
              isListening
                ? 'bg-accent-error text-text-inverse animate-pulse'
                : isProcessing
                  ? 'bg-accent-warning text-text-inverse'
                  : 'text-text-secondary hover:bg-overlay hover:text-text-primary'
            )}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
            {isListening && <span className="text-xs font-medium">Listening...</span>}
          </button>

          {/* Transcript preview */}
          {(isListening || isProcessing) && transcript && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-elevated border border-border-default shadow-lg p-3 z-50">
              <div className="flex items-start gap-2">
                <span className="h-2 w-2 rounded-full bg-accent-error animate-pulse mt-1.5 shrink-0" />
                <p className="text-sm text-text-primary">{transcript}</p>
              </div>
            </div>
          )}

          {/* Error display */}
          {voiceError && !isListening && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-lg bg-elevated border border-accent-error shadow-lg p-3 z-50">
              <p className="text-sm text-accent-error">{voiceError}</p>
            </div>
          )}
        </div>

        {/* Command palette trigger */}
        <button
          onClick={openCommandPalette}
          aria-label="Open command palette (Cmd+K)"
          className="flex items-center gap-2 rounded-md border border-border-default bg-elevated px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
          data-tour="command-palette-trigger"
        >
          <span>Search</span>
          <kbd
            className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-xs"
            aria-hidden="true"
          >
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <button
          onClick={openPanel}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          className="relative rounded-md p-2 text-text-secondary hover:bg-overlay hover:text-text-primary"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-error px-1 text-[10px] font-medium text-text-inverse animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Credit/Quota Warning Indicator */}
        <CreditWarningIndicator />

        {/* Collaborators */}
        <div className="relative" ref={collaboratorsPanelRef}>
          <button
            onClick={() => setShowCollaborators(!showCollaborators)}
            aria-label={`View collaborators (${onlineCount} online)`}
            aria-expanded={showCollaborators}
            aria-haspopup="true"
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1.5 text-text-secondary hover:bg-overlay hover:text-text-primary',
              showCollaborators && 'bg-overlay text-text-primary'
            )}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">{onlineCount || 1}</span>
          </button>

          {/* Collaborators Panel Dropdown */}
          {showCollaborators && (
            <div
              className="absolute right-0 top-full mt-1 w-80 bg-surface border border-border-default rounded-xl shadow-xl z-50 overflow-hidden"
              role="dialog"
              aria-label="Collaborators"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated">
                <h3 className="text-sm font-medium text-text-primary">Collaborators</h3>
                <button
                  onClick={() => setShowCollaborators(false)}
                  className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
                  aria-label="Close collaborators panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto">
                <PresencePanel sessionId={sessionId} />
              </div>
            </div>
          )}
        </div>

        {/* Pause/Resume Session */}
        {session?.workspaceStatus === 'running' && (
          <button
            onClick={() => openModal('pause-session')}
            aria-label="Pause session"
            className="rounded-md p-2 text-text-secondary hover:bg-overlay hover:text-yellow-400"
            title="Pause session (enter standby)"
          >
            <Pause className="h-4 w-4" aria-hidden="true" />
          </button>
        )}

        {/* Auto-Standby Settings */}
        <button
          onClick={() => openModal('standby-settings')}
          aria-label="Configure auto-standby timeout"
          className="rounded-md p-2 text-text-secondary hover:bg-overlay hover:text-text-primary"
          title="Configure auto-standby timeout"
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Settings */}
        <button
          onClick={() => router.push('/settings')}
          aria-label="Open settings"
          className="rounded-md p-2 text-text-secondary hover:bg-overlay hover:text-text-primary"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Logout */}
        <button
          onClick={() => {
            logout();
            router.push('/');
          }}
          aria-label="Log out"
          className="rounded-md p-2 text-text-secondary hover:bg-overlay hover:text-accent-error"
          title="Log out"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
