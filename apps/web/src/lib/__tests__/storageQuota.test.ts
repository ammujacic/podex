/**
 * Tests for storageQuota.ts utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getStorageQuota,
  isNearQuota,
  isCriticallyFull,
  getUsageByPrefix,
  getKeysSortedBySize,
  setupQuotaMonitoring,
  safeSetItem,
  cleanupByPrefix,
} from '../storageQuota';

// Mock the config store
vi.mock('@/stores/config', () => ({
  useConfigStore: {
    getState: () => ({
      getStorageQuotaDefaults: () => ({
        defaultQuotaBytes: 5 * 1024 * 1024, // 5MB
        warningThreshold: 0.7,
        criticalThreshold: 0.9,
      }),
    }),
  },
}));

describe('storageQuota utilities', () => {
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    mockLocalStorage = {};

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        mockLocalStorage = {};
      }),
      key: vi.fn((index: number) => Object.keys(mockLocalStorage)[index] || null),
      get length() {
        return Object.keys(mockLocalStorage).length;
      },
    };

    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('getStorageQuota', () => {
    it('returns quota info for empty localStorage', () => {
      const quota = getStorageQuota();

      expect(quota.used).toBe(0);
      expect(quota.total).toBe(5 * 1024 * 1024);
      expect(quota.percentage).toBe(0);
      expect(quota.usedFormatted).toBe('0 B');
    });

    it('calculates used bytes correctly', () => {
      mockLocalStorage['key1'] = 'value1';
      mockLocalStorage['key2'] = 'value2';

      const quota = getStorageQuota();

      // Each character is 2 bytes (UTF-16)
      // 'key1' (4) + 'value1' (6) = 10 chars = 20 bytes
      // 'key2' (4) + 'value2' (6) = 10 chars = 20 bytes
      // Total = 40 bytes
      expect(quota.used).toBe(40);
    });

    it('calculates percentage correctly', () => {
      // Add 1MB of data (approximately)
      const largeValue = 'x'.repeat(500000); // 500000 chars = 1MB
      mockLocalStorage['large'] = largeValue;

      const quota = getStorageQuota();

      // (5 + 500000) * 2 bytes = ~1MB out of 5MB = ~20%
      expect(quota.percentage).toBeGreaterThan(0.19);
      expect(quota.percentage).toBeLessThan(0.21);
    });

    it('formats used size in KB', () => {
      mockLocalStorage['data'] = 'x'.repeat(1000); // 2KB
      const quota = getStorageQuota();
      expect(quota.usedFormatted).toMatch(/KB$/);
    });

    it('formats total size in MB', () => {
      const quota = getStorageQuota();
      expect(quota.totalFormatted).toBe('5.00 MB');
    });

    it('handles localStorage access errors', () => {
      vi.stubGlobal('localStorage', {
        get length() {
          throw new Error('Access denied');
        },
        key: () => {
          throw new Error('Access denied');
        },
      });

      const quota = getStorageQuota();

      expect(quota.used).toBe(0);
      expect(quota.percentage).toBe(0);
    });
  });

  describe('isNearQuota', () => {
    it('returns false when storage is mostly empty', () => {
      expect(isNearQuota()).toBe(false);
    });

    it('returns true when usage exceeds warning threshold (70%)', () => {
      // Add ~3.7MB of data (70% of 5MB = 3.67MB)
      // 5MB = 5242880 bytes, 70% = ~3670000 bytes
      // Each char = 2 bytes, so need ~1835000 chars + key length
      const largeValue = 'x'.repeat(1840000);
      mockLocalStorage['large'] = largeValue;

      expect(isNearQuota()).toBe(true);
    });

    it('accepts custom threshold', () => {
      // Add ~2.5MB of data (50% of 5MB)
      const largeValue = 'x'.repeat(1250000); // ~2.5MB
      mockLocalStorage['large'] = largeValue;

      expect(isNearQuota(0.4)).toBe(true); // 40% threshold
      expect(isNearQuota(0.6)).toBe(false); // 60% threshold
    });
  });

  describe('isCriticallyFull', () => {
    it('returns false when storage is not critical', () => {
      expect(isCriticallyFull()).toBe(false);
    });

    it('returns true when usage exceeds critical threshold (90%)', () => {
      // Add ~4.7MB of data (90% of 5MB = 4.72MB)
      // 5MB = 5242880 bytes, 90% = ~4718592 bytes
      // Each char = 2 bytes, so need ~2360000 chars + key length
      const largeValue = 'x'.repeat(2365000);
      mockLocalStorage['large'] = largeValue;

      expect(isCriticallyFull()).toBe(true);
    });
  });

  describe('getUsageByPrefix', () => {
    it('returns 0 for non-existent prefix', () => {
      mockLocalStorage['other'] = 'value';
      expect(getUsageByPrefix('app_')).toBe(0);
    });

    it('calculates usage for matching keys', () => {
      mockLocalStorage['app_setting1'] = 'value1';
      mockLocalStorage['app_setting2'] = 'value2';
      mockLocalStorage['other'] = 'value';

      const usage = getUsageByPrefix('app_');

      // 'app_setting1' (12) + 'value1' (6) = 18 chars = 36 bytes
      // 'app_setting2' (12) + 'value2' (6) = 18 chars = 36 bytes
      // Total = 72 bytes
      expect(usage).toBe(72);
    });

    it('handles localStorage access errors', () => {
      vi.stubGlobal('localStorage', {
        get length() {
          throw new Error('Access denied');
        },
      });

      expect(getUsageByPrefix('app_')).toBe(0);
    });
  });

  describe('getKeysSortedBySize', () => {
    it('returns empty array for empty localStorage', () => {
      expect(getKeysSortedBySize()).toEqual([]);
    });

    it('returns keys sorted by size (largest first)', () => {
      mockLocalStorage['small'] = 'a';
      mockLocalStorage['medium'] = 'abcdefghij';
      mockLocalStorage['large'] = 'x'.repeat(100);

      const sorted = getKeysSortedBySize();

      expect(sorted[0]?.key).toBe('large');
      expect(sorted[1]?.key).toBe('medium');
      expect(sorted[2]?.key).toBe('small');
    });

    it('includes correct size for each key', () => {
      mockLocalStorage['test'] = 'value';

      const sorted = getKeysSortedBySize();

      // 'test' (4) + 'value' (5) = 9 chars = 18 bytes
      expect(sorted[0]).toEqual({ key: 'test', size: 18 });
    });

    it('handles localStorage access errors', () => {
      vi.stubGlobal('localStorage', {
        get length() {
          throw new Error('Access denied');
        },
      });

      expect(getKeysSortedBySize()).toEqual([]);
    });
  });

  describe('setupQuotaMonitoring', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls callback on initial check if warning threshold exceeded', () => {
      // 70% of 5MB = ~1840000 chars (each char = 2 bytes in UTF-16)
      const largeValue = 'x'.repeat(1840000);
      mockLocalStorage['large'] = largeValue;

      const onWarning = vi.fn();
      setupQuotaMonitoring(onWarning);

      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warning',
          message: expect.stringContaining('localStorage is'),
        })
      );
    });

    it('calls callback with critical level when critically full', () => {
      // 90% of 5MB = ~2365000 chars (each char = 2 bytes in UTF-16)
      const largeValue = 'x'.repeat(2365000);
      mockLocalStorage['large'] = largeValue;

      const onWarning = vi.fn();
      setupQuotaMonitoring(onWarning);

      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          message: expect.stringContaining('critically full'),
        })
      );
    });

    it('returns cleanup function that stops monitoring', () => {
      const onWarning = vi.fn();
      const cleanup = setupQuotaMonitoring(onWarning, 1000);

      cleanup();

      // Add data that would trigger warning
      const largeValue = 'x'.repeat(2000000);
      mockLocalStorage['large'] = largeValue;

      vi.advanceTimersByTime(5000);

      // Should only have been called once (initial check before cleanup)
      expect(onWarning).toHaveBeenCalledTimes(0);
    });

    it('checks periodically at specified interval', () => {
      const onWarning = vi.fn();
      setupQuotaMonitoring(onWarning, 1000);

      // Initially under threshold
      vi.advanceTimersByTime(1000);
      expect(onWarning).not.toHaveBeenCalled();

      // Add data to trigger warning (70% of 5MB)
      const largeValue = 'x'.repeat(1840000);
      mockLocalStorage['large'] = largeValue;

      vi.advanceTimersByTime(1000);
      expect(onWarning).toHaveBeenCalled();
    });

    it('only fires callback when level changes', () => {
      const onWarning = vi.fn();
      // Warning level: 70% of 5MB
      const largeValue = 'x'.repeat(1840000);
      mockLocalStorage['large'] = largeValue;

      setupQuotaMonitoring(onWarning, 1000);

      // Initial call
      expect(onWarning).toHaveBeenCalledTimes(1);

      // Subsequent checks at same level shouldn't fire
      vi.advanceTimersByTime(3000);
      expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it('resets and fires again when level changes', () => {
      const onWarning = vi.fn();
      setupQuotaMonitoring(onWarning, 1000);

      // Add warning-level data (70% of 5MB)
      mockLocalStorage['large'] = 'x'.repeat(1840000);
      vi.advanceTimersByTime(1000);
      expect(onWarning).toHaveBeenCalledTimes(1);

      // Increase to critical level (90% of 5MB)
      mockLocalStorage['large'] = 'x'.repeat(2365000);
      vi.advanceTimersByTime(1000);
      expect(onWarning).toHaveBeenCalledTimes(2);
      expect(onWarning).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'critical' }));
    });
  });

  describe('safeSetItem', () => {
    it('returns true on successful write', () => {
      const result = safeSetItem('key', 'value');

      expect(result).toBe(true);
      expect(localStorage.setItem).toHaveBeenCalledWith('key', 'value');
    });

    it('returns false when quota exceeded', () => {
      vi.mocked(localStorage.setItem).mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const result = safeSetItem('key', 'value');

      expect(result).toBe(false);
    });

    it('calls onQuotaExceeded callback on error', () => {
      const error = new Error('QuotaExceededError');
      vi.mocked(localStorage.setItem).mockImplementation(() => {
        throw error;
      });

      const onQuotaExceeded = vi.fn();
      safeSetItem('key', 'value', onQuotaExceeded);

      expect(onQuotaExceeded).toHaveBeenCalledWith(error);
    });

    it('does not call callback when no error', () => {
      const onQuotaExceeded = vi.fn();
      safeSetItem('key', 'value', onQuotaExceeded);

      expect(onQuotaExceeded).not.toHaveBeenCalled();
    });
  });

  describe('cleanupByPrefix', () => {
    it('removes all items matching prefix', () => {
      mockLocalStorage['app_1'] = 'value1';
      mockLocalStorage['app_2'] = 'value2';
      mockLocalStorage['other'] = 'value3';

      const removed = cleanupByPrefix('app_');

      expect(removed).toBe(2);
      expect(localStorage.removeItem).toHaveBeenCalledWith('app_1');
      expect(localStorage.removeItem).toHaveBeenCalledWith('app_2');
      expect(localStorage.removeItem).not.toHaveBeenCalledWith('other');
    });

    it('keeps most recent items when keepCount specified', () => {
      mockLocalStorage['app_1'] = 'oldest';
      mockLocalStorage['app_2'] = 'middle';
      mockLocalStorage['app_3'] = 'newest';

      const removed = cleanupByPrefix('app_', 1);

      expect(removed).toBe(2);
      // Should keep app_3 (last in sorted order)
      expect(localStorage.removeItem).toHaveBeenCalledWith('app_1');
      expect(localStorage.removeItem).toHaveBeenCalledWith('app_2');
    });

    it('returns 0 when no items match prefix', () => {
      mockLocalStorage['other'] = 'value';

      const removed = cleanupByPrefix('app_');

      expect(removed).toBe(0);
    });

    it('returns 0 when keepCount exceeds matching items', () => {
      mockLocalStorage['app_1'] = 'value1';
      mockLocalStorage['app_2'] = 'value2';

      const removed = cleanupByPrefix('app_', 5);

      expect(removed).toBe(0);
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it('handles localStorage access errors', () => {
      vi.stubGlobal('localStorage', {
        get length() {
          throw new Error('Access denied');
        },
      });

      const removed = cleanupByPrefix('app_');

      expect(removed).toBe(0);
    });

    it('handles empty localStorage', () => {
      const removed = cleanupByPrefix('app_');

      expect(removed).toBe(0);
    });
  });
});
