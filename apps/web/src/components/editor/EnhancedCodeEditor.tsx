'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor';
import { useSessionStore } from '@/stores/session';
import { EditorTabs, EditorEmptyState } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import { Breadcrumbs, type BreadcrumbSymbol, convertMonacoSymbolKind } from './Breadcrumbs';
import { getSnippetManager, registerDefaultSnippets } from '@/lib/snippets';
import { getCompletionProvider } from '@/lib/ai';
import { VSCodeEditor, type VSCodeEditorRef } from '@/lib/vscode';
import { updateFileContent, getFileContent } from '@/lib/api';
import * as monaco from '@codingame/monaco-vscode-editor-api';

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
  onLanguageChange?: (language: string) => void;
  className?: string;
  showToolbar?: boolean;
}

// ============================================================================
// Terminal Noir Theme Registration
// ============================================================================

let themeRegistered = false;

function registerTerminalNoirTheme() {
  if (themeRegistered) return;

  try {
    monaco.editor.defineTheme('terminal-noir', {
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
    });
    themeRegistered = true;
  } catch {
    // Theme registration may fail if Monaco not fully initialized
  }
}

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
  onLanguageChange,
  className,
  showToolbar = true,
}: EditorPaneContentProps) {
  const editorRef = useRef<VSCodeEditorRef>(null);
  const [currentLanguage, setCurrentLanguage] = useState(language);

  const settings = useEditorStore((s) => s.settings);
  const updateTabCursorPosition = useEditorStore((s) => s.updateTabCursorPosition);
  const getTabByPath = useEditorStore((s) => s.getTabByPath);

  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [symbols, setSymbols] = useState<BreadcrumbSymbol[]>([]);

  // Handle editor mount
  const handleEditorMount = useCallback(
    async (editorInstance: monaco.editor.IStandaloneCodeEditor) => {
      // Register theme
      registerTerminalNoirTheme();
      monaco.editor.setTheme('terminal-noir');

      // Register snippets
      registerDefaultSnippets();
      const snippetManager = getSnippetManager();
      snippetManager.registerCompletionProvider(monaco, language);

      // Register AI inline completions if enabled
      if (settings.completionsEnabled) {
        const aiProvider = getCompletionProvider();
        aiProvider.setEnabled(true);
        aiProvider.register(monaco);
      }

      // Add save keybinding
      editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (onSave) {
          const currentValue = editorInstance.getValue();
          onSave(currentValue);
        }
      });

      // Get document symbols for breadcrumbs
      // Note: Document symbols are provided by language services via DocumentSymbolProvider
      // This requires language server integration which may not be available for all languages
      const updateSymbols = async () => {
        const model = editorInstance.getModel();
        if (!model) return;

        try {
          // Try to get document symbols using the DocumentSymbolProviderRegistry
          // This is the monaco-vscode-api compatible approach
          const providers = (
            monaco.languages as unknown as {
              DocumentSymbolProviderRegistry?: {
                all: (model: monaco.editor.ITextModel) => Array<{
                  provideDocumentSymbols: (
                    model: monaco.editor.ITextModel,
                    token: monaco.CancellationToken
                  ) => Promise<monaco.languages.DocumentSymbol[] | null>;
                }>;
              };
            }
          ).DocumentSymbolProviderRegistry;

          if (providers) {
            const allProviders = providers.all(model);
            const firstProvider = allProviders[0];
            if (firstProvider) {
              const tokenSource = new monaco.CancellationTokenSource();
              const rawSymbols = await firstProvider.provideDocumentSymbols(
                model,
                tokenSource.token
              );
              tokenSource.dispose();

              if (rawSymbols) {
                const convertSymbols = (
                  syms: monaco.languages.DocumentSymbol[]
                ): BreadcrumbSymbol[] => {
                  return syms.map((sym) => ({
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
            }
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

      // Focus the editor
      editorInstance.focus();
    },
    [language, onSave, settings.completionsEnabled]
  );

  // Handle cursor position change
  const handleCursorChange = useCallback(
    (position: monaco.Position) => {
      setCursorLine(position.lineNumber);
      setCursorColumn(position.column);

      const tab = getTabByPath(path);
      if (tab) {
        updateTabCursorPosition(tab.id, position.lineNumber, position.column);
      }
    },
    [path, getTabByPath, updateTabCursorPosition]
  );

  // Sync language with prop
  useEffect(() => {
    setCurrentLanguage(language);
  }, [language]);

  // Handle language change from toolbar
  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      setCurrentLanguage(newLanguage);
      onLanguageChange?.(newLanguage);
    },
    [onLanguageChange]
  );

  // Memoize editor options to prevent unnecessary editor recreation
  const editorOptions = useMemo(
    () => ({
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineHeight: 1.6,
      cursorBlinking: settings.cursorBlinking,
      renderLineHighlight: 'line' as const,
      renderWhitespace: settings.renderWhitespace,
      bracketPairColorization: { enabled: settings.bracketPairColorization },
      formatOnPaste: settings.formatOnPaste,
      inlineSuggest: {
        enabled: settings.completionsEnabled,
        mode: 'subword' as const,
      },
    }),
    [
      settings.cursorBlinking,
      settings.renderWhitespace,
      settings.bracketPairColorization,
      settings.formatOnPaste,
      settings.completionsEnabled,
    ]
  );

  // Navigate to symbol
  const handleNavigateToSymbol = useCallback((symbol: BreadcrumbSymbol) => {
    if (symbol.range) {
      editorRef.current?.scrollToLine(symbol.range.startLine);
      editorRef.current?.setPosition({
        lineNumber: symbol.range.startLine,
        column: 1,
      });
      editorRef.current?.focus();
    }
  }, []);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Editor Toolbar */}
      {showToolbar && (
        <EditorToolbar
          language={currentLanguage}
          onLanguageChange={handleLanguageChange}
          editorRef={{ current: editorRef.current?.getEditor() ?? null }}
          monacoRef={{ current: monaco }}
        />
      )}

      {/* Breadcrumbs */}
      <Breadcrumbs
        path={path}
        symbols={symbols}
        cursorLine={cursorLine}
        onNavigateToSymbol={handleNavigateToSymbol}
        className="border-b border-border-subtle"
      />

      {/* VS Code Editor */}
      <div className="flex-1">
        <VSCodeEditor
          ref={editorRef}
          value={content}
          language={currentLanguage}
          filePath={path}
          theme="vs-dark"
          readOnly={readOnly}
          onChange={onChange}
          onMount={handleEditorMount}
          onCursorChange={handleCursorChange}
          minimap={settings.minimap}
          lineNumbers={settings.lineNumbers !== 'off'}
          wordWrap={settings.wordWrap !== 'off'}
          fontSize={settings.fontSize}
          tabSize={settings.tabSize}
          options={editorOptions}
          className="h-full"
        />
      </div>

      {/* Status Bar */}
      <div className="flex h-6 items-center justify-end border-t border-border-subtle bg-elevated px-3 text-xs text-text-muted">
        <div className="flex items-center gap-4">
          {/* Cursor position */}
          <span>
            Ln {cursorLine}, Col {cursorColumn}
          </span>

          {/* Language */}
          <span className="capitalize">{language}</span>
        </div>
      </div>
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
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const [fileContent, setFileContent] = useState<string>('');

  // Get the active tab for this pane
  const activeTab = useMemo(() => {
    if (!pane?.activeTabId) return null;
    return tabs[pane.activeTabId] || null;
  }, [pane?.activeTabId, tabs]);

  // Extract stable path for file loading - only reload when path actually changes
  const activeTabPath = activeTab?.path;

  // Load file content when active tab path changes (not on every cursor move)
  useEffect(() => {
    const loadFileContent = async () => {
      if (!activeTabPath || !currentSessionId) {
        setFileContent('');
        return;
      }

      try {
        const response = await getFileContent(currentSessionId, activeTabPath);
        setFileContent(response.content);
      } catch (error) {
        console.error('Failed to load file content:', error);
        setFileContent('');
      }
    };

    loadFileContent();
  }, [activeTabPath, currentSessionId]);

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
    async (value: string) => {
      if (activeTab && currentSessionId) {
        try {
          await updateFileContent(currentSessionId, activeTab.path, value);
          setTabDirty(activeTab.id, false);
        } catch (error) {
          console.error('Failed to save file:', error);
          // Keep the tab dirty if save failed
        }
      }
    },
    [activeTab, currentSessionId, setTabDirty]
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
          content={fileContent}
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
