import { isCriticallyFull, isNearQuota, cleanupByPrefix } from '@/lib/storageQuota';

// ============================================================================
// Debounced Storage Types
// ============================================================================

/** Zustand persist middleware compatible storage value format */
export type StorageValue<T> = { state: T; version?: number };

/** Zustand persist middleware compatible storage interface */
export type PersistStorage<T> = {
  getItem: (name: string) => StorageValue<T> | null | Promise<StorageValue<T> | null>;
  setItem: (name: string, value: StorageValue<T>) => void | Promise<void>;
  removeItem: (name: string) => void | Promise<void>;
};

// ============================================================================
// Debounced Storage Adapter
// ============================================================================

/**
 * Creates a debounced localStorage adapter that prevents excessive writes.
 * Uses requestIdleCallback when available for better performance.
 *
 * Features:
 * - Debounces writes to prevent performance issues during rapid updates
 * - Uses requestIdleCallback for non-blocking writes when available
 * - Handles localStorage quota errors with automatic cleanup
 * - Cleans up old entries when storage is near capacity
 *
 * @param storagePrefix - Prefix for cleanup operations (e.g., 'podex-sessions')
 * @param debounceMs - Debounce delay in milliseconds (default: 1000)
 */
export function createDebouncedStorage<T>(
  storagePrefix: string,
  debounceMs: number = 1000
): PersistStorage<T> {
  let pendingWrite: string | null = null;
  let writeTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastWriteTime = 0;

  const scheduleWrite = (key: string, value: string) => {
    pendingWrite = value;

    // Clear any existing timeout
    if (writeTimeout) {
      clearTimeout(writeTimeout);
    }

    // Calculate time since last write
    const timeSinceLastWrite = Date.now() - lastWriteTime;

    // If it's been long enough, write immediately using idle callback
    if (timeSinceLastWrite >= debounceMs) {
      const doWrite = () => {
        if (pendingWrite !== null) {
          // Check quota before writing
          if (isCriticallyFull()) {
            console.warn('localStorage critically full, attempting cleanup...');
            // Try to cleanup old session data to make room
            const cleaned = cleanupByPrefix(storagePrefix, 5);
            if (cleaned > 0) {
              console.warn(`Cleaned up ${cleaned} old session entries`);
            }
          }

          try {
            localStorage.setItem(key, pendingWrite);
            lastWriteTime = Date.now();
          } catch (e) {
            console.warn('Failed to persist session state:', e);
            // If write failed due to quota, try cleanup and retry once
            if (e instanceof Error && e.name === 'QuotaExceededError') {
              cleanupByPrefix(storagePrefix, 3);
              try {
                localStorage.setItem(key, pendingWrite);
                lastWriteTime = Date.now();
              } catch {
                console.error('Failed to persist session state even after cleanup');
              }
            }
          }
          pendingWrite = null;
        }
      };

      // Use requestIdleCallback if available for non-blocking writes
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doWrite, { timeout: 100 });
      } else {
        doWrite();
      }
    } else {
      // Otherwise, schedule a debounced write
      writeTimeout = setTimeout(() => {
        if (pendingWrite !== null) {
          // Check quota before writing
          if (isNearQuota(0.9)) {
            console.warn('localStorage near quota, cleaning up old sessions...');
            cleanupByPrefix(storagePrefix, 5);
          }

          try {
            localStorage.setItem(key, pendingWrite);
            lastWriteTime = Date.now();
          } catch (e) {
            console.warn('Failed to persist session state:', e);
          }
          pendingWrite = null;
        }
        writeTimeout = null;
      }, debounceMs - timeSinceLastWrite);
    }
  };

  return {
    getItem: (name: string): StorageValue<T> | null => {
      try {
        const value = localStorage.getItem(name);
        if (!value) return null;
        return JSON.parse(value) as StorageValue<T>;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: StorageValue<T>): void => {
      try {
        scheduleWrite(name, JSON.stringify(value));
      } catch {
        // Ignore serialization errors
      }
    },
    removeItem: (name: string): void => {
      // Immediate removal
      if (writeTimeout) {
        clearTimeout(writeTimeout);
        writeTimeout = null;
      }
      pendingWrite = null;
      try {
        localStorage.removeItem(name);
      } catch {
        // Ignore removal errors
      }
    },
  };
}
