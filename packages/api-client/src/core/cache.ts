/**
 * Request cache for deduplication and caching.
 * Platform-agnostic - uses only standard JavaScript APIs.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pendingRequests = new Map<string, Promise<unknown>>();
  private defaultTTL: number;

  constructor(defaultTTL = 30 * 1000) {
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get cached data if valid, otherwise return null.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cached data with optional TTL.
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + (ttl ?? this.defaultTTL),
    });
  }

  /**
   * Delete cached data.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a pattern.
   */
  invalidatePattern(pattern: string | RegExp): void {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache size.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Deduplicate concurrent requests to the same endpoint.
   * If a request is already in progress for the given key, returns the existing promise.
   */
  async deduplicateRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
    // Check if there's already a pending request for this key
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Create the request and store it
    const promise = request().finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }
}
