'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for destructive or important actions.
 * Accessible with keyboard support and focus management.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
    >
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full shrink-0',
              confirmVariant === 'danger' ? 'bg-red-500/10' : 'bg-accent-primary/10'
            )}
            aria-hidden="true"
          >
            <AlertTriangle
              className={cn(
                'h-5 w-5',
                confirmVariant === 'danger' ? 'text-red-400' : 'text-accent-primary'
              )}
            />
          </div>
          <div className="flex-1">
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-text-primary">
              {title}
            </h3>
            <p id="confirm-dialog-description" className="mt-2 text-sm text-text-secondary">
              {message}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors cursor-pointer min-h-[44px]"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors cursor-pointer min-h-[44px]',
              confirmVariant === 'danger'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-accent-primary hover:bg-accent-primary/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PromptDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

/**
 * Prompt dialog for user text input.
 * Accessible with keyboard support.
 */
export function PromptDialog({
  isOpen,
  title,
  message,
  defaultValue,
  placeholder,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue || '');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, defaultValue]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-dialog-title"
    >
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl p-6">
        <h3 id="prompt-dialog-title" className="text-lg font-semibold text-text-primary">
          {title}
        </h3>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mt-4 w-full px-3 py-2 bg-elevated border border-border-default rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none min-h-[44px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) {
              onConfirm(value.trim());
            }
          }}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay rounded-lg transition-colors cursor-pointer min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={!value.trim()}
            className="px-4 py-2 text-sm font-medium bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer min-h-[44px]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
