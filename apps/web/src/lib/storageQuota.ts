/**
 * localStorage quota monitoring and management utilities.
 *
 * Provides tools for:
 * - Monitoring localStorage usage and quota
 * - Warning when approaching storage limits
 * - Automatic cleanup of old data when quota is exceeded
 */

import { useConfigStore } from '@/stores/config';

// Helper to check if config is ready
function isConfigReady(): boolean {
  return useConfigStore.getState().isInitialized;
}

// Helper functions to get config values (returns null if config not ready)
function getStorageQuotaConfig() {
  if (!isConfigReady()) return null;
  return useConfigStore.getState().getStorageQuotaDefaults();
}

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
 * Returns null if config is not yet initialized.
 *
 * Note: localStorage uses UTF-16 encoding, so each character = 2 bytes.
 */
export function getStorageQuota(): StorageQuota | null {
  const config = getStorageQuotaConfig();
  if (!config) return null; // Config not ready yet

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
      total: config.defaultQuotaBytes,
      percentage: 0,
      usedFormatted: '0 B',
      totalFormatted: formatBytes(config.defaultQuotaBytes),
    };
  }

  return {
    used,
    total: config.defaultQuotaBytes,
    percentage: used / config.defaultQuotaBytes,
    usedFormatted: formatBytes(used),
    totalFormatted: formatBytes(config.defaultQuotaBytes),
  };
}

/**
 * Check if localStorage is near its quota limit.
 * Returns false if config is not yet initialized (safe to proceed with writes).
 */
export function isNearQuota(threshold?: number): boolean {
  const config = getStorageQuotaConfig();
  if (!config) return false; // Config not ready, skip check

  const quota = getStorageQuota();
  if (!quota) return false;

  const effectiveThreshold = threshold ?? config.warningThreshold;
  return quota.percentage >= effectiveThreshold;
}

/**
 * Check if localStorage is critically full.
 * Returns false if config is not yet initialized (safe to proceed with writes).
 */
export function isCriticallyFull(): boolean {
  const config = getStorageQuotaConfig();
  if (!config) return false; // Config not ready, skip check

  const quota = getStorageQuota();
  if (!quota) return false;

  return quota.percentage >= config.criticalThreshold;
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
 * Only starts monitoring once config is initialized.
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
    const config = getStorageQuotaConfig();
    if (!config) return; // Config not ready, skip check

    const quota = getStorageQuota();
    if (!quota) return;

    if (quota.percentage >= config.criticalThreshold) {
      // Only fire callback if level changed or first time
      if (lastWarningLevel !== 'critical') {
        lastWarningLevel = 'critical';
        onWarning({
          level: 'critical',
          message: `localStorage is critically full (${(quota.percentage * 100).toFixed(1)}%). Some data may not be saved.`,
          quota,
        });
      }
    } else if (quota.percentage >= config.warningThreshold) {
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
