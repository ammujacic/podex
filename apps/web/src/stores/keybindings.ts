import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export interface Keybinding {
  id: string;
  command: string;
  label: string;
  category: string;
  keys: string[];
  when?: string;
  isDefault?: boolean;
  isCustom?: boolean;
}

// ============================================================================
// Default Keybindings
// ============================================================================

export const defaultKeybindings: Keybinding[] = [
  // File operations
  { id: 'file.new', command: 'file.new', label: 'New File', category: 'File', keys: ['Cmd+N'] },
  { id: 'file.open', command: 'file.open', label: 'Open File', category: 'File', keys: ['Cmd+O'] },
  { id: 'file.save', command: 'file.save', label: 'Save', category: 'File', keys: ['Cmd+S'] },
  {
    id: 'file.saveAll',
    command: 'file.saveAll',
    label: 'Save All',
    category: 'File',
    keys: ['Cmd+Alt+S'],
  },
  {
    id: 'file.close',
    command: 'file.close',
    label: 'Close Tab',
    category: 'File',
    keys: ['Cmd+W'],
  },
  {
    id: 'file.closeAll',
    command: 'file.closeAll',
    label: 'Close All',
    category: 'File',
    keys: ['Cmd+K Cmd+W'],
  },
  {
    id: 'file.reopenClosed',
    command: 'file.reopenClosed',
    label: 'Reopen Closed',
    category: 'File',
    keys: ['Cmd+Shift+T'],
  },

  // Navigation
  {
    id: 'nav.quickOpen',
    command: 'nav.quickOpen',
    label: 'Quick Open',
    category: 'Navigation',
    keys: ['Cmd+P'],
  },
  {
    id: 'nav.commandPalette',
    command: 'nav.commandPalette',
    label: 'Command Palette',
    category: 'Navigation',
    keys: ['Cmd+Shift+P'],
  },
  {
    id: 'nav.goToLine',
    command: 'nav.goToLine',
    label: 'Go to Line',
    category: 'Navigation',
    keys: ['Cmd+G'],
  },
  {
    id: 'nav.goToSymbol',
    command: 'nav.goToSymbol',
    label: 'Go to Symbol',
    category: 'Navigation',
    keys: ['Cmd+Shift+O'],
  },
  {
    id: 'nav.goToDefinition',
    command: 'nav.goToDefinition',
    label: 'Go to Definition',
    category: 'Navigation',
    keys: ['F12'],
  },
  {
    id: 'nav.peekDefinition',
    command: 'nav.peekDefinition',
    label: 'Peek Definition',
    category: 'Navigation',
    keys: ['Alt+F12'],
  },
  {
    id: 'nav.findReferences',
    command: 'nav.findReferences',
    label: 'Find References',
    category: 'Navigation',
    keys: ['Shift+F12'],
  },
  {
    id: 'nav.back',
    command: 'nav.back',
    label: 'Go Back',
    category: 'Navigation',
    keys: ['Ctrl+-'],
  },
  {
    id: 'nav.forward',
    command: 'nav.forward',
    label: 'Go Forward',
    category: 'Navigation',
    keys: ['Ctrl+Shift+-'],
  },

  // Search
  { id: 'search.find', command: 'search.find', label: 'Find', category: 'Search', keys: ['Cmd+F'] },
  {
    id: 'search.replace',
    command: 'search.replace',
    label: 'Replace',
    category: 'Search',
    keys: ['Cmd+H'],
  },
  {
    id: 'search.findInFiles',
    command: 'search.findInFiles',
    label: 'Find in Files',
    category: 'Search',
    keys: ['Cmd+Shift+F'],
  },
  {
    id: 'search.findNext',
    command: 'search.findNext',
    label: 'Find Next',
    category: 'Search',
    keys: ['F3', 'Cmd+G'],
  },
  {
    id: 'search.findPrevious',
    command: 'search.findPrevious',
    label: 'Find Previous',
    category: 'Search',
    keys: ['Shift+F3', 'Cmd+Shift+G'],
  },

  // Editor
  {
    id: 'editor.selectAll',
    command: 'editor.selectAll',
    label: 'Select All',
    category: 'Editor',
    keys: ['Cmd+A'],
  },
  { id: 'editor.cut', command: 'editor.cut', label: 'Cut', category: 'Editor', keys: ['Cmd+X'] },
  { id: 'editor.copy', command: 'editor.copy', label: 'Copy', category: 'Editor', keys: ['Cmd+C'] },
  {
    id: 'editor.paste',
    command: 'editor.paste',
    label: 'Paste',
    category: 'Editor',
    keys: ['Cmd+V'],
  },
  { id: 'editor.undo', command: 'editor.undo', label: 'Undo', category: 'Editor', keys: ['Cmd+Z'] },
  {
    id: 'editor.redo',
    command: 'editor.redo',
    label: 'Redo',
    category: 'Editor',
    keys: ['Cmd+Shift+Z'],
  },
  {
    id: 'editor.comment',
    command: 'editor.comment',
    label: 'Toggle Comment',
    category: 'Editor',
    keys: ['Cmd+/'],
  },
  {
    id: 'editor.blockComment',
    command: 'editor.blockComment',
    label: 'Toggle Block Comment',
    category: 'Editor',
    keys: ['Cmd+Shift+/'],
  },
  {
    id: 'editor.deleteLine',
    command: 'editor.deleteLine',
    label: 'Delete Line',
    category: 'Editor',
    keys: ['Cmd+Shift+K'],
  },
  {
    id: 'editor.moveLineUp',
    command: 'editor.moveLineUp',
    label: 'Move Line Up',
    category: 'Editor',
    keys: ['Alt+Up'],
  },
  {
    id: 'editor.moveLineDown',
    command: 'editor.moveLineDown',
    label: 'Move Line Down',
    category: 'Editor',
    keys: ['Alt+Down'],
  },
  {
    id: 'editor.copyLineUp',
    command: 'editor.copyLineUp',
    label: 'Copy Line Up',
    category: 'Editor',
    keys: ['Alt+Shift+Up'],
  },
  {
    id: 'editor.copyLineDown',
    command: 'editor.copyLineDown',
    label: 'Copy Line Down',
    category: 'Editor',
    keys: ['Alt+Shift+Down'],
  },
  {
    id: 'editor.addCursorAbove',
    command: 'editor.addCursorAbove',
    label: 'Add Cursor Above',
    category: 'Editor',
    keys: ['Cmd+Alt+Up'],
  },
  {
    id: 'editor.addCursorBelow',
    command: 'editor.addCursorBelow',
    label: 'Add Cursor Below',
    category: 'Editor',
    keys: ['Cmd+Alt+Down'],
  },
  {
    id: 'editor.selectNextOccurrence',
    command: 'editor.selectNextOccurrence',
    label: 'Select Next Occurrence',
    category: 'Editor',
    keys: ['Cmd+D'],
  },
  {
    id: 'editor.selectAllOccurrences',
    command: 'editor.selectAllOccurrences',
    label: 'Select All Occurrences',
    category: 'Editor',
    keys: ['Cmd+Shift+L'],
  },
  {
    id: 'editor.rename',
    command: 'editor.rename',
    label: 'Rename Symbol',
    category: 'Editor',
    keys: ['F2'],
  },
  {
    id: 'editor.quickFix',
    command: 'editor.quickFix',
    label: 'Quick Fix',
    category: 'Editor',
    keys: ['Cmd+.'],
  },
  {
    id: 'editor.format',
    command: 'editor.format',
    label: 'Format Document',
    category: 'Editor',
    keys: ['Cmd+Shift+I'],
  },
  {
    id: 'editor.formatSelection',
    command: 'editor.formatSelection',
    label: 'Format Selection',
    category: 'Editor',
    keys: ['Cmd+K Cmd+F'],
  },

  // View
  {
    id: 'view.toggleSidebar',
    command: 'view.toggleSidebar',
    label: 'Toggle Sidebar',
    category: 'View',
    keys: ['Cmd+B'],
  },
  {
    id: 'view.togglePanel',
    command: 'view.togglePanel',
    label: 'Toggle Panel',
    category: 'View',
    keys: ['Cmd+J'],
  },
  {
    id: 'view.toggleTerminal',
    command: 'view.toggleTerminal',
    label: 'Toggle Terminal',
    category: 'View',
    keys: ['Cmd+`'],
  },
  {
    id: 'view.splitEditor',
    command: 'view.splitEditor',
    label: 'Split Editor',
    category: 'View',
    keys: ['Cmd+\\'],
  },
  {
    id: 'view.focusExplorer',
    command: 'view.focusExplorer',
    label: 'Focus Explorer',
    category: 'View',
    keys: ['Cmd+Shift+E'],
  },
  {
    id: 'view.focusSearch',
    command: 'view.focusSearch',
    label: 'Focus Search',
    category: 'View',
    keys: ['Cmd+Shift+F'],
  },
  {
    id: 'view.focusGit',
    command: 'view.focusGit',
    label: 'Focus Git',
    category: 'View',
    keys: ['Cmd+Shift+G'],
  },
  {
    id: 'view.focusDebug',
    command: 'view.focusDebug',
    label: 'Focus Debug',
    category: 'View',
    keys: ['Cmd+Shift+D'],
  },
  {
    id: 'view.zoomIn',
    command: 'view.zoomIn',
    label: 'Zoom In',
    category: 'View',
    keys: ['Cmd+='],
  },
  {
    id: 'view.zoomOut',
    command: 'view.zoomOut',
    label: 'Zoom Out',
    category: 'View',
    keys: ['Cmd+-'],
  },
  {
    id: 'view.resetZoom',
    command: 'view.resetZoom',
    label: 'Reset Zoom',
    category: 'View',
    keys: ['Cmd+0'],
  },

  // Debug
  {
    id: 'debug.start',
    command: 'debug.start',
    label: 'Start Debugging',
    category: 'Debug',
    keys: ['F5'],
  },
  {
    id: 'debug.stop',
    command: 'debug.stop',
    label: 'Stop Debugging',
    category: 'Debug',
    keys: ['Shift+F5'],
  },
  {
    id: 'debug.restart',
    command: 'debug.restart',
    label: 'Restart Debugging',
    category: 'Debug',
    keys: ['Cmd+Shift+F5'],
  },
  {
    id: 'debug.continue',
    command: 'debug.continue',
    label: 'Continue',
    category: 'Debug',
    keys: ['F5'],
    when: 'inDebugMode',
  },
  {
    id: 'debug.stepOver',
    command: 'debug.stepOver',
    label: 'Step Over',
    category: 'Debug',
    keys: ['F10'],
  },
  {
    id: 'debug.stepInto',
    command: 'debug.stepInto',
    label: 'Step Into',
    category: 'Debug',
    keys: ['F11'],
  },
  {
    id: 'debug.stepOut',
    command: 'debug.stepOut',
    label: 'Step Out',
    category: 'Debug',
    keys: ['Shift+F11'],
  },
  {
    id: 'debug.toggleBreakpoint',
    command: 'debug.toggleBreakpoint',
    label: 'Toggle Breakpoint',
    category: 'Debug',
    keys: ['F9'],
  },

  // Agent
  {
    id: 'agent.inlineChat',
    command: 'agent.inlineChat',
    label: 'Inline Chat',
    category: 'Agent',
    keys: ['Cmd+I'],
  },
  {
    id: 'agent.chat',
    command: 'agent.chat',
    label: 'Open Chat',
    category: 'Agent',
    keys: ['Cmd+Shift+I'],
  },
  {
    id: 'agent.acceptSuggestion',
    command: 'agent.acceptSuggestion',
    label: 'Accept Suggestion',
    category: 'Agent',
    keys: ['Tab'],
    when: 'hasInlineSuggestion',
  },
  {
    id: 'agent.dismissSuggestion',
    command: 'agent.dismissSuggestion',
    label: 'Dismiss Suggestion',
    category: 'Agent',
    keys: ['Escape'],
    when: 'hasInlineSuggestion',
  },
];

