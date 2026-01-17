/**
 * Shared helper functions for tool result displays.
 */

import type { ToolResult } from './types';

/**
 * Safely parse JSON string to object.
 */
export function safeParseJSON(str: unknown): ToolResult | null {
  if (typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Format bytes to human readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
