'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SheetHeight = 'auto' | 'half' | 'full';

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  height?: SheetHeight;
  /** Allow dragging to resize between half and full */
  draggable?: boolean;
  /** Show close button in header */
  showCloseButton?: boolean;
  /** Custom footer content */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared mobile bottom sheet component with consistent behavior.
 * Features:
 * - Keyboard support (Escape to close, Tab trapping)
 * - Touch drag to resize/close
 * - Backdrop click to close
 * - Accessible (ARIA attributes, focus management)
 */
export function MobileBottomSheet({
  isOpen,
  onClose,
  title,
  icon,
  height: initialHeight = 'auto',
  draggable = true,
  showCloseButton = true,
  footer,
  children,
}: MobileBottomSheetProps) {
  const [currentHeight, setCurrentHeight] = useState<SheetHeight>(initialHeight);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reset height when sheet opens
  useEffect(() => {
    if (isOpen) {
      setCurrentHeight(initialHeight);
      setDragOffset(0);
    }
  }, [isOpen, initialHeight]);

  // Handle escape key and focus trap
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Focus trap: cycle through focusable elements
      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    // Focus the close button when sheet opens
    setTimeout(() => closeButtonRef.current?.focus(), 100);

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Handle touch start on the drag handle
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!draggable) return;
      const touch = e.touches[0];
      if (!touch || !sheetRef.current) return;

      startYRef.current = touch.clientY;
      setIsDragging(true);
      setDragOffset(0);
    },
    [draggable]
  );

  // Handle touch move
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging || !draggable) return;

      const touch = e.touches[0];
      if (!touch) return;

      const deltaY = touch.clientY - startYRef.current;
      setDragOffset(deltaY);

      // Prevent default to stop background scrolling
      e.preventDefault();
    },
    [isDragging, draggable]
  );

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !draggable) return;

    setIsDragging(false);

    // Determine action based on drag distance - increased threshold for better UX
    const threshold = 80;

    if (dragOffset > threshold) {
      // Dragged down
      if (currentHeight === 'half' || currentHeight === 'auto') {
        onClose();
      } else {
        setCurrentHeight('half');
      }
    } else if (dragOffset < -threshold) {
      // Dragged up - expand to full
      setCurrentHeight('full');
    }

    setDragOffset(0);
  }, [isDragging, draggable, dragOffset, currentHeight, onClose]);

  if (!isOpen) return null;

  // Calculate height values
  const heightClasses = {
    auto: 'max-h-[70vh]',
    half: 'h-[50vh]',
    full: 'h-[85vh]',
  };

  // Calculate visual offset during drag
  const visualOffset = isDragging ? Math.max(0, dragOffset) : 0;

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          'absolute inset-x-0 bottom-0 bg-surface border-t border-border-default rounded-t-2xl',
          heightClasses[currentHeight],
          !isDragging && 'transition-all duration-200 ease-out',
          'flex flex-col overflow-hidden'
        )}
        style={{
          transform: `translateY(${visualOffset}px)`,
          opacity: isDragging ? 1 - visualOffset / 300 : 1,
        }}
      >
        {/* Drag handle */}
        {draggable && (
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
            aria-valuenow={currentHeight === 'full' ? 100 : currentHeight === 'half' ? 50 : 30}
          >
            <div
              className={cn(
                'w-10 h-1.5 bg-border-strong rounded-full transition-colors',
                isDragging && 'bg-accent-primary'
              )}
            />
          </div>
        )}

        {/* Header */}
        <div className="px-4 pb-2 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {icon && <span className="text-text-secondary">{icon}</span>}
            <h3 id="sheet-title" className="text-lg font-semibold text-text-primary">
              {title}
            </h3>
          </div>
          {showCloseButton && (
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg hover:bg-surface-hover transition-colors touch-manipulation min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>

        {/* Footer */}
        {footer && <div className="flex-shrink-0 border-t border-border-subtle">{footer}</div>}

        {/* Safe area */}
        <div className="h-safe-bottom flex-shrink-0" />
      </div>
    </div>
  );
}

/**
 * Simple bottom sheet without drag functionality - for menus and selections
 */
interface SimpleBottomSheetProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function SimpleBottomSheet({ title, onClose, children }: SimpleBottomSheetProps) {
  return (
    <MobileBottomSheet
      isOpen={true}
      onClose={onClose}
      title={title}
      height="auto"
      draggable={false}
    >
      {children}
    </MobileBottomSheet>
  );
}
