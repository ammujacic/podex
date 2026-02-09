'use client';

import { memo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreVertical, Play, Pause, Trash2, Loader2, Pin, PinOff } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';

interface SessionMenuProps {
  sessionId: string;
  isPinned: boolean;
  status: string;
  workspaceId?: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onPin: () => void;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
  isPinning: boolean;
  isDeleting: boolean;
  isPausing: boolean;
  isResuming: boolean;
}

export const SessionMenu = memo(function SessionMenu({
  sessionId,
  isPinned,
  status,
  workspaceId,
  isOpen,
  onToggle,
  onClose,
  onPin,
  onDelete,
  onPause,
  onResume,
  isPinning,
  isDeleting,
  isPausing,
  isResuming,
}: SessionMenuProps) {
  const menuRef = useClickOutside<HTMLDivElement>(onClose, isOpen);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        className="p-2.5 rounded hover:bg-overlay text-text-muted hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Session options"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-1 w-44 bg-elevated border border-border-default rounded-lg shadow-lg py-1 z-10"
            role="menu"
          >
            <Link
              href={`/session/${sessionId}`}
              className="flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay min-h-[44px]"
              role="menuitem"
              onClick={(e) => e.stopPropagation()}
            >
              <Play className="w-4 h-4" />
              Open
            </Link>

            {status === 'active' && workspaceId && onPause && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPause();
                }}
                disabled={isPausing}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay min-h-[44px] disabled:opacity-50"
                role="menuitem"
              >
                {isPausing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Pause className="w-4 h-4" />
                )}
                Pause
              </button>
            )}

            {status === 'stopped' && workspaceId && onResume && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onResume();
                }}
                disabled={isResuming}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay min-h-[44px] disabled:opacity-50"
                role="menuitem"
              >
                {isResuming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Resume
              </button>
            )}

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPin();
              }}
              disabled={isPinning}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay min-h-[44px] disabled:opacity-50"
              role="menuitem"
            >
              {isPinning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPinned ? (
                <PinOff className="w-4 h-4" />
              ) : (
                <Pin className="w-4 h-4" />
              )}
              {isPinned ? 'Unpin' : 'Pin'}
            </button>

            <div className="h-px bg-border-subtle my-1" role="separator" />

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
              disabled={isDeleting}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-accent-error hover:bg-accent-error/10 min-h-[44px] disabled:opacity-50"
              role="menuitem"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
