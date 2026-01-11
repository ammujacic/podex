'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type { editor, languages } from 'monaco-editor';
import { cn } from '@/lib/utils';
import { useEditorStore, type KeyMode } from '@/stores/editor';
import { EditorTabs, EditorEmptyState } from './EditorTabs';
import { Breadcrumbs, type BreadcrumbSymbol, convertMonacoSymbolKind } from './Breadcrumbs';
import { initVimMode, disposeVimMode, vimStatusBarStyles } from './keymodes/VimMode';
import { initEmacsMode, disposeEmacsMode } from './keymodes/EmacsMode';
import { getSnippetManager, registerDefaultSnippets } from '@/lib/snippets';

// ============================================================================
// Types
// ============================================================================

interface EnhancedCodeEditorProps {
  paneId: string;
  className?: string;
}

interface EditorPaneContentProps {
  path: string;
  content: string;
  language: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  className?: string;
}

// ============================================================================
// Terminal Noir Theme
// ============================================================================

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

// ============================================================================
// Editor Pane Content (individual Monaco instance)
// ============================================================================

function EditorPaneContent({
  path,
  content,
  language,
  readOnly = false,
  onChange,
  onSave,
  className,
}: EditorPaneContentProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);

  const settings = useEditorStore((s) => s.settings);
  const updateTabCursorPosition = useEditorStore((s) => s.updateTabCursorPosition);
  const getTabByPath = useEditorStore((s) => s.getTabByPath);

  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [symbols, setSymbols] = useState<BreadcrumbSymbol[]>([]);
  const [vimMode] = useState<string>('NORMAL');

  // Initialize key mode
  const initKeyMode = useCallback(
    async (editorInstance: editor.IStandaloneCodeEditor, keyMode: KeyMode) => {
      // Clean up existing modes
      disposeVimMode(editorInstance);
      disposeEmacsMode(editorInstance);

      if (keyMode === 'vim' && vimStatusRef.current) {
        await initVimMode(editorInstance, vimStatusRef.current);
      } else if (keyMode === 'emacs') {
        await initEmacsMode(editorInstance);
      }
    },
    []
  );

  // Handle editor mount
  const handleEditorDidMount: OnMount = useCallback(
    async (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editorInstance;
      monacoRef.current = monaco;

      // Define and set theme
      monaco.editor.defineTheme('terminal-noir', terminalNoirTheme);
      monaco.editor.setTheme('terminal-noir');

      // Register snippets
      registerDefaultSnippets();
      const snippetManager = getSnippetManager();
      snippetManager.registerCompletionProvider(monaco, language);

      // Add save keybinding
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (onSave) {
          const currentValue = editorInstance.getValue();
          onSave(currentValue);
        }
      });

      // Track cursor position
      editorInstance.onDidChangeCursorPosition((e) => {
        setCursorLine(e.position.lineNumber);
        setCursorColumn(e.position.column);

        const tab = getTabByPath(path);
        if (tab) {
          updateTabCursorPosition(tab.id, e.position.lineNumber, e.position.column);
        }
      });

      // Get document symbols for breadcrumbs
      const updateSymbols = async () => {
        const model = editorInstance.getModel();
        if (!model) return;

        try {
          const rawSymbols = await monaco.languages.getDocumentSymbols(model);
          if (rawSymbols) {
            const convertSymbols = (syms: languages.DocumentSymbol[]): BreadcrumbSymbol[] => {
              return syms.map((sym: languages.DocumentSymbol) => ({
                name: sym.name,
                kind: convertMonacoSymbolKind(sym.kind),
                range: {
                  startLine: sym.range.startLineNumber,
                  endLine: sym.range.endLineNumber,
                },
                children: sym.children ? convertSymbols(sym.children) : undefined,
              }));
            };
            setSymbols(convertSymbols(rawSymbols));
          }
        } catch {
          // Symbols not available for this language
        }
      };

      editorInstance.onDidChangeModelContent(() => {
        // Debounce symbol updates
        setTimeout(updateSymbols, 500);
      });

      updateSymbols();

      // Initialize key mode
      await initKeyMode(editorInstance, settings.keyMode);

      // Focus the editor
      editorInstance.focus();
    },
    [language, onSave, settings.keyMode, initKeyMode, path, getTabByPath, updateTabCursorPosition]
  );

  // Update key mode when settings change
  useEffect(() => {
    if (editorRef.current) {
      initKeyMode(editorRef.current, settings.keyMode);
    }
  }, [settings.keyMode, initKeyMode]);

  // Handle content changes
  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (onChange && newValue !== undefined) {
        onChange(newValue);
      }
    },
    [onChange]
  );

  // Navigate to symbol
  const handleNavigateToSymbol = useCallback((symbol: BreadcrumbSymbol) => {
    if (editorRef.current && symbol.range) {
      editorRef.current.revealLineInCenter(symbol.range.startLine);
      editorRef.current.setPosition({
        lineNumber: symbol.range.startLine,
        column: 1,
      });
      editorRef.current.focus();
    }
  }, []);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Breadcrumbs */}
      <Breadcrumbs
        path={path}
        symbols={symbols}
        cursorLine={cursorLine}
        onNavigateToSymbol={handleNavigateToSymbol}
        className="border-b border-border-subtle"
      />

      {/* Monaco Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          value={content}
          path={path}
          theme="terminal-noir"
          onChange={handleChange}
          onMount={handleEditorDidMount}
          options={{
            readOnly,
            minimap: { enabled: settings.minimap },
            fontSize: settings.fontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            lineHeight: 1.6,
            padding: { top: 8, bottom: 8 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: settings.cursorBlinking,
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'line',
            renderWhitespace: settings.renderWhitespace,
            bracketPairColorization: { enabled: settings.bracketPairColorization },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            folding: true,
            foldingHighlight: true,
            formatOnPaste: settings.formatOnPaste,
            tabSize: settings.tabSize,
            wordWrap: settings.wordWrap,
            lineNumbers: settings.lineNumbers,
            automaticLayout: true,
          }}
          loading={
            <div className="flex h-full items-center justify-center bg-surface">
              <div className="text-text-muted">Loading editor...</div>
            </div>
          }
        />
      </div>

      {/* Status Bar */}
      <div className="flex h-6 items-center justify-between border-t border-border-subtle bg-elevated px-3 text-xs text-text-muted">
        <div className="flex items-center gap-4">
          {/* Vim status */}
          {settings.keyMode === 'vim' && (
            <div ref={vimStatusRef} className="font-mono text-accent-primary">
              {vimMode}
            </div>
          )}
          {settings.keyMode === 'emacs' && (
            <div className="font-mono text-accent-secondary">Emacs</div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {/* Cursor position */}
          <span>
            Ln {cursorLine}, Col {cursorColumn}
          </span>

          {/* Language */}
          <span className="capitalize">{language}</span>
        </div>
      </div>

      {/* Inject Vim status bar styles */}
      <style dangerouslySetInnerHTML={{ __html: vimStatusBarStyles }} />
    </div>
  );
}

