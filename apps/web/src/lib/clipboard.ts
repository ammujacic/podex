/**
 * Clipboard utilities with toast notifications.
 * Centralizes copy-to-clipboard functionality with consistent UX.
 */

import { toast } from 'sonner';

interface CopyOptions {
  /** Custom success message */
  successMessage?: string;
  /** Custom error message */
  errorMessage?: string;
  /** Whether to show a toast notification (default: true) */
  showToast?: boolean;
}

/**
 * Copy text to clipboard with optional toast notification.
 * @param text - The text to copy
 * @param options - Configuration options
 * @returns Promise that resolves to true on success, false on failure
 */
export async function copyToClipboard(text: string, options: CopyOptions = {}): Promise<boolean> {
  const {
    successMessage = 'Copied to clipboard',
    errorMessage = 'Failed to copy to clipboard',
    showToast = true,
  } = options;

  try {
    await navigator.clipboard.writeText(text);
    if (showToast) {
      toast.success(successMessage);
    }
    return true;
  } catch (error) {
    console.error('Clipboard copy failed:', error);
    if (showToast) {
      toast.error(errorMessage);
    }
    return false;
  }
}

/**
 * Copy file path to clipboard.
 */
export async function copyPath(path: string): Promise<boolean> {
  return copyToClipboard(path, {
    successMessage: 'Path copied',
  });
}

/**
 * Copy URL to clipboard.
 */
export async function copyUrl(url: string): Promise<boolean> {
  return copyToClipboard(url, {
    successMessage: 'URL copied',
  });
}

/**
 * Copy code snippet to clipboard.
 */
export async function copyCode(code: string): Promise<boolean> {
  return copyToClipboard(code, {
    successMessage: 'Code copied',
  });
}

/**
 * Copy commit hash to clipboard.
 */
export async function copyCommitHash(hash: string): Promise<boolean> {
  return copyToClipboard(hash, {
    successMessage: 'Commit hash copied',
  });
}

/**
 * Copy token/secret to clipboard (generic for API keys, auth tokens, etc).
 */
export async function copySecret(secret: string, label = 'Token'): Promise<boolean> {
  return copyToClipboard(secret, {
    successMessage: `${label} copied`,
  });
}
