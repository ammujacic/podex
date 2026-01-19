'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { editor } from '@codingame/monaco-vscode-editor-api';
import { keybindingManager } from '@/lib/keybindings';

/**
 * Hook to register Monaco editor commands with the keybinding system
 *
 * This connects the global keyboard shortcuts to Monaco's built-in
 * functionality like find, replace, formatting, etc.
 *
 * @param editorRef - Reference to the Monaco editor instance
 */
export function useEditorCommands(editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>) {
  const isInitialized = useRef(false);

  // Get editor or return early
  const getEditor = useCallback(() => {
    return editorRef.current;
  }, [editorRef]);

  useEffect(() => {
    if (isInitialized.current) return;
    isInitialized.current = true;

    // Find commands
    keybindingManager.registerCommand('editor.find', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'actions.find', null);
      }
    });

    keybindingManager.registerCommand('editor.replace', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.startFindReplaceAction', null);
      }
    });

    keybindingManager.registerCommand('editor.findNext', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.nextMatchFindAction', null);
      }
    });

    keybindingManager.registerCommand('editor.findPrev', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.previousMatchFindAction', null);
      }
    });

    keybindingManager.registerCommand('editor.addSelectionToNextMatch', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.addSelectionToNextFindMatch', null);
      }
    });

    keybindingManager.registerCommand('editor.selectAllOccurrences', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.selectHighlights', null);
      }
    });

    // Navigation commands
    keybindingManager.registerCommand('editor.goToLine', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.gotoLine', null);
      }
    });

    keybindingManager.registerCommand('editor.goToSymbol', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.quickOutline', null);
      }
    });

    keybindingManager.registerCommand('editor.goToDefinition', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.revealDefinition', null);
      }
    });

    keybindingManager.registerCommand('editor.peekDefinition', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.peekDefinition', null);
      }
    });

    keybindingManager.registerCommand('editor.findReferences', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.goToReferences', null);
      }
    });

    // Editing commands
    keybindingManager.registerCommand('editor.toggleComment', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.commentLine', null);
      }
    });

    keybindingManager.registerCommand('editor.toggleBlockComment', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.blockComment', null);
      }
    });

    keybindingManager.registerCommand('editor.deleteLine', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.deleteLines', null);
      }
    });

    keybindingManager.registerCommand('editor.moveLineUp', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.moveLinesUpAction', null);
      }
    });

    keybindingManager.registerCommand('editor.moveLineDown', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.moveLinesDownAction', null);
      }
    });

    keybindingManager.registerCommand('editor.copyLineUp', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.copyLinesUpAction', null);
      }
    });

    keybindingManager.registerCommand('editor.copyLineDown', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.copyLinesDownAction', null);
      }
    });

    keybindingManager.registerCommand('editor.insertLineBelow', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.insertLineAfter', null);
      }
    });

    keybindingManager.registerCommand('editor.insertLineAbove', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.insertLineBefore', null);
      }
    });

    keybindingManager.registerCommand('editor.indentLine', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.indentLines', null);
      }
    });

    keybindingManager.registerCommand('editor.outdentLine', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.outdentLines', null);
      }
    });

    keybindingManager.registerCommand('editor.formatDocument', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.formatDocument', null);
      }
    });

    keybindingManager.registerCommand('editor.rename', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.rename', null);
      }
    });

    keybindingManager.registerCommand('editor.quickFix', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.quickFix', null);
      }
    });

    // Selection commands
    keybindingManager.registerCommand('editor.selectAll', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.selectAll', null);
      }
    });

    keybindingManager.registerCommand('editor.expandSelection', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.smartSelect.expand', null);
      }
    });

    keybindingManager.registerCommand('editor.shrinkSelection', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.smartSelect.shrink', null);
      }
    });

    keybindingManager.registerCommand('editor.addCursorAbove', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.insertCursorAbove', null);
      }
    });

    keybindingManager.registerCommand('editor.addCursorBelow', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.action.insertCursorBelow', null);
      }
    });

    // Folding commands
    keybindingManager.registerCommand('editor.fold', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.fold', null);
      }
    });

    keybindingManager.registerCommand('editor.unfold', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.unfold', null);
      }
    });

    keybindingManager.registerCommand('editor.foldAll', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.foldAll', null);
      }
    });

    keybindingManager.registerCommand('editor.unfoldAll', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'editor.unfoldAll', null);
      }
    });

    // Undo/Redo (let Monaco handle by default, but register for completeness)
    keybindingManager.registerCommand('editor.undo', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'undo', null);
      }
    });

    keybindingManager.registerCommand('editor.redo', () => {
      const ed = getEditor();
      if (ed) {
        ed.trigger('keyboard', 'redo', null);
      }
    });

    // Cleanup function
    return () => {
      const commands = [
        'editor.find',
        'editor.replace',
        'editor.findNext',
        'editor.findPrev',
        'editor.addSelectionToNextMatch',
        'editor.selectAllOccurrences',
        'editor.goToLine',
        'editor.goToSymbol',
        'editor.goToDefinition',
        'editor.peekDefinition',
        'editor.findReferences',
        'editor.toggleComment',
        'editor.toggleBlockComment',
        'editor.deleteLine',
        'editor.moveLineUp',
        'editor.moveLineDown',
        'editor.copyLineUp',
        'editor.copyLineDown',
        'editor.insertLineBelow',
        'editor.insertLineAbove',
        'editor.indentLine',
        'editor.outdentLine',
        'editor.formatDocument',
        'editor.rename',
        'editor.quickFix',
        'editor.selectAll',
        'editor.expandSelection',
        'editor.shrinkSelection',
        'editor.addCursorAbove',
        'editor.addCursorBelow',
        'editor.fold',
        'editor.unfold',
        'editor.foldAll',
        'editor.unfoldAll',
        'editor.undo',
        'editor.redo',
      ];

      for (const cmd of commands) {
        keybindingManager.unregisterCommand(cmd);
      }
      isInitialized.current = false;
    };
  }, [getEditor]);
}

/**
 * Hook to set editor focus context for keybindings
 */
export function useEditorFocusContext(
  editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>
) {
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;

    const handleFocus = () => {
      keybindingManager.setContext({ editorFocus: true });
    };

    const handleBlur = () => {
      keybindingManager.setContext({ editorFocus: false });
    };

    const focusDisposable = ed.onDidFocusEditorWidget(handleFocus);
    const blurDisposable = ed.onDidBlurEditorWidget(handleBlur);

    return () => {
      focusDisposable.dispose();
      blurDisposable.dispose();
    };
  }, [editorRef]);
}
