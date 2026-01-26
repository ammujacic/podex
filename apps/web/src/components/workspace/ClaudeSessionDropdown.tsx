'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronDown, Loader2, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet';
import {
  listClaudeProjects,
  listClaudeSessions,
  getClaudeSession,
  type ClaudeProject,
  type ClaudeSessionSummary,
  type ClaudeSessionDetail,
} from '@/lib/api';

/** Info about the current Claude session (from backend, for cross-device sync) */
export interface ClaudeSessionInfo {
  claudeSessionId: string;
  projectPath: string;
  firstPrompt: string | null;
}

export interface ClaudeSessionDropdownProps {
  workspaceId?: string;
  projectPath?: string;
  /** Current session info from backend (enables cross-device sync) */
  initialSessionInfo?: ClaudeSessionInfo | null;
  /** Called when a session is loaded with its messages */
  onSessionLoaded?: (sessionDetail: ClaudeSessionDetail, sessionInfo: ClaudeSessionInfo) => void;
  /** Called when user clicks "New session" */
  onNewSession?: () => void;
  className?: string;
  /** Use mobile bottom sheet instead of dropdown */
  useMobileSheet?: boolean;
}

// Get display text for a session (fallback for empty prompts)
const getSessionDisplayText = (session: ClaudeSessionSummary): string => {
  const prompt = session.first_prompt.trim();
  if (prompt.length > 0) {
    return prompt;
  }
  // Fallback: show truncated session ID like Claude Code does
  return `Session ${session.session_id.slice(0, 8)}...`;
};

// Format time like Claude Code: "1h", "2h", "1d", etc.
const formatTimeShort = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
    return `${Math.floor(diffDays / 30)}mo`;
  } catch {
    return '';
  }
};

// Get date group label
const getDateGroup = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (sessionDate.getTime() === today.getTime()) return 'Today';
    if (sessionDate.getTime() === yesterday.getTime()) return 'Yesterday';
    if (sessionDate.getTime() > today.getTime() - 7 * 86400000) return 'This Week';
    if (sessionDate.getTime() > today.getTime() - 30 * 86400000) return 'This Month';
    return 'Older';
  } catch {
    return 'Older';
  }
};

// Group sessions by date
type GroupedSessions = { label: string; sessions: ClaudeSessionSummary[] }[];

