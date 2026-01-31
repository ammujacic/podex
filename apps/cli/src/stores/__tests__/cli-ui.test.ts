/**
 * Tests for CLI UI store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createCliUiStore } from '../cli-ui';

describe('CLI UI Store', () => {
  let store: ReturnType<typeof createCliUiStore>;

  beforeEach(() => {
    store = createCliUiStore();
  });

  describe('mode', () => {
    it('should default to interactive mode', () => {
      expect(store.getState().mode).toBe('interactive');
    });

    it('should update mode', () => {
      store.getState().setMode('run');
      expect(store.getState().mode).toBe('run');
    });
  });

  describe('input history', () => {
    it('should start with empty history', () => {
      expect(store.getState().inputHistory).toHaveLength(0);
    });

    it('should add to history', () => {
      store.getState().addToHistory('first command');
      store.getState().addToHistory('second command');

      expect(store.getState().inputHistory).toHaveLength(2);
      expect(store.getState().inputHistory[0]).toBe('second command');
      expect(store.getState().inputHistory[1]).toBe('first command');
    });

    it('should not add empty strings to history', () => {
      store.getState().addToHistory('');
      store.getState().addToHistory('   ');

      expect(store.getState().inputHistory).toHaveLength(0);
    });

    it('should not add duplicate of last entry', () => {
      store.getState().addToHistory('same command');
      store.getState().addToHistory('same command');

      expect(store.getState().inputHistory).toHaveLength(1);
    });

    it('should navigate history up', () => {
      store.getState().addToHistory('first');
      store.getState().addToHistory('second');

      const first = store.getState().navigateHistory('up');
      expect(first).toBe('second');

      const second = store.getState().navigateHistory('up');
      expect(second).toBe('first');

      // Should stay at the end
      const still = store.getState().navigateHistory('up');
      expect(still).toBe('first');
    });

    it('should navigate history down', () => {
      store.getState().addToHistory('first');
      store.getState().addToHistory('second');

      store.getState().navigateHistory('up');
      store.getState().navigateHistory('up');

      const second = store.getState().navigateHistory('down');
      expect(second).toBe('second');

      const empty = store.getState().navigateHistory('down');
      expect(empty).toBe('');
    });

    it('should clear history', () => {
      store.getState().addToHistory('command');
      store.getState().clearHistory();

      expect(store.getState().inputHistory).toHaveLength(0);
      expect(store.getState().historyIndex).toBe(-1);
    });
  });

  describe('loading state', () => {
    it('should default to not loading', () => {
      expect(store.getState().isLoading).toBe(false);
      expect(store.getState().loadingMessage).toBeNull();
    });

    it('should set loading state with message', () => {
      store.getState().setLoading(true, 'Loading...');

      expect(store.getState().isLoading).toBe(true);
      expect(store.getState().loadingMessage).toBe('Loading...');
    });

    it('should clear loading message when not loading', () => {
      store.getState().setLoading(true, 'Loading...');
      store.getState().setLoading(false);

      expect(store.getState().isLoading).toBe(false);
      expect(store.getState().loadingMessage).toBeNull();
    });
  });

  describe('error state', () => {
    it('should default to no error', () => {
      expect(store.getState().error).toBeNull();
    });

    it('should set and clear error', () => {
      store.getState().setError('Something went wrong');
      expect(store.getState().error).toBe('Something went wrong');

      store.getState().setError(null);
      expect(store.getState().error).toBeNull();
    });
  });

  describe('pending approval', () => {
    it('should default to no pending approval', () => {
      expect(store.getState().pendingApprovalId).toBeNull();
    });

    it('should set and clear pending approval', () => {
      store.getState().setPendingApproval('approval-123');
      expect(store.getState().pendingApprovalId).toBe('approval-123');

      store.getState().setPendingApproval(null);
      expect(store.getState().pendingApprovalId).toBeNull();
    });
  });
});
