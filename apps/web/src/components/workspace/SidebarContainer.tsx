'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Bot,
  FileCode,
  FolderTree,
  GitBranch,
  Github,
  Terminal,
  MoreVertical,
  X,
  PanelLeftClose,
  PanelRightClose,
  Plug,
  Box,
  Search,
  AlertTriangle,
  BarChart3,
  Zap,
  Activity,
} from 'lucide-react';

// Custom Sentry icon component to match lucide-react API
function SentryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 66"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z"
        transform="translate(11, 11)"
      />
    </svg>
  );
}
import { useUIStore, type PanelId, type SidebarSide } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { useSidebarBadges } from '@/hooks/useSidebarBadges';
import { FilesPanel } from './FilesPanel';
import { AgentsPanel } from './AgentsPanel';
import { GitPanel } from './GitPanel';
import { GitHubWidget } from './GitHubWidget';
import { MCPPanel } from './MCPPanel';
import { ExtensionsPanel } from './ExtensionsPanel';
import { SearchPanel } from './SearchPanel';
import { DiagnosticsSidebarPanel } from './DiagnosticsSidebarPanel';
import { UsageSidebarPanel } from './UsageSidebarPanel';
import { SentryPanel } from './SentryPanel';
import { SkillsPanel } from './SkillsPanel';
import ProjectHealth from './ProjectHealth';

interface SidebarContainerProps {
  side: SidebarSide;
  sessionId: string;
}

const panelConfig: Record<
  PanelId,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  agents: { icon: Bot, label: 'Agents' },
  files: { icon: FolderTree, label: 'Files' },
  git: { icon: GitBranch, label: 'Git' },
  github: { icon: Github, label: 'GitHub' },
  preview: { icon: FileCode, label: 'Preview' },
  mcp: { icon: Plug, label: 'Integrations' },
  extensions: { icon: Box, label: 'Extensions' },
  search: { icon: Search, label: 'Search' },
  problems: { icon: AlertTriangle, label: 'Problems' },
  usage: { icon: BarChart3, label: 'Usage' },
  sentry: { icon: SentryIcon, label: 'Sentry MCP' },
  skills: { icon: Zap, label: 'Skills' },
  health: { icon: Activity, label: 'Health' },
};

// Left sidebar: traditional coding tools
const leftPanelIds: PanelId[] = ['files', 'search', 'git', 'github', 'problems', 'health'];

// Right sidebar: AI-related and utility panels
const rightPanelIds: PanelId[] = [
  'agents',
  'skills',
  'mcp',
  'sentry',
  'extensions',
  'usage',
  'preview',
];

// Panels that show badge counts
const badgePanelIds: PanelId[] = ['agents', 'mcp', 'problems', 'sentry'];

