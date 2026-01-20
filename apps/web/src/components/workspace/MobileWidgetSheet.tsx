'use client';

import { useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type WidgetId =
  | 'files'
  | 'git'
  | 'github'
  | 'search'
  | 'problems'
  | 'agents'
  | 'mcp'
  | 'extensions'
  | 'usage'
  | 'terminal'
  | 'sentry'
  | 'preview';

interface MobileWidgetSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  height?: 'half' | 'full';
  children: React.ReactNode;
}

export function MobileWidgetSheet({
  isOpen,
  onClose,
  title,
  icon,
  height: initialHeight = 'half',
  children,
}: MobileWidgetSheetProps) {
  // State for current height (can be dragged between half and full)
  const [currentHeight, setCurrentHeight] = useState(initialHeight);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Get height values in vh
  const heightVh = currentHeight === 'half' ? 50 : 85;

  // Handle touch start on the drag handle
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch || !sheetRef.current) return;

    startYRef.current = touch.clientY;
    startHeightRef.current = sheetRef.current.getBoundingClientRect().height;
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
      setDragOffset(deltaY);

      // Prevent default to stop background scrolling
      e.preventDefault();
    },
    [isDragging]
  );

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;

    setIsDragging(false);

    // Determine action based on drag distance - increased threshold for better UX
    const threshold = 80;

    if (dragOffset > threshold) {
      // Dragged down
      if (currentHeight === 'half') {
        // Close if already at half height
        onClose();
      } else {
        // Go to half height if at full
        setCurrentHeight('half');
      }
    } else if (dragOffset < -threshold) {
      // Dragged up - expand to full
      setCurrentHeight('full');
    }

    setDragOffset(0);
  }, [isDragging, dragOffset, currentHeight, onClose]);

  if (!isOpen) return null;

  // Calculate visual offset during drag
  const visualOffset = isDragging ? Math.max(0, dragOffset) : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-40 md:hidden"
        onClick={onClose}
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
          height: `${heightVh}vh`,
          transform: `translateY(${visualOffset}px)`,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Handle bar for drag - touch-action: none prevents background scroll */}
        <div
          className="flex justify-center pt-3 pb-2 flex-shrink-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          role="slider"
          aria-label="Drag to resize or close"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={currentHeight === 'full' ? 100 : 50}
        >
          <div
            className={cn(
              'w-10 h-1.5 bg-border-strong rounded-full transition-all',
              isDragging && 'w-14 bg-accent-primary'
            )}
          />
        </div>

        {/* Header */}
        <div className="px-4 pb-3 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {icon && (
                <span className="text-text-secondary" aria-hidden="true">
                  {icon}
                </span>
              )}
              <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg hover:bg-surface-hover transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {/* Safe area */}
        <div className="h-safe-bottom flex-shrink-0" />
      </div>
    </>
  );
}
