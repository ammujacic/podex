/**
 * Tests for defaultBindings
 *
 * Comprehensive tests covering:
 * - Default bindings structure validation
 * - Required properties for each binding
 * - Category grouping functionality
 * - Binding uniqueness and consistency
 */
import { describe, it, expect } from 'vitest';
import { defaultKeybindings, getKeybindingsByCategory } from '../defaultBindings';
import type { Keybinding } from '../KeybindingManager';

describe('defaultBindings', () => {
  // ==================== Structure Validation Tests ====================
  describe('binding structure', () => {
    it('exports an array of keybindings', () => {
      expect(Array.isArray(defaultKeybindings)).toBe(true);
      expect(defaultKeybindings.length).toBeGreaterThan(0);
    });

    it('all bindings have required id property', () => {
      for (const binding of defaultKeybindings) {
        expect(binding.id).toBeDefined();
        expect(typeof binding.id).toBe('string');
        expect(binding.id.length).toBeGreaterThan(0);
      }
    });

    it('all bindings have required key property', () => {
      for (const binding of defaultKeybindings) {
        expect(binding.key).toBeDefined();
        expect(typeof binding.key).toBe('string');
        expect(binding.key.length).toBeGreaterThan(0);
      }
    });

    it('all bindings have required command property', () => {
      for (const binding of defaultKeybindings) {
        expect(binding.command).toBeDefined();
        expect(typeof binding.command).toBe('string');
        expect(binding.command.length).toBeGreaterThan(0);
      }
    });

    it('all bindings have description property', () => {
      for (const binding of defaultKeybindings) {
        expect(binding.description).toBeDefined();
        expect(typeof binding.description).toBe('string');
      }
    });

    it('all bindings have category property', () => {
      for (const binding of defaultKeybindings) {
        expect(binding.category).toBeDefined();
        expect(typeof binding.category).toBe('string');
      }
    });

    it('when property is optional and a string if present', () => {
      for (const binding of defaultKeybindings) {
        if (binding.when !== undefined) {
          expect(typeof binding.when).toBe('string');
        }
      }
    });
  });

  // ==================== ID Uniqueness Tests ====================
  describe('id uniqueness', () => {
    it('all binding ids are unique', () => {
      const ids = defaultKeybindings.map((b) => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ==================== Key Format Tests ====================
  describe('key format validation', () => {
    it('keys use valid modifier names', () => {
      const validModifiers = ['mod', 'ctrl', 'alt', 'shift', 'meta'];
      const modifierPattern = /^(mod|ctrl|alt|shift|meta)\+/;

      for (const binding of defaultKeybindings) {
        const keyParts = binding.key.split(' ');
        for (const part of keyParts) {
          const modifiers = part.split('+').slice(0, -1);
          for (const mod of modifiers) {
            expect(validModifiers).toContain(mod);
          }
        }
      }
    });

    it('keys contain at least one non-modifier key', () => {
      for (const binding of defaultKeybindings) {
        const keyParts = binding.key.split(' ');
        for (const part of keyParts) {
          const keys = part.split('+');
          const modifiers = ['mod', 'ctrl', 'alt', 'shift', 'meta'];
          const nonModifierKeys = keys.filter((k) => !modifiers.includes(k));
          expect(nonModifierKeys.length).toBeGreaterThan(0);
        }
      }
    });

    it('chord sequences are properly formatted', () => {
      const chordBindings = defaultKeybindings.filter((b) => b.key.includes(' '));

      for (const binding of chordBindings) {
        const parts = binding.key.split(' ');
        expect(parts.length).toBe(2);
        for (const part of parts) {
          expect(part.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ==================== Category Tests ====================
  describe('categories', () => {
    const expectedCategories = [
      'Navigation',
      'View',
      'Editor',
      'Find',
      'Edit',
      'Selection',
      'Folding',
      'AI',
      'Git',
      'Debug',
      'Terminal',
      'Settings',
    ];

    it('all categories are from expected set', () => {
      const categories = new Set(defaultKeybindings.map((b) => b.category));
      for (const category of categories) {
        expect(expectedCategories).toContain(category);
      }
    });

    it('Navigation category has expected bindings', () => {
      const navBindings = defaultKeybindings.filter((b) => b.category === 'Navigation');
      expect(navBindings.length).toBeGreaterThan(0);

      const commands = navBindings.map((b) => b.command);
      expect(commands).toContain('quickOpen.toggle');
      expect(commands).toContain('commandPalette.toggle');
    });

    it('View category has expected bindings', () => {
      const viewBindings = defaultKeybindings.filter((b) => b.category === 'View');
      expect(viewBindings.length).toBeGreaterThan(0);

      const commands = viewBindings.map((b) => b.command);
      expect(commands).toContain('sidebar.toggle');
      expect(commands).toContain('terminal.toggle');
    });

    it('Editor category has expected bindings', () => {
      const editorBindings = defaultKeybindings.filter((b) => b.category === 'Editor');
      expect(editorBindings.length).toBeGreaterThan(0);

      const commands = editorBindings.map((b) => b.command);
      expect(commands).toContain('editor.split');
      expect(commands).toContain('editor.closeTab');
    });

    it('Edit category has expected bindings', () => {
      const editBindings = defaultKeybindings.filter((b) => b.category === 'Edit');
      expect(editBindings.length).toBeGreaterThan(0);

      const commands = editBindings.map((b) => b.command);
      expect(commands).toContain('editor.save');
      expect(commands).toContain('editor.undo');
      expect(commands).toContain('editor.redo');
    });

    it('AI category has expected bindings', () => {
      const aiBindings = defaultKeybindings.filter((b) => b.category === 'AI');
      expect(aiBindings.length).toBeGreaterThan(0);

      const commands = aiBindings.map((b) => b.command);
      expect(commands).toContain('agent.inlineChat');
      expect(commands).toContain('agent.explainCode');
    });

    it('Debug category has expected bindings', () => {
      const debugBindings = defaultKeybindings.filter((b) => b.category === 'Debug');
      expect(debugBindings.length).toBeGreaterThan(0);

      const commands = debugBindings.map((b) => b.command);
      expect(commands).toContain('debug.start');
      expect(commands).toContain('debug.stop');
    });
  });

  // ==================== Specific Binding Tests ====================
  describe('specific bindings', () => {
    it('quickOpen has mod+p binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'quickOpen');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+p');
      expect(binding?.command).toBe('quickOpen.toggle');
    });

    it('commandPalette has mod+k binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'commandPalette');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k');
      expect(binding?.command).toBe('commandPalette.toggle');
    });

    it('save has mod+s binding with editorFocus context', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'save');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+s');
      expect(binding?.command).toBe('editor.save');
      expect(binding?.when).toBe('editorFocus');
    });

    it('toggleSidebar has mod+b binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'toggleSidebar');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+b');
      expect(binding?.command).toBe('sidebar.toggle');
    });

    it('toggleTerminal has mod+backtick binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'toggleTerminal');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+backtick');
      expect(binding?.command).toBe('terminal.toggle');
    });

    it('find has mod+f binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'find');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+f');
      expect(binding?.command).toBe('editor.find');
    });

    it('findInFiles has mod+shift+f binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'findInFiles');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+shift+f');
      expect(binding?.command).toBe('search.findInFiles');
    });

    it('undo has mod+z binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'undo');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+z');
      expect(binding?.command).toBe('editor.undo');
    });

    it('redo has mod+shift+z binding', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'redo');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+shift+z');
      expect(binding?.command).toBe('editor.redo');
    });
  });

  // ==================== Chord Bindings Tests ====================
  describe('chord bindings', () => {
    it('foldAll uses mod+k mod+0 chord', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'foldAll');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k mod+0');
      expect(binding?.command).toBe('editor.foldAll');
    });

    it('unfoldAll uses mod+k mod+j chord', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'unfoldAll');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k mod+j');
      expect(binding?.command).toBe('editor.unfoldAll');
    });

    it('explainCode uses mod+k mod+e chord', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'explainCode');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k mod+e');
      expect(binding?.command).toBe('agent.explainCode');
    });

    it('gitCommit uses mod+k mod+c chord', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'gitCommit');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k mod+c');
      expect(binding?.command).toBe('git.commit');
    });

    it('openKeyboardShortcuts uses mod+k mod+s chord', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'openKeyboardShortcuts');
      expect(binding).toBeDefined();
      expect(binding?.key).toBe('mod+k mod+s');
      expect(binding?.command).toBe('settings.openKeyboardShortcuts');
    });
  });

  // ==================== Context Conditions Tests ====================
  describe('context conditions', () => {
    it('editor commands require editorFocus', () => {
      const editorCommands = [
        'save',
        'find',
        'replace',
        'undo',
        'redo',
        'cut',
        'copy',
        'paste',
        'toggleComment',
        'deleteLine',
      ];

      for (const cmdId of editorCommands) {
        const binding = defaultKeybindings.find((b) => b.id === cmdId);
        if (binding) {
          expect(binding.when).toBe('editorFocus');
        }
      }
    });

    it('terminal clear requires terminalFocus', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'clearTerminal');
      expect(binding).toBeDefined();
      expect(binding?.when).toBe('terminalFocus');
    });

    it('AI suggestion bindings have suggestion context', () => {
      const suggestionCommands = ['acceptSuggestion', 'dismissSuggestion'];

      for (const cmdId of suggestionCommands) {
        const binding = defaultKeybindings.find((b) => b.id === cmdId);
        if (binding) {
          expect(binding.when).toContain('suggestionVisible');
        }
      }
    });

    it('global bindings have no when condition', () => {
      const globalBindings = ['commandPalette', 'commandPaletteAlt', 'toggleSidebar'];

      for (const bindingId of globalBindings) {
        const binding = defaultKeybindings.find((b) => b.id === bindingId);
        if (binding) {
          expect(binding.when).toBeUndefined();
        }
      }
    });
  });

  // ==================== getKeybindingsByCategory Tests ====================
  describe('getKeybindingsByCategory', () => {
    it('returns an object', () => {
      const grouped = getKeybindingsByCategory();
      expect(typeof grouped).toBe('object');
    });

    it('groups bindings by category', () => {
      const grouped = getKeybindingsByCategory();

      expect(grouped.Navigation).toBeDefined();
      expect(Array.isArray(grouped.Navigation)).toBe(true);
    });

    it('includes all bindings when grouped', () => {
      const grouped = getKeybindingsByCategory();

      let totalGrouped = 0;
      for (const category of Object.keys(grouped)) {
        totalGrouped += grouped[category].length;
      }

      expect(totalGrouped).toBe(defaultKeybindings.length);
    });

    it('all Navigation bindings have Navigation category', () => {
      const grouped = getKeybindingsByCategory();

      for (const binding of grouped.Navigation) {
        expect(binding.category).toBe('Navigation');
      }
    });

    it('all View bindings have View category', () => {
      const grouped = getKeybindingsByCategory();

      for (const binding of grouped.View) {
        expect(binding.category).toBe('View');
      }
    });

    it('all categories from bindings are present in grouped result', () => {
      const grouped = getKeybindingsByCategory();
      const categories = new Set(defaultKeybindings.map((b) => b.category));

      for (const category of categories) {
        if (category) {
          expect(grouped[category]).toBeDefined();
        }
      }
    });
  });

  // ==================== Function Key Bindings Tests ====================
  describe('function key bindings', () => {
    it('goToDefinition uses F12', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'goToDefinition');
      expect(binding?.key).toBe('f12');
    });

    it('peekDefinition uses alt+F12', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'peekDefinition');
      expect(binding?.key).toBe('alt+f12');
    });

    it('findReferences uses shift+F12', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'findReferences');
      expect(binding?.key).toBe('shift+f12');
    });

    it('findNext uses F3', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'findNext');
      expect(binding?.key).toBe('f3');
    });

    it('startDebugging uses F5', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'startDebugging');
      expect(binding?.key).toBe('f5');
    });

    it('toggleBreakpoint uses F9', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'toggleBreakpoint');
      expect(binding?.key).toBe('f9');
    });

    it('stepOver uses F10', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'stepOver');
      expect(binding?.key).toBe('f10');
    });

    it('stepInto uses F11', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'stepInto');
      expect(binding?.key).toBe('f11');
    });
  });

  // ==================== Tab Navigation Tests ====================
  describe('tab navigation bindings', () => {
    it('has bindings for tabs 1-5', () => {
      for (let i = 1; i <= 5; i++) {
        const binding = defaultKeybindings.find((b) => b.id === `tab${i}`);
        expect(binding).toBeDefined();
        expect(binding?.key).toBe(`mod+${i}`);
        expect(binding?.command).toBe(`editor.focusTab${i}`);
      }
    });

    it('nextTab uses mod+tab', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'nextTab');
      expect(binding?.key).toBe('mod+tab');
    });

    it('prevTab uses mod+shift+tab', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'prevTab');
      expect(binding?.key).toBe('mod+shift+tab');
    });
  });

  // ==================== Line Manipulation Bindings Tests ====================
  describe('line manipulation bindings', () => {
    it('moveLineUp uses alt+up', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'moveLineUp');
      expect(binding?.key).toBe('alt+up');
      expect(binding?.when).toBe('editorFocus');
    });

    it('moveLineDown uses alt+down', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'moveLineDown');
      expect(binding?.key).toBe('alt+down');
      expect(binding?.when).toBe('editorFocus');
    });

    it('copyLineUp uses alt+shift+up', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'copyLineUp');
      expect(binding?.key).toBe('alt+shift+up');
    });

    it('copyLineDown uses alt+shift+down', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'copyLineDown');
      expect(binding?.key).toBe('alt+shift+down');
    });

    it('deleteLine uses mod+shift+k', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'deleteLine');
      expect(binding?.key).toBe('mod+shift+k');
    });
  });

  // ==================== Multi-cursor Bindings Tests ====================
  describe('multi-cursor bindings', () => {
    it('addCursorAbove uses mod+alt+up', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'addCursorAbove');
      expect(binding?.key).toBe('mod+alt+up');
    });

    it('addCursorBelow uses mod+alt+down', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'addCursorBelow');
      expect(binding?.key).toBe('mod+alt+down');
    });

    it('addSelectionToNextMatch uses mod+d', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'addSelectionToNextMatch');
      expect(binding?.key).toBe('mod+d');
    });

    it('selectAllOccurrences uses mod+shift+l', () => {
      const binding = defaultKeybindings.find((b) => b.id === 'selectAllOccurrences');
      expect(binding?.key).toBe('mod+shift+l');
    });
  });
});
