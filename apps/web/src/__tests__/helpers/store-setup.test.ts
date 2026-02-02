/**
 * Tests for store test helpers (resetAllStores, resetStore, getStoreState, setStoreState, waitForStoreCondition).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  resetAllStores,
  resetStore,
  getStoreState,
  setStoreState,
  waitForStoreCondition,
} from './store-setup';
import { useSessionStore } from '@/stores/session';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { useEditorStore } from '@/stores/editor';
import { useBillingStore } from '@/stores/billing';

describe('store-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resetAllStores', () => {
    it('should reset session store', async () => {
      await act(async () => {
        resetAllStores();
      });
      const state = useSessionStore.getState();
      expect(state.sessions).toEqual({});
      expect(state.currentSessionId).toBeNull();
      expect(state.recentFiles).toEqual([]);
    });

    it('should reset auth store', async () => {
      await act(async () => {
        resetAllStores();
      });
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.tokens).toBeNull();
      expect(state.error).toBeNull();
      expect(state.isInitialized).toBe(false);
    });

    it('should reset UI store', async () => {
      await act(async () => {
        resetAllStores();
      });
      const state = useUIStore.getState();
      expect(state.theme).toBeDefined();
      expect(state.sidebarLayout).toBeDefined();
    });

    it('should reset editor store', async () => {
      await act(async () => {
        resetAllStores();
      });
      const state = useEditorStore.getState();
      expect(state.panes).toBeDefined();
      expect(state.activePane == null).toBe(true);
    });

    it('should reset billing store', async () => {
      await act(async () => {
        resetAllStores();
      });
      const state = useBillingStore.getState();
      expect(state.plans).toEqual([]);
      expect(state.quotas).toEqual([]);
    });
  });

  describe('resetStore', () => {
    it('should reset a store by name when module exists', () => {
      resetStore('auth');
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
    });

    it('should not throw when store module does not exist', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => resetStore('nonexistent-store')).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not reset store'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getStoreState', () => {
    it('should return state from store hook', () => {
      const mockState = { count: 42 };
      const getState = vi.fn().mockReturnValue(mockState);
      const storeHook = { getState };
      expect(getStoreState(storeHook as any)).toBe(mockState);
    });
  });

  describe('setStoreState', () => {
    it('should set state on store hook with replace', async () => {
      const setStateFn = vi.fn();
      const storeHook = { setState: setStateFn };
      const state = { foo: 'bar' };
      await act(async () => {
        setStoreState(storeHook as any, state);
      });
      expect(setStateFn).toHaveBeenCalledWith(state, true);
    });
  });

  describe('waitForStoreCondition', () => {
    it('should resolve when condition is met immediately', async () => {
      const storeHook = {
        getState: vi.fn().mockReturnValue({ ready: true }),
      };
      await expect(
        waitForStoreCondition(storeHook as any, (s: any) => s.ready === true, 1000)
      ).resolves.toBeUndefined();
    });

    it('should resolve when condition becomes true after a few checks', async () => {
      let callCount = 0;
      const storeHook = {
        getState: vi.fn(() => {
          callCount++;
          return { ready: callCount >= 3 };
        }),
      };
      await expect(
        waitForStoreCondition(storeHook as any, (s: any) => s.ready === true, 5000)
      ).resolves.toBeUndefined();
    });

    it('should reject with timeout when condition is never met', async () => {
      const storeHook = {
        getState: vi.fn().mockReturnValue({ ready: false }),
      };
      await expect(
        waitForStoreCondition(storeHook as any, (s: any) => s.ready === true, 100)
      ).rejects.toThrow('Timeout waiting for store condition');
    });
  });
});
