/**
 * Utility functions for API client.
 * Platform-agnostic helpers.
 */

/**
 * Calculate token expiry timestamp from expires_in seconds.
 */
export function calculateExpiry(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

/**
 * Check if a token is about to expire (within the given buffer).
 * @param expiresAt - Token expiry timestamp in milliseconds
 * @param bufferMs - Buffer time in milliseconds (default 5 minutes)
 */
export function isTokenExpiringSoon(expiresAt: number, bufferMs = 5 * 60 * 1000): boolean {
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Transform snake_case keys to camelCase.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Transform camelCase keys to snake_case.
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Recursively transform object keys from snake_case to camelCase.
 */
export function transformKeysToCamel<T>(obj: unknown): T {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToCamel) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [snakeToCamel(key), transformKeysToCamel(value)])
    ) as T;
  }
  return obj as T;
}

/**
 * Recursively transform object keys from camelCase to snake_case.
 */
export function transformKeysToSnake<T>(obj: unknown): T {
  if (Array.isArray(obj)) {
    return obj.map(transformKeysToSnake) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [camelToSnake(key), transformKeysToSnake(value)])
    ) as T;
  }
  return obj as T;
}

/**
 * Build query string from params object.
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

/**
 * Join URL path segments safely.
 */
export function joinPath(...segments: string[]): string {
  return segments
    .map((segment, index) => {
      if (index === 0) {
        return segment.replace(/\/+$/, '');
      }
      return segment.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}
