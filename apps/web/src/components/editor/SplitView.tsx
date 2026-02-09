'use client';

import { useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useEditorStore, type SplitLayout, type SplitPane } from '@/stores/editor';

// ============================================================================
// Resizer Component
// ============================================================================

interface ResizerProps {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  className?: string;
}

function Resizer({ direction, onResize, className }: ResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
    },
    [direction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPosRef.current;
      onResize(delta);
      startPosRef.current = currentPos;
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
  }, [isDragging, direction, onResize]);

  return (
    <div
      className={cn(
        'group relative z-10 flex-shrink-0 transition-colors',
        direction === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-accent-primary/50'
          : 'h-1 cursor-row-resize hover:bg-accent-primary/50',
        isDragging && 'bg-accent-primary',
        className
      )}
      onMouseDown={handleMouseDown}
    >
      {/* Larger hit area */}
      <div
        className={cn(
          'absolute',
          direction === 'horizontal'
            ? '-left-1 -right-1 top-0 bottom-0'
            : 'left-0 right-0 -top-1 -bottom-1'
        )}
      />
    </div>
  );
}

// ============================================================================
// EditorPane Component
// ============================================================================

interface EditorPaneProps {
  pane: SplitPane;
  children: ReactNode;
  isActive: boolean;
  onFocus: () => void;
  style?: React.CSSProperties;
}

function EditorPane({ pane: _pane, children, isActive, onFocus, style }: EditorPaneProps) {
  return (
    <div
      className={cn('flex flex-col overflow-hidden', isActive && 'ring-1 ring-accent-primary/30')}
      style={style}
      onClick={onFocus}
    >
      {children}
    </div>
  );
}

// ============================================================================
// SplitView Component
// ============================================================================

interface SplitViewProps {
  renderPane: (paneId: string) => ReactNode;
  className?: string;
}

