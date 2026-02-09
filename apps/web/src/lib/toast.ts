import { toast } from 'sonner';

interface UndoableAction<T> {
  action: () => Promise<T> | T;
  undo: () => Promise<void> | void;
  message: string;
  undoMessage?: string;
  duration?: number;
}

/**
 * Execute an action that can be undone via toast notification
 */
export async function undoableAction<T>({
  action,
  undo,
  message,
  undoMessage = 'Action undone',
  duration = 5000,
}: UndoableAction<T>): Promise<T | null> {
  let result: T | null = null;
  let undone = false;

  // Execute the action
  result = await action();

  // Show toast with undo button
  toast(message, {
    duration,
    action: {
      label: 'Undo',
      onClick: async () => {
        undone = true;
        try {
          await undo();
          toast.success(undoMessage, { duration: 2000 });
        } catch (error) {
          toast.error('Failed to undo action');
          console.error('Undo failed:', error);
        }
      },
    },
  });

  return undone ? null : result;
}

/**
 * Show a success toast
 */
export function showSuccess(message: string, description?: string) {
  toast.success(message, {
    description,
    duration: 3000,
  });
}

/**
 * Show an error toast
 */
export function showError(message: string, description?: string) {
  toast.error(message, {
    description,
    duration: 5000,
  });
}

/**
 * Show a warning toast
 */
export function showWarning(message: string, description?: string) {
  toast.warning(message, {
    description,
    duration: 4000,
  });
}

/**
 * Show an info toast
 */
export function showInfo(message: string, description?: string) {
  toast.info(message, {
    description,
    duration: 4000,
  });
}

/**
 * Show a loading toast that can be updated
 */
export function showLoading(message: string) {
  return toast.loading(message);
}

/**
 * Update a loading toast to success
 */
export function updateToSuccess(toastId: string | number, message: string) {
  toast.success(message, { id: toastId, duration: 3000 });
}

/**
 * Update a loading toast to error
 */
export function updateToError(toastId: string | number, message: string) {
  toast.error(message, { id: toastId, duration: 5000 });
}

/**
 * Show a promise toast that updates based on promise state
 */
export function showPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((error: Error) => string);
  }
) {
  return toast.promise(promise, messages);
}

/**
 * Dismiss a specific toast
 */
export function dismissToast(toastId: string | number) {
  toast.dismiss(toastId);
}

/**
 * Dismiss all toasts
 */
export function dismissAllToasts() {
  toast.dismiss();
}

/**
 * Custom toast with action buttons
 */
export function showActionToast(
  message: string,
  actions: Array<{
    label: string;
    onClick: () => void;
    variant?: 'default' | 'destructive';
  }>,
  options?: {
    duration?: number;
    description?: string;
  }
) {
  // For now, use primary action only (sonner limitation)
  const primaryAction = actions[0];

  return toast(message, {
    description: options?.description,
    duration: options?.duration ?? 5000,
    action: primaryAction
      ? {
          label: primaryAction.label,
          onClick: primaryAction.onClick,
        }
      : undefined,
  });
}

/**
 * Confirmation toast (user must click to dismiss)
 */
export function showConfirmation(message: string, onConfirm: () => void, onCancel?: () => void) {
  return toast(message, {
    duration: Infinity,
    action: {
      label: 'Confirm',
      onClick: onConfirm,
    },
    cancel: onCancel
      ? {
          label: 'Cancel',
          onClick: onCancel,
        }
      : undefined,
  });
}
