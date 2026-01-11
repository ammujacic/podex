'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Bot,
  FileCode,
  FolderTree,
  GitBranch,
  Settings,
  Terminal,
  ChevronRight,
  File,
  Folder,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore, type FilePreview } from '@/stores/session';
import { cn } from '@/lib/utils';
import { getLanguageFromPath } from './CodeEditor';
import { GitPanel } from './GitPanel';
import { listFiles, getFileContent, type FileNode } from '@/lib/api';

interface WorkspaceSidebarProps {
  collapsed: boolean;
  sessionId: string;
}

const sidebarItems = [
  { icon: Bot, label: 'Agents', id: 'agents' },
  { icon: FolderTree, label: 'Files', id: 'files' },
  { icon: Terminal, label: 'Terminal', id: 'terminal' },
  { icon: GitBranch, label: 'Git', id: 'git' },
  { icon: FileCode, label: 'Preview', id: 'preview' },
];

interface FileTreeNodeProps {
  item: FileNode;
  depth: number;
  onFileClick: (path: string) => void;
}

function FileTreeNode({ item, depth, onFileClick }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (item.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
          <Folder className="h-4 w-4 text-accent-secondary" />
          <span className="truncate">{item.name}</span>
        </button>
        {expanded && item.children && (
          <div>
            {item.children.map((child) => (
              <FileTreeNode
                key={child.path}
                item={child}
                depth={depth + 1}
                onFileClick={onFileClick}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(item.path)}
      className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
      style={{ paddingLeft: depth * 12 + 20 }}
    >
      <File className="h-4 w-4 text-text-muted" />
      <span className="truncate">{item.name}</span>
    </button>
  );
}

export function WorkspaceSidebar({ collapsed, sessionId }: WorkspaceSidebarProps) {
  const { toggleTerminal, toggleSidebar, terminalVisible } = useUIStore();
  const { openFilePreview, sessions, setActiveAgent } = useSessionStore();
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const session = sessions[sessionId];
  const agents = session?.agents || [];

  // Fetch files when files panel is opened
  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const fileTree = await listFiles(sessionId);
      setFiles(fileTree);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setFilesLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (activePanel === 'files' && files.length === 0 && !filesLoading) {
      loadFiles();
    }
  }, [activePanel, files.length, filesLoading, loadFiles]);

  const handleItemClick = (id: string) => {
    if (id === 'terminal') {
      toggleTerminal();
    } else {
      setActivePanel(activePanel === id ? null : id);
    }
  };

  const handleFileClick = useCallback(
    async (path: string) => {
      try {
        const fileContent = await getFileContent(sessionId, path);

        const preview: FilePreview = {
          id: `preview-${Date.now()}`,
          path: fileContent.path,
          content: fileContent.content,
          language: fileContent.language,
          pinned: false,
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
          docked: false, // Start as floating overlay
        };

        openFilePreview(sessionId, preview);
      } catch (err) {
        console.error('Failed to load file content:', err);
        // Fallback: open with empty content
        const preview: FilePreview = {
          id: `preview-${Date.now()}`,
          path,
          content: `// Failed to load content for ${path}`,
          language: getLanguageFromPath(path),
          pinned: false,
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
          docked: false,
        };
        openFilePreview(sessionId, preview);
      }
    },
    [sessionId, openFilePreview]
  );

  return (
    <div className="flex" data-tour="sidebar">
      {/* Icon bar */}
      <aside
        className={cn(
          'flex flex-col border-r border-border-subtle bg-surface transition-all duration-200',
          collapsed ? 'w-12' : 'w-14'
        )}
      >
        <nav className="flex flex-1 flex-col items-center gap-1 py-2">
          {sidebarItems.map((item) => {
            const isActive = item.id === 'terminal' ? terminalVisible : activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
                className={cn(
                  'group relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary',
                  isActive && 'bg-overlay text-accent-primary'
                )}
                title={item.label}
                {...(item.id === 'terminal' ? { 'data-tour': 'terminal-toggle' } : {})}
              >
                <item.icon className="h-5 w-5" />
                {/* Tooltip */}
                <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs text-text-primary shadow-panel group-hover:block z-50">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-border-subtle py-2">
          <button
            onClick={() => toggleSidebar('left')}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </aside>

      {/* Expandable panel */}
      {activePanel === 'files' && (
        <div className="w-64 border-r border-border-subtle bg-surface flex flex-col max-h-full">
          <div className="border-b border-border-subtle px-4 py-3 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-medium text-text-primary">Files</h2>
            <button
              onClick={loadFiles}
              disabled={filesLoading}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', filesLoading && 'animate-spin')} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filesLoading && files.length === 0 ? (
              <div className="flex items-center justify-center h-24">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              </div>
            ) : filesError ? (
              <div className="p-4 text-center">
                <p className="text-accent-error text-sm mb-2">{filesError}</p>
                <button onClick={loadFiles} className="text-sm text-accent-primary hover:underline">
                  Retry
                </button>
              </div>
            ) : files.length === 0 ? (
              <div className="p-4 text-center text-text-muted text-sm">
                <FolderTree className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p>No files found</p>
              </div>
            ) : (
              files.map((item) => (
                <FileTreeNode key={item.path} item={item} depth={0} onFileClick={handleFileClick} />
              ))
            )}
          </div>
        </div>
      )}

      {activePanel === 'agents' && (
        <div className="w-64 border-r border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3">
            <h2 className="text-sm font-medium text-text-primary">Agents ({agents.length})</h2>
          </div>
          {agents.length === 0 ? (
            <div className="p-4 text-center text-text-muted text-sm">
              <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No agents yet.</p>
              <p className="mt-2 text-xs">
                Click &quot;Add Agent&quot; in the workspace to create one.
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setActiveAgent(sessionId, agent.id)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-overlay',
                    session?.activeAgentId === agent.id && 'bg-overlay'
                  )}
                >
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: agent.color }} />
                  <div className="flex-1 truncate">
                    <div className="font-medium text-text-primary">{agent.name}</div>
                    <div className="text-xs text-text-muted capitalize">{agent.role}</div>
                  </div>
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full',
                      agent.status === 'active'
                        ? 'bg-accent-success animate-pulse'
                        : agent.status === 'error'
                          ? 'bg-accent-error'
                          : 'bg-text-muted'
                    )}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activePanel === 'git' && (
        <div className="w-72 border-r border-border-subtle bg-surface flex flex-col max-h-full">
          <div className="border-b border-border-subtle px-4 py-3 shrink-0">
            <h2 className="text-sm font-medium text-text-primary">Source Control</h2>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <GitPanel sessionId={sessionId} />
          </div>
        </div>
      )}

      {activePanel === 'preview' && (
        <div className="w-64 border-r border-border-subtle bg-surface">
          <div className="border-b border-border-subtle px-4 py-3">
            <h2 className="text-sm font-medium text-text-primary">Preview</h2>
          </div>
          <div className="p-4 text-center text-text-muted text-sm">
            <FileCode className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>Preview your running application.</p>
            <p className="mt-2 text-xs">Start a dev server to see your app live.</p>
            <div className="mt-4 space-y-2">
              <div className="text-left text-xs">
                <div className="font-medium text-text-secondary mb-1">Available Ports:</div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between px-2 py-1 rounded bg-overlay">
                    <span>3000</span>
                    <span className="text-text-muted">Dev Server</span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded bg-overlay">
                    <span>5173</span>
                    <span className="text-text-muted">Vite</span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded bg-overlay">
                    <span>8080</span>
                    <span className="text-text-muted">Backend</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
