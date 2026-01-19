'use client';

import { useCallback, useRef, useEffect } from 'react';
import { VSCodeEditor, type VSCodeEditorRef, getLanguageFromPath } from '@/lib/vscode';
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
}: CodeEditorProps) {
  const editorRef = useRef<VSCodeEditorRef>(null);
  const contentChangeTimerRef = useRef<NodeJS.Timeout | null>(null);

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

      // Focus the editor
      editor.focus();
    },
    [onSave]
  );

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

// Re-export getLanguageFromPath from vscode lib
export { getLanguageFromPath };
