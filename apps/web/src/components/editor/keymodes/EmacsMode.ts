/**
 * Emacs Mode Integration for Monaco Editor
 *
 * This module integrates monaco-emacs with our editor, providing Emacs keybindings.
 */

import type { editor } from 'monaco-editor';

// Types for monaco-emacs
interface EmacsModeInstance {
  dispose: () => void;
  start: () => void;
}

interface EmacsModeConstructor {
  new (editor: editor.IStandaloneCodeEditor): EmacsModeInstance;
}

// Track active Emacs mode instances per editor
const emacsInstances = new WeakMap<editor.IStandaloneCodeEditor, EmacsModeInstance>();

/**
 * Initialize Emacs mode for a Monaco editor instance
 */
export async function initEmacsMode(
  editorInstance: editor.IStandaloneCodeEditor
): Promise<EmacsModeInstance | null> {
  // Dispose existing instance if any
  disposeEmacsMode(editorInstance);

  try {
    // Dynamically import monaco-emacs
    const { EmacsExtension } = (await import('monaco-emacs')) as {
      EmacsExtension: EmacsModeConstructor;
    };

    // Initialize Emacs mode
    const emacsMode = new EmacsExtension(editorInstance);
    emacsMode.start();

    // Store the instance
    emacsInstances.set(editorInstance, emacsMode);

    return emacsMode;
  } catch (error) {
    console.warn('Failed to initialize Emacs mode:', error);
    return null;
  }
}

/**
 * Dispose Emacs mode for an editor instance
 */
export function disposeEmacsMode(editorInstance: editor.IStandaloneCodeEditor): void {
  const instance = emacsInstances.get(editorInstance);
  if (instance) {
    instance.dispose();
    emacsInstances.delete(editorInstance);
  }
}

/**
 * Check if Emacs mode is active for an editor
 */
export function isEmacsModeActive(editorInstance: editor.IStandaloneCodeEditor): boolean {
  return emacsInstances.has(editorInstance);
}

/**
 * Common Emacs key bindings reference
 */
export const emacsKeyReference = {
  navigation: {
    'Forward char': 'Ctrl+f',
    'Backward char': 'Ctrl+b',
    'Next line': 'Ctrl+n',
    'Previous line': 'Ctrl+p',
    'Forward word': 'Alt+f',
    'Backward word': 'Alt+b',
    'Beginning of line': 'Ctrl+a',
    'End of line': 'Ctrl+e',
    'Beginning of buffer': 'Alt+<',
    'End of buffer': 'Alt+>',
    'Go to line': 'Ctrl+g',
  },
  editing: {
    'Kill line': 'Ctrl+k',
    'Kill word': 'Alt+d',
    'Kill word backward': 'Alt+Backspace',
    Yank: 'Ctrl+y',
    'Yank pop': 'Alt+y',
    Undo: 'Ctrl+/',
    'Set mark': 'Ctrl+Space',
    'Kill region': 'Ctrl+w',
    'Copy region': 'Alt+w',
    'Transpose chars': 'Ctrl+t',
    'Transpose words': 'Alt+t',
    'Upcase word': 'Alt+u',
    'Downcase word': 'Alt+l',
    'Capitalize word': 'Alt+c',
  },
  search: {
    'Incremental search': 'Ctrl+s',
    'Reverse search': 'Ctrl+r',
    'Query replace': 'Alt+%',
  },
  buffer: {
    Save: 'Ctrl+x Ctrl+s',
    'Find file': 'Ctrl+x Ctrl+f',
    'Switch buffer': 'Ctrl+x b',
    'Kill buffer': 'Ctrl+x k',
  },
  other: {
    'Cancel command': 'Ctrl+g',
    'Universal argument': 'Ctrl+u',
    'Execute command': 'Alt+x',
  },
};

/**
 * Emacs status message styles
 */
export const emacsStatusStyles = `
  .emacs-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    background: #141419;
    border-top: 1px solid #2a2a35;
    color: #9898a8;
  }

  .emacs-status .emacs-mark {
    color: #a855f7;
  }

  .emacs-status .emacs-region {
    color: #00e5ff;
  }
`;