function SidebarBadge({ count }: { count: number | undefined }) {
  if (!count || count <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-primary px-1 text-[10px] font-medium text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

interface PanelHeaderProps {
  panelId: PanelId;
}

function PanelHeader({ panelId }: PanelHeaderProps) {
  const { removePanel } = useUIStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const config = panelConfig[panelId];

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle shrink-0">
      <h2 className="text-sm font-medium text-text-primary">{config.label}</h2>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-elevated border border-border-default rounded-md shadow-lg z-50">
            <button
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-overlay flex items-center gap-2"
              onClick={() => {
                removePanel(panelId);
                setMenuOpen(false);
              }}
            >
              <X className="h-4 w-4" />
              Close Panel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface SidebarPanelProps {
  panelId: PanelId;
  sessionId: string;
}

function SidebarPanel({ panelId, sessionId }: SidebarPanelProps) {
  const renderContent = () => {
    switch (panelId) {
      case 'files':
        return <FilesPanel sessionId={sessionId} />;
      case 'agents':
        return <AgentsPanel sessionId={sessionId} />;
      case 'git':
        return <GitPanel sessionId={sessionId} />;
      case 'github':
        return <GitHubWidget sessionId={sessionId} />;
      case 'mcp':
        return <MCPPanel sessionId={sessionId} />;
      case 'extensions':
        return <ExtensionsPanel sessionId={sessionId} />;
      case 'search':
        return <SearchPanel sessionId={sessionId} />;
      case 'problems':
        return <DiagnosticsSidebarPanel sessionId={sessionId} />;
      case 'usage':
        // Usage panel receives isVisible=true since it's only rendered when in the active panels list
        return <UsageSidebarPanel sessionId={sessionId} isVisible={true} />;
      case 'preview':
        // Preview panel needs workspaceId not sessionId - show placeholder for now
        return (
          <div className="p-4 text-center text-text-muted text-sm">
            <FileCode className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>Preview panel</p>
            <p className="mt-2 text-xs">Open preview from the header menu.</p>
          </div>
        );
      case 'sentry':
        return <SentryPanel sessionId={sessionId} />;
      case 'skills':
        return <SkillsPanel sessionId={sessionId} />;
      case 'health':
        return <ProjectHealth sessionId={sessionId} compact />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PanelHeader panelId={panelId} />
      <div className="flex-1 overflow-hidden">{renderContent()}</div>
    </div>
  );
}

interface PanelResizeHandleProps {
  side: SidebarSide;
  panelIndex: number;
}

function PanelResizeHandle({ side, panelIndex }: PanelResizeHandleProps) {
  const { setSidebarPanelHeight, sidebarLayout } = useUIStore();
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef(0);
  const startHeightsRef = useRef<number[]>([]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      containerRef.current = (e.target as HTMLElement).closest(
        '[data-panel-area]'
      ) as HTMLDivElement;
      startYRef.current = e.clientY;
      startHeightsRef.current = sidebarLayout[side].panels.map((p) => p.height);
    },
    [side, sidebarLayout]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const deltaY = e.clientY - startYRef.current;
      const deltaPercent = (deltaY / rect.height) * 100;

      // Adjust the panel above the handle (panelIndex) and the one below (panelIndex + 1)
      const currentHeight = startHeightsRef.current[panelIndex] ?? 50;
      const nextHeight = startHeightsRef.current[panelIndex + 1] ?? 50;

      const newCurrentHeight = Math.max(10, Math.min(90, currentHeight + deltaPercent));
      const newNextHeight = Math.max(10, Math.min(90, nextHeight - deltaPercent));

      // Only update if both panels maintain minimum size
      if (newCurrentHeight >= 10 && newNextHeight >= 10) {
        setSidebarPanelHeight(side, panelIndex, newCurrentHeight);
        setSidebarPanelHeight(side, panelIndex + 1, newNextHeight);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      containerRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, side, panelIndex, setSidebarPanelHeight]);

  return (
    <div
      className={cn(
        'h-2 cursor-row-resize shrink-0 transition-colors flex items-center justify-center group',
        isDragging ? 'bg-accent-primary/20' : 'hover:bg-accent-primary/10'
      )}
      onMouseDown={handleMouseDown}
    >
      <div
        className={cn(
          'w-12 h-1 rounded-full transition-colors',
          isDragging ? 'bg-accent-primary' : 'bg-border-default group-hover:bg-accent-primary/70'
        )}
      />
    </div>
  );
}

interface HorizontalResizeHandleProps {
  side: SidebarSide;
}

function HorizontalResizeHandle({ side }: HorizontalResizeHandleProps) {
  const { setSidebarWidth, sidebarLayout } = useUIStore();
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = sidebarLayout[side].width;
    },
    [side, sidebarLayout]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startXRef.current;
      // For left sidebar, dragging right increases width
      // For right sidebar, dragging left increases width
      const newWidth =
        side === 'left' ? startWidthRef.current + deltaX : startWidthRef.current - deltaX;
      setSidebarWidth(side, newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, side, setSidebarWidth]);

  return (
    <div
      className={cn(
        'w-1 cursor-col-resize shrink-0 transition-colors hover:bg-accent-primary/50',
        isDragging && 'bg-accent-primary'
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

export function SidebarContainer({ side, sessionId }: SidebarContainerProps) {
  const { sidebarLayout, toggleSidebar, addPanel, removePanel, toggleTerminal, terminalVisible } =
    useUIStore();
  const config = sidebarLayout[side];
  const badgeCounts = useSidebarBadges(sessionId);
  const [isHovering, setIsHovering] = useState(false);

  const handleIconClick = (panelId: PanelId) => {
    const isOnThisSide = config.panels.some((p) => p.panelId === panelId);
    if (isOnThisSide) {
      // Panel is already here - toggle it off
      removePanel(panelId);
      return;
    }
    // Add panel to this sidebar
    addPanel(panelId, side);
  };

  const handleTerminalClick = () => {
    toggleTerminal();
  };

  const handleMouseEnter = () => {
    if (config.collapsed) {
      setIsHovering(true);
    }
  };

  const handleMouseLeave = () => {
    if (config.collapsed) {
      setIsHovering(false);
    }
  };

  // If collapsed, show only icon bar
  if (config.collapsed && !isHovering) {
    return (
      <div className="h-full" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        <aside
          className={cn(
            'flex h-full flex-col border-border-subtle bg-surface transition-all duration-200 w-12',
            side === 'left' ? 'border-r' : 'border-l'
          )}
        >
          <nav className="flex flex-1 flex-col items-center gap-1 py-2">
            {(side === 'left' ? leftPanelIds : rightPanelIds).map((panelId) => {
              const panelConf = panelConfig[panelId];
              const Icon = panelConf.icon;
              const isActive = config.panels.some((p) => p.panelId === panelId);
              const showBadge = badgePanelIds.includes(panelId);
              return (
                <button
                  key={panelId}
                  onClick={() => handleIconClick(panelId)}
                  className={cn(
                    'group relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary',
                    isActive && 'bg-overlay text-accent-primary'
                  )}
                  title={panelConf.label}
                >
                  <Icon className="h-5 w-5" />
                  {showBadge && <SidebarBadge count={badgeCounts[panelId]} />}
                  <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs text-text-primary shadow-panel group-hover:block z-50">
                    {panelConf.label}
                  </span>
                </button>
              );
            })}
            {side === 'left' && (
              <button
                onClick={handleTerminalClick}
                className={cn(
                  'group relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary',
                  terminalVisible && 'bg-overlay text-accent-primary'
                )}
                title="Terminal"
              >
                <Terminal className="h-5 w-5" />
                <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs text-text-primary shadow-panel group-hover:block z-50">
                  Terminal
                </span>
              </button>
            )}
          </nav>
          <div className="border-t border-border-subtle py-2">
            <button
              onClick={() => toggleSidebar(side)}
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary"
              title={`Expand ${side} sidebar`}
            >
              {side === 'left' ? (
                <PanelLeftClose className="h-5 w-5 rotate-180" />
              ) : (
                <PanelRightClose className="h-5 w-5 rotate-180" />
              )}
            </button>
          </div>
        </aside>
      </div>
    );
  }

  // Expanded view
  return (
    <div
      className={cn('flex', side === 'right' && 'flex-row-reverse')}
      data-tour={side === 'left' ? 'sidebar' : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Icon bar */}
      <aside
        className={cn(
          'flex flex-col border-border-subtle bg-surface transition-all duration-200 w-12',
          side === 'left' ? 'border-r' : 'border-l'
        )}
      >
        <nav className="flex flex-1 flex-col items-center gap-1 py-2">
          {(side === 'left' ? leftPanelIds : rightPanelIds).map((panelId) => {
            const panelConf = panelConfig[panelId];
            const Icon = panelConf.icon;
            const isActive = config.panels.some((p) => p.panelId === panelId);
            const showBadge = badgePanelIds.includes(panelId);
            return (
              <button
                key={panelId}
                onClick={() => handleIconClick(panelId)}
                className={cn(
                  'group relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary',
                  isActive && 'bg-overlay text-accent-primary'
                )}
                title={panelConf.label}
              >
                <Icon className="h-5 w-5" />
                {showBadge && <SidebarBadge count={badgeCounts[panelId]} />}
                <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs text-text-primary shadow-panel group-hover:block z-50">
                  {panelConf.label}
                </span>
              </button>
            );
          })}
          {side === 'left' && (
            <button
              onClick={handleTerminalClick}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary',
                terminalVisible && 'bg-overlay text-accent-primary'
              )}
              title="Terminal"
              data-tour="terminal-toggle"
            >
              <Terminal className="h-5 w-5" />
              <span className="absolute left-full ml-2 hidden whitespace-nowrap rounded bg-elevated px-2 py-1 text-xs text-text-primary shadow-panel group-hover:block z-50">
                Terminal
              </span>
            </button>
          )}
        </nav>
        <div className="border-t border-border-subtle py-2">
          <button
            onClick={() => toggleSidebar(side)}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary hover:bg-overlay hover:text-text-primary"
            title={`Collapse ${side} sidebar`}
          >
            {side === 'left' ? (
              <PanelLeftClose className="h-5 w-5" />
            ) : (
              <PanelRightClose className="h-5 w-5" />
            )}
          </button>
        </div>
      </aside>

      {/* Panel area */}
      {config.panels.length > 0 && (
        <>
          <div
            className={cn(
              'flex flex-col bg-surface overflow-hidden',
              side === 'left' ? 'border-r border-border-subtle' : 'border-l border-border-subtle'
            )}
            style={{ width: config.width }}
            data-panel-area
          >
            {config.panels.map((panel, index) => (
              <div key={panel.panelId} className="contents">
                <div style={{ height: `${panel.height}%` }} className="overflow-hidden min-h-0">
                  <SidebarPanel panelId={panel.panelId} sessionId={sessionId} />
                </div>
                {index < config.panels.length - 1 && (
                  <PanelResizeHandle side={side} panelIndex={index} />
                )}
              </div>
            ))}
          </div>
          <HorizontalResizeHandle side={side} />
        </>
      )}
    </div>
  );
}
