'use client';

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { initializeVSCodeServices, areServicesInitialized } from './initServices';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface VSCodeEditorProps {
  /** Initial content of the editor */
  value?: string;
  /** Language ID for syntax highlighting */
  language?: string;
  /** File path (used for model URI) */
  filePath?: string;
  /** Theme: built-in themes ('vs-dark', 'vs', 'hc-black') or custom theme name */
  theme?: string;
  /** Editor options */
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** Read-only mode */
  readOnly?: boolean;
  /** Called when content changes */
  onChange?: (value: string) => void;
  /** Called when editor is mounted */
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  /** Called when cursor position changes */
  onCursorChange?: (position: monaco.Position) => void;
  /** Called when selection changes */
  onSelectionChange?: (selection: monaco.Selection) => void;
  /** Additional CSS class */
  className?: string;
  /** Line number to scroll to on mount */
  scrollToLine?: number;
  /** Enable minimap */
  minimap?: boolean;
  /** Enable line numbers */
  lineNumbers?: boolean;
  /** Enable word wrap */
  wordWrap?: boolean;
  /** Font size in pixels */
  fontSize?: number;
  /** Tab size */
  tabSize?: number;
}

export interface VSCodeEditorRef {
  /** Get the Monaco editor instance */
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
  /** Get current value */
  getValue: () => string;
  /** Set value */
  setValue: (value: string) => void;
  /** Focus the editor */
  focus: () => void;
  /** Get current cursor position */
  getPosition: () => monaco.Position | null;
  /** Set cursor position */
  setPosition: (position: monaco.IPosition) => void;
  /** Get current selection */
  getSelection: () => monaco.Selection | null;
  /** Set selection */
  setSelection: (selection: monaco.ISelection) => void;
  /** Scroll to line */
  scrollToLine: (line: number) => void;
  /** Trigger an action (like format document) */
  triggerAction: (actionId: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export const VSCodeEditor = forwardRef<VSCodeEditorRef, VSCodeEditorProps>(function VSCodeEditor(
  {
    value = '',
    language = 'plaintext',
    filePath,
    theme = 'vs-dark',
    options = {},
    readOnly = false,
    onChange,
    onMount,
    onCursorChange,
    onSelectionChange,
    className,
    scrollToLine,
    minimap = false,
    lineNumbers = true,
    wordWrap = false,
    fontSize = 13,
    tabSize = 2,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isInitialized, setIsInitialized] = useState(areServicesInitialized());
  const [error, setError] = useState<string | null>(null);

  // Use refs for callbacks to avoid recreating editor on callback changes
  const onChangeRef = useRef(onChange);
  const onMountRef = useRef(onMount);
  const onCursorChangeRef = useRef(onCursorChange);
  const onSelectionChangeRef = useRef(onSelectionChange);

  // Keep refs updated
  useEffect(() => {
    onChangeRef.current = onChange;
    onMountRef.current = onMount;
    onCursorChangeRef.current = onCursorChange;
    onSelectionChangeRef.current = onSelectionChange;
  }, [onChange, onMount, onCursorChange, onSelectionChange]);

  // Expose editor methods via ref
  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
    getValue: () => editorRef.current?.getValue() ?? '',
    setValue: (newValue: string) => {
      editorRef.current?.setValue(newValue);
    },
    focus: () => {
      editorRef.current?.focus();
    },
    getPosition: () => editorRef.current?.getPosition() ?? null,
    setPosition: (position: monaco.IPosition) => {
      editorRef.current?.setPosition(position);
    },
    getSelection: () => editorRef.current?.getSelection() ?? null,
    setSelection: (selection: monaco.ISelection) => {
      editorRef.current?.setSelection(selection);
    },
    scrollToLine: (line: number) => {
      editorRef.current?.revealLineInCenter(line);
    },
    triggerAction: (actionId: string) => {
      editorRef.current?.getAction(actionId)?.run();
    },
  }));

  // Initialize VS Code services
  useEffect(() => {
    if (isInitialized) return;

    initializeVSCodeServices()
      .then(() => {
        setIsInitialized(true);
      })
      .catch((err) => {
        console.error('[VSCodeEditor] Failed to initialize services:', err);
        setError('Failed to initialize editor services');
      });
  }, [isInitialized]);

