'use client';

import { useRef, useCallback, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { MobileCodeEditor } from './MobileCodeEditor';

export function MobileFileViewerSheet() {
  const mobileOpenFile = useUIStore((state) => state.mobileOpenFile);
  const closeMobileFile = useUIStore((state) => state.closeMobileFile);

  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [copied, setCopied] = useState(false);
  const startYRef = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Handle touch start on the drag handle
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    startYRef.current = touch.clientY;
    setIsDragging(true);
    setDragOffset(0);
  }, []);

  // Handle touch move
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaY = touch.clientY - startYRef.current;
      setDragOffset(Math.max(0, deltaY)); // Only allow dragging down

      e.preventDefault();
    },
    [isDragging]
  );

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    // Close if dragged down far enough
    const threshold = 100;
    if (dragOffset > threshold) {
      closeMobileFile();
    }

    setDragOffset(0);
  }, [isDragging, dragOffset, closeMobileFile]);

  // Copy file path to clipboard
  const handleCopyPath = useCallback(async () => {
    if (!mobileOpenFile) return;
    try {
      await navigator.clipboard.writeText(mobileOpenFile.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  }, [mobileOpenFile]);

  if (!mobileOpenFile) return null;

  // Get just the filename for the header
  const filename = mobileOpenFile.path.split('/').pop() || mobileOpenFile.path;

  const visualOffset = isDragging ? dragOffset : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-40 md:hidden"
        onClick={closeMobileFile}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 md:hidden',
          'bg-surface border-t border-border-default rounded-t-2xl',
          !isDragging && 'transition-all duration-200 ease-out',
          'flex flex-col'
        )}
        style={{
          height: '90vh',
          transform: `translateY(${visualOffset}px)`,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Viewing ${filename}`}
      >
        {/* Handle bar for drag */}
        <div
          className="flex justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1.5 bg-border-strong rounded-full" />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 mr-3">
              <h2 className="text-lg font-semibold text-text-primary truncate">{filename}</h2>
              <button
                onClick={handleCopyPath}
                className="text-xs text-text-tertiary hover:text-text-secondary flex items-center gap-1 mt-0.5"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-status-success" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span className="truncate max-w-[200px]">{mobileOpenFile.path}</span>
                  </>
                )}
              </button>
            </div>
            <button
              onClick={closeMobileFile}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-hover transition-colors touch-manipulation flex-shrink-0"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Editor content */}
        <div className="flex-1 min-h-0 p-2">
          <MobileCodeEditor
            value={mobileOpenFile.content}
            language={mobileOpenFile.language}
            readOnly
            className="h-full max-h-full"
          />
        </div>

        {/* Safe area */}
        <div className="h-safe-bottom flex-shrink-0" />
      </div>
    </>
  );
}
