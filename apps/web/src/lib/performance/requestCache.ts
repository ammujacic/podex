// ============================================================================
// Request Deduplication & Caching
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

// ============================================================================
// Request Cache
// ============================================================================

class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pendingRequests = new Map<string, PendingRequest<unknown>>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get or fetch data with deduplication and caching
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options?: {
      ttl?: number;
      forceRefresh?: boolean;
      staleWhileRevalidate?: boolean;
    }
  ): Promise<T> {
    const {
      ttl = this.defaultTTL,
      forceRefresh = false,
      staleWhileRevalidate = false,
    } = options || {};

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) {
        const now = Date.now();
        if (now < cached.expiresAt) {
          return cached.data as T;
        }

        // Stale-while-revalidate: return stale data and refresh in background
        if (staleWhileRevalidate && now - cached.timestamp < ttl * 2) {
          this.refreshInBackground(key, fetcher, ttl);
          return cached.data as T;
        }
      }
    }

    // Check for pending request (deduplication)
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending.promise as Promise<T>;
    }

    // Make new request
    const promise = fetcher()
      .then((data) => {
        // Cache the result
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttl,
        });

        // Remove from pending
        this.pendingRequests.delete(key);

        return data;
      })
      .catch((error) => {
        // Remove from pending on error
        this.pendingRequests.delete(key);
        throw error;
      });

    // Track pending request
    this.pendingRequests.set(key, {
      promise,
      timestamp: Date.now(),
    });

    return promise;
  }

  /**
   * Refresh data in background without blocking
   */
  private refreshInBackground<T>(key: string, fetcher: () => Promise<T>, ttl: number): void {
    // Skip if already refreshing
    if (this.pendingRequests.has(key)) return;

    fetcher()
      .then((data) => {
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttl,
        });
      })
      .catch(() => {
        // Ignore background refresh errors
      });
  }

  /**
   * Get cached data without fetching
   */
  get<T>(key: string): T | undefined {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data as T;
    }
    return undefined;
  }

  /**
   * Set cache data manually
   */
  set<T>(key: string, data: T, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + (ttl || this.defaultTTL),
    });
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; pending: number; keys: string[] } {
    return {
      size: this.cache.size,
      pending: this.pendingRequests.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Export singleton instance
export const requestCache = new RequestCache();

// ============================================================================
// Debounced Request
// ============================================================================

type DebouncedFn<T extends (...args: unknown[]) => unknown> = (
  ...args: Parameters<T>
) => Promise<ReturnType<T>>;

export function createDebouncedRequest<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delay: number
): DebouncedFn<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingResolve: ((value: any) => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;

  return function debouncedFn(...args: Parameters<T>): Promise<ReturnType<T>> {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Create new promise
    return new Promise((resolve, reject) => {
      pendingResolve = resolve as (value: unknown) => void;
      pendingReject = reject;

      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          pendingResolve?.(result);
        } catch (error) {
          pendingReject?.(error);
        }
        timeoutId = null;
        pendingResolve = null;
        pendingReject = null;
      }, delay);
    });
  };
}

// ============================================================================
// Throttled Request
// ============================================================================

export function createThrottledRequest<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  interval: number
): DebouncedFn<T> {
  let lastCall = 0;
  let pendingPromise: Promise<unknown> | null = null;

  return function throttledFn(...args: Parameters<T>): Promise<ReturnType<T>> {
    const now = Date.now();

    // If within throttle interval, return pending or resolve immediately
    if (now - lastCall < interval) {
      if (pendingPromise) {
        return pendingPromise as Promise<ReturnType<T>>;
      }
      // Create a delayed execution
      return new Promise((resolve, reject) => {
        const delayMs = interval - (now - lastCall);
        setTimeout(() => {
          fn(...args)
            .then(resolve as (value: unknown) => void)
            .catch(reject);
        }, delayMs);
      });
    }

    // Execute immediately
    lastCall = now;
    pendingPromise = fn(...args).finally(() => {
      pendingPromise = null;
    });

    return pendingPromise as Promise<ReturnType<T>>;
  };
}

// ============================================================================
// Retry with Backoff
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryCondition?: (error: unknown, attempt: number) => boolean;
}

export async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    retryCondition = () => true,
  } = options || {};

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetcher();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxRetries || !retryCondition(error, attempt)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt), maxDelay);

      // Add jitter to prevent thundering herd
      const jitter = delay * 0.1 * Math.random();

      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}

// ============================================================================
// Batch Requests
// ============================================================================

interface BatchConfig<TKey, TResult> {
  maxBatchSize?: number;
  maxWaitMs?: number;
  batchFn: (keys: TKey[]) => Promise<Map<TKey, TResult>>;
}

export function createBatchedRequest<TKey, TResult>({
  maxBatchSize = 50,
  maxWaitMs = 10,
  batchFn,
}: BatchConfig<TKey, TResult>) {
  let batch: TKey[] = [];
  let resolvers: Map<
    TKey,
    { resolve: (value: TResult) => void; reject: (error: unknown) => void }
  > = new Map();
  let timeoutId: NodeJS.Timeout | null = null;

  const flush = async () => {
    if (batch.length === 0) return;

    const currentBatch = batch;
    const currentResolvers = resolvers;

    batch = [];
    resolvers = new Map();
    timeoutId = null;

    try {
      const results = await batchFn(currentBatch);

      for (const key of currentBatch) {
        const resolver = currentResolvers.get(key);
        if (resolver) {
          const result = results.get(key);
          if (result !== undefined) {
            resolver.resolve(result);
          } else {
            resolver.reject(new Error(`No result for key: ${key}`));
          }
        }
      }
    } catch (error) {
      for (const resolver of currentResolvers.values()) {
        resolver.reject(error);
      }
    }
  };

  return function batchedRequest(key: TKey): Promise<TResult> {
    return new Promise((resolve, reject) => {
      batch.push(key);
      resolvers.set(key, { resolve, reject });

      // Flush if batch is full
      if (batch.length >= maxBatchSize) {
        flush();
        return;
      }

      // Schedule flush if not already scheduled
      if (!timeoutId) {
        timeoutId = setTimeout(flush, maxWaitMs);
      }
    });
  };
}