// ============================================================================
// Store
// ============================================================================

interface KeybindingsState {
  keybindings: Keybinding[];
  customOverrides: Record<string, string[]>;

  updateKeybinding: (id: string, keys: string[]) => void;
  resetKeybinding: (id: string) => void;
  resetAll: () => void;
  addCustomKeybinding: (keybinding: Keybinding) => void;
  removeCustomKeybinding: (id: string) => void;
}

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set) => ({
      keybindings: defaultKeybindings.map((k) => ({ ...k, isDefault: true })),
      customOverrides: {},

      updateKeybinding: (id, keys) => {
        set((state) => ({
          customOverrides: { ...state.customOverrides, [id]: keys },
          keybindings: state.keybindings.map((k) =>
            k.id === id ? { ...k, keys, isCustom: true } : k
          ),
        }));
      },

      resetKeybinding: (id) => {
        const defaultBinding = defaultKeybindings.find((k) => k.id === id);
        set((state) => {
          const { [id]: _, ...rest } = state.customOverrides;
          void _;
          return {
            customOverrides: rest,
            keybindings: state.keybindings.map((k) =>
              k.id === id && defaultBinding
                ? { ...defaultBinding, isDefault: true, isCustom: false }
                : k
            ),
          };
        });
      },

      resetAll: () => {
        set({
          customOverrides: {},
          keybindings: defaultKeybindings.map((k) => ({ ...k, isDefault: true })),
        });
      },

      addCustomKeybinding: (keybinding) => {
        set((state) => ({
          keybindings: [...state.keybindings, { ...keybinding, isCustom: true }],
        }));
      },

      removeCustomKeybinding: (id) => {
        set((state) => ({
          keybindings: state.keybindings.filter((k) => k.id !== id || k.isDefault),
        }));
      },
    }),
    {
      name: 'podex-keybindings',
    }
  )
);
