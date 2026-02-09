/**
 * Async utility functions for common patterns.
 * Provides debouncing, retrying, and safe async operations.
 */

/**
 * Creates a debounced version of an async function.
 * Only the last call within the delay period will execute.
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args).catch(console.error);
    }, delayMs);
  };
}

/**
 * Retry an async operation with exponential backoff.
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async function and return [result, error] tuple.
 * Useful for avoiding try/catch boilerplate.
 */
export async function safeAsync<T>(fn: () => Promise<T>): Promise<[T, null] | [null, Error]> {
  try {
    const result = await fn();
    return [result, null];
  } catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))];
  }
}

/**
 * Create a cancellable async operation.
 * Returns a controller with a cancel method.
 */
export function cancellableAsync<T>(fn: (signal: AbortSignal) => Promise<T>): {
  promise: Promise<T>;
  cancel: () => void;
} {
  const controller = new AbortController();

  const promise = fn(controller.signal).catch((error) => {
    if (error.name === 'AbortError') {
      throw new Error('Operation cancelled');
    }
    throw error;
  });

  return {
    promise,
    cancel: () => controller.abort(),
  };
}

/**
 * Execute promises in parallel with a concurrency limit.
 */
export async function parallelLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      if (item !== undefined) {
        results[currentIndex] = await fn(item, currentIndex);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);

  return results;
}

/**
 * Timeout wrapper for promises.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
