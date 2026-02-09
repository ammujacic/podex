'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { Button } from '@podex/ui';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    setIsLoading(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Error handling is done in the parent
    } finally {
      setIsLoading(false);
    }
  }, [onConfirm, onClose]);

  const variantStyles = {
    danger: {
      icon: 'text-accent-error',
      iconBg: 'bg-accent-error/10',
      button: 'bg-accent-error hover:bg-accent-error/90',
    },
    warning: {
      icon: 'text-accent-warning',
      iconBg: 'bg-accent-warning/10',
      button: 'bg-accent-warning hover:bg-accent-warning/90',
    },
    default: {
      icon: 'text-accent-primary',
      iconBg: 'bg-accent-primary/10',
      button: 'bg-accent-primary hover:bg-accent-primary/90',
    },
  };

  const styles = variantStyles[variant];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onClose} />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-surface border border-border-default rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-description"
          >
            {/* Header */}
            <div className="flex items-start gap-4 px-5 pt-5">
              <div
                className={`w-10 h-10 rounded-lg ${styles.iconBg} flex items-center justify-center flex-shrink-0`}
              >
                <AlertTriangle className={`w-5 h-5 ${styles.icon}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 id="confirm-dialog-title" className="text-lg font-semibold text-text-primary">
                  {title}
                </h2>
                <p id="confirm-dialog-description" className="text-sm text-text-secondary mt-1">
                  {message}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 mt-4 border-t border-border-subtle">
              <Button
                variant="ghost"
                onClick={onClose}
                disabled={isLoading}
                className="min-h-[44px]"
              >
                {cancelLabel}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isLoading}
                className={`min-h-[44px] ${styles.button} text-white`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  confirmLabel
                )}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook to manage confirm dialog state
export function useConfirmDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'default';
  } | null>(null);

  const openDialog = useCallback(
    (dialogConfig: {
      title: string;
      message: string;
      onConfirm: () => Promise<void> | void;
      confirmLabel?: string;
      cancelLabel?: string;
      variant?: 'danger' | 'warning' | 'default';
    }) => {
      setConfig(dialogConfig);
      setIsOpen(true);
    },
    []
  );

  const closeDialog = useCallback(() => {
    setIsOpen(false);
  }, []);

  const dialogProps = config
    ? {
        isOpen,
        onClose: closeDialog,
        ...config,
      }
    : null;

  return {
    openDialog,
    closeDialog,
    dialogProps,
    ConfirmDialog,
  };
}
