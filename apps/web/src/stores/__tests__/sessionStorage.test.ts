import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createDebouncedStorage } from '../sessionStorage';
import type { StorageValue } from '../sessionStorage';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

// Mock storageQuota functions
vi.mock('@/lib/storageQuota', () => ({
  isCriticallyFull: vi.fn(() => false),
  isNearQuota: vi.fn(() => false),
  cleanupByPrefix: vi.fn(() => 5),
}));

describe('sessionStorage', () => {
  let storage: ReturnType<typeof createDebouncedStorage>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockLocalStorage.clear();
    vi.stubGlobal('localStorage', mockLocalStorage as Storage);

    // Create storage instance with short debounce for testing
    storage = createDebouncedStorage('podex-test', 100);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('returns null for non-existent key', () => {
      const result = storage.getItem('non-existent-key');
      expect(result).toBeNull();
    });

    it('storage is empty initially', () => {
      expect(mockLocalStorage.length).toBe(0);
    });
  });

  // ========================================================================
  // Save/Load Operations
  // ========================================================================

  describe('Save and Load', () => {
    it('saves and retrieves simple state', async () => {
      const testData: StorageValue<{ count: number }> = {
        state: { count: 42 },
        version: 1,
      };

      act(() => {
        storage.setItem('test-key', testData);
      });

      // Wait for debounce
      await vi.waitFor(() => {
        const retrieved = storage.getItem('test-key');
        expect(retrieved).toEqual(testData);
      });
    });

    it('saves and retrieves complex state', async () => {
      const testData: StorageValue<{ user: { name: string; age: number }; items: string[] }> = {
        state: {
          user: { name: 'Test User', age: 25 },
          items: ['item1', 'item2', 'item3'],
        },
        version: 2,
      };

      act(() => {
        storage.setItem('complex-key', testData);
      });

      await vi.waitFor(() => {
        const retrieved = storage.getItem('complex-key');
        expect(retrieved).toEqual(testData);
      });
    });

    it('overwrites existing value', async () => {
      const initial: StorageValue<{ value: string }> = { state: { value: 'initial' } };
      const updated: StorageValue<{ value: string }> = { state: { value: 'updated' } };

      act(() => {
        storage.setItem('key', initial);
      });

      await vi.waitFor(() => {
        expect(storage.getItem('key')).toEqual(initial);
      });

      act(() => {
        storage.setItem('key', updated);
      });

      await vi.waitFor(() => {
        expect(storage.getItem('key')).toEqual(updated);
      });
    });

    it('handles state without version', async () => {
      const testData: StorageValue<{ count: number }> = {
        state: { count: 10 },
      };

      act(() => {
        storage.setItem('no-version', testData);
      });

      await vi.waitFor(() => {
        const retrieved = storage.getItem('no-version');
        expect(retrieved?.state).toEqual({ count: 10 });
      });
    });

    it('returns null for corrupted data', () => {
      mockLocalStorage.setItem('corrupted', 'not-valid-json{');
      const result = storage.getItem('corrupted');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // Remove Operations
  // ========================================================================

  describe('Remove', () => {
    it('removes item from storage', async () => {
      const testData: StorageValue<{ value: string }> = { state: { value: 'test' } };

      act(() => {
        storage.setItem('to-remove', testData);
      });

      await vi.waitFor(() => {
        expect(storage.getItem('to-remove')).toEqual(testData);
      });

      act(() => {
        storage.removeItem('to-remove');
      });

      expect(storage.getItem('to-remove')).toBeNull();
    });

    it('removes non-existent item gracefully', () => {
      expect(() => {
        act(() => {
          storage.removeItem('does-not-exist');
        });
      }).not.toThrow();
    });

    it('clears pending write when removing', async () => {
      const testData: StorageValue<{ value: string }> = { state: { value: 'test' } };

      act(() => {
        storage.setItem('pending-key', testData);
        // Immediately remove before debounce completes
        storage.removeItem('pending-key');
      });

      // Wait longer than debounce
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(storage.getItem('pending-key')).toBeNull();
    });
  });

  // ========================================================================
  // Debouncing Behavior
  // ========================================================================

  describe('Debouncing', () => {
    it('debounces multiple writes to same key', async () => {
      const setItemSpy = vi.spyOn(mockLocalStorage, 'setItem');

      act(() => {
        storage.setItem('debounce-key', { state: { value: 1 } });
        storage.setItem('debounce-key', { state: { value: 2 } });
        storage.setItem('debounce-key', { state: { value: 3 } });
      });

      await vi.waitFor(() => {
        const retrieved = storage.getItem('debounce-key');
        expect(retrieved?.state).toEqual({ value: 3 });
      });

      // Should have called setItem only once (or very few times) due to debouncing
      expect(setItemSpy.mock.calls.length).toBeLessThan(3);
    });

    it('respects debounce timeout', async () => {
      const setItemSpy = vi.spyOn(mockLocalStorage, 'setItem');

      act(() => {
        storage.setItem('timeout-key', { state: { count: 1 } });
      });

      // Wait a short time to ensure debounce is active
      await new Promise((resolve) => setTimeout(resolve, 50));

      // After debounce completes
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(setItemSpy).toHaveBeenCalled();
    });

    it('writes immediately if enough time has passed', async () => {
      const setItemSpy = vi.spyOn(mockLocalStorage, 'setItem');

      act(() => {
        storage.setItem('immediate-key', { state: { value: 'first' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // Second write after enough time should also be immediate
      act(() => {
        storage.setItem('immediate-key', { state: { value: 'second' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(setItemSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // Error Handling
  // ========================================================================

  describe('Error Handling', () => {
    it('handles JSON parse errors gracefully', () => {
      mockLocalStorage.setItem('bad-json', '{invalid');
      const result = storage.getItem('bad-json');
      expect(result).toBeNull();
    });

    it('handles JSON stringify errors gracefully', () => {
      const circular: { ref?: unknown } = {};
      circular.ref = circular;

      expect(() => {
        act(() => {
          storage.setItem('circular', { state: circular });
        });
      }).not.toThrow();
    });

    it('handles storage quota errors with cleanup', async () => {
      const { isCriticallyFull, cleanupByPrefix } = await import('@/lib/storageQuota');
      vi.mocked(isCriticallyFull).mockReturnValue(true);

      act(() => {
        storage.setItem('quota-key', { state: { data: 'test' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cleanupByPrefix).toHaveBeenCalledWith('podex-test', 5);
    });

    it('retries write after cleanup on quota error', async () => {
      let callCount = 0;
      const originalSetItem = mockLocalStorage.setItem;
      mockLocalStorage.setItem = (key: string, value: string) => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('QuotaExceededError');
          error.name = 'QuotaExceededError';
          throw error;
        }
        originalSetItem.call(mockLocalStorage, key, value);
      };

      act(() => {
        storage.setItem('retry-key', { state: { value: 'test' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(callCount).toBe(2); // Initial attempt + retry
      mockLocalStorage.setItem = originalSetItem;
    });
  });

  // ========================================================================
  // Multiple Keys
  // ========================================================================

  describe('Multiple Keys', () => {
    it('stores multiple different keys independently', async () => {
      // Set first key and wait for it to be written
      act(() => {
        storage.setItem('key1', { state: { value: 'one' } });
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Set second key and wait for it to be written
      act(() => {
        storage.setItem('key2', { state: { value: 'two' } });
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Set third key and wait for it to be written
      act(() => {
        storage.setItem('key3', { state: { value: 'three' } });
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(storage.getItem('key1')?.state).toEqual({ value: 'one' });
      expect(storage.getItem('key2')?.state).toEqual({ value: 'two' });
      expect(storage.getItem('key3')?.state).toEqual({ value: 'three' });
    });

    it('removes specific key without affecting others', async () => {
      act(() => {
        storage.setItem('keep1', { state: { value: 'keep' } });
        storage.setItem('remove', { state: { value: 'remove' } });
        storage.setItem('keep2', { state: { value: 'keep' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      act(() => {
        storage.removeItem('remove');
      });

      expect(storage.getItem('keep1')).not.toBeNull();
      expect(storage.getItem('remove')).toBeNull();
      expect(storage.getItem('keep2')).not.toBeNull();
    });
  });

  // ========================================================================
  // Persistence
  // ========================================================================

  describe('Persistence', () => {
    it('persists data across storage instance recreation', async () => {
      const storage1 = createDebouncedStorage('podex-persist', 100);

      act(() => {
        storage1.setItem('persist-key', { state: { value: 'persisted' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Create new storage instance
      const storage2 = createDebouncedStorage('podex-persist', 100);
      const retrieved = storage2.getItem('persist-key');

      expect(retrieved?.state).toEqual({ value: 'persisted' });
    });

    it('data survives after removeItem and re-add', async () => {
      act(() => {
        storage.setItem('survive-key', { state: { count: 100 } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      act(() => {
        storage.removeItem('survive-key');
        storage.setItem('survive-key', { state: { count: 200 } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(storage.getItem('survive-key')?.state).toEqual({ count: 200 });
    });
  });

  // ========================================================================
  // Storage Cleanup
  // ========================================================================

  describe('Storage Cleanup', () => {
    it('triggers cleanup when near quota', async () => {
      const { isNearQuota, cleanupByPrefix } = await import('@/lib/storageQuota');
      vi.mocked(isNearQuota).mockReturnValue(true);

      act(() => {
        storage.setItem('cleanup-key', { state: { data: 'test' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cleanupByPrefix).toHaveBeenCalledWith('podex-test', 5);
    });

    it('does not trigger cleanup when quota is healthy', async () => {
      const { isNearQuota, isCriticallyFull, cleanupByPrefix } = await import('@/lib/storageQuota');
      vi.mocked(isNearQuota).mockReturnValue(false);
      vi.mocked(isCriticallyFull).mockReturnValue(false);

      act(() => {
        storage.setItem('no-cleanup-key', { state: { data: 'test' } });
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cleanupByPrefix).not.toHaveBeenCalled();
    });
  });
});
