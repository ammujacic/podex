'use client';

import { useCallback, useState, useRef, type DragEvent } from 'react';
import { X, Circle, SplitSquareHorizontal, SplitSquareVertical, Copy, Columns } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { useEditorStore, type EditorTab } from '@/stores/editor';

// File type icons (simple colored circles for now)
const getFileIcon = (language: string): { color: string; label: string } => {
  const iconMap: Record<string, { color: string; label: string }> = {
    typescript: { color: '#3178c6', label: 'TS' },
    javascript: { color: '#f7df1e', label: 'JS' },
    python: { color: '#3776ab', label: 'PY' },
    rust: { color: '#dea584', label: 'RS' },
    go: { color: '#00add8', label: 'GO' },
    html: { color: '#e34c26', label: 'HTML' },
    css: { color: '#264de4', label: 'CSS' },
    json: { color: '#cbcb41', label: 'JSON' },
    markdown: { color: '#083fa1', label: 'MD' },
    yaml: { color: '#cb171e', label: 'YAML' },
    dockerfile: { color: '#2496ed', label: 'DOCKER' },
    shell: { color: '#89e051', label: 'SH' },
    sql: { color: '#e38c00', label: 'SQL' },
  };
  return iconMap[language] || { color: '#9898a8', label: '' };
};

interface TabItemProps {
  tab: EditorTab;
  isActive: boolean;
  onClose: () => void;
  onClick: () => void;
  onDoubleClick: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function TabItem({
  tab,
  isActive,
  onClose,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDrop,
  onContextMenu,
}: TabItemProps) {
  const icon = getFileIcon(tab.language);

  return (
    <div
      className={cn(
        'group relative flex h-9 min-w-[120px] max-w-[200px] cursor-pointer items-center gap-2 border-r border-border-subtle px-3',
        'transition-colors duration-100',
        isActive
          ? 'bg-surface text-text-primary'
          : 'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary',
        tab.isPreview && 'italic'
      )}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      {/* Active indicator */}
      {isActive && <div className="absolute inset-x-0 top-0 h-[2px] bg-accent-primary" />}

      {/* File icon */}
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-bold"
        style={{ backgroundColor: icon.color + '20', color: icon.color }}
      >
        {icon.label.slice(0, 2)}
      </div>

      {/* File name */}
      <span className="flex-1 truncate text-xs">{tab.name}</span>

      {/* Dirty indicator or close button */}
      <div className="flex h-4 w-4 shrink-0 items-center justify-center">
        {tab.isDirty ? (
          <Circle className="h-2 w-2 fill-accent-warning text-accent-warning" />
        ) : (
          <button
            className={cn(
              'rounded p-0.5 opacity-0 transition-opacity hover:bg-overlay',
              'group-hover:opacity-100',
              isActive && 'opacity-50'
            )}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

interface EditorTabsProps {
  paneId: string;
  className?: string;
}

export function EditorTabs({ paneId, className }: EditorTabsProps) {
  const tabs = useEditorStore((s) => s.getTabsForPane(paneId));
  const pane = useEditorStore((s) => s.panes[paneId]);
  const activeTabId = pane?.activeTabId;

  const closeTab = useEditorStore((s) => s.closeTab);
  const closeOtherTabs = useEditorStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useEditorStore((s) => s.closeTabsToRight);
  const closeAllTabs = useEditorStore((s) => s.closeAllTabs);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const pinTab = useEditorStore((s) => s.pinTab);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);
  const splitPane = useEditorStore((s) => s.splitPane);
  const moveTabToPane = useEditorStore((s) => s.moveTabToPane);
  const paneOrder = useEditorStore((s) => s.paneOrder);

  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [contextMenuTab, setContextMenuTab] = useState<EditorTab | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: DragEvent, tabId: string) => {
    setDraggedTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent, targetTabId: string) => {
      e.preventDefault();
      if (!draggedTabId || draggedTabId === targetTabId) return;

      const fromIndex = tabs.findIndex((t) => t.id === draggedTabId);
      const toIndex = tabs.findIndex((t) => t.id === targetTabId);

      if (fromIndex !== -1 && toIndex !== -1) {
        reorderTabs(paneId, fromIndex, toIndex);
      }

      setDraggedTabId(null);
    },
    [draggedTabId, tabs, paneId, reorderTabs]
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: EditorTab) => {
    e.preventDefault();
    setContextMenuTab(tab);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handleSplitRight = useCallback(() => {
    if (!contextMenuTab) return;
    const newPaneId = splitPane(paneId, 'horizontal');
    moveTabToPane(contextMenuTab.id, newPaneId);
    setContextMenuTab(null);
  }, [contextMenuTab, paneId, splitPane, moveTabToPane]);

  const handleSplitDown = useCallback(() => {
    if (!contextMenuTab) return;
    const newPaneId = splitPane(paneId, 'vertical');
    moveTabToPane(contextMenuTab.id, newPaneId);
    setContextMenuTab(null);
  }, [contextMenuTab, paneId, splitPane, moveTabToPane]);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-9 items-stretch overflow-x-auto border-b border-border-default bg-elevated',
        'scrollbar-thin scrollbar-thumb-border-strong scrollbar-track-transparent',
        className
      )}
    >
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onClose={() => closeTab(tab.id)}
          onClick={() => setActiveTab(tab.id)}
          onDoubleClick={() => pinTab(tab.id)}
          onDragStart={(e) => handleDragStart(e, tab.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab)}
        />
      ))}

      {/* Context Menu */}
      {contextMenuTab && (
        <DropdownMenu
          open={!!contextMenuTab}
          onOpenChange={(open) => !open && setContextMenuTab(null)}
        >
          <DropdownMenuTrigger asChild>
            <div
              className="fixed"
              style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start" side="bottom" sideOffset={0}>
            <DropdownMenuItem onClick={() => closeTab(contextMenuTab.id)}>
              <X className="mr-2 h-4 w-4" />
              Close
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => closeOtherTabs(contextMenuTab.id)}>
              Close Others
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => closeTabsToRight(contextMenuTab.id)}>
              Close to the Right
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => closeAllTabs(paneId)}>Close All</DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(contextMenuTab.path)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Path
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={handleSplitRight}>
              <SplitSquareHorizontal className="mr-2 h-4 w-4" />
              Split Right
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSplitDown}>
              <SplitSquareVertical className="mr-2 h-4 w-4" />
              Split Down
            </DropdownMenuItem>

            {paneOrder.length > 1 && (
              <>
                <DropdownMenuSeparator />
                {paneOrder
                  .filter((id) => id !== paneId)
                  .map((targetPaneId, index) => (
                    <DropdownMenuItem
                      key={targetPaneId}
                      onClick={() => {
                        moveTabToPane(contextMenuTab.id, targetPaneId);
                        setContextMenuTab(null);
                      }}
                    >
                      <Columns className="mr-2 h-4 w-4" />
                      Move to Pane {index + 1}
                    </DropdownMenuItem>
                  ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Empty state when no tabs are open
export function EditorEmptyState({ paneId: _paneId }: { paneId: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface text-text-muted">
      <div className="mb-4 text-4xl opacity-20">{'</>'}</div>
      <p className="text-sm">No file open</p>
      <p className="mt-1 text-xs opacity-60">
        Open a file from the sidebar or use{' '}
        <kbd className="rounded bg-overlay px-1.5 py-0.5 text-xs">Cmd+P</kbd>
      </p>
    </div>
  );
}
