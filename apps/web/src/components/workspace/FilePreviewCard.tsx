'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { X, Pin, PinOff, Maximize2, Copy, Check, LayoutGrid } from 'lucide-react';
import { CodeEditor, getLanguageFromPath } from './CodeEditor';
import type { FilePreview } from '@/stores/session';
import { cn } from '@/lib/utils';

interface FilePreviewCardProps {
  preview: FilePreview;
  onClose: () => void;
  onPin: (pinned: boolean) => void;
  onExpand: () => void;
  onUpdate: (updates: Partial<FilePreview>) => void;
  onDock?: () => void;
}

const MIN_WIDTH = 400;
const MIN_HEIGHT = 250;
const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 350;

export function FilePreviewCard({
  preview,
  onClose,
  onPin,
  onExpand,
  onUpdate,
  onDock,
}: FilePreviewCardProps) {
  const [copied, setCopied] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Use motion values for smooth dragging
  const x = useMotionValue(preview.position.x);
  const y = useMotionValue(preview.position.y);

  const width = preview.position.width ?? DEFAULT_WIDTH;
  const height = preview.position.height ?? DEFAULT_HEIGHT;

  // Sync motion values when position changes
  useEffect(() => {
    x.set(preview.position.x);
    y.set(preview.position.y);
  }, [preview.position.x, preview.position.y, x, y]);

  const handleDragEnd = useCallback(() => {
    onUpdate({
      position: {
        ...preview.position,
        x: x.get(),
        y: y.get(),
      },
    });
  }, [onUpdate, preview.position, x, y]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width,
        height,
      });
    },
    [width, height]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;
      const newWidth = Math.max(MIN_WIDTH, resizeStart.width + deltaX);
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.height + deltaY);
      onUpdate({
        position: {
          ...preview.position,
          width: newWidth,
          height: newHeight,
        },
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart, preview.position, onUpdate]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(preview.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [preview.content]);

  const handleContentChange = useCallback(
    (content: string) => {
      onUpdate({ content });
    },
    [onUpdate]
  );

  // Get filename from path
  const filename = preview.path.split('/').pop() || preview.path;
  const language = preview.language || getLanguageFromPath(preview.path);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      drag
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{
        x,
        y,
        width,
        zIndex: preview.position.zIndex ?? 50,
      }}
      className="absolute overflow-hidden rounded-lg border border-border-default bg-surface shadow-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-elevated px-3 py-2">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="h-2 w-2 rounded-full bg-accent-primary" />
          <span className="truncate text-sm font-medium text-text-primary" title={preview.path}>
            {filename}
          </span>
          <span className="rounded bg-overlay px-1.5 py-0.5 text-xs text-text-muted">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="rounded p-1 text-text-muted transition-colors hover:bg-overlay hover:text-text-secondary"
            title="Copy content"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-accent-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => onPin(!preview.pinned)}
            className={`rounded p-1 transition-colors hover:bg-overlay ${
              preview.pinned ? 'text-accent-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
            title={preview.pinned ? 'Unpin' : 'Pin'}
          >
            {preview.pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
          {onDock && (
            <button
              onClick={onDock}
              className="rounded p-1 text-text-muted transition-colors hover:bg-overlay hover:text-text-secondary"
              title="Dock to grid"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onExpand}
            className="rounded p-1 text-text-muted transition-colors hover:bg-overlay hover:text-text-secondary"
            title="Expand to full editor"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-overlay hover:text-text-secondary"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Editor content */}
      <div style={{ height: height - 80 }}>
        <CodeEditor
          value={preview.content}
          language={language}
          path={preview.path}
          onChange={handleContentChange}
          className="h-full"
        />
      </div>

      {/* Footer */}
      <div className="border-t border-border-subtle bg-elevated px-3 py-1.5">
        <span className="text-xs text-text-muted">{preview.path}</span>
      </div>

      {/* Resize handle */}
      <div
        className={cn(
          'absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10',
          'after:absolute after:bottom-1 after:right-1 after:w-2 after:h-2',
          'after:border-r-2 after:border-b-2 after:border-text-muted after:opacity-50',
          'hover:after:opacity-100'
        )}
        onMouseDown={handleResizeStart}
      />
    </motion.div>
  );
}