export function ClaudeSessionDropdown({
  projectPath,
  initialSessionInfo,
  onSessionLoaded,
  onNewSession,
  className,
  useMobileSheet = false,
}: ClaudeSessionDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ClaudeProject | null>(null);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumingSession, setResumingSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Initialize from backend session info (cross-device sync)
  const [currentSessionName, setCurrentSessionName] = useState<string | null>(
    initialSessionInfo?.firstPrompt ?? null
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Update currentSessionName when initialSessionInfo changes (e.g., from another device)
  useEffect(() => {
    if (initialSessionInfo?.firstPrompt) {
      setCurrentSessionName(initialSessionInfo.firstPrompt);
    }
  }, [initialSessionInfo?.firstPrompt]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus search when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Load projects
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listClaudeProjects();
      setProjects(response.projects);

      if (response.projects.length > 0) {
        const toSelect = projectPath
          ? response.projects.find((p) => p.path === projectPath)
          : response.projects[0];
        if (toSelect) {
          setSelectedProject(toSelect);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('local pod')) {
        setError('No local pod connected');
      } else {
        setError('Failed to load projects');
      }
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load sessions when project selected
  const loadSessions = useCallback(async (project: ClaudeProject) => {
    setLoadingSessions(true);
    try {
      const response = await listClaudeSessions(project.path, {
        limit: 50,
        sortBy: 'modified',
        sortOrder: 'desc',
      });
      setSessions(response.sessions);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // Load projects when dropdown opens
  useEffect(() => {
    if (isOpen && projects.length === 0) {
      loadProjects();
    }
  }, [isOpen, projects.length, loadProjects]);

  // Load sessions when project changes
  useEffect(() => {
    if (selectedProject) {
      loadSessions(selectedProject);
    }
  }, [selectedProject, loadSessions]);

  // Filter and group sessions (show ALL sessions like Claude Code does)
  const groupedSessions = useMemo((): GroupedSessions => {
    // Only filter by search query - don't filter out empty prompts
    const filtered = searchQuery
      ? sessions.filter((s) => {
          const displayText = getSessionDisplayText(s).toLowerCase();
          return displayText.includes(searchQuery.toLowerCase());
        })
      : sessions;

    // Group by date
    const groups: Record<string, ClaudeSessionSummary[]> = {};
    const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

    for (const session of filtered) {
      const group = getDateGroup(session.modified_at);
      if (!groups[group]) groups[group] = [];
      groups[group].push(session);
    }

    return groupOrder
      .filter((label) => groups[label]?.length)
      .map((label) => ({ label, sessions: groups[label]! }));
  }, [sessions, searchQuery]);

  // Handle loading a session (fetch messages and sync to agent)
  const handleLoadSession = async (session: ClaudeSessionSummary) => {
    if (!selectedProject) return;
    setResumingSession(session.session_id);
    try {
      // Fetch full session detail with messages
      const sessionDetail = await getClaudeSession(session.session_id, selectedProject.path, {
        includeMessages: true,
        messageLimit: 500,
      });

      // Track the current session name for display
      setCurrentSessionName(session.first_prompt);

      // Create session info for state management
      const sessionInfo: ClaudeSessionInfo = {
        claudeSessionId: session.session_id,
        projectPath: selectedProject.path,
        firstPrompt: session.first_prompt,
      };

      // Pass session detail and info back to parent to update agent messages
      onSessionLoaded?.(sessionDetail, sessionInfo);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setResumingSession(null);
    }
  };

  // Get current session label for trigger button
  // Show current session name if available, otherwise show project name or default
  const currentLabel = currentSessionName
    ? currentSessionName.slice(0, 30) + (currentSessionName.length > 30 ? '...' : '')
    : selectedProject
      ? selectedProject.path.split('/').pop() || 'Sessions'
      : 'Sessions';

  // Handle new session click
  const handleNewSession = () => {
    onNewSession?.();
    setCurrentSessionName(null);
    setIsOpen(false);
  };

  // Shared session list content
  const renderSessionList = () => (
    <>
      {/* Search */}
      <div className="p-3 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full pl-10 pr-10 py-2.5 bg-surface-hover border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* New session button */}
      {onNewSession && (
        <button
          onClick={handleNewSession}
          className="w-full px-4 py-3 border-b border-border-subtle hover:bg-overlay active:bg-surface-active transition-colors text-left flex items-center gap-3"
        >
          <Plus className="w-5 h-5 text-accent-primary shrink-0" />
          <span className="text-sm text-accent-primary font-medium">New session</span>
        </button>
      )}

      {/* Project selector (if multiple) */}
      {projects.length > 1 && (
        <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-2">
          <select
            value={selectedProject?.path || ''}
            onChange={(e) => {
              const project = projects.find((p) => p.path === e.target.value);
              if (project) setSelectedProject(project);
            }}
            className="flex-1 bg-surface-hover text-sm text-text-secondary border border-border-subtle rounded-lg px-3 py-2 cursor-pointer"
          >
            {projects.map((p) => (
              <option key={p.path} value={p.path} className="bg-surface">
                {p.path.split('/').pop() || p.path}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              e.stopPropagation();
              loadProjects();
            }}
            disabled={loading}
            className="p-2 hover:bg-overlay rounded-lg"
            title="Refresh"
          >
            <RefreshCw className={cn('w-4 h-4 text-text-muted', loading && 'animate-spin')} />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="overflow-y-auto flex-1 max-h-[60vh]">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={loadProjects}
              className="mt-3 text-sm text-accent-primary hover:text-accent-primary/80"
            >
              Try again
            </button>
          </div>
        ) : loadingSessions ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
          </div>
        ) : groupedSessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">
            {searchQuery ? 'No matching sessions' : 'No sessions found'}
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label}>
              {/* Date group header */}
              <div className="px-4 py-2 text-xs font-semibold text-text-muted uppercase tracking-wider bg-surface-alt">
                {group.label}
              </div>
              {/* Sessions in group */}
              {group.sessions.map((session) => (
                <button
                  key={session.session_id}
                  onClick={() => handleLoadSession(session)}
                  disabled={resumingSession === session.session_id}
                  className="w-full px-4 py-3 hover:bg-overlay active:bg-surface-active transition-colors text-left disabled:opacity-50 flex items-center gap-3 min-h-[56px]"
                >
                  <MessageSquare className="w-5 h-5 text-text-muted shrink-0" />
                  <span className="flex-1 text-sm text-text-primary line-clamp-2">
                    {getSessionDisplayText(session)}
                  </span>
                  <span className="text-xs text-text-muted shrink-0">
                    {resumingSession === session.session_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      formatTimeShort(session.modified_at)
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );

  // Mobile: Use MobileBottomSheet
  if (useMobileSheet) {
    return (
      <>
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 text-xs bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary rounded transition-colors',
            className
          )}
        >
          <MessageSquare className="w-3 h-3 shrink-0" />
          <span className="truncate max-w-[100px]">{currentLabel}</span>
          <ChevronDown className="w-3 h-3 shrink-0" />
        </button>
        <MobileBottomSheet
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Claude Sessions"
          height="auto"
        >
          {renderSessionList()}
        </MobileBottomSheet>
      </>
    );
  }

  // Desktop: Use dropdown
  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary rounded transition-colors"
      >
        <MessageSquare className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[120px]">{currentLabel}</span>
        <ChevronDown
          className={cn('w-3 h-3 shrink-0 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 max-h-[400px] bg-surface border border-border-default rounded-lg shadow-xl z-50 overflow-hidden flex flex-col">
          {renderSessionList()}
        </div>
      )}
    </div>
  );
}