export function SplitView({ renderPane, className }: SplitViewProps) {
  const splitLayout = useEditorStore((s) => s.splitLayout);
  const panes = useEditorStore((s) => s.panes);
  const paneOrder = useEditorStore((s) => s.paneOrder);
  const activePaneId = useEditorStore((s) => s.activePaneId);
  const setActivePane = useEditorStore((s) => s.setActivePane);
  const resizePane = useEditorStore((s) => s.resizePane);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleResize = useCallback(
    (paneId: string, delta: number, direction: 'horizontal' | 'vertical') => {
      const pane = panes[paneId];
      if (!pane) return;

      const totalSize = direction === 'horizontal' ? containerSize.width : containerSize.height;
      const deltaPercent = (delta / totalSize) * 100;
      const newSize = Math.max(10, Math.min(90, pane.size + deltaPercent));

      resizePane(paneId, newSize);
    },
    [panes, containerSize, resizePane]
  );

  const orderedPanes = paneOrder.map((id) => panes[id]).filter(Boolean) as SplitPane[];

  // Render based on layout type
  const renderLayout = () => {
    switch (splitLayout) {
      case 'single': {
        const firstPane = orderedPanes[0];
        if (!firstPane) return null;
        return (
          <EditorPane
            pane={firstPane}
            isActive={firstPane.id === activePaneId}
            onFocus={() => setActivePane(firstPane.id)}
            style={{ flex: 1 }}
          >
            {renderPane(firstPane.id)}
          </EditorPane>
        );
      }

      case 'horizontal':
        return (
          <div className="flex h-full">
            {orderedPanes.map((pane, index) => (
              <div key={pane.id} className="flex h-full" style={{ flex: pane.size }}>
                <EditorPane
                  pane={pane}
                  isActive={pane.id === activePaneId}
                  onFocus={() => setActivePane(pane.id)}
                  style={{ flex: 1 }}
                >
                  {renderPane(pane.id)}
                </EditorPane>
                {index < orderedPanes.length - 1 && (
                  <Resizer
                    direction="horizontal"
                    onResize={(delta) => handleResize(pane.id, delta, 'horizontal')}
                  />
                )}
              </div>
            ))}
          </div>
        );

      case 'vertical':
        return (
          <div className="flex h-full flex-col">
            {orderedPanes.map((pane, index) => (
              <div key={pane.id} className="flex flex-col" style={{ flex: pane.size }}>
                <EditorPane
                  pane={pane}
                  isActive={pane.id === activePaneId}
                  onFocus={() => setActivePane(pane.id)}
                  style={{ flex: 1 }}
                >
                  {renderPane(pane.id)}
                </EditorPane>
                {index < orderedPanes.length - 1 && (
                  <Resizer
                    direction="vertical"
                    onResize={(delta) => handleResize(pane.id, delta, 'vertical')}
                  />
                )}
              </div>
            ))}
          </div>
        );

      case 'quad': {
        // 2x2 grid layout
        const topPanes = orderedPanes.slice(0, 2);
        const bottomPanes = orderedPanes.slice(2, 4);

        return (
          <div className="flex h-full flex-col">
            {/* Top row */}
            <div className="flex" style={{ flex: 50 }}>
              {topPanes.map((pane, index) => (
                <div key={pane.id} className="flex" style={{ flex: pane.size }}>
                  <EditorPane
                    pane={pane}
                    isActive={pane.id === activePaneId}
                    onFocus={() => setActivePane(pane.id)}
                    style={{ flex: 1 }}
                  >
                    {renderPane(pane.id)}
                  </EditorPane>
                  {index < topPanes.length - 1 && (
                    <Resizer
                      direction="horizontal"
                      onResize={(delta) => handleResize(pane.id, delta, 'horizontal')}
                    />
                  )}
                </div>
              ))}
            </div>

            {bottomPanes.length > 0 && (
              <>
                <Resizer
                  direction="vertical"
                  onResize={(delta) => handleResize(topPanes[0]?.id || '', delta, 'vertical')}
                />

                {/* Bottom row */}
                <div className="flex" style={{ flex: 50 }}>
                  {bottomPanes.map((pane, index) => (
                    <div key={pane.id} className="flex" style={{ flex: pane.size }}>
                      <EditorPane
                        pane={pane}
                        isActive={pane.id === activePaneId}
                        onFocus={() => setActivePane(pane.id)}
                        style={{ flex: 1 }}
                      >
                        {renderPane(pane.id)}
                      </EditorPane>
                      {index < bottomPanes.length - 1 && (
                        <Resizer
                          direction="horizontal"
                          onResize={(delta) => handleResize(pane.id, delta, 'horizontal')}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div ref={containerRef} className={cn('flex h-full w-full bg-surface', className)}>
      {renderLayout()}
    </div>
  );
}

// ============================================================================
// Layout Toggle Component
// ============================================================================

interface LayoutToggleProps {
  className?: string;
}

export function LayoutToggle({ className }: LayoutToggleProps) {
  const splitLayout = useEditorStore((s) => s.splitLayout);
  const setSplitLayout = useEditorStore((s) => s.setSplitLayout);

  const layouts: { value: SplitLayout; icon: ReactNode; label: string }[] = [
    {
      value: 'single',
      icon: <div className="h-3 w-4 rounded-sm border border-current" />,
      label: 'Single',
    },
    {
      value: 'horizontal',
      icon: (
        <div className="flex h-3 w-4 gap-px">
          <div className="flex-1 rounded-sm border border-current" />
          <div className="flex-1 rounded-sm border border-current" />
        </div>
      ),
      label: 'Split Horizontal',
    },
    {
      value: 'vertical',
      icon: (
        <div className="flex h-3 w-4 flex-col gap-px">
          <div className="flex-1 rounded-sm border border-current" />
          <div className="flex-1 rounded-sm border border-current" />
        </div>
      ),
      label: 'Split Vertical',
    },
    {
      value: 'quad',
      icon: (
        <div className="grid h-3 w-4 grid-cols-2 gap-px">
          <div className="rounded-sm border border-current" />
          <div className="rounded-sm border border-current" />
          <div className="rounded-sm border border-current" />
          <div className="rounded-sm border border-current" />
        </div>
      ),
      label: 'Quad',
    },
  ];

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {layouts.map((layout) => (
        <button
          key={layout.value}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            splitLayout === layout.value
              ? 'bg-overlay text-text-primary'
              : 'text-text-muted hover:bg-overlay hover:text-text-secondary'
          )}
          onClick={() => setSplitLayout(layout.value)}
          title={layout.label}
        >
          {layout.icon}
        </button>
      ))}
    </div>
  );
}
