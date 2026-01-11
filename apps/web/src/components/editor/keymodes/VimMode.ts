/**
 * Vim Mode Integration for Monaco Editor
 *
 * This module integrates monaco-vim with our editor, providing a full Vim experience.
 * It handles mode switching, status bar updates, and custom keybindings.
 */

import type { editor } from 'monaco-editor';

// Types for monaco-vim (the library doesn't have great TypeScript support)
interface VimModeInstance {
  dispose: () => void;
}

interface VimModeStatic {
  initVimMode: (
    editor: editor.IStandaloneCodeEditor,
    statusBarNode?: HTMLElement | null
  ) => VimModeInstance;
  VimMode: {
    Vim: {
      defineEx: (name: string, prefix: string, callback: () => void) => void;
      map: (keys: string, action: string, mode: string) => void;
      noremap: (keys: string, action: string, mode: string) => void;
    };
  };
}

// Track active Vim mode instances per editor
const vimInstances = new WeakMap<editor.IStandaloneCodeEditor, VimModeInstance>();

/**
 * Initialize Vim mode for a Monaco editor instance
 */
export async function initVimMode(
  editorInstance: editor.IStandaloneCodeEditor,
  statusBarElement?: HTMLElement | null,
  options?: {
    onModeChange?: (mode: string) => void;
    customMappings?: Array<{ keys: string; action: string; mode?: string }>;
  }
): Promise<VimModeInstance | null> {
  // Dispose existing instance if any
  disposeVimMode(editorInstance);

  try {
    // Dynamically import monaco-vim
    const { initVimMode: init, VimMode } = (await import('monaco-vim')) as unknown as VimModeStatic;

    // Initialize Vim mode
    const vimMode = init(editorInstance, statusBarElement);

    // Store the instance
    vimInstances.set(editorInstance, vimMode);

    // Add custom commands
    const Vim = VimMode.Vim;

    // Custom ex commands
    Vim.defineEx('write', 'w', () => {
      // Trigger save
      editorInstance.trigger('vim', 'editor.action.save', null);
    });

    Vim.defineEx('quit', 'q', () => {
      // Could trigger tab close
      editorInstance.trigger('vim', 'closeActiveEditor', null);
    });

    Vim.defineEx('wq', 'wq', () => {
      editorInstance.trigger('vim', 'editor.action.save', null);
      editorInstance.trigger('vim', 'closeActiveEditor', null);
    });

    // Apply custom mappings
    if (options?.customMappings) {
      for (const mapping of options.customMappings) {
        Vim.noremap(mapping.keys, mapping.action, mapping.mode || 'normal');
      }
    }

    // Add some helpful default mappings
    // jk to exit insert mode (common mapping)
    Vim.map('jk', '<Esc>', 'insert');

    // Leader key mappings (using space as leader)
    // Note: monaco-vim doesn't fully support leader key, but we can define common patterns

    return vimMode;
  } catch (error) {
    console.warn('Failed to initialize Vim mode:', error);
    return null;
  }
}

/**
 * Dispose Vim mode for an editor instance
 */
export function disposeVimMode(editorInstance: editor.IStandaloneCodeEditor): void {
  const instance = vimInstances.get(editorInstance);
  if (instance) {
    instance.dispose();
    vimInstances.delete(editorInstance);
  }
}

/**
 * Check if Vim mode is active for an editor
 */
export function isVimModeActive(editorInstance: editor.IStandaloneCodeEditor): boolean {
  return vimInstances.has(editorInstance);
}

/**
 * Vim status bar component styles
 */
export const vimStatusBarStyles = `
  .vim-status-bar {
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

  .vim-status-bar .vim-mode {
    font-weight: 600;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 3px;
  }

  .vim-status-bar .vim-mode.normal {
    background: #22c55e20;
    color: #22c55e;
  }

  .vim-status-bar .vim-mode.insert {
    background: #00e5ff20;
    color: #00e5ff;
  }

  .vim-status-bar .vim-mode.visual {
    background: #a855f720;
    color: #a855f7;
  }

  .vim-status-bar .vim-mode.replace {
    background: #ef444420;
    color: #ef4444;
  }

  .vim-status-bar .vim-command {
    color: #f0f0f5;
  }
`;

/**
 * Common Vim key mappings reference
 */
export const vimKeyReference = {
  modes: {
    normal: 'Esc / Ctrl+[',
    insert: 'i / a / o / O',
    visual: 'v / V / Ctrl+v',
    command: ':',
  },
  navigation: {
    'Move left': 'h',
    'Move down': 'j',
    'Move up': 'k',
    'Move right': 'l',
    'Word forward': 'w',
    'Word backward': 'b',
    'Line start': '0 / ^',
    'Line end': '$',
    'File start': 'gg',
    'File end': 'G',
    'Go to line': ':<number>',
  },
  editing: {
    Undo: 'u',
    Redo: 'Ctrl+r',
    Delete: 'x / dd / dw',
    Yank: 'yy / yw',
    Paste: 'p / P',
    Change: 'c / cc / cw',
    Replace: 'r',
  },
  search: {
    'Search forward': '/',
    'Search backward': '?',
    'Next match': 'n',
    'Previous match': 'N',
    'Search word': '*',
  },
};
