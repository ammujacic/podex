import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RequestCache } from '../cache';

describe('RequestCache', () => {
  let cache: RequestCache;

  beforeEach(() => {
    cache = new RequestCache(1000); // 1 second default TTL
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Basic Operations', () => {
    it('should set and get cached data', () => {
      cache.set('key1', { data: 'test' });
      const result = cache.get('key1');
      expect(result).toEqual({ data: 'test' });
    });

    it('should return null for non-existent key', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete cached data', () => {
      cache.set('key1', { data: 'test' });
      cache.delete('key1');
      expect(cache.get('key1')).toBeNull();
    });

    it('should clear all cache', () => {
      cache.set('key1', { data: 'test1' });
      cache.set('key2', { data: 'test2' });
      expect(cache.size).toBe(2);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
    });

    it('should track cache size', () => {
      expect(cache.size).toBe(0);
      cache.set('key1', { data: 'test1' });
      expect(cache.size).toBe(1);
      cache.set('key2', { data: 'test2' });
      expect(cache.size).toBe(2);
      cache.delete('key1');
      expect(cache.size).toBe(1);
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire cached data after default TTL', () => {
      cache.set('key1', { data: 'test' });
      expect(cache.get('key1')).toEqual({ data: 'test' });

      // Advance time past TTL
      vi.advanceTimersByTime(1001);
      expect(cache.get('key1')).toBeNull();
    });

    it('should respect custom TTL', () => {
      cache.set('key1', { data: 'test' }, 2000); // 2 seconds

      // Should still be valid after 1 second
      vi.advanceTimersByTime(1000);
      expect(cache.get('key1')).toEqual({ data: 'test' });

      // Should expire after 2 seconds
      vi.advanceTimersByTime(1001);
      expect(cache.get('key1')).toBeNull();
    });

    it('should use default TTL from constructor', () => {
      const customCache = new RequestCache(5000); // 5 seconds
      customCache.set('key1', { data: 'test' });

      vi.advanceTimersByTime(4999);
      expect(customCache.get('key1')).toEqual({ data: 'test' });

      vi.advanceTimersByTime(2);
      expect(customCache.get('key1')).toBeNull();
    });

    it('should clean up expired entries on get', () => {
      cache.set('key1', { data: 'test' });
      expect(cache.size).toBe(1);

      vi.advanceTimersByTime(1001);
      cache.get('key1'); // This should trigger cleanup
      expect(cache.size).toBe(0);
    });
  });

  describe('Pattern Invalidation', () => {
    beforeEach(() => {
      cache.set('users:1', { id: 1 });
      cache.set('users:2', { id: 2 });
      cache.set('posts:1', { id: 1 });
      cache.set('posts:2', { id: 2 });
    });

    it('should invalidate entries matching string pattern', () => {
      cache.invalidatePattern('users:');
      expect(cache.get('users:1')).toBeNull();
      expect(cache.get('users:2')).toBeNull();
      expect(cache.get('posts:1')).toEqual({ id: 1 });
      expect(cache.get('posts:2')).toEqual({ id: 2 });
    });

    it('should invalidate entries matching regex pattern', () => {
      cache.invalidatePattern(/^users:/);
      expect(cache.get('users:1')).toBeNull();
      expect(cache.get('users:2')).toBeNull();
      expect(cache.get('posts:1')).toEqual({ id: 1 });
      expect(cache.get('posts:2')).toEqual({ id: 2 });
    });

    it('should invalidate all entries with wildcard pattern', () => {
      cache.invalidatePattern('.*');
      expect(cache.size).toBe(0);
    });

    it('should handle patterns with no matches', () => {
      const sizeBefore = cache.size;
      cache.invalidatePattern('nonexistent');
      expect(cache.size).toBe(sizeBefore);
    });

    it('should invalidate specific ID patterns', () => {
      cache.invalidatePattern(/:\d$/);
      expect(cache.size).toBe(0); // All entries match :digit pattern
    });
  });

  describe('Request Deduplication', () => {
    it('should deduplicate concurrent requests', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ data: 'test' });

      // Start two concurrent requests with same key
      const promise1 = cache.deduplicateRequest('request1', mockRequest);
      const promise2 = cache.deduplicateRequest('request1', mockRequest);

      // Both should resolve to same value
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ data: 'test' });
      expect(result2).toEqual({ data: 'test' });

      // Request function should only be called once
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('should allow sequential requests with same key', async () => {
      const mockRequest = vi
        .fn()
        .mockResolvedValueOnce({ data: 'test1' })
        .mockResolvedValueOnce({ data: 'test2' });

      const result1 = await cache.deduplicateRequest('request1', mockRequest);
      const result2 = await cache.deduplicateRequest('request1', mockRequest);

      expect(result1).toEqual({ data: 'test1' });
      expect(result2).toEqual({ data: 'test2' });
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should handle different keys independently', async () => {
      const mockRequest1 = vi.fn().mockResolvedValue({ data: 'test1' });
      const mockRequest2 = vi.fn().mockResolvedValue({ data: 'test2' });

      const promise1 = cache.deduplicateRequest('request1', mockRequest1);
      const promise2 = cache.deduplicateRequest('request2', mockRequest2);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ data: 'test1' });
      expect(result2).toEqual({ data: 'test2' });
      expect(mockRequest1).toHaveBeenCalledTimes(1);
      expect(mockRequest2).toHaveBeenCalledTimes(1);
    });

    it('should handle request failures', async () => {
      const mockRequest = vi.fn().mockRejectedValue(new Error('Request failed'));

      await expect(cache.deduplicateRequest('request1', mockRequest)).rejects.toThrow(
        'Request failed'
      );

      // Should be able to retry after failure
      mockRequest.mockResolvedValueOnce({ data: 'success' });
      const result = await cache.deduplicateRequest('request1', mockRequest);
      expect(result).toEqual({ data: 'success' });
    });

    it('should clean up pending requests after completion', async () => {
      const mockRequest = vi.fn().mockResolvedValue({ data: 'test' });

      await cache.deduplicateRequest('request1', mockRequest);

      // Second request should call the function again (not deduped)
      await cache.deduplicateRequest('request1', mockRequest);

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('Type Safety', () => {
    it('should preserve types for get/set', () => {
      interface User {
        id: number;
        name: string;
      }

      const user: User = { id: 1, name: 'Test' };
      cache.set<User>('user1', user);

      const result = cache.get<User>('user1');
      expect(result).toEqual(user);
    });

    it('should preserve types for deduplicateRequest', async () => {
      interface ApiResponse {
        status: string;
        data: { id: number };
      }

      const mockRequest = (): Promise<ApiResponse> =>
        Promise.resolve({ status: 'ok', data: { id: 1 } });

      const result = await cache.deduplicateRequest<ApiResponse>('request1', mockRequest);
      expect(result.status).toBe('ok');
      expect(result.data.id).toBe(1);
    });
  });
});
