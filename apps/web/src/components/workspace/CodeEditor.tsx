'use client';

import { useCallback, useRef, useEffect } from 'react';
import { VSCodeEditor, type VSCodeEditorRef } from '@/lib/vscode';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import type { LSPDiagnostic } from '@/lib/api';
import { diagnosticsToMonacoMarkers } from '@/hooks/useLSP';

export interface CodeEditorProps {
  value: string;
  language: string;
  path?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  className?: string;
  /** LSP diagnostics to display as markers */
  diagnostics?: LSPDiagnostic[];
  /** Callback when editor content changes (debounced) for triggering diagnostics */
  onContentChange?: (value: string) => void;
  /** Line number to scroll to and highlight */
  startLine?: number;
  /** End line for highlighting a range */
  endLine?: number;
}

export function CodeEditor({
  value,
  language,
  path,
  readOnly = false,
  onChange,
  onSave,
  className,
  diagnostics,
  onContentChange,
  startLine,
  endLine,
}: CodeEditorProps) {
  const editorRef = useRef<VSCodeEditorRef>(null);
  const contentChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasScrolledToLine = useRef(false);

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor) => {
      // Add save keybinding
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (onSave) {
          const currentValue = editor.getValue();
          onSave(currentValue);
        }
      });

      // Scroll to line and highlight range if specified
      if (startLine && !hasScrolledToLine.current) {
        hasScrolledToLine.current = true;
        // Delay to ensure content is loaded
        setTimeout(() => {
          const model = editor.getModel();
          const lineCount = model?.getLineCount() || 0;

          // Validate line numbers are within bounds
          const validStartLine = Math.min(Math.max(1, startLine), lineCount || 1);
          const validEndLine = endLine ? Math.min(Math.max(1, endLine), lineCount || 1) : undefined;

          if (lineCount > 0) {
            editor.revealLineInCenter(validStartLine);
            // If we have a range, highlight it
            if (validEndLine) {
              editor.setSelection({
                startLineNumber: validStartLine,
                startColumn: 1,
                endLineNumber: validEndLine,
                endColumn: model?.getLineMaxColumn(validEndLine) || 1,
              });
            } else {
              // Just position cursor at the start of the line
              editor.setPosition({ lineNumber: validStartLine, column: 1 });
            }
          }
        }, 100);
      }

      // Focus the editor
      editor.focus();
    },
    [onSave, startLine, endLine]
  );

  // Handle line number changes after initial mount
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor || !startLine) return;

    const model = editor.getModel();
    const lineCount = model?.getLineCount() || 0;

    // Validate line numbers are within bounds
    const validStartLine = Math.min(Math.max(1, startLine), lineCount || 1);
    const validEndLine = endLine ? Math.min(Math.max(1, endLine), lineCount || 1) : undefined;

    if (lineCount > 0) {
      editor.revealLineInCenter(validStartLine);
      if (validEndLine) {
        editor.setSelection({
          startLineNumber: validStartLine,
          startColumn: 1,
          endLineNumber: validEndLine,
          endColumn: model?.getLineMaxColumn(validEndLine) || 1,
        });
      } else {
        editor.setPosition({ lineNumber: validStartLine, column: 1 });
      }
    }
  }, [startLine, endLine]);

  // Update Monaco markers when diagnostics change
  useEffect(() => {
    const editor = editorRef.current?.getEditor();
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (diagnostics && diagnostics.length > 0) {
      const markers = diagnosticsToMonacoMarkers(diagnostics);
      monaco.editor.setModelMarkers(model, 'lsp', markers);
    } else {
      // Clear markers if no diagnostics
      monaco.editor.setModelMarkers(model, 'lsp', []);
    }
  }, [diagnostics]);

  const handleChange = useCallback(
    (newValue: string) => {
      if (onChange) {
        onChange(newValue);
      }

      // Debounced content change for diagnostics
      if (onContentChange) {
        if (contentChangeTimerRef.current) {
          clearTimeout(contentChangeTimerRef.current);
        }
        contentChangeTimerRef.current = setTimeout(() => {
          onContentChange(newValue);
        }, 500); // 500ms debounce
      }
    },
    [onChange, onContentChange]
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (contentChangeTimerRef.current) {
        clearTimeout(contentChangeTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={className}>
      <VSCodeEditor
        ref={editorRef}
        value={value}
        language={language}
        filePath={path}
        theme="vs-dark"
        readOnly={readOnly}
        onChange={handleChange}
        onMount={handleEditorMount}
        minimap={false}
        fontSize={13}
        tabSize={2}
        wordWrap={false}
        options={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontLigatures: true,
          lineHeight: 1.6,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'line',
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          folding: true,
          foldingHighlight: true,
          formatOnPaste: true,
        }}
        className="h-full"
      />
    </div>
  );
}
