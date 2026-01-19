'use client';

import { useCallback, useMemo } from 'react';
import {
  ChevronDown,
  AlignLeft,
  WrapText,
  Map,
  Eye,
  EyeOff,
  Settings,
  Type,
  Indent,
  Check,
  Sparkles,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/stores/editor';
import type * as monaco from '@codingame/monaco-vscode-editor-api';

// ============================================================================
// Types
// ============================================================================

interface EditorToolbarProps {
  language: string;
  onLanguageChange?: (language: string) => void;
  editorRef?: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  monacoRef?: React.RefObject<typeof monaco | null>;
  className?: string;
}

// ============================================================================
// Language Options
// ============================================================================

const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript', ext: '.ts' },
  { id: 'javascript', label: 'JavaScript', ext: '.js' },
  { id: 'typescriptreact', label: 'TypeScript React', ext: '.tsx' },
  { id: 'javascriptreact', label: 'JavaScript React', ext: '.jsx' },
  { id: 'python', label: 'Python', ext: '.py' },
  { id: 'go', label: 'Go', ext: '.go' },
  { id: 'rust', label: 'Rust', ext: '.rs' },
  { id: 'java', label: 'Java', ext: '.java' },
  { id: 'csharp', label: 'C#', ext: '.cs' },
  { id: 'cpp', label: 'C++', ext: '.cpp' },
  { id: 'c', label: 'C', ext: '.c' },
  { id: 'ruby', label: 'Ruby', ext: '.rb' },
  { id: 'php', label: 'PHP', ext: '.php' },
  { id: 'swift', label: 'Swift', ext: '.swift' },
  { id: 'kotlin', label: 'Kotlin', ext: '.kt' },
  { id: 'html', label: 'HTML', ext: '.html' },
  { id: 'css', label: 'CSS', ext: '.css' },
  { id: 'scss', label: 'SCSS', ext: '.scss' },
  { id: 'less', label: 'Less', ext: '.less' },
  { id: 'json', label: 'JSON', ext: '.json' },
  { id: 'yaml', label: 'YAML', ext: '.yaml' },
  { id: 'xml', label: 'XML', ext: '.xml' },
  { id: 'markdown', label: 'Markdown', ext: '.md' },
  { id: 'sql', label: 'SQL', ext: '.sql' },
  { id: 'shell', label: 'Shell', ext: '.sh' },
  { id: 'dockerfile', label: 'Dockerfile', ext: '' },
  { id: 'graphql', label: 'GraphQL', ext: '.graphql' },
  { id: 'plaintext', label: 'Plain Text', ext: '.txt' },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
const TAB_SIZES = [2, 4, 8];

// ============================================================================
// Component
// ============================================================================

export function EditorToolbar({
  language,
  onLanguageChange,
  editorRef,
  monacoRef,
  className,
}: EditorToolbarProps) {
  const settings = useEditorStore((s) => s.settings);
  const updateSettings = useEditorStore((s) => s.updateSettings);

  // Get current language display name
  const currentLanguage = useMemo(() => {
    const lang = LANGUAGES.find((l) => l.id === language);
    return lang?.label || language || 'Plain Text';
  }, [language]);

  // Format document
  const handleFormatDocument = useCallback(() => {
    const editor = editorRef?.current;
    if (editor) {
      editor.getAction('editor.action.formatDocument')?.run();
    }
  }, [editorRef]);

  // Format selection
  const handleFormatSelection = useCallback(() => {
    const editor = editorRef?.current;
    if (editor) {
      editor.getAction('editor.action.formatSelection')?.run();
    }
  }, [editorRef]);

  // Toggle minimap
  const handleToggleMinimap = useCallback(() => {
    updateSettings({ minimap: !settings.minimap });
  }, [settings.minimap, updateSettings]);

  // Toggle word wrap
  const handleToggleWordWrap = useCallback(() => {
    updateSettings({ wordWrap: settings.wordWrap === 'on' ? 'off' : 'on' });
  }, [settings.wordWrap, updateSettings]);

  // Toggle whitespace rendering
  const handleToggleWhitespace = useCallback(() => {
    const next = settings.renderWhitespace === 'none' ? 'selection' : 'none';
    updateSettings({ renderWhitespace: next });
  }, [settings.renderWhitespace, updateSettings]);

  // Toggle AI completions
  const handleToggleCompletions = useCallback(() => {
    updateSettings({ completionsEnabled: !settings.completionsEnabled });
  }, [settings.completionsEnabled, updateSettings]);

  // Change language
  const handleLanguageChange = useCallback(
    (newLanguage: string) => {
      if (onLanguageChange) {
        onLanguageChange(newLanguage);
      }
      // Also update Monaco model language
      const editor = editorRef?.current;
      const monaco = monacoRef?.current;
      if (editor && monaco) {
        const model = editor.getModel();
        if (model) {
          monaco.editor.setModelLanguage(model, newLanguage);
        }
      }
    },
    [onLanguageChange, editorRef, monacoRef]
  );

  // Change font size
  const handleFontSizeChange = useCallback(
    (size: number) => {
      updateSettings({ fontSize: size });
    },
    [updateSettings]
  );

  // Change tab size
  const handleTabSizeChange = useCallback(
    (size: number) => {
      updateSettings({ tabSize: size });
    },
    [updateSettings]
  );

  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-1 border-b border-border-subtle bg-elevated',
        className
      )}
    >
      {/* Language Selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors">
            <span className="font-medium">{currentLanguage}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48 max-h-80 overflow-y-auto" align="start">
          <DropdownMenuLabel>Select Language</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {LANGUAGES.map((lang) => (
            <DropdownMenuItem
              key={lang.id}
              onClick={() => handleLanguageChange(lang.id)}
              className="flex items-center justify-between cursor-pointer"
            >
              <span>{lang.label}</span>
              {lang.id === language && <Check className="h-3.5 w-3.5 text-accent-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="w-px h-4 bg-border-subtle mx-1" />

      {/* Format Document */}
      <button
        onClick={handleFormatDocument}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors"
        title="Format Document (Cmd+Shift+F)"
      >
        <AlignLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Format</span>
      </button>

      <div className="w-px h-4 bg-border-subtle mx-1" />

      {/* Quick Toggles */}
      <div className="flex items-center gap-0.5">
        {/* Minimap Toggle */}
        <button
          onClick={handleToggleMinimap}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
            settings.minimap
              ? 'text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20'
              : 'text-text-muted hover:text-text-primary hover:bg-overlay'
          )}
          title={`Minimap: ${settings.minimap ? 'On' : 'Off'}`}
        >
          <Map className="h-3.5 w-3.5" />
        </button>

        {/* Word Wrap Toggle */}
        <button
          onClick={handleToggleWordWrap}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
            settings.wordWrap === 'on'
              ? 'text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20'
              : 'text-text-muted hover:text-text-primary hover:bg-overlay'
          )}
          title={`Word Wrap: ${settings.wordWrap === 'on' ? 'On' : 'Off'}`}
        >
          <WrapText className="h-3.5 w-3.5" />
        </button>

        {/* Whitespace Toggle */}
        <button
          onClick={handleToggleWhitespace}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
            settings.renderWhitespace !== 'none'
              ? 'text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20'
              : 'text-text-muted hover:text-text-primary hover:bg-overlay'
          )}
          title={`Show Whitespace: ${settings.renderWhitespace !== 'none' ? 'On' : 'Off'}`}
        >
          {settings.renderWhitespace !== 'none' ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>

        {/* AI Completions Toggle */}
        <button
          onClick={handleToggleCompletions}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
            settings.completionsEnabled
              ? 'text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20'
              : 'text-text-muted hover:text-text-primary hover:bg-overlay'
          )}
          title={`AI Completions: ${settings.completionsEnabled ? 'On' : 'Off'}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-overlay transition-colors">
            <Settings className="h-3.5 w-3.5" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end">
          {/* Font Size */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Type className="mr-2 h-4 w-4" />
              <span>Font Size</span>
              <span className="ml-auto text-xs text-text-muted">{settings.fontSize}px</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {FONT_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => handleFontSizeChange(size)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span>{size}px</span>
                  {size === settings.fontSize && (
                    <Check className="h-3.5 w-3.5 text-accent-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* Tab Size */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Indent className="mr-2 h-4 w-4" />
              <span>Tab Size</span>
              <span className="ml-auto text-xs text-text-muted">{settings.tabSize}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {TAB_SIZES.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => handleTabSizeChange(size)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span>{size} spaces</span>
                  {size === settings.tabSize && (
                    <Check className="h-3.5 w-3.5 text-accent-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {/* Checkboxes for additional settings */}
          <DropdownMenuCheckboxItem
            checked={settings.bracketPairColorization}
            onCheckedChange={(checked) => updateSettings({ bracketPairColorization: checked })}
          >
            Bracket Colorization
          </DropdownMenuCheckboxItem>

          <DropdownMenuCheckboxItem
            checked={settings.formatOnSave}
            onCheckedChange={(checked) => updateSettings({ formatOnSave: checked })}
          >
            Format on Save
          </DropdownMenuCheckboxItem>

          <DropdownMenuCheckboxItem
            checked={settings.formatOnPaste}
            onCheckedChange={(checked) => updateSettings({ formatOnPaste: checked })}
          >
            Format on Paste
          </DropdownMenuCheckboxItem>

          <DropdownMenuSeparator />

          {/* Format Actions */}
          <DropdownMenuItem onClick={handleFormatDocument} className="cursor-pointer">
            <AlignLeft className="mr-2 h-4 w-4" />
            Format Document
            <span className="ml-auto text-xs text-text-muted">⇧⌘F</span>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={handleFormatSelection} className="cursor-pointer">
            <AlignLeft className="mr-2 h-4 w-4" />
            Format Selection
            <span className="ml-auto text-xs text-text-muted">⌘K ⌘F</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
