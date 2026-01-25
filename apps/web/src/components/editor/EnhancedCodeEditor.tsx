'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor';
import { useSessionStore } from '@/stores/session';
import { EditorTabs, EditorEmptyState } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import { Breadcrumbs, type BreadcrumbSymbol, convertMonacoSymbolKind } from './Breadcrumbs';
import { getSnippetManager, registerDefaultSnippets } from '@/lib/snippets';
import {
  getCompletionProvider,
  getBugDetector,
  getCodeGenerator,
  bugGlyphStyles,
  generatorStyles,
} from '@/lib/ai';
import { VSCodeEditor, type VSCodeEditorRef } from '@/lib/vscode';
import { useEditorCommands, useEditorFocusContext } from '@/hooks/useEditorCommands';
import { updateFileContent, getFileContent } from '@/lib/api';
import * as monaco from '@codingame/monaco-vscode-editor-api';
import { SelectionActions } from './SelectionActions';

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
let aiStylesInjected = false;

function injectAIStyles() {
  if (aiStylesInjected || typeof document === 'undefined') return;

  const style = document.createElement('style');
  style.textContent = bugGlyphStyles + generatorStyles;
  document.head.appendChild(style);
  aiStylesInjected = true;
}

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
  const monacoEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState(language);
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );

  const settings = useEditorStore((s) => s.settings);
  const updateTabCursorPosition = useEditorStore((s) => s.updateTabCursorPosition);
  const getTabByPath = useEditorStore((s) => s.getTabByPath);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);
  const [symbols, setSymbols] = useState<BreadcrumbSymbol[]>([]);

  // Register Monaco-aware editor commands and focus context
  useEditorCommands(monacoEditorRef);
  useEditorFocusContext(monacoEditorRef);

  // Handle global "Save All" requests from the command palette.
  useEffect(() => {
    const handleSaveAll = () => {
      if (!onSave) return;
      const editor = editorRef.current?.getEditor();
      if (!editor) return;
      const value = editor.getValue();
      onSave(value);
    };

    window.addEventListener('podex-save-all', handleSaveAll);
    return () => {
      window.removeEventListener('podex-save-all', handleSaveAll);
    };
  }, [onSave]);

  // Handle editor mount
  const handleEditorMount = useCallback(
    async (editor: monaco.editor.IStandaloneCodeEditor) => {
      // Store editor instance for SelectionActions
      setEditorInstance(editor);
      monacoEditorRef.current = editor;

      // Register theme
      registerTerminalNoirTheme();
      monaco.editor.setTheme('terminal-noir');

      // Inject AI feature styles (bug glyphs, generator markers)
      injectAIStyles();

      // Register snippets
      registerDefaultSnippets();
      const snippetManager = getSnippetManager();
      snippetManager.registerCompletionProvider(monaco, language);

      // Register AI inline completions if enabled
      if (settings?.completionsEnabled) {
        const aiProvider = getCompletionProvider();
        aiProvider.setEnabled(true);
        aiProvider.register(monaco);
      }

      // Register AI Bug Detector if enabled
      if (settings?.completionsEnabled) {
        const bugDetector = getBugDetector();
        bugDetector.setupAutoAnalysis(editor, monaco);
      }

      // Register AI Code Generator (TODO comment detection)
      const codeGenerator = getCodeGenerator();
      codeGenerator.register(monaco);

      // Add save keybinding
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (onSave) {
          const currentValue = editor.getValue();
          onSave(currentValue);
        }
      });

      // Get document symbols for breadcrumbs
      // Note: Document symbols are provided by language services via DocumentSymbolProvider
      // This requires language server integration which may not be available for all languages
      const updateSymbols = async () => {
        const model = editor.getModel();
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

      editor.onDidChangeModelContent(() => {
        // Debounce symbol updates
        setTimeout(updateSymbols, 500);
      });

      updateSymbols();

      // Focus the editor
      editor.focus();
    },
    [language, onSave, settings?.completionsEnabled]
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
      cursorBlinking: settings?.cursorBlinking ?? 'smooth',
      renderLineHighlight: 'line' as const,
      renderWhitespace: settings?.renderWhitespace ?? 'selection',
      bracketPairColorization: { enabled: settings?.bracketPairColorization ?? true },
      formatOnPaste: settings?.formatOnPaste ?? true,
      inlineSuggest: {
        enabled: settings?.completionsEnabled ?? false,
        mode: 'subword' as const,
      },
    }),
    [settings]
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

  // SelectionActions handler for AI actions
  const handleAIAction = useCallback(
    async (prompt: string, selectedText: string) => {
      if (!currentSessionId || !path) return;

      try {
        const { performEditorAIAction } = await import('@/lib/api');
        const result = await performEditorAIAction({
          sessionId: currentSessionId,
          prompt,
          code: selectedText,
          language: currentLanguage,
          filePath: path,
          model: settings?.aiActionModel ?? null,
        });

        if (result.response) {
          // Result is available in result.response for further processing
          // Could be shown in a panel or applied to editor based on action type
        }
      } catch (error) {
        console.error('AI action failed:', error);
        // Handle billing errors
        const { handleBillingError } = await import('@/lib/api');
        handleBillingError(error);
      }
    },
    [currentSessionId, path, currentLanguage, settings?.aiActionModel]
  );

  // Wait for settings to be initialized from ConfigStore (after all hooks)
  if (!settings) {
    return (
      <div className={cn('flex h-full items-center justify-center bg-surface', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm">Loading editor settings...</span>
        </div>
      </div>
    );
  }

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
      <div className="flex-1 relative">
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

        {/* Selection Actions (floating context menu on text selection) */}
        {editorInstance && <SelectionActions editor={editorInstance} onAIAction={handleAIAction} />}
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

  // Extract stable identifiers for file loading - only reload when path actually changes
  const activeTabId = activeTab?.id;
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

        // On fresh load, assume the file on disk is the source of truth
        // and clear any stale dirty state (e.g. from a previous session).
        if (activeTabId) {
          setTabDirty(activeTabId, false);
        }
      } catch (error) {
        console.error('Failed to load file content:', error);
        setFileContent('');
      }
    };

    loadFileContent();
  }, [activeTabPath, activeTabId, currentSessionId, setTabDirty]);

  // Handle content change
  // Only mark the tab as dirty when the buffer actually diverges from the last
  // loaded/saved content, not on initial model setup.
  const handleChange = useCallback(
    (value: string | undefined) => {
      if (!activeTab || value === undefined) return;

      // If the current value matches the last loaded/saved content, treat it as clean.
      if (value === fileContent) return;

      setTabDirty(activeTab.id, true);

      // Pin the tab when edited
      if (activeTab.isPreview) {
        pinTab(activeTab.id);
      }
    },
    [activeTab, fileContent, setTabDirty, pinTab]
  );

  // Handle save
  const handleSave = useCallback(
    async (value: string) => {
      if (activeTab && currentSessionId) {
        try {
          await updateFileContent(currentSessionId, activeTab.path, value);
          // Persist the saved content as the new clean baseline
          setFileContent(value);
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
