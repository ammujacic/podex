/**
 * Utility to get the API base URL, with Electron support.
 * In Electron, this will fetch the API URL from Electron's settings.
 */

/**
 * Get the API base URL, checking Electron settings if available.
 */
export async function getApiBaseUrl(): Promise<string> {
  // Check if we're in Electron
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      const electronApi = window.electronAPI;
      if (electronApi.getApiUrl) {
        const apiUrl = await electronApi.getApiUrl();
        if (apiUrl && typeof apiUrl === 'string') {
          return apiUrl;
        }
      }
    } catch (error) {
      console.warn('Failed to get API URL from Electron:', error);
    }
  }

  // Fallback to environment variable or default
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

/**
 * Get the API base URL synchronously (for initial client setup).
 * In Electron, this will use a default and should be updated later.
 */
export function getApiBaseUrlSync(): string {
  // In Electron, we'll use the default and update it async
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}
