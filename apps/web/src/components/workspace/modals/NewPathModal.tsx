'use client';

import { useState } from 'react';
import { X, FolderPlus, FilePlus2, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createFile, createFolder } from '@/lib/api';
import { useUIStore } from '@/stores/ui';

type NewPathMode = 'file' | 'folder';

interface NewPathModalProps {
  sessionId: string;
  mode: NewPathMode;
  initialPath?: string;
  onClose: () => void;
}

/**
 * Modal for creating a new file or folder by path.
 * Always asks for a path, optionally prefilled from context.
 */
export function NewPathModal({ sessionId, mode, initialPath = '', onClose }: NewPathModalProps) {
  const [path, setPath] = useState(initialPath);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const announce = useUIStore((state) => state.announce);

  const title = mode === 'file' ? 'New File' : 'New Folder';
  const description =
    mode === 'file'
      ? 'Enter a relative path for the new file.'
      : 'Enter a relative path for the new folder.';

  const placeholder = mode === 'file' ? 'e.g. src/components/Button.tsx' : 'e.g. src/components';

  const Icon = mode === 'file' ? FilePlus2 : FolderPlus;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = path.trim();

    if (!trimmed) {
      setError('Path is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (mode === 'file') {
        await createFile(sessionId, trimmed, '');
        announce(`File created: ${trimmed}`);
      } else {
        await createFolder(sessionId, trimmed);
        announce(`Folder created: ${trimmed}`);
      }
      onClose();
    } catch (err: unknown) {
      let message = 'Failed to create path';
      if (typeof err === 'object' && err !== null) {
        if ('detail' in err && typeof (err as { detail: unknown }).detail === 'string') {
          message = (err as { detail: string }).detail;
        } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
          message = (err as { message: string }).message;
        }
      } else if (typeof err === 'string') {
        message = err;
      }
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-path-title"
        className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10"
              aria-hidden="true"
            >
              <Icon className="h-4 w-4 text-accent-primary" />
            </div>
            <div>
              <h2 id="new-path-title" className="text-sm font-semibold text-text-primary">
                {title}
              </h2>
              <p className="text-xs text-text-muted">{description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary min-w-[32px] min-h-[32px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="px-4 py-4 space-y-3">
          <div>
            <label
              htmlFor="new-path-input"
              className="block text-xs font-medium text-text-secondary mb-1"
            >
              Path
            </label>
            <input
              id="new-path-input"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-full rounded-lg border border-border-default bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary min-h-[40px]"
            />
          </div>

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1 pb-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 min-h-[32px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !path.trim()}
              className={cn(
                'rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-text-inverse hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-50 min-h-[32px] flex items-center gap-2'
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>Create {mode === 'file' ? 'File' : 'Folder'}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
