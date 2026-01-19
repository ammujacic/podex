/**
 * Initialize VS Code services for Monaco editor.
 *
 * This module sets up the necessary services from @codingame/monaco-vscode-api
 * to enable full VS Code API compatibility in the browser.
 */

import { initialize as initializeMonacoService } from '@codingame/monaco-vscode-api/services';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import '@codingame/monaco-vscode-theme-defaults-default-extension';

// Configure Monaco environment to suppress worker warnings
// Monaco will fall back to main thread execution, which is fine for our use case
if (typeof window !== 'undefined') {
  type MonacoEnv = {
    getWorker: (_workerId: string, _label: string) => Worker;
  };
  const win = window as Window & { MonacoEnvironment?: MonacoEnv };
  // Setting getWorker to a function that returns a stub prevents the warning
  // The stub worker won't be used - Monaco falls back to main thread
  win.MonacoEnvironment = {
    getWorker: () => {
      // Return a minimal worker that immediately posts back empty result
      const blob = new Blob(['self.onmessage = () => self.postMessage({});'], {
        type: 'application/javascript',
      });
      return new Worker(URL.createObjectURL(blob));
    },
  };
}

let servicesInitialized = false;
let initializationPromise: Promise<void> | null = null;
let themeRegistered = false;

/**
 * Apply Terminal Noir theme customizations via CSS.
 * Since VS Code Monaco API uses a different theming system,
 * we apply customizations through CSS variables and overrides.
 */
function applyTerminalNoirTheme() {
  if (themeRegistered) return;

  try {
    // Inject CSS variables for Monaco editor theming
    const style = document.createElement('style');
    style.id = 'terminal-noir-theme';
    style.textContent = `
      /* Terminal Noir Theme for Monaco Editor */
      .monaco-editor {
        --vscode-editor-background: #0d0d12;
        --vscode-editor-foreground: #ffffff;
        --vscode-editorLineNumber-foreground: #8B5CF6;
        --vscode-editorLineNumber-activeForeground: #a78bfa;
        --vscode-editorCursor-foreground: #8B5CF6;
        --vscode-editor-lineHighlightBackground: #1a1a21;
        --vscode-editor-selectionBackground: rgba(139, 92, 246, 0.3);
        --vscode-editor-inactiveSelectionBackground: rgba(139, 92, 246, 0.15);
        --vscode-editor-selectionHighlightBackground: rgba(139, 92, 246, 0.2);
        --vscode-editorIndentGuide-background: #1e1e26;
        --vscode-editorIndentGuide-activeBackground: #2a2a35;
      }

      /* Syntax token colors */
      .monaco-editor .mtk1 { color: #ffffff !important; } /* default */
      .monaco-editor .mtk2 { color: #546e7a !important; } /* comment */
      .monaco-editor .mtk3 { color: #c792ea !important; } /* keyword */
      .monaco-editor .mtk4 { color: #c3e88d !important; } /* string */
      .monaco-editor .mtk5 { color: #ffd700 !important; } /* number */
      .monaco-editor .mtk6 { color: #82aaff !important; } /* function */
      .monaco-editor .mtk7 { color: #ffcb6b !important; } /* type */
      .monaco-editor .mtk8 { color: #00e5ff !important; } /* constant */
      .monaco-editor .mtk9 { color: #89ddff !important; } /* operator */
      .monaco-editor .mtk10 { color: #b4b4c8 !important; } /* delimiter */

      /* Line numbers with purple accent */
      .monaco-editor .line-numbers { color: #8B5CF6 !important; }
      .monaco-editor .current-line-number { color: #a78bfa !important; }
    `;

    document.head.appendChild(style);
    themeRegistered = true;
  } catch (error) {
    console.error('[VSCode] Failed to apply Terminal Noir theme:', error);
  }
}

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
        ...getThemeServiceOverride(),
      });

      // Apply custom theme after services are initialized
      applyTerminalNoirTheme();

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
