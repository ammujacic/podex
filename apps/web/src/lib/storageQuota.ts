/**
 * localStorage quota monitoring and management utilities.
 *
 * Provides tools for:
 * - Monitoring localStorage usage and quota
 * - Warning when approaching storage limits
 * - Automatic cleanup of old data when quota is exceeded
 */

// Most browsers have 5-10MB localStorage quota per origin
const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024; // Conservative 5MB estimate
const WARNING_THRESHOLD = 0.8; // 80% threshold for warnings
const CRITICAL_THRESHOLD = 0.95; // 95% threshold for auto-cleanup

export interface StorageQuota {
  /** Bytes currently used */
  used: number;
  /** Estimated total quota in bytes */
  total: number;
  /** Usage as a percentage (0-1) */
  percentage: number;
  /** Human-readable used size */
  usedFormatted: string;
  /** Human-readable total size */
  totalFormatted: string;
}

export interface QuotaWarning {
  level: 'warning' | 'critical';
  message: string;
  quota: StorageQuota;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Calculate the current localStorage usage.
 *
 * Note: localStorage uses UTF-16 encoding, so each character = 2 bytes.
 */
export function getStorageQuota(): StorageQuota {
  let used = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        // Key length + value length, both in UTF-16 (2 bytes per char)
        const value = localStorage.getItem(key) || '';
        used += (key.length + value.length) * 2;
      }
    }
  } catch {
    // localStorage might be inaccessible in some contexts
    return {
      used: 0,
      total: DEFAULT_QUOTA_BYTES,
      percentage: 0,
      usedFormatted: '0 B',
      totalFormatted: formatBytes(DEFAULT_QUOTA_BYTES),
    };
  }

  return {
    used,
    total: DEFAULT_QUOTA_BYTES,
    percentage: used / DEFAULT_QUOTA_BYTES,
    usedFormatted: formatBytes(used),
    totalFormatted: formatBytes(DEFAULT_QUOTA_BYTES),
  };
}

/**
 * Check if localStorage is near its quota limit.
 */
export function isNearQuota(threshold = WARNING_THRESHOLD): boolean {
  return getStorageQuota().percentage >= threshold;
}

/**
 * Check if localStorage is critically full.
 */
export function isCriticallyFull(): boolean {
  return getStorageQuota().percentage >= CRITICAL_THRESHOLD;
}

/**
 * Get storage usage for a specific key prefix.
 */
export function getUsageByPrefix(prefix: string): number {
  let used = 0;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        const value = localStorage.getItem(key) || '';
        used += (key.length + value.length) * 2;
      }
    }
  } catch {
    return 0;
  }

  return used;
}

/**
 * Get all keys sorted by size (largest first).
 */
export function getKeysSortedBySize(): Array<{ key: string; size: number }> {
  const items: Array<{ key: string; size: number }> = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || '';
        items.push({
          key,
          size: (key.length + value.length) * 2,
        });
      }
    }
  } catch {
    return [];
  }

  return items.sort((a, b) => b.size - a.size);
}

type QuotaWarningCallback = (warning: QuotaWarning) => void;

/**
 * Setup periodic monitoring of localStorage quota.
 *
 * @param onWarning - Callback when quota threshold is exceeded
 * @param intervalMs - Check interval in milliseconds (default: 60 seconds)
 * @returns Cleanup function to stop monitoring
 */
export function setupQuotaMonitoring(
  onWarning: QuotaWarningCallback,
  intervalMs = 60000
): () => void {
  let lastWarningLevel: 'warning' | 'critical' | null = null;

  const check = () => {
    const quota = getStorageQuota();

    if (quota.percentage >= CRITICAL_THRESHOLD) {
      // Only fire callback if level changed or first time
      if (lastWarningLevel !== 'critical') {
        lastWarningLevel = 'critical';
        onWarning({
          level: 'critical',
          message: `localStorage is critically full (${(quota.percentage * 100).toFixed(1)}%). Some data may not be saved.`,
          quota,
        });
      }
    } else if (quota.percentage >= WARNING_THRESHOLD) {
      if (lastWarningLevel !== 'warning') {
        lastWarningLevel = 'warning';
        onWarning({
          level: 'warning',
          message: `localStorage is ${(quota.percentage * 100).toFixed(1)}% full. Consider clearing old data.`,
          quota,
        });
      }
    } else {
      // Reset warning level if usage drops below threshold
      lastWarningLevel = null;
    }
  };

  // Initial check
  check();

  // Periodic checks
  const intervalId = setInterval(check, intervalMs);

  return () => {
    clearInterval(intervalId);
  };
}

/**
 * Try to write to localStorage, with quota handling.
 *
 * @param key - Storage key
 * @param value - Value to store
 * @param onQuotaExceeded - Optional callback when quota is exceeded
 * @returns true if write succeeded, false if quota exceeded
 */
export function safeSetItem(
  key: string,
  value: string,
  onQuotaExceeded?: (error: Error) => void
): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    // QuotaExceededError or similar
    if (error instanceof Error) {
      onQuotaExceeded?.(error);
    }
    return false;
  }
}

/**
 * Remove items matching a prefix, optionally keeping the most recent N items.
 *
 * @param prefix - Key prefix to match
 * @param keepCount - Number of most recent items to keep (by key name)
 * @returns Number of items removed
 */
export function cleanupByPrefix(prefix: string, keepCount = 0): number {
  const keysToRemove: string[] = [];

  try {
    const matchingKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        matchingKeys.push(key);
      }
    }

    // Sort keys (assumes lexicographic order reflects recency for most cases)
    matchingKeys.sort();

    // Mark older items for removal
    const removeCount = Math.max(0, matchingKeys.length - keepCount);
    for (let i = 0; i < removeCount; i++) {
      const key = matchingKeys[i];
      if (key !== undefined) {
        keysToRemove.push(key);
      }
    }

    // Remove items
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore errors during cleanup
  }

  return keysToRemove.length;
}
