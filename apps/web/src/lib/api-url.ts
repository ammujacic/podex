/**
 * Utility to get the API base URL.
 */

/**
 * Get the API base URL (async).
 */
export async function getApiBaseUrl(): Promise<string> {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

/**
 * Get the API base URL synchronously (for initial client setup).
 */
export function getApiBaseUrlSync(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}