  // Create editor instance
  useEffect(() => {
    if (!isInitialized || !containerRef.current || editorRef.current) return;

    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const attemptCreateEditor = (retryCount = 0) => {
      if (cancelled || editorRef.current || !containerRef.current) return;

      // Create model URI from file path
      const uri = filePath
        ? monaco.Uri.file(filePath)
        : monaco.Uri.parse(`inmemory://model/${Date.now()}`);

      // Check if model already exists
      let model = monaco.editor.getModel(uri);
      if (!model) {
        model = monaco.editor.createModel(value, language, uri);
      } else {
        // Update existing model
        if (model.getValue() !== value) {
          model.setValue(value);
        }
        if (model.getLanguageId() !== language) {
          monaco.editor.setModelLanguage(model, language);
        }
      }

      // Create editor with error handling for race conditions
      let editor: monaco.editor.IStandaloneCodeEditor;
      try {
        editor = monaco.editor.create(containerRef.current, {
          model,
          theme,
          readOnly,
          automaticLayout: true,
          minimap: { enabled: minimap },
          lineNumbers: lineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          fontSize,
          tabSize,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderWhitespace: 'selection',
          folding: true,
          foldingStrategy: 'indentation',
          showFoldingControls: 'mouseover',
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          padding: { top: 8, bottom: 8 },
          // Explicitly enable text selection
          selectionHighlight: true,
          occurrencesHighlight: 'singleFile',
          selectOnLineNumbers: true,
          domReadOnly: false,
          ...options,
        });
      } catch (err) {
        console.error('[VSCodeEditor] Failed to create editor:', err);
        // Retry a few times if services aren't fully loaded yet
        if (retryCount < 3) {
          retryTimeout = setTimeout(() => attemptCreateEditor(retryCount + 1), 100);
          return;
        }
        setError('Failed to create editor. Please refresh the page.');
        return;
      }

      if (cancelled) {
        editor.dispose();
        return;
      }

      editorRef.current = editor;

      // Scroll to line if specified
      if (scrollToLine) {
        editor.revealLineInCenter(scrollToLine);
      }

      // Set up change listener
      const changeDisposable = editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(editor.getValue());
      });

      // Set up cursor change listener
      const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
        onCursorChangeRef.current?.(e.position);
      });

      // Set up selection change listener
      const selectionDisposable = editor.onDidChangeCursorSelection((e) => {
        onSelectionChangeRef.current?.(e.selection);
      });

      // Notify mount
      onMountRef.current?.(editor);

      // Store cleanup function
      cleanupRef.current = () => {
        changeDisposable.dispose();
        cursorDisposable.dispose();
        selectionDisposable.dispose();
        editor.dispose();
        editorRef.current = null;
      };
    };

    // Store cleanup ref for async creation
    const cleanupRef = { current: null as (() => void) | null };

    attemptCreateEditor();

    // Cleanup
    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      cleanupRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isInitialized,
    filePath,
    theme,
    readOnly,
    minimap,
    lineNumbers,
    wordWrap,
    fontSize,
    tabSize,
    options,
  ]);

  // Update value when it changes externally
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentValue = editor.getValue();
    if (currentValue !== value) {
      const position = editor.getPosition();
      editor.setValue(value);
      if (position) {
        editor.setPosition(position);
      }
    }
  }, [value]);

  // Update language when it changes
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  // Update theme when it changes (only after services are initialized)
  useEffect(() => {
    if (!isInitialized) return;
    try {
      monaco.editor.setTheme(theme);
    } catch (err) {
      console.warn('[VSCodeEditor] Failed to set theme:', err);
    }
  }, [theme, isInitialized]);

  // Update read-only state
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  if (error) {
    return (
      <div
        className={cn('flex items-center justify-center bg-surface text-accent-error', className)}
      >
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className={cn('flex items-center justify-center bg-surface', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm">Loading editor...</span>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={cn('w-full h-full', className)} />;
});
