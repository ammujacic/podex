/**
 * Comprehensive tests for useEditorCommands and useEditorFocusContext hooks
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorCommands, useEditorFocusContext } from '../useEditorCommands';
import type { editor } from '@codingame/monaco-vscode-editor-api';

// Mock the keybinding manager
vi.mock('@/lib/keybindings', () => ({
  keybindingManager: {
    registerCommand: vi.fn(),
    unregisterCommand: vi.fn(),
    setContext: vi.fn(),
  },
}));

// Import after mock
import { keybindingManager } from '@/lib/keybindings';

const mockRegisterCommand = vi.mocked(keybindingManager.registerCommand);
const mockUnregisterCommand = vi.mocked(keybindingManager.unregisterCommand);
const mockSetContext = vi.mocked(keybindingManager.setContext);

describe('useEditorCommands', () => {
  let mockEditor: Partial<editor.IStandaloneCodeEditor>;
  let editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>;

  beforeEach(() => {
    // Clear and reset all mocks
    mockRegisterCommand.mockClear();
    mockUnregisterCommand.mockClear();
    mockSetContext.mockClear();

    // Create mock editor with trigger method
    mockEditor = {
      trigger: vi.fn(),
    };

    // Create ref object
    editorRef = {
      current: mockEditor as editor.IStandaloneCodeEditor,
    };
  });

  afterEach(() => {
    mockRegisterCommand.mockClear();
    mockUnregisterCommand.mockClear();
    mockSetContext.mockClear();
  });

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Hook Initialization', () => {
    it('should register all editor commands on mount', () => {
      renderHook(() => useEditorCommands(editorRef));

      // Should register all 34 commands
      expect(mockRegisterCommand.mock.calls.length).toBeGreaterThanOrEqual(34);
      // Verify specific commands were registered
      const commandNames = mockRegisterCommand.mock.calls.map((call) => call[0]);
      expect(commandNames).toContain('editor.find');
      expect(commandNames).toContain('editor.formatDocument');
      expect(commandNames).toContain('editor.undo');
    });

    it('should only initialize once even on re-renders', () => {
      const { rerender } = renderHook(() => useEditorCommands(editorRef));

      const initialCount = mockRegisterCommand.mock.calls.length;

      // Re-render should not register again
      rerender();
      expect(mockRegisterCommand.mock.calls.length).toBe(initialCount);
    });

    it('should not call editor trigger during initialization', () => {
      renderHook(() => useEditorCommands(editorRef));

      expect(mockEditor.trigger).not.toHaveBeenCalled();
    });

    it('should handle null editor ref gracefully', () => {
      const nullRef = { current: null };

      const initialCount = mockRegisterCommand.mock.calls.length;

      expect(() => {
        renderHook(() => useEditorCommands(nullRef));
      }).not.toThrow();

      // Should still register commands even with null ref
      expect(mockRegisterCommand.mock.calls.length).toBeGreaterThan(initialCount);
    });
  });

  // ========================================================================
  // Find Commands
  // ========================================================================

  describe('Find Commands', () => {
    it('should trigger find action when editor.find command is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const findCommandHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.find'
      )?.[1];

      expect(findCommandHandler).toBeDefined();
      findCommandHandler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'actions.find', null);
    });

    it('should trigger replace action when editor.replace command is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const replaceCommandHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.replace'
      )?.[1];

      replaceCommandHandler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.startFindReplaceAction',
        null
      );
    });

    it('should trigger findNext action when editor.findNext command is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const findNextHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.findNext'
      )?.[1];

      findNextHandler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.nextMatchFindAction',
        null
      );
    });

    it('should trigger findPrev action when editor.findPrev command is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const findPrevHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.findPrev'
      )?.[1];

      findPrevHandler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.previousMatchFindAction',
        null
      );
    });

    it('should trigger addSelectionToNextMatch when editor.addSelectionToNextMatch is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.addSelectionToNextMatch'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.addSelectionToNextFindMatch',
        null
      );
    });

    it('should trigger selectAllOccurrences when editor.selectAllOccurrences is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.selectAllOccurrences'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.selectHighlights',
        null
      );
    });

    it('should not throw when find commands are executed with null editor', () => {
      const nullRef = { current: null };
      renderHook(() => useEditorCommands(nullRef));

      const findHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.find'
      )?.[1];

      expect(() => findHandler?.()).not.toThrow();
    });
  });

  // ========================================================================
  // Navigation Commands
  // ========================================================================

  describe('Navigation Commands', () => {
    it('should trigger goToLine action when editor.goToLine is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.goToLine'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.gotoLine', null);
    });

    it('should trigger goToSymbol action when editor.goToSymbol is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.goToSymbol'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.quickOutline',
        null
      );
    });

    it('should trigger goToDefinition action when editor.goToDefinition is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.goToDefinition'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.revealDefinition',
        null
      );
    });

    it('should trigger peekDefinition action when editor.peekDefinition is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.peekDefinition'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.peekDefinition',
        null
      );
    });

    it('should trigger findReferences action when editor.findReferences is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.findReferences'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.goToReferences',
        null
      );
    });
  });

  // ========================================================================
  // Editing Commands
  // ========================================================================

  describe('Editing Commands', () => {
    it('should trigger toggleComment when editor.toggleComment is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.toggleComment'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.commentLine',
        null
      );
    });

    it('should trigger toggleBlockComment when editor.toggleBlockComment is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.toggleBlockComment'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.blockComment',
        null
      );
    });

    it('should trigger deleteLine when editor.deleteLine is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.deleteLine'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.deleteLines',
        null
      );
    });

    it('should trigger moveLineUp when editor.moveLineUp is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.moveLineUp'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.moveLinesUpAction',
        null
      );
    });

    it('should trigger moveLineDown when editor.moveLineDown is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.moveLineDown'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.moveLinesDownAction',
        null
      );
    });

    it('should trigger copyLineUp when editor.copyLineUp is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.copyLineUp'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.copyLinesUpAction',
        null
      );
    });

    it('should trigger copyLineDown when editor.copyLineDown is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.copyLineDown'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.copyLinesDownAction',
        null
      );
    });

    it('should trigger insertLineBelow when editor.insertLineBelow is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.insertLineBelow'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.insertLineAfter',
        null
      );
    });

    it('should trigger insertLineAbove when editor.insertLineAbove is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.insertLineAbove'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.insertLineBefore',
        null
      );
    });

    it('should trigger indentLine when editor.indentLine is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.indentLine'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.indentLines',
        null
      );
    });

    it('should trigger outdentLine when editor.outdentLine is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.outdentLine'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.outdentLines',
        null
      );
    });

    it('should trigger formatDocument when editor.formatDocument is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.formatDocument'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.formatDocument',
        null
      );
    });

    it('should trigger rename when editor.rename is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.rename'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.rename', null);
    });

    it('should trigger quickFix when editor.quickFix is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.quickFix'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.quickFix', null);
    });
  });

  // ========================================================================
  // Selection Commands
  // ========================================================================

  describe('Selection Commands', () => {
    it('should trigger selectAll when editor.selectAll is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.selectAll'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.action.selectAll', null);
    });

    it('should trigger expandSelection when editor.expandSelection is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.expandSelection'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.smartSelect.expand',
        null
      );
    });

    it('should trigger shrinkSelection when editor.shrinkSelection is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.shrinkSelection'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.smartSelect.shrink',
        null
      );
    });

    it('should trigger addCursorAbove when editor.addCursorAbove is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.addCursorAbove'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.insertCursorAbove',
        null
      );
    });

    it('should trigger addCursorBelow when editor.addCursorBelow is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.addCursorBelow'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith(
        'keyboard',
        'editor.action.insertCursorBelow',
        null
      );
    });
  });

  // ========================================================================
  // Folding Commands
  // ========================================================================

  describe('Folding Commands', () => {
    it('should trigger fold when editor.fold is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find((call) => call[0] === 'editor.fold')?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.fold', null);
    });

    it('should trigger unfold when editor.unfold is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.unfold'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.unfold', null);
    });

    it('should trigger foldAll when editor.foldAll is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.foldAll'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.foldAll', null);
    });

    it('should trigger unfoldAll when editor.unfoldAll is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.unfoldAll'
      )?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'editor.unfoldAll', null);
    });
  });

  // ========================================================================
  // Undo/Redo Commands
  // ========================================================================

  describe('Undo/Redo Commands', () => {
    it('should trigger undo when editor.undo is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find((call) => call[0] === 'editor.undo')?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'undo', null);
    });

    it('should trigger redo when editor.redo is executed', () => {
      renderHook(() => useEditorCommands(editorRef));

      const handler = mockRegisterCommand.mock.calls.find((call) => call[0] === 'editor.redo')?.[1];

      handler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'redo', null);
    });
  });

  // ========================================================================
  // Cleanup Tests
  // ========================================================================

  describe('Cleanup on Unmount', () => {
    it('should unregister all commands on unmount', () => {
      mockUnregisterCommand.mockClear();

      const { unmount } = renderHook(() => useEditorCommands(editorRef));

      expect(mockUnregisterCommand).not.toHaveBeenCalled();

      unmount();

      // Should unregister all commands (at least 34)
      expect(mockUnregisterCommand.mock.calls.length).toBeGreaterThanOrEqual(34);
    });

    it('should unregister specific command names', () => {
      const { unmount } = renderHook(() => useEditorCommands(editorRef));

      unmount();

      const unregisteredCommands = mockUnregisterCommand.mock.calls.map((call) => call[0]);

      expect(unregisteredCommands).toContain('editor.find');
      expect(unregisteredCommands).toContain('editor.replace');
      expect(unregisteredCommands).toContain('editor.formatDocument');
      expect(unregisteredCommands).toContain('editor.undo');
      expect(unregisteredCommands).toContain('editor.redo');
    });

    it('should reset initialization state after unmount', () => {
      mockRegisterCommand.mockClear();
      mockUnregisterCommand.mockClear();

      const { unmount } = renderHook(() => useEditorCommands(editorRef));

      expect(mockRegisterCommand.mock.calls.length).toBeGreaterThanOrEqual(34);

      unmount();

      // Clear mocks and re-mount
      mockRegisterCommand.mockClear();

      // Re-render after unmount should re-register commands
      const { unmount: unmount2 } = renderHook(() => useEditorCommands(editorRef));

      expect(mockRegisterCommand.mock.calls.length).toBeGreaterThanOrEqual(34); // Should have registered commands again

      unmount2();
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle editor ref changing from null to valid editor', () => {
      const nullRef = { current: null };
      const { rerender } = renderHook(() => useEditorCommands(nullRef));

      // Change ref to valid editor
      Object.defineProperty(nullRef, 'current', {
        value: mockEditor as editor.IStandaloneCodeEditor,
        writable: true,
      });

      rerender();

      // Execute a command - should now work with the editor
      const findHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.find'
      )?.[1];

      findHandler?.();

      expect(mockEditor.trigger).toHaveBeenCalledWith('keyboard', 'actions.find', null);
    });

    it('should handle editor ref changing from valid to null', () => {
      const { rerender } = renderHook(() => useEditorCommands(editorRef));

      // Change ref to null
      editorRef.current = null;

      rerender();

      // Execute a command - should not throw
      const findHandler = mockRegisterCommand.mock.calls.find(
        (call) => call[0] === 'editor.find'
      )?.[1];

      expect(() => findHandler?.()).not.toThrow();
    });

    it('should handle rapid mount/unmount cycles', () => {
      // Clear mocks to ensure clean slate
      mockRegisterCommand.mockClear();
      mockUnregisterCommand.mockClear();

      const cycles = 3;
      for (let i = 0; i < cycles; i++) {
        const { unmount } = renderHook(() => useEditorCommands(editorRef));
        unmount();
      }

      // Should register and unregister the same number of times
      const registerCount = mockRegisterCommand.mock.calls.length;
      const unregisterCount = mockUnregisterCommand.mock.calls.length;

      expect(registerCount).toBe(unregisterCount);
      expect(registerCount).toBeGreaterThanOrEqual(34 * cycles);
    });
  });
});

// ============================================================================
// useEditorFocusContext Tests
// ============================================================================

describe('useEditorFocusContext', () => {
  let mockEditor: Partial<editor.IStandaloneCodeEditor>;
  let editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>;
  let focusHandler: (() => void) | null = null;
  let blurHandler: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();

    focusHandler = null;
    blurHandler = null;

    // Create mock editor with event handlers
    mockEditor = {
      onDidFocusEditorWidget: vi.fn((handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      }),
      onDidBlurEditorWidget: vi.fn((handler) => {
        blurHandler = handler;
        return { dispose: vi.fn() };
      }),
    };

    editorRef = {
      current: mockEditor as editor.IStandaloneCodeEditor,
    };
  });

  afterEach(() => {
    mockRegisterCommand.mockClear();
    mockUnregisterCommand.mockClear();
    mockSetContext.mockClear();
  });

  // ========================================================================
  // Focus Context Tests
  // ========================================================================

  describe('Focus Context Management', () => {
    it('should register focus and blur handlers on mount', () => {
      renderHook(() => useEditorFocusContext(editorRef));

      expect(mockEditor.onDidFocusEditorWidget).toHaveBeenCalledTimes(1);
      expect(mockEditor.onDidBlurEditorWidget).toHaveBeenCalledTimes(1);
    });

    it('should set editorFocus context to true on focus', () => {
      renderHook(() => useEditorFocusContext(editorRef));

      expect(focusHandler).toBeDefined();
      focusHandler?.();

      expect(mockSetContext).toHaveBeenCalledWith({ editorFocus: true });
    });

    it('should set editorFocus context to false on blur', () => {
      renderHook(() => useEditorFocusContext(editorRef));

      expect(blurHandler).toBeDefined();
      blurHandler?.();

      expect(mockSetContext).toHaveBeenCalledWith({ editorFocus: false });
    });

    it('should handle multiple focus/blur cycles', () => {
      renderHook(() => useEditorFocusContext(editorRef));

      // Focus
      focusHandler?.();
      expect(mockSetContext).toHaveBeenCalledWith({ editorFocus: true });

      // Blur
      blurHandler?.();
      expect(mockSetContext).toHaveBeenCalledWith({ editorFocus: false });

      // Focus again
      focusHandler?.();
      expect(mockSetContext).toHaveBeenCalledWith({ editorFocus: true });

      expect(mockSetContext).toHaveBeenCalledTimes(3);
    });

    it('should not register handlers when editor is null', () => {
      const nullRef = { current: null };

      renderHook(() => useEditorFocusContext(nullRef));

      expect(mockEditor.onDidFocusEditorWidget).not.toHaveBeenCalled();
      expect(mockEditor.onDidBlurEditorWidget).not.toHaveBeenCalled();
    });

    it('should dispose handlers on unmount', () => {
      const focusDispose = vi.fn();
      const blurDispose = vi.fn();

      mockEditor.onDidFocusEditorWidget = vi.fn(() => ({
        dispose: focusDispose,
      }));

      mockEditor.onDidBlurEditorWidget = vi.fn(() => ({
        dispose: blurDispose,
      }));

      const { unmount } = renderHook(() => useEditorFocusContext(editorRef));

      expect(focusDispose).not.toHaveBeenCalled();
      expect(blurDispose).not.toHaveBeenCalled();

      unmount();

      expect(focusDispose).toHaveBeenCalledTimes(1);
      expect(blurDispose).toHaveBeenCalledTimes(1);
    });

    it('should handle editor ref changes', () => {
      const focusDispose = vi.fn();
      const blurDispose = vi.fn();

      mockEditor.onDidFocusEditorWidget = vi.fn(() => ({
        dispose: focusDispose,
      }));

      mockEditor.onDidBlurEditorWidget = vi.fn(() => ({
        dispose: blurDispose,
      }));

      const { unmount } = renderHook(() => useEditorFocusContext(editorRef));

      expect(mockEditor.onDidFocusEditorWidget).toHaveBeenCalledTimes(1);

      // Create new editor and mount separately
      const newMockEditor: Partial<editor.IStandaloneCodeEditor> = {
        onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
        onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      };

      unmount();

      const newRef = { current: newMockEditor as editor.IStandaloneCodeEditor };
      renderHook(() => useEditorFocusContext(newRef));

      // Should have registered new handlers
      expect(newMockEditor.onDidFocusEditorWidget).toHaveBeenCalledTimes(1);
      expect(newMockEditor.onDidBlurEditorWidget).toHaveBeenCalledTimes(1);
    });

    it('should not throw when handlers are called after unmount', () => {
      const { unmount } = renderHook(() => useEditorFocusContext(editorRef));

      const savedFocusHandler = focusHandler;
      const savedBlurHandler = blurHandler;

      unmount();

      // Handlers should still be safe to call
      expect(() => savedFocusHandler?.()).not.toThrow();
      expect(() => savedBlurHandler?.()).not.toThrow();
    });
  });
});
