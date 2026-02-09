/**
 * Tests for async-utils.ts utility functions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  debounceAsync,
  retryAsync,
  sleep,
  safeAsync,
  cancellableAsync,
  parallelLimit,
  withTimeout,
} from '../async-utils';

describe('debounceAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays function execution', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const debounced = debounceAsync(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('only executes the last call within delay period', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const debounced = debounceAsync(fn, 100);

    debounced('call1');
    debounced('call2');
    debounced('call3');

    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('call3');
  });

  it('resets timer on each call', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const debounced = debounceAsync(fn, 100);

    debounced();
    await vi.advanceTimersByTimeAsync(50);
    debounced();
    await vi.advanceTimersByTimeAsync(50);
    expect(fn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('handles rejected promises gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new Error('test error'));
    const debounced = debounceAsync(fn, 100);

    debounced();
    await vi.advanceTimersByTimeAsync(100);

    expect(fn).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('retryAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const promise = retryAsync(fn);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure up to maxRetries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');

    const promise = retryAsync(fn, { maxRetries: 3, initialDelayMs: 100 });

    // First call fails
    await vi.advanceTimersByTimeAsync(0);
    // Wait for first retry delay
    await vi.advanceTimersByTimeAsync(100);
    // Wait for second retry delay (200ms due to exponential backoff)
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exceeded', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    const promise = retryAsync(fn, { maxRetries: 2, initialDelayMs: 100 });

    // Handle the rejection to prevent unhandled rejection warning
    promise.catch(() => {}); // noop to prevent unhandled rejection

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(100); // First retry
    await vi.advanceTimersByTimeAsync(200); // Second retry

    await expect(promise).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('respects shouldRetry callback', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    const promise = retryAsync(fn, { maxRetries: 3, shouldRetry });

    await expect(promise).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalled();
  });

  it('uses exponential backoff with max delay', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');

    const promise = retryAsync(fn, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 1500,
    });

    // First attempt fails immediately
    await vi.advanceTimersByTimeAsync(0);
    // First retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    // Second retry after 1500ms (capped from 2000)
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;
    expect(result).toBe('success');
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after specified duration', async () => {
    const promise = sleep(100);
    let resolved = false;

    promise.then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(resolved).toBe(true);
  });

  it('resolves immediately for 0ms', async () => {
    const promise = sleep(0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('safeAsync', () => {
  it('returns [result, null] on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const [result, error] = await safeAsync(fn);

    expect(result).toBe('success');
    expect(error).toBeNull();
  });

  it('returns [null, Error] on failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('test error'));

    const [result, error] = await safeAsync(fn);

    expect(result).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('test error');
  });

  it('wraps non-Error throws in Error', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    const [result, error] = await safeAsync(fn);

    expect(result).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('string error');
  });

  it('handles null/undefined values correctly', async () => {
    const fn = vi.fn().mockResolvedValue(null);

    const [result, error] = await safeAsync(fn);

    expect(result).toBeNull();
    expect(error).toBeNull();
  });
});

describe('cancellableAsync', () => {
  it('returns promise and cancel function', () => {
    const fn = vi.fn().mockImplementation(async () => 'result');
    const { promise, cancel } = cancellableAsync(fn);

    expect(promise).toBeInstanceOf(Promise);
    expect(typeof cancel).toBe('function');
  });

  it('passes abort signal to function', async () => {
    let receivedSignal: AbortSignal | null = null;
    const fn = vi.fn().mockImplementation(async (signal: AbortSignal) => {
      receivedSignal = signal;
      return 'result';
    });

    const { promise } = cancellableAsync(fn);
    await promise;

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('throws "Operation cancelled" when cancelled', async () => {
    const fn = vi.fn().mockImplementation(async (signal: AbortSignal) => {
      // Simulate async operation that checks abort
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const { promise, cancel } = cancellableAsync(fn);
    cancel();

    await expect(promise).rejects.toThrow('Operation cancelled');
  });

  it('resolves normally when not cancelled', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const { promise } = cancellableAsync(fn);

    const result = await promise;
    expect(result).toBe('result');
  });
});

describe('parallelLimit', () => {
  it('processes all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const fn = vi.fn().mockImplementation(async (item: number) => item * 2);

    const results = await parallelLimit(items, fn, 2);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('respects concurrency limit', async () => {
    const items = [1, 2, 3, 4];
    let concurrent = 0;
    let maxConcurrent = 0;

    const fn = vi.fn().mockImplementation(async (item: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent--;
      return item;
    });

    await parallelLimit(items, fn, 2);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles empty array', async () => {
    const fn = vi.fn();
    const results = await parallelLimit([], fn, 5);

    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('maintains order of results', async () => {
    const items = [3, 1, 2];
    const fn = vi.fn().mockImplementation(async (item: number, index: number) => {
      await new Promise((resolve) => setTimeout(resolve, item * 10));
      return `item-${index}`;
    });

    const results = await parallelLimit(items, fn, 3);

    expect(results).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('uses default concurrency of 5', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let concurrent = 0;
    let maxConcurrent = 0;

    const fn = vi.fn().mockImplementation(async (item: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent--;
      return item;
    });

    await parallelLimit(items, fn);

    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with result if promise completes in time', async () => {
    const promise = Promise.resolve('success');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('success');
  });

  it('throws timeout error if promise takes too long', async () => {
    const promise = new Promise((resolve) => setTimeout(() => resolve('late'), 2000));
    const timeoutPromise = withTimeout(promise, 1000);

    // Handle the rejection to prevent unhandled rejection warning
    timeoutPromise.catch(() => {}); // noop to prevent unhandled rejection

    await vi.advanceTimersByTimeAsync(1000);

    await expect(timeoutPromise).rejects.toThrow('Operation timed out');
  });

  it('uses custom timeout message', async () => {
    const promise = new Promise((resolve) => setTimeout(() => resolve('late'), 2000));
    const timeoutPromise = withTimeout(promise, 1000, 'Custom timeout message');

    // Handle the rejection to prevent unhandled rejection warning
    timeoutPromise.catch(() => {}); // noop to prevent unhandled rejection

    await vi.advanceTimersByTimeAsync(1000);

    await expect(timeoutPromise).rejects.toThrow('Custom timeout message');
  });

  it('clears timeout when promise resolves', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const promise = Promise.resolve('fast');
    await withTimeout(promise, 1000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('propagates error from rejected promise', async () => {
    const promise = Promise.reject(new Error('Promise failed'));

    await expect(withTimeout(promise, 1000)).rejects.toThrow('Promise failed');
  });
});
