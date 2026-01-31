'use client';

import { useRef, useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink, Pencil, Pin, PinOff, Trash2, Loader2 } from 'lucide-react';

interface PodCardMenuProps {
  sessionId: string;
  isPinned: boolean;
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isPinning: boolean;
  isDeleting: boolean;
}

export function PodCardMenu({
  sessionId,
  isPinned,
  isOpen,
  onClose,
  onRename,
  onTogglePin,
  onDelete,
  isPinning,
  isDeleting,
}: PodCardMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute right-0 mt-1 w-40 bg-elevated border border-border-default rounded-lg shadow-lg py-1 z-10"
    >
      <Link
        href={`/session/${sessionId}`}
        className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
      >
        <ExternalLink className="w-4 h-4" />
        Open
      </Link>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRename();
          onClose();
        }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay"
      >
        <Pencil className="w-4 h-4" />
        Rename
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
          onClose();
        }}
        disabled={isPinning}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay disabled:opacity-50"
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
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
          onClose();
        }}
        disabled={isDeleting}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-error hover:bg-overlay disabled:opacity-50"
      >
        {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        Delete
      </button>
    </div>
  );
}
