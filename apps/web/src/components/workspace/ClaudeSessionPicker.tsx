'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  GitBranch,
  Clock,
  ChevronRight,
  ChevronDown,
  Folder,
  RefreshCw,
  Loader2,
  Import,
  Search,
  X,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listClaudeProjects,
  listClaudeSessions,
  syncClaudeSession,
  getClaudeSession,
  type ClaudeProject,
  type ClaudeSessionSummary,
  type ClaudeSessionDetail,
} from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

export interface ClaudeSessionPickerProps {
  sessionId: string;
  workspaceId?: string;
  /** Called when a session is loaded with its messages */
  onSessionLoaded?: (sessionDetail: ClaudeSessionDetail, projectPath: string) => void;
  /** Called when a session is synced to Podex */
  onSessionSynced?: (podexSessionId: string, agentId: string) => void;
  /** Class name for the container */
  className?: string;
}

export function ClaudeSessionPicker({
  sessionId,
  onSessionLoaded,
  onSessionSynced,
  className,
}: ClaudeSessionPickerProps) {
  // State
  const [projects, setProjects] = useState<ClaudeProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<ClaudeProject | null>(null);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Load projects on mount
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listClaudeProjects();
      setProjects(response.projects);
      // Auto-select the first project if available
      if (response.projects.length > 0 && !selectedProject) {
        const firstProject = response.projects[0]!;
        setSelectedProject(firstProject);
        setExpandedProjects(new Set([firstProject.path]));
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('local pod')) {
        setError(
          'No local pod connected. Please connect your local pod to view Claude Code sessions.'
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load Claude projects');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load sessions when project is selected
  const loadSessions = useCallback(async (projectPath: string) => {
    setLoadingSessions(true);
    setError(null);
    try {
      const response = await listClaudeSessions(projectPath, {
        limit: 50,
        sortBy: 'modified',
        sortOrder: 'desc',
      });
      setSessions(response.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadSessions(selectedProject.path);
    }
  }, [selectedProject, loadSessions]);

  // Handle project toggle
  const toggleProject = (project: ClaudeProject) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(project.path)) {
      newExpanded.delete(project.path);
    } else {
      newExpanded.add(project.path);
      setSelectedProject(project);
    }
    setExpandedProjects(newExpanded);
  };

  // Handle session load (fetch messages)
  const handleLoad = async (session: ClaudeSessionSummary) => {
    if (!selectedProject) return;
    setActionInProgress(session.session_id);
    try {
      const sessionDetail = await getClaudeSession(session.session_id, selectedProject.path, {
        includeMessages: true,
        messageLimit: 500,
      });
      onSessionLoaded?.(sessionDetail, selectedProject.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle session sync
  const handleSync = async (session: ClaudeSessionSummary) => {
    if (!selectedProject) return;
    setActionInProgress(session.session_id);
    try {
      const response = await syncClaudeSession({
        session_id: session.session_id,
        project_path: selectedProject.path,
        podex_session_id: sessionId,
      });
      onSessionSynced?.(response.podex_session_id, response.agent_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync session');
    } finally {
      setActionInProgress(null);
    }
  };

  // Filter sessions by search query
  const filteredSessions = sessions.filter(
    (session) =>
      session.first_prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.git_branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format time
  const formatTime = (isoString: string) => {
    try {
      return formatDistanceToNow(new Date(isoString), { addSuffix: true });
    } catch {
      return isoString;
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-neutral-900', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-medium text-neutral-200">Claude Code Sessions</span>
        </div>
        <button
          onClick={() => loadProjects()}
          disabled={loading}
          className="p-1 hover:bg-neutral-800 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw className={cn('w-4 h-4 text-neutral-400', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-3 mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
        </div>
      )}

      {/* No Local Pod */}
      {!loading && projects.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <MessageSquare className="w-10 h-10 text-neutral-600 mb-3" />
          <p className="text-sm text-neutral-400 mb-1">No Claude Code sessions found</p>
          <p className="text-xs text-neutral-500">
            Make sure your local pod is connected and you have Claude Code sessions on your machine.
          </p>
        </div>
      )}

      {/* Content */}
      {!loading && projects.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Search */}
          {selectedProject && (
            <div className="px-3 py-2 border-b border-neutral-800">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions..."
                  className="w-full pl-8 pr-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-orange-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3 h-3 text-neutral-500 hover:text-neutral-300" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Projects & Sessions List */}
          <div className="flex-1 overflow-y-auto">
            {projects.map((project) => (
              <div key={project.path} className="border-b border-neutral-800 last:border-b-0">
                {/* Project Header */}
                <button
                  onClick={() => toggleProject(project)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 hover:bg-neutral-800/50 transition-colors',
                    selectedProject?.path === project.path && 'bg-neutral-800/30'
                  )}
                >
                  {expandedProjects.has(project.path) ? (
                    <ChevronDown className="w-4 h-4 text-neutral-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-neutral-500" />
                  )}
                  <Folder className="w-4 h-4 text-orange-400" />
                  <span className="flex-1 text-left text-sm text-neutral-300 truncate">
                    {project.path.split('/').pop() || project.path}
                  </span>
                  <span className="text-xs text-neutral-500">{project.session_count}</span>
                </button>

                {/* Sessions List */}
                {expandedProjects.has(project.path) && selectedProject?.path === project.path && (
                  <div className="bg-neutral-900/50">
                    {loadingSessions ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 text-neutral-500 animate-spin" />
                      </div>
                    ) : filteredSessions.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-neutral-500">
                        {searchQuery ? 'No matching sessions' : 'No sessions found'}
                      </div>
                    ) : (
                      filteredSessions.map((session) => (
                        <div
                          key={session.session_id}
                          className="px-3 py-2 hover:bg-neutral-800/30 border-t border-neutral-800/50"
                        >
                          {/* Session Info */}
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-4 h-4 text-neutral-500 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-neutral-300 line-clamp-2">
                                {session.first_prompt}
                              </p>
                              <div className="flex items-center gap-3 mt-1">
                                {session.git_branch && (
                                  <span className="flex items-center gap-1 text-xs text-neutral-500">
                                    <GitBranch className="w-3 h-3" />
                                    {session.git_branch}
                                  </span>
                                )}
                                <span className="flex items-center gap-1 text-xs text-neutral-500">
                                  <Clock className="w-3 h-3" />
                                  {formatTime(session.modified_at)}
                                </span>
                                <span className="text-xs text-neutral-600">
                                  {session.message_count} msgs
                                </span>
                                <span className="text-xs text-neutral-600">
                                  {formatFileSize(session.file_size_bytes)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 mt-2 pl-6">
                            <button
                              onClick={() => handleLoad(session)}
                              disabled={actionInProgress === session.session_id}
                              className="flex items-center gap-1 px-2 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded text-xs transition-colors disabled:opacity-50"
                            >
                              {actionInProgress === session.session_id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <MessageSquare className="w-3 h-3" />
                              )}
                              Load
                            </button>
                            <button
                              onClick={() => handleSync(session)}
                              disabled={actionInProgress === session.session_id}
                              className="flex items-center gap-1 px-2 py-1 bg-neutral-700/50 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition-colors disabled:opacity-50"
                            >
                              {actionInProgress === session.session_id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Import className="w-3 h-3" />
                              )}
                              Import
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
