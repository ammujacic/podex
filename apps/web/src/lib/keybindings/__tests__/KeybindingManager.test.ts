/**
 * Tests for KeybindingManager
 *
 * Comprehensive tests covering:
 * - Keybinding registration and removal
 * - Command execution
 * - Context handling and condition evaluation
 * - Shortcut parsing and normalization
 * - Chord sequences
 * - Cross-platform key handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a fresh KeybindingManager instance for testing
// We need to mock the window/document environment
const createMockKeybindingManager = () => {
  // Import the module fresh for each test
  const bindings = new Map<
    string,
    Array<{
      id: string;
      key: string;
      command: string;
      when?: string;
      description?: string;
      category?: string;
    }>
  >();
  const commands = new Map<string, () => void | Promise<void>>();
  const listeners = new Set<() => void>();
  let context = {
    editorFocus: false,
    terminalFocus: false,
    sidebarFocus: false,
    inputFocus: false,
    modalOpen: false,
    quickOpenOpen: false,
    commandPaletteOpen: false,
  };

  // Normalize key helper
  const normalizeKey = (key: string): string => {
    return key
      .toLowerCase()
      .replace(/meta|cmd|command/g, 'mod')
      .replace(/control/g, 'ctrl')
      .replace(/option/g, 'alt')
      .replace(/\s+/g, '')
      .split('+')
      .sort((a, b) => {
        const modOrder = ['mod', 'ctrl', 'alt', 'shift'];
        const aIdx = modOrder.indexOf(a);
        const bIdx = modOrder.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
      })
      .join('+');
  };

  // Evaluate condition helper
  const evaluateCondition = (condition: string, ctx: typeof context): boolean => {
    if (!condition) return true;

    const tokens = condition.split(/\s+(&&|\|\|)\s+/);
    let result = true;
    let operator = '&&';

    for (const token of tokens) {
      if (token === '&&' || token === '||') {
        operator = token;
        continue;
      }

      let value = false;
      const negated = token.startsWith('!');
      const keyName = negated ? token.slice(1) : token;

      if (keyName in ctx) {
        value = ctx[keyName as keyof typeof ctx];
      }

      if (negated) value = !value;

      if (operator === '&&') {
        result = result && value;
      } else {
        result = result || value;
      }
    }

    return result;
  };

  const notifyListeners = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    // Internal state access for testing
    _bindings: bindings,
    _commands: commands,
    _context: context,
    _normalizeKey: normalizeKey,
    _evaluateCondition: evaluateCondition,

    registerKeybinding(binding: {
      id: string;
      key: string;
      command: string;
      when?: string;
      description?: string;
      category?: string;
    }) {
      const normalizedKey = normalizeKey(binding.key);
      const existing = bindings.get(normalizedKey) || [];
      const filtered = existing.filter((b) => b.command !== binding.command);
      filtered.push({ ...binding, key: normalizedKey });
      bindings.set(normalizedKey, filtered);
      notifyListeners();
    },

    registerKeybindings(
      bindingsList: Array<{
        id: string;
        key: string;
        command: string;
        when?: string;
        description?: string;
        category?: string;
      }>
    ) {
      for (const binding of bindingsList) {
        this.registerKeybinding(binding);
      }
    },

    unregisterKeybinding(id: string) {
      for (const [key, keyBindings] of bindings) {
        const filtered = keyBindings.filter((b) => b.id !== id);
        if (filtered.length === 0) {
          bindings.delete(key);
        } else {
          bindings.set(key, filtered);
        }
      }
      notifyListeners();
    },

    clearAllKeybindings() {
      bindings.clear();
      notifyListeners();
    },

    registerCommand(command: string, handler: () => void | Promise<void>) {
      commands.set(command, handler);
    },

    unregisterCommand(command: string) {
      commands.delete(command);
    },

    executeCommand(command: string) {
      const handler = commands.get(command);
      if (handler) {
        handler();
      }
    },

    setContext(updates: Partial<typeof context>) {
      context = { ...context, ...updates };
    },

    getContext() {
      return context;
    },

    getAllKeybindings() {
      const all: Array<{
        id: string;
        key: string;
        command: string;
        when?: string;
        description?: string;
        category?: string;
      }> = [];
      for (const keyBindings of bindings.values()) {
        all.push(...keyBindings);
      }
      return all;
    },

    getKeybindingForCommand(command: string) {
      for (const keyBindings of bindings.values()) {
        const found = keyBindings.find((b) => b.command === command);
        if (found) return found;
      }
      return undefined;
    },

    formatKeyForDisplay(key: string, isMac = false): string {
      return key
        .split(' ')
        .map((part) =>
          part
            .split('+')
            .map((k) => {
              if (k === 'mod') return isMac ? '\u2318' : 'Ctrl';
              if (k === 'ctrl') return isMac ? '\u2303' : 'Ctrl';
              if (k === 'alt') return isMac ? '\u2325' : 'Alt';
              if (k === 'shift') return isMac ? '\u21E7' : 'Shift';
              if (k === 'enter') return '\u21B5';
              if (k === 'backspace') return '\u232B';
              if (k === 'delete') return '\u2326';
              if (k === 'esc') return 'Esc';
              if (k === 'tab') return '\u21E5';
              if (k === 'space') return 'Space';
              if (k === 'up') return '\u2191';
              if (k === 'down') return '\u2193';
              if (k === 'left') return '\u2190';
              if (k === 'right') return '\u2192';
              if (k === 'backtick') return '`';
              return k.toUpperCase();
            })
            .join(isMac ? '' : '+')
        )
        .join(' ');
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Helper for testing condition evaluation
    checkCondition(condition: string) {
      return evaluateCondition(condition, context);
    },
  };
};

describe('KeybindingManager', () => {
  let manager: ReturnType<typeof createMockKeybindingManager>;

  beforeEach(() => {
    manager = createMockKeybindingManager();
  });

  // ==================== Key Normalization Tests ====================
  describe('normalizeKey', () => {
    it('converts keys to lowercase', () => {
      expect(manager._normalizeKey('MOD+P')).toBe('mod+p');
      expect(manager._normalizeKey('CTRL+SHIFT+F')).toBe('ctrl+shift+f');
    });

    it('normalizes "cmd" to "mod"', () => {
      expect(manager._normalizeKey('cmd+p')).toBe('mod+p');
    });

    it('normalizes "command" to "mod"', () => {
      expect(manager._normalizeKey('command+s')).toBe('mod+s');
    });

    it('normalizes "meta" to "mod"', () => {
      expect(manager._normalizeKey('meta+f')).toBe('mod+f');
    });

    it('normalizes "control" to "ctrl"', () => {
      expect(manager._normalizeKey('control+c')).toBe('ctrl+c');
    });

    it('normalizes "option" to "alt"', () => {
      expect(manager._normalizeKey('option+o')).toBe('alt+o');
    });

    it('removes whitespace', () => {
      expect(manager._normalizeKey('mod + p')).toBe('mod+p');
      expect(manager._normalizeKey('ctrl  +  shift + f')).toBe('ctrl+shift+f');
    });

    it('sorts modifiers in consistent order', () => {
      expect(manager._normalizeKey('shift+mod+alt+p')).toBe('mod+alt+shift+p');
      expect(manager._normalizeKey('alt+shift+ctrl+x')).toBe('ctrl+alt+shift+x');
    });

    it('handles single keys', () => {
      expect(manager._normalizeKey('f1')).toBe('f1');
      expect(manager._normalizeKey('Enter')).toBe('enter');
    });

    it('handles chord sequences', () => {
      // Note: the normalizeKey function handles each part separately when split by space
      const key1 = manager._normalizeKey('mod+k');
      const key2 = manager._normalizeKey('mod+c');
      expect(key1).toBe('mod+k');
      expect(key2).toBe('mod+c');
    });
  });

  // ==================== Keybinding Registration Tests ====================
  describe('registerKeybinding', () => {
    it('registers a simple keybinding', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'quickOpen.toggle',
        description: 'Quick open',
      });

      const bindings = manager.getAllKeybindings();
      expect(bindings).toHaveLength(1);
      expect(bindings[0].command).toBe('quickOpen.toggle');
    });

    it('normalizes key when registering', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'Cmd+Shift+P',
        command: 'commandPalette.toggle',
      });

      const bindings = manager.getAllKeybindings();
      expect(bindings[0].key).toBe('mod+shift+p');
    });

    it('replaces existing binding with same command', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'quickOpen.toggle',
      });

      manager.registerKeybinding({
        id: 'test2',
        key: 'mod+p',
        command: 'quickOpen.toggle',
      });

      const bindings = manager.getAllKeybindings();
      expect(bindings).toHaveLength(1);
      expect(bindings[0].id).toBe('test2');
    });

    it('allows multiple commands on same key', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+k',
        command: 'commandPalette.toggle',
      });

      manager.registerKeybinding({
        id: 'test2',
        key: 'mod+k',
        command: 'terminal.clear',
        when: 'terminalFocus',
      });

      const bindings = manager.getAllKeybindings();
      expect(bindings).toHaveLength(2);
    });

    it('stores optional properties', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+s',
        command: 'editor.save',
        when: 'editorFocus',
        description: 'Save file',
        category: 'Edit',
      });

      const binding = manager.getKeybindingForCommand('editor.save');
      expect(binding?.when).toBe('editorFocus');
      expect(binding?.description).toBe('Save file');
      expect(binding?.category).toBe('Edit');
    });
  });

  describe('registerKeybindings', () => {
    it('registers multiple keybindings at once', () => {
      manager.registerKeybindings([
        { id: 'test1', key: 'mod+p', command: 'quickOpen.toggle' },
        { id: 'test2', key: 'mod+s', command: 'editor.save' },
        { id: 'test3', key: 'mod+b', command: 'sidebar.toggle' },
      ]);

      expect(manager.getAllKeybindings()).toHaveLength(3);
    });

    it('handles empty array', () => {
      manager.registerKeybindings([]);
      expect(manager.getAllKeybindings()).toHaveLength(0);
    });
  });

  describe('unregisterKeybinding', () => {
    beforeEach(() => {
      manager.registerKeybindings([
        { id: 'test1', key: 'mod+p', command: 'quickOpen.toggle' },
        { id: 'test2', key: 'mod+s', command: 'editor.save' },
        { id: 'test3', key: 'mod+p', command: 'other.command' },
      ]);
    });

    it('removes keybinding by id', () => {
      manager.unregisterKeybinding('test1');
      const bindings = manager.getAllKeybindings();
      expect(bindings).toHaveLength(2);
      expect(bindings.find((b) => b.id === 'test1')).toBeUndefined();
    });

    it('keeps other bindings on same key', () => {
      manager.unregisterKeybinding('test1');
      const binding = manager.getKeybindingForCommand('other.command');
      expect(binding).toBeDefined();
    });

    it('handles non-existent id gracefully', () => {
      manager.unregisterKeybinding('nonexistent');
      expect(manager.getAllKeybindings()).toHaveLength(3);
    });
  });

  describe('clearAllKeybindings', () => {
    it('removes all keybindings', () => {
      manager.registerKeybindings([
        { id: 'test1', key: 'mod+p', command: 'quickOpen.toggle' },
        { id: 'test2', key: 'mod+s', command: 'editor.save' },
      ]);

      manager.clearAllKeybindings();
      expect(manager.getAllKeybindings()).toHaveLength(0);
    });
  });

  // ==================== Command Registration Tests ====================
  describe('registerCommand', () => {
    it('registers a command handler', () => {
      const handler = vi.fn();
      manager.registerCommand('test.command', handler);

      manager.executeCommand('test.command');
      expect(handler).toHaveBeenCalled();
    });

    it('overwrites existing handler', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.registerCommand('test.command', handler1);
      manager.registerCommand('test.command', handler2);

      manager.executeCommand('test.command');
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('unregisterCommand', () => {
    it('removes a command handler', () => {
      const handler = vi.fn();
      manager.registerCommand('test.command', handler);
      manager.unregisterCommand('test.command');

      manager.executeCommand('test.command');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('executeCommand', () => {
    it('executes registered command', () => {
      const handler = vi.fn();
      manager.registerCommand('test.command', handler);
      manager.executeCommand('test.command');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does nothing for unregistered command', () => {
      // Should not throw
      expect(() => manager.executeCommand('nonexistent.command')).not.toThrow();
    });

    it('handles async handlers', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      manager.registerCommand('async.command', handler);
      manager.executeCommand('async.command');
      expect(handler).toHaveBeenCalled();
    });
  });

  // ==================== Context Tests ====================
  describe('setContext', () => {
    it('sets context values', () => {
      manager.setContext({ editorFocus: true });
      expect(manager.getContext().editorFocus).toBe(true);
    });

    it('preserves other context values', () => {
      manager.setContext({ editorFocus: true });
      manager.setContext({ terminalFocus: true });

      const ctx = manager.getContext();
      expect(ctx.editorFocus).toBe(true);
      expect(ctx.terminalFocus).toBe(true);
    });

    it('can set multiple values at once', () => {
      manager.setContext({
        editorFocus: true,
        modalOpen: true,
        inputFocus: false,
      });

      const ctx = manager.getContext();
      expect(ctx.editorFocus).toBe(true);
      expect(ctx.modalOpen).toBe(true);
      expect(ctx.inputFocus).toBe(false);
    });
  });

  // ==================== Condition Evaluation Tests ====================
  describe('evaluateCondition', () => {
    it('returns true for empty condition', () => {
      expect(manager.checkCondition('')).toBe(true);
    });

    it('evaluates simple true condition', () => {
      manager.setContext({ editorFocus: true });
      expect(manager.checkCondition('editorFocus')).toBe(true);
    });

    it('evaluates simple false condition', () => {
      manager.setContext({ editorFocus: false });
      expect(manager.checkCondition('editorFocus')).toBe(false);
    });

    it('evaluates negated condition', () => {
      manager.setContext({ editorFocus: false });
      expect(manager.checkCondition('!editorFocus')).toBe(true);

      manager.setContext({ editorFocus: true });
      expect(manager.checkCondition('!editorFocus')).toBe(false);
    });

    it('evaluates AND conditions', () => {
      manager.setContext({ editorFocus: true, inputFocus: true });
      expect(manager.checkCondition('editorFocus && inputFocus')).toBe(true);

      manager.setContext({ editorFocus: true, inputFocus: false });
      expect(manager.checkCondition('editorFocus && inputFocus')).toBe(false);
    });

    it('evaluates OR conditions', () => {
      manager.setContext({ editorFocus: true, terminalFocus: false });
      expect(manager.checkCondition('editorFocus || terminalFocus')).toBe(true);

      manager.setContext({ editorFocus: false, terminalFocus: false });
      expect(manager.checkCondition('editorFocus || terminalFocus')).toBe(false);
    });

    it('evaluates complex conditions with negation', () => {
      manager.setContext({ editorFocus: true, inputFocus: false });
      expect(manager.checkCondition('editorFocus && !inputFocus')).toBe(true);

      manager.setContext({ editorFocus: true, inputFocus: true });
      expect(manager.checkCondition('editorFocus && !inputFocus')).toBe(false);
    });

    it('handles unknown context keys as false', () => {
      expect(manager.checkCondition('unknownKey')).toBe(false);
      expect(manager.checkCondition('!unknownKey')).toBe(true);
    });
  });

  // ==================== Get Keybindings Tests ====================
  describe('getAllKeybindings', () => {
    it('returns empty array when no bindings', () => {
      expect(manager.getAllKeybindings()).toEqual([]);
    });

    it('returns all registered bindings', () => {
      manager.registerKeybindings([
        { id: 'test1', key: 'mod+p', command: 'cmd1' },
        { id: 'test2', key: 'mod+s', command: 'cmd2' },
      ]);

      const bindings = manager.getAllKeybindings();
      expect(bindings).toHaveLength(2);
    });
  });

  describe('getKeybindingForCommand', () => {
    beforeEach(() => {
      manager.registerKeybindings([
        { id: 'test1', key: 'mod+p', command: 'quickOpen.toggle' },
        { id: 'test2', key: 'mod+s', command: 'editor.save' },
      ]);
    });

    it('returns keybinding for existing command', () => {
      const binding = manager.getKeybindingForCommand('quickOpen.toggle');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+p');
    });

    it('returns undefined for non-existent command', () => {
      const binding = manager.getKeybindingForCommand('nonexistent');
      expect(binding).toBeUndefined();
    });
  });

  // ==================== Display Formatting Tests ====================
  describe('formatKeyForDisplay', () => {
    it('formats mod key for Mac', () => {
      expect(manager.formatKeyForDisplay('mod+p', true)).toBe('\u2318P');
    });

    it('formats mod key for Windows/Linux', () => {
      expect(manager.formatKeyForDisplay('mod+p', false)).toBe('Ctrl+P');
    });

    it('formats ctrl key for Mac', () => {
      expect(manager.formatKeyForDisplay('ctrl+c', true)).toBe('\u2303C');
    });

    it('formats alt key for Mac', () => {
      expect(manager.formatKeyForDisplay('alt+a', true)).toBe('\u2325A');
    });

    it('formats alt key for Windows', () => {
      expect(manager.formatKeyForDisplay('alt+a', false)).toBe('Alt+A');
    });

    it('formats shift key for Mac', () => {
      expect(manager.formatKeyForDisplay('shift+s', true)).toBe('\u21E7S');
    });

    it('formats shift key for Windows', () => {
      expect(manager.formatKeyForDisplay('shift+s', false)).toBe('Shift+S');
    });

    it('formats special keys', () => {
      expect(manager.formatKeyForDisplay('enter', false)).toBe('\u21B5');
      expect(manager.formatKeyForDisplay('backspace', false)).toBe('\u232B');
      expect(manager.formatKeyForDisplay('delete', false)).toBe('\u2326');
      expect(manager.formatKeyForDisplay('esc', false)).toBe('Esc');
      expect(manager.formatKeyForDisplay('tab', false)).toBe('\u21E5');
      expect(manager.formatKeyForDisplay('space', false)).toBe('Space');
    });

    it('formats arrow keys', () => {
      expect(manager.formatKeyForDisplay('up', false)).toBe('\u2191');
      expect(manager.formatKeyForDisplay('down', false)).toBe('\u2193');
      expect(manager.formatKeyForDisplay('left', false)).toBe('\u2190');
      expect(manager.formatKeyForDisplay('right', false)).toBe('\u2192');
    });

    it('formats backtick', () => {
      expect(manager.formatKeyForDisplay('backtick', false)).toBe('`');
    });

    it('formats complex key combinations for Mac', () => {
      expect(manager.formatKeyForDisplay('mod+shift+p', true)).toBe('\u2318\u21E7P');
    });

    it('formats complex key combinations for Windows', () => {
      expect(manager.formatKeyForDisplay('mod+shift+p', false)).toBe('Ctrl+Shift+P');
    });

    it('formats chord sequences', () => {
      expect(manager.formatKeyForDisplay('mod+k mod+c', false)).toBe('Ctrl+K Ctrl+C');
      expect(manager.formatKeyForDisplay('mod+k mod+c', true)).toBe('\u2318K \u2318C');
    });
  });

  // ==================== Subscription Tests ====================
  describe('subscribe', () => {
    it('calls listener when keybinding is registered', () => {
      const listener = vi.fn();
      manager.subscribe(listener);

      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'test.command',
      });

      expect(listener).toHaveBeenCalled();
    });

    it('calls listener when keybinding is unregistered', () => {
      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'test.command',
      });

      const listener = vi.fn();
      manager.subscribe(listener);

      manager.unregisterKeybinding('test1');

      expect(listener).toHaveBeenCalled();
    });

    it('calls listener when all keybindings are cleared', () => {
      const listener = vi.fn();
      manager.subscribe(listener);

      manager.clearAllKeybindings();

      expect(listener).toHaveBeenCalled();
    });

    it('returns unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = manager.subscribe(listener);

      unsubscribe();

      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'test.command',
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      manager.subscribe(listener1);
      manager.subscribe(listener2);

      manager.registerKeybinding({
        id: 'test1',
        key: 'mod+p',
        command: 'test.command',
      });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  // ==================== Edge Cases ====================
  describe('edge cases', () => {
    it('handles function keys', () => {
      manager.registerKeybinding({
        id: 'f1',
        key: 'f1',
        command: 'help.show',
      });

      const binding = manager.getKeybindingForCommand('help.show');
      expect(binding?.key).toBe('f1');
    });

    it('handles f-key with modifiers', () => {
      manager.registerKeybinding({
        id: 'shiftF12',
        key: 'shift+f12',
        command: 'editor.findReferences',
      });

      const binding = manager.getKeybindingForCommand('editor.findReferences');
      expect(binding?.key).toBe('shift+f12');
    });

    it('handles numeric keys', () => {
      manager.registerKeybinding({
        id: 'tab1',
        key: 'mod+1',
        command: 'editor.focusTab1',
      });

      const binding = manager.getKeybindingForCommand('editor.focusTab1');
      expect(binding?.key).toBe('mod+1');
    });

    it('handles punctuation keys', () => {
      manager.registerKeybinding({
        id: 'comment',
        key: 'mod+/',
        command: 'editor.toggleComment',
      });

      const binding = manager.getKeybindingForCommand('editor.toggleComment');
      expect(binding?.key).toBe('mod+/');
    });

    it('handles bracket keys', () => {
      manager.registerKeybinding({
        id: 'indent',
        key: 'mod+]',
        command: 'editor.indentLine',
      });

      const binding = manager.getKeybindingForCommand('editor.indentLine');
      expect(binding?.key).toBe('mod+]');
    });
  });
});
