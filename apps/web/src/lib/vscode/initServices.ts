/**
 * Initialize VS Code services for Monaco editor.
 *
 * This module sets up the necessary services from @codingame/monaco-vscode-api
 * to enable full VS Code API compatibility in the browser.
 */

import { initialize as initializeMonacoService } from '@codingame/monaco-vscode-api/services';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import '@codingame/monaco-vscode-theme-defaults-default-extension';

let servicesInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize Monaco VS Code services.
 * This should be called once at app startup before using the editor.
 *
 * Services are initialized lazily - calling this multiple times is safe.
 */
export async function initializeVSCodeServices(): Promise<void> {
  // Return early if already initialized
  if (servicesInitialized) {
    return;
  }

  // Return existing promise if initialization is in progress
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    try {
      // Initialize Monaco services with VS Code API compatibility
      await initializeMonacoService({
        ...getTextmateServiceOverride(),
      });

      servicesInitialized = true;
    } catch (error) {
      console.error('[VSCode] Failed to initialize services:', error);
      initializationPromise = null;
      throw error;
    }
  })();

  return initializationPromise;
}

/**
 * Check if VS Code services have been initialized.
 */
export function areServicesInitialized(): boolean {
  return servicesInitialized;
}

/**
 * Get the initialization promise (for awaiting in components).
 */
export function getInitializationPromise(): Promise<void> | null {
  return initializationPromise;
}
