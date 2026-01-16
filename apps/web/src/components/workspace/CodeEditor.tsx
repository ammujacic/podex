'use client';

import { useCallback, useRef, useEffect } from 'react';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
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

// Terminal Noir theme for Monaco
const terminalNoirTheme: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'f0f0f5', background: '0d0d12' },
    { token: 'comment', foreground: '546e7a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c792ea' },
    { token: 'string', foreground: 'c3e88d' },
    { token: 'number', foreground: 'f78c6c' },
    { token: 'function', foreground: '82aaff' },
    { token: 'variable', foreground: 'f0f0f5' },
    { token: 'type', foreground: 'ffcb6b' },
    { token: 'class', foreground: 'ffcb6b' },
    { token: 'interface', foreground: 'ffcb6b' },
    { token: 'constant', foreground: '00e5ff' },
    { token: 'tag', foreground: 'f07178' },
    { token: 'attribute.name', foreground: 'c792ea' },
    { token: 'attribute.value', foreground: 'c3e88d' },
    { token: 'delimiter', foreground: '9898a8' },
    { token: 'operator', foreground: '89ddff' },
  ],
  colors: {
    'editor.background': '#0d0d12',
    'editor.foreground': '#f0f0f5',
    'editor.lineHighlightBackground': '#1a1a21',
    'editor.selectionBackground': '#22222b',
    'editor.inactiveSelectionBackground': '#1e1e26',
    'editorLineNumber.foreground': '#5c5c6e',
    'editorLineNumber.activeForeground': '#9898a8',
    'editorCursor.foreground': '#00e5ff',
    'editor.selectionHighlightBackground': '#2a2a35',
    'editorIndentGuide.background': '#1e1e26',
    'editorIndentGuide.activeBackground': '#2a2a35',
    'editorBracketMatch.background': '#2a2a35',
    'editorBracketMatch.border': '#00e5ff',
    'editorWidget.background': '#141419',
    'editorWidget.border': '#2a2a35',
    'editorSuggestWidget.background': '#141419',
    'editorSuggestWidget.border': '#2a2a35',
    'editorSuggestWidget.selectedBackground': '#22222b',
    'editorHoverWidget.background': '#141419',
    'editorHoverWidget.border': '#2a2a35',
    'scrollbarSlider.background': '#2a2a3580',
    'scrollbarSlider.hoverBackground': '#3a3a4880',
    'scrollbarSlider.activeBackground': '#5c5c6e80',
  },
};

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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorDidMount: OnMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Define custom theme
      monaco.editor.defineTheme('terminal-noir', terminalNoirTheme);
      monaco.editor.setTheme('terminal-noir');

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
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

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

  // Debounce ref for content change callback
  const contentChangeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (newValue === undefined) return;

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
      <Editor
        height="100%"
        language={language}
        value={value}
        path={path}
        theme="terminal-noir"
        onChange={handleChange}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
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
          tabSize: 2,
          wordWrap: 'off',
          automaticLayout: true,
        }}
        loading={
          <div className="flex h-full items-center justify-center bg-surface">
            <div className="text-text-muted">Loading editor...</div>
          </div>
        }
      />
    </div>
  );
}

// Helper to get Monaco language from file path
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    jsonc: 'json',

    // Python
    py: 'python',
    pyw: 'python',
    pyi: 'python',

    // Other languages
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',

    // Config/Data
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    ini: 'ini',
    env: 'dotenv',

    // Documentation
    md: 'markdown',
    mdx: 'markdown',

    // Shell
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',

    // SQL
    sql: 'sql',

    // Docker
    dockerfile: 'dockerfile',

    // GraphQL
    graphql: 'graphql',
    gql: 'graphql',
  };

  // Check for special filenames
  const filename = path.split('/').pop()?.toLowerCase() || '';
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile') return 'makefile';
  if (filename.startsWith('.env')) return 'dotenv';

  return languageMap[ext] || 'plaintext';
}