// ============================================================================
// Enhanced Code Editor (with tabs)
// ============================================================================

export function EnhancedCodeEditor({ paneId, className }: EnhancedCodeEditorProps) {
  const pane = useEditorStore((s) => s.panes[paneId]);
  const tabs = useEditorStore((s) => s.tabs);
  const setTabDirty = useEditorStore((s) => s.setTabDirty);
  const pinTab = useEditorStore((s) => s.pinTab);

  // Get the active tab for this pane
  const activeTab = useMemo(() => {
    if (!pane?.activeTabId) return null;
    return tabs[pane.activeTabId] || null;
  }, [pane?.activeTabId, tabs]);

  // Handle content change
  const handleChange = useCallback(
    (_value: string | undefined) => {
      if (activeTab) {
        setTabDirty(activeTab.id, true);
        // Pin the tab when edited
        if (activeTab.isPreview) {
          pinTab(activeTab.id);
        }
      }
    },
    [activeTab, setTabDirty, pinTab]
  );

  // Handle save
  const handleSave = useCallback(
    (_value: string) => {
      if (activeTab) {
        setTabDirty(activeTab.id, false);
        // TODO: Implement API call to save file
      }
    },
    [activeTab, setTabDirty]
  );

  if (!pane) {
    return <EditorEmptyState paneId={paneId} />;
  }

  return (
    <div className={cn('flex h-full flex-col bg-surface', className)}>
      {/* Tab bar */}
      <EditorTabs paneId={paneId} />

      {/* Editor content */}
      {activeTab ? (
        <EditorPaneContent
          key={activeTab.id}
          path={activeTab.path}
          content="" // TODO: Get content from file store or API
          language={activeTab.language}
          onChange={handleChange}
          onSave={handleSave}
          className="flex-1"
        />
      ) : (
        <EditorEmptyState paneId={paneId} />
      )}
    </div>
  );
}

// ============================================================================
// Editor Container (with split views)
// ============================================================================

export { SplitView, LayoutToggle } from './SplitView';
