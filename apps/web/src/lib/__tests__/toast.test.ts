/**
 * Tests for toast.ts utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'sonner';
import {
  undoableAction,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showLoading,
  updateToSuccess,
  updateToError,
  showPromise,
  dismissToast,
  dismissAllToasts,
  showActionToast,
  showConfirmation,
} from '../toast';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

describe('toast utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('undoableAction', () => {
    it('executes the action and shows toast', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn();

      const result = await undoableAction({
        action,
        undo,
        message: 'Action completed',
      });

      expect(action).toHaveBeenCalled();
      expect(result).toBe('result');
      expect(toast).toHaveBeenCalledWith('Action completed', expect.any(Object));
    });

    it('includes undo button in toast', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn();

      await undoableAction({
        action,
        undo,
        message: 'Test message',
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]).toHaveProperty('action');
      expect(toastCall[1]?.action).toHaveProperty('label', 'Undo');
    });

    it('uses custom duration', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn();

      await undoableAction({
        action,
        undo,
        message: 'Test',
        duration: 10000,
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.duration).toBe(10000);
    });

    it('uses default duration of 5000ms', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn();

      await undoableAction({
        action,
        undo,
        message: 'Test',
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.duration).toBe(5000);
    });

    it('when user clicks Undo, undo is called and success toast shown', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn().mockResolvedValue(undefined);

      const resultPromise = undoableAction({
        action,
        undo,
        message: 'Done',
        undoMessage: 'Reverted',
      });
      await Promise.resolve();

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall).toBeDefined();
      const onClick = toastCall?.[1]?.action?.onClick;
      expect(onClick).toBeDefined();
      await onClick?.();

      expect(undo).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Reverted', { duration: 2000 });
      const result = await resultPromise;
      expect(result).toBe('result');
    });

    it('when Undo throws, error toast is shown', async () => {
      const action = vi.fn().mockResolvedValue('result');
      const undo = vi.fn().mockRejectedValue(new Error('undo failed'));

      await undoableAction({
        action,
        undo,
        message: 'Done',
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      const onClick = toastCall[1]?.action?.onClick;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await onClick?.();

      expect(toast.error).toHaveBeenCalledWith('Failed to undo action');
      consoleSpy.mockRestore();
    });
  });

  describe('showSuccess', () => {
    it('calls toast.success with message', () => {
      showSuccess('Success message');

      expect(toast.success).toHaveBeenCalledWith('Success message', {
        description: undefined,
        duration: 3000,
      });
    });

    it('includes description when provided', () => {
      showSuccess('Success', 'Additional details');

      expect(toast.success).toHaveBeenCalledWith('Success', {
        description: 'Additional details',
        duration: 3000,
      });
    });
  });

  describe('showError', () => {
    it('calls toast.error with message', () => {
      showError('Error message');

      expect(toast.error).toHaveBeenCalledWith('Error message', {
        description: undefined,
        duration: 5000,
      });
    });

    it('includes description when provided', () => {
      showError('Error', 'Error details');

      expect(toast.error).toHaveBeenCalledWith('Error', {
        description: 'Error details',
        duration: 5000,
      });
    });

    it('has longer duration than success toast', () => {
      showError('Error');
      showSuccess('Success');

      const errorCall = vi.mocked(toast.error).mock.calls[0];
      const successCall = vi.mocked(toast.success).mock.calls[0];

      expect(errorCall[1]?.duration).toBeGreaterThan(successCall[1]?.duration ?? 0);
    });
  });

  describe('showWarning', () => {
    it('calls toast.warning with message', () => {
      showWarning('Warning message');

      expect(toast.warning).toHaveBeenCalledWith('Warning message', {
        description: undefined,
        duration: 4000,
      });
    });

    it('includes description when provided', () => {
      showWarning('Warning', 'Warning details');

      expect(toast.warning).toHaveBeenCalledWith('Warning', {
        description: 'Warning details',
        duration: 4000,
      });
    });
  });

  describe('showInfo', () => {
    it('calls toast.info with message', () => {
      showInfo('Info message');

      expect(toast.info).toHaveBeenCalledWith('Info message', {
        description: undefined,
        duration: 4000,
      });
    });

    it('includes description when provided', () => {
      showInfo('Info', 'More information');

      expect(toast.info).toHaveBeenCalledWith('Info', {
        description: 'More information',
        duration: 4000,
      });
    });
  });

  describe('showLoading', () => {
    it('calls toast.loading with message', () => {
      showLoading('Loading...');

      expect(toast.loading).toHaveBeenCalledWith('Loading...');
    });

    it('returns toast id', () => {
      vi.mocked(toast.loading).mockReturnValue('toast-123');

      const result = showLoading('Loading...');

      expect(result).toBe('toast-123');
    });
  });

  describe('updateToSuccess', () => {
    it('updates toast to success state', () => {
      updateToSuccess('toast-123', 'Completed!');

      expect(toast.success).toHaveBeenCalledWith('Completed!', {
        id: 'toast-123',
        duration: 3000,
      });
    });

    it('works with numeric toast id', () => {
      updateToSuccess(123, 'Done');

      expect(toast.success).toHaveBeenCalledWith('Done', {
        id: 123,
        duration: 3000,
      });
    });
  });

  describe('updateToError', () => {
    it('updates toast to error state', () => {
      updateToError('toast-123', 'Failed!');

      expect(toast.error).toHaveBeenCalledWith('Failed!', {
        id: 'toast-123',
        duration: 5000,
      });
    });

    it('works with numeric toast id', () => {
      updateToError(456, 'Error occurred');

      expect(toast.error).toHaveBeenCalledWith('Error occurred', {
        id: 456,
        duration: 5000,
      });
    });
  });

  describe('showPromise', () => {
    it('calls toast.promise with promise and messages', () => {
      const promise = Promise.resolve('data');
      const messages = {
        loading: 'Loading...',
        success: 'Loaded!',
        error: 'Failed to load',
      };

      showPromise(promise, messages);

      expect(toast.promise).toHaveBeenCalledWith(promise, messages);
    });

    it('supports dynamic success message', () => {
      const promise = Promise.resolve({ count: 5 });
      const messages = {
        loading: 'Loading...',
        success: (data: { count: number }) => `Loaded ${data.count} items`,
        error: 'Failed',
      };

      showPromise(promise, messages);

      expect(toast.promise).toHaveBeenCalledWith(promise, messages);
    });

    it('supports dynamic error message', () => {
      const promise = Promise.reject(new Error('Network error'));
      // Handle the rejection to prevent unhandled rejection warning
      promise.catch(() => {}); // noop to prevent unhandled rejection

      const messages = {
        loading: 'Loading...',
        success: 'Done',
        error: (err: Error) => `Error: ${err.message}`,
      };

      showPromise(promise, messages);

      expect(toast.promise).toHaveBeenCalledWith(promise, messages);
    });
  });

  describe('dismissToast', () => {
    it('dismisses specific toast by id', () => {
      dismissToast('toast-123');

      expect(toast.dismiss).toHaveBeenCalledWith('toast-123');
    });

    it('works with numeric toast id', () => {
      dismissToast(789);

      expect(toast.dismiss).toHaveBeenCalledWith(789);
    });
  });

  describe('dismissAllToasts', () => {
    it('dismisses all toasts', () => {
      dismissAllToasts();

      expect(toast.dismiss).toHaveBeenCalledWith();
    });
  });

  describe('showActionToast', () => {
    it('shows toast with action button', () => {
      const onClick = vi.fn();
      showActionToast('Click me', [{ label: 'Action', onClick }]);

      expect(toast).toHaveBeenCalledWith('Click me', {
        description: undefined,
        duration: 5000,
        action: {
          label: 'Action',
          onClick,
        },
      });
    });

    it('uses custom duration', () => {
      showActionToast('Message', [{ label: 'Click', onClick: vi.fn() }], { duration: 10000 });

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.duration).toBe(10000);
    });

    it('includes description', () => {
      showActionToast('Message', [{ label: 'Click', onClick: vi.fn() }], {
        description: 'More info',
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.description).toBe('More info');
    });

    it('handles empty actions array', () => {
      showActionToast('Message', []);

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.action).toBeUndefined();
    });

    it('uses only primary action (first in array)', () => {
      const onClick1 = vi.fn();
      const onClick2 = vi.fn();
      showActionToast('Message', [
        { label: 'Primary', onClick: onClick1 },
        { label: 'Secondary', onClick: onClick2 },
      ]);

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.action?.label).toBe('Primary');
    });
  });

  describe('showConfirmation', () => {
    it('shows confirmation toast with infinite duration', () => {
      const onConfirm = vi.fn();
      showConfirmation('Are you sure?', onConfirm);

      expect(toast).toHaveBeenCalledWith('Are you sure?', {
        duration: Infinity,
        action: {
          label: 'Confirm',
          onClick: onConfirm,
        },
        cancel: undefined,
      });
    });

    it('includes cancel button when callback provided', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      showConfirmation('Delete?', onConfirm, onCancel);

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.cancel).toEqual({
        label: 'Cancel',
        onClick: onCancel,
      });
    });

    it('omits cancel button when no callback', () => {
      const onConfirm = vi.fn();
      showConfirmation('Proceed?', onConfirm);

      const toastCall = vi.mocked(toast).mock.calls[0];
      expect(toastCall[1]?.cancel).toBeUndefined();
    });
  });
});
