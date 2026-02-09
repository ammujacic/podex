'use client';

import React, { useMemo, useState, useCallback, useEffect, memo } from 'react';
import { cn } from '@/lib/utils';
import { Copy, Check, Save, Loader2, Terminal } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { PromptDialog } from '@/components/ui/Dialogs';
import { createFile } from '@/lib/api';

// Types for lazy-loaded syntax highlighter
type SyntaxHighlighterType = typeof import('react-syntax-highlighter').Prism;
type ThemeType = Record<string, React.CSSProperties>;

// Lazy-loaded syntax highlighter state
let SyntaxHighlighterComponent: SyntaxHighlighterType | null = null;
let oneDarkTheme: ThemeType | null = null;
let loadPromise: Promise<void> | null = null;

// Load the syntax highlighter and theme lazily (~200KB total)
function loadSyntaxHighlighter(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = Promise.all([
    import('react-syntax-highlighter').then((mod) => {
      SyntaxHighlighterComponent = mod.Prism;
    }),
    import('react-syntax-highlighter/dist/esm/styles/prism').then((mod) => {
      oneDarkTheme = mod.oneDark;
    }),
  ]).then(() => {});

  return loadPromise;
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Callback when a file link is clicked (path, line range) */
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}

interface NestedListItem {
  content: string;
  children?: NestedListItem[];
}

interface TableCell {
  content: string;
  align?: 'left' | 'center' | 'right';
}

interface TableData {
  headers: TableCell[];
  rows: TableCell[][];
  alignments: ('left' | 'center' | 'right')[];
}

interface ParsedBlock {
  type: 'paragraph' | 'code' | 'heading' | 'list' | 'blockquote' | 'hr' | 'tool_call' | 'table';
  content: string;
  language?: string;
  level?: number;
  ordered?: boolean;
  items?: string[];
  nestedItems?: NestedListItem[];
  tableData?: TableData;
}

/**
 * Check if a URL is a file path (not a web URL)
 */
function isFilePath(url: string): boolean {
  // Skip web URLs
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
    return false;
  }
  // Check for file-like patterns (has extension or looks like a path)
  return /\.[a-zA-Z0-9]+(?:#|$)/.test(url) || url.includes('/');
}

/**
 * Parse file path and optional line numbers from a URL
 * Supports formats: path/file.ts, path/file.ts#L42, path/file.ts#L42-L51
 */
function parseFilePath(url: string): { path: string; startLine?: number; endLine?: number } {
  const [pathPart, fragment] = url.split('#');
  const path = pathPart || url;

  if (!fragment) {
    return { path };
  }

  // Match L42 or L42-L51 patterns
  const lineMatch = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
  if (lineMatch && lineMatch[1]) {
    return {
      path,
      startLine: parseInt(lineMatch[1], 10),
      endLine: lineMatch[2] ? parseInt(lineMatch[2], 10) : undefined,
    };
  }

  return { path };
}

/**
 * Parses inline markdown elements (bold, italic, code, links)
 */
function parseInlineMarkdown(
  text: string,
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  // Pattern for all inline elements
  const patterns = [
    // Code (backticks) - must come before bold/italic to avoid conflicts
    {
      regex: /`([^`]+)`/,
      render: (match: string) => (
        <code
          key={key++}
          className="rounded bg-void/50 px-1.5 py-0.5 text-xs font-mono text-accent-primary break-all"
        >
          {match}
        </code>
      ),
    },
    // Bold with asterisks - recursively parse content for nested links
    {
      regex: /\*\*([^*]+)\*\*/,
      render: (match: string) => (
        <strong key={key++} className="font-semibold">
          {parseInlineMarkdown(match, onFileClick)}
        </strong>
      ),
    },
    // Bold with underscores - use lookbehind/lookahead to avoid snake_case
    {
      regex: /(?<![a-zA-Z0-9])__([^_]+)__(?![a-zA-Z0-9])/,
      render: (match: string) => (
        <strong key={key++} className="font-semibold">
          {parseInlineMarkdown(match, onFileClick)}
        </strong>
      ),
    },
    // Italic with asterisks - recursively parse content for nested links
    {
      regex: /\*([^*]+)\*/,
      render: (match: string) => (
        <em key={key++} className="italic">
          {parseInlineMarkdown(match, onFileClick)}
        </em>
      ),
    },
    // Italic with underscores - use lookbehind/lookahead to avoid matching snake_case
    // e.g. _italic_ matches, but create_execution_plan does not
    {
      regex: /(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/,
      render: (match: string) => (
        <em key={key++} className="italic">
          {parseInlineMarkdown(match, onFileClick)}
        </em>
      ),
    },
    // Links - handle file paths specially if callback is provided
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (linkText: string, url: string) => {
        // Check if this is a file path and we have a callback
        if (onFileClick && isFilePath(url)) {
          const { path, startLine, endLine } = parseFilePath(url);
          return (
            <button
              key={key++}
              onClick={() => onFileClick(path, startLine, endLine)}
              className="text-accent-primary hover:underline hover:text-accent-primary/80 cursor-pointer bg-transparent border-none p-0 font-inherit"
            >
              {linkText}
            </button>
          );
        }
        // Regular external link
        return (
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-primary hover:underline"
          >
            {linkText}
          </a>
        );
      },
    },
  ];

  while (remaining.length > 0) {
    let earliestMatch: {
      index: number;
      pattern: (typeof patterns)[0];
      match: RegExpExecArray;
    } | null = null;

    // Find the earliest matching pattern
    for (const pattern of patterns) {
      const match = pattern.regex.exec(remaining);
      if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
        earliestMatch = { index: match.index, pattern, match };
      }
    }

    if (earliestMatch) {
      // Add text before the match
      if (earliestMatch.index > 0) {
        elements.push(remaining.slice(0, earliestMatch.index));
      }

      // Render the matched element
      const { pattern, match } = earliestMatch;
      if (match.length === 3) {
        // Link pattern with text and url
        elements.push(pattern.render(match[1] ?? '', match[2] ?? ''));
      } else {
        elements.push(pattern.render(match[1] ?? '', ''));
      }

      // Continue with remaining text
      remaining = remaining.slice(earliestMatch.index + match[0].length);
    } else {
      // No more matches, add remaining text
      elements.push(remaining);
      break;
    }
  }

  return elements;
}

interface ListItem {
  content: string;
  children?: ListItem[];
}

interface ParsedList {
  ordered: boolean;
  items: ListItem[];
}

/**
 * Gets the indentation level of a line (number of leading spaces)
 */
function getIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match?.[1]?.length ?? 0;
}

/**
 * Parses a list (handles nested lists)
 */
function parseList(lines: string[], startIndex: number): { list: ParsedList; endIndex: number } {
  const firstLine = lines[startIndex]?.trim() ?? '';
  const isOrdered = /^\d+\.\s/.test(firstLine);
  const items: ListItem[] = [];
  let i = startIndex;
  const baseIndent = getIndent(lines[startIndex] ?? '');

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    const indent = getIndent(line);

    // Empty line might end the list or be a paragraph break within it
    if (trimmed === '') {
      // Check if next non-empty line continues the list
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && (lines[nextNonEmpty] ?? '').trim() === '') {
        nextNonEmpty++;
      }
      if (nextNonEmpty < lines.length) {
        const nextLine = lines[nextNonEmpty] ?? '';
        const nextTrimmed = nextLine.trim();
        const nextIndent = getIndent(nextLine);
        const isList = /^[-*+]\s/.test(nextTrimmed) || /^\d+\.\s/.test(nextTrimmed);
        if (isList && nextIndent <= baseIndent) {
          i = nextNonEmpty;
          continue;
        }
      }
      break;
    }

    // Check if this line is a list item at our level
    const isListItem = /^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);

    if (isListItem && indent <= baseIndent) {
      // This is a list item at our level or higher
      if (indent < baseIndent) {
        // This belongs to a parent list
        break;
      }
      // Extract item content
      const itemContent = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');
      items.push({ content: itemContent });
      i++;
    } else if (indent > baseIndent && items.length > 0) {
      // This might be a nested list or continuation
      const lastItem = items[items.length - 1]!;

      if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
        // Nested list
        const nested = parseList(lines, i);
        lastItem.children = nested.list.items;
        i = nested.endIndex;
      } else {
        // Continuation of the last item
        lastItem.content += ' ' + trimmed;
        i++;
      }
    } else {
      // Not a list item and not indented - end of list
      break;
    }
  }

  return {
    list: { ordered: isOrdered, items },
    endIndex: i,
  };
}

/**
 * Checks if a line is a valid table separator row (e.g., |---|---|)
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  // Must start and end with | (or start with |)
  if (!trimmed.startsWith('|')) return false;
  // Check for pattern like |---|---| or | --- | --- |
  const separatorPattern = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
  return separatorPattern.test(trimmed);
}

/**
 * Parses a table row into cells
 */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading and trailing pipes
  const content = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  // Split by | and trim each cell
  return content.split('|').map((cell) => cell.trim());
}

/**
 * Parses alignment from separator row
 */
function parseTableAlignments(separatorLine: string): ('left' | 'center' | 'right')[] {
  const cells = parseTableRow(separatorLine);
  return cells.map((cell) => {
    const trimmed = cell.trim();
    const leftColon = trimmed.startsWith(':');
    const rightColon = trimmed.endsWith(':');
    if (leftColon && rightColon) return 'center';
    if (rightColon) return 'right';
    return 'left';
  });
}

/**
 * Parses a markdown table
 */
function parseTable(
  lines: string[],
  startIndex: number
): { table: TableData; endIndex: number } | null {
  // Need at least header + separator (2 lines)
  if (startIndex + 1 >= lines.length) return null;

  const headerLine = lines[startIndex] ?? '';
  const separatorLine = lines[startIndex + 1] ?? '';

  // Validate header looks like a table row
  if (!headerLine.trim().includes('|')) return null;

  // Validate separator
  if (!isTableSeparator(separatorLine)) return null;

  const headers = parseTableRow(headerLine);
  const alignments = parseTableAlignments(separatorLine);

  // Ensure alignments array matches headers length
  while (alignments.length < headers.length) {
    alignments.push('left');
  }

  const headerCells: TableCell[] = headers.map((content, i) => ({
    content,
    align: alignments[i],
  }));

  const rows: TableCell[][] = [];
  let i = startIndex + 2;

  // Parse data rows
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Empty line or non-table line ends the table
    if (!trimmed || !trimmed.includes('|')) break;

    const rowCells = parseTableRow(line);
    const row: TableCell[] = rowCells.map((content, idx) => ({
      content,
      align: alignments[idx] || 'left',
    }));

    // Pad row if needed
    while (row.length < headers.length) {
      row.push({ content: '', align: 'left' });
    }

    rows.push(row);
    i++;
  }

  return {
    table: {
      headers: headerCells,
      rows,
      alignments,
    },
    endIndex: i,
  };
}

/**
 * Parses markdown content into structured blocks
 */
function parseMarkdown(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmedLine = line.trim();

    // Empty line - skip
    if (trimmedLine === '') {
      i++;
      continue;
    }

    // Code block (fenced)
    if (trimmedLine.startsWith('```')) {
      const language = trimmedLine.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i++;

      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i++;
      }

      // Check if this looks like a tool/function call JSON
      const codeContent = codeLines.join('\n');
      const isToolCall =
        language === 'json' &&
        (codeContent.includes('"function_name"') ||
          codeContent.includes('"tool_name"') ||
          (codeContent.includes('"name":') && codeContent.includes('"arguments"')));

      blocks.push({
        type: isToolCall ? 'tool_call' : 'code',
        content: codeContent,
        language,
      });

      i++; // Skip closing ```
      continue;
    }

    // Headings
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmedLine)) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
      });
      continue;
    }

    // Lists (ordered or unordered)
    if (/^[-*+]\s/.test(trimmedLine) || /^\d+\.\s/.test(trimmedLine)) {
      const { list, endIndex } = parseList(lines, i);
      blocks.push({
        type: 'list',
        content: '',
        ordered: list.ordered,
        items: list.items.map((item) => item.content),
        // Store nested items in a way we can render
        nestedItems: list.items,
      });
      i = endIndex;
      continue;
    }

    // Tables - check if this line starts a table (contains | and next line is separator)
    if (trimmedLine.includes('|')) {
      const tableResult = parseTable(lines, i);
      if (tableResult) {
        blocks.push({
          type: 'table',
          content: '',
          tableData: tableResult.table,
        });
        i = tableResult.endIndex;
        continue;
      }
    }

    // Check if this line is a standalone code span (insight-style decorative line)
    // These should be their own paragraphs, not joined with adjacent content
    const isStandaloneCodeSpan = /^`[^`]+`$/.test(trimmedLine);

    if (isStandaloneCodeSpan) {
      // Standalone code spans get their own paragraph
      blocks.push({
        type: 'paragraph',
        content: trimmedLine,
      });
      i++;
      continue;
    }

    // Regular paragraph - collect consecutive non-empty lines
    const paragraphLines: string[] = [trimmedLine];
    i++;
    while (i < lines.length) {
      const currentLine = lines[i] ?? '';
      const currentTrimmed = currentLine.trim();
      // Stop at: empty lines, code blocks, headings, blockquotes, lists, HRs, or standalone code spans
      if (
        currentTrimmed === '' ||
        currentTrimmed.startsWith('```') ||
        currentTrimmed.startsWith('#') ||
        currentTrimmed.startsWith('>') ||
        /^[-*+]\s/.test(currentTrimmed) ||
        /^\d+\.\s/.test(currentTrimmed) ||
        /^[-*_]{3,}$/.test(currentTrimmed) ||
        /^`[^`]+`$/.test(currentTrimmed) // Standalone code spans break paragraphs
      ) {
        break;
      }
      paragraphLines.push(currentTrimmed);
      i++;
    }

    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join(' '),
    });
  }

  return blocks;
}

/**
 * Recursively renders list items with their nested children
 */
function ListItemRenderer({
  item,
  ordered: _ordered,
  onFileClick,
}: {
  item: NestedListItem;
  ordered: boolean;
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}) {
  return (
    <li className="leading-relaxed break-words overflow-hidden">
      {parseInlineMarkdown(item.content, onFileClick)}
      {item.children && item.children.length > 0 && (
        <ul className="pl-4 mt-1 space-y-1 list-disc">
          {item.children.map((child, childIndex) => (
            <ListItemRenderer
              key={childIndex}
              item={child}
              ordered={false}
              onFileClick={onFileClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Map common language aliases to syntax highlighter language names
 */
const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  htm: 'html',
  rs: 'rust',
  golang: 'go',
  text: 'text',
};

/**
 * Copy button component for code blocks
 */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'flex items-center gap-1 px-2 py-1 text-xs rounded transition-all',
        'bg-surface-elevated/80 hover:bg-surface-elevated',
        'text-text-muted hover:text-text-primary',
        'border border-border-subtle hover:border-border-default',
        copied && 'text-green-400 border-green-400/50'
      )}
      title={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <>
          <Check size={12} />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy size={12} />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

/**
 * Save-to-file button and modal for code blocks
 */
function SaveToFileButton({ content, language }: { content: string; language: string }) {
  const currentSessionId = useSessionStore((s) => s.currentSessionId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const suggestedPath = useMemo(() => {
    const lang = (language || 'text').toLowerCase();
    const extMap: Record<string, string> = {
      typescript: 'ts',
      ts: 'ts',
      tsx: 'tsx',
      javascript: 'js',
      js: 'js',
      jsx: 'jsx',
      python: 'py',
      py: 'py',
      bash: 'sh',
      sh: 'sh',
      shell: 'sh',
      json: 'json',
      yaml: 'yml',
      yml: 'yml',
      markdown: 'md',
      md: 'md',
      html: 'html',
      css: 'css',
      sql: 'sql',
      rust: 'rs',
      rs: 'rs',
      go: 'go',
      golang: 'go',
      text: 'txt',
    };

    const ext = extMap[lang] || 'txt';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `snippets/snippet-${timestamp}.${ext}`;
  }, [language]);

  const handleOpenDialog = useCallback(() => {
    if (!currentSessionId) {
      console.warn('No active session; cannot save code to file.');
      return;
    }
    setIsDialogOpen(true);
  }, [currentSessionId]);

  const handleConfirm = useCallback(
    async (path: string) => {
      if (!currentSessionId) {
        console.warn('No active session; cannot save code to file.');
        return;
      }

      setIsSaving(true);
      try {
        await createFile(currentSessionId, path, content);
      } catch (error) {
        console.error('Failed to save code to file:', error);
      } finally {
        setIsSaving(false);
        setIsDialogOpen(false);
      }
    },
    [content, currentSessionId]
  );

  return (
    <>
      <button
        onClick={handleOpenDialog}
        disabled={!currentSessionId || isSaving}
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs rounded transition-all',
          'bg-surface-elevated/80 hover:bg-surface-elevated',
          'text-text-muted hover:text-text-primary',
          'border border-border-subtle hover:border-border-default',
          (!currentSessionId || isSaving) && 'opacity-60 cursor-not-allowed'
        )}
        title={
          currentSessionId
            ? isSaving
              ? 'Saving...'
              : 'Save code to workspace file'
            : 'Open a session to enable saving'
        }
      >
        <Save size={12} />
        <span>{isSaving ? 'Saving...' : 'Save'}</span>
      </button>

      <PromptDialog
        isOpen={isDialogOpen}
        title="Save code to file"
        message="Enter the file path in your workspace where this code should be saved."
        defaultValue={suggestedPath}
        placeholder="src/snippets/snippet.ts"
        onConfirm={handleConfirm}
        onCancel={() => setIsDialogOpen(false)}
      />
    </>
  );
}

/**
 * Renders a code block with syntax highlighting and copy buttons
 * Uses lazy-loaded syntax highlighter for better performance
 */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'powershell', 'cmd']);

const CodeBlock = memo(function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const normalizedLang = LANGUAGE_MAP[language.toLowerCase()] || language.toLowerCase();
  const lineCount = content.split('\n').length;
  const [isLoaded, setIsLoaded] = useState(
    SyntaxHighlighterComponent !== null && oneDarkTheme !== null
  );

  // Check if this is a shell/terminal language
  const isShellLanguage =
    SHELL_LANGUAGES.has(normalizedLang) || SHELL_LANGUAGES.has(language.toLowerCase());

  // Load syntax highlighter on mount if not already loaded
  useEffect(() => {
    if (!isLoaded) {
      loadSyntaxHighlighter().then(() => setIsLoaded(true));
    }
  }, [isLoaded]);

  // Custom style overrides to match the app theme
  const customStyle: React.CSSProperties = useMemo(
    () => ({
      margin: 0,
      padding: '0.75rem',
      fontSize: '0.75rem',
      lineHeight: '1.625',
      borderRadius: 0,
      background: 'transparent',
    }),
    []
  );

  const lineNumberStyle = useMemo(
    () => ({
      minWidth: '2.5em',
      paddingRight: '1em',
      color: 'rgb(var(--text-muted))',
      userSelect: 'none' as const,
    }),
    []
  );

  const isPlainText = normalizedLang === 'text';

  // Simpler rendering for plain text blocks
  if (isPlainText) {
    return (
      <div className="relative group my-2 rounded-md overflow-hidden bg-surface-elevated/30 border border-border-subtle">
        <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border-subtle/50">
          <CopyButton content={content} />
          <SaveToFileButton content={content} language={language} />
        </div>
        <pre className="p-3 overflow-x-auto text-sm font-mono leading-relaxed">
          <code className="text-text-secondary whitespace-pre-wrap break-words">{content}</code>
        </pre>
      </div>
    );
  }

  // Terminal-style rendering for shell languages
  if (isShellLanguage) {
    return (
      <div className="relative group my-2 rounded-lg overflow-hidden bg-[#1a1b26] border border-[#2a2b3d]">
        {/* macOS-style terminal header */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#16161e] border-b border-[#2a2b3d]">
          <div className="flex items-center gap-3">
            {/* Traffic light dots */}
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56] opacity-80" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e] opacity-80" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f] opacity-80" />
            </div>
            <div className="flex items-center gap-1.5 text-[#787c99]">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{language}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton content={content} />
            <SaveToFileButton content={content} language={language} />
          </div>
        </div>

        {/* Terminal content with $ prompt */}
        <div className="p-3 overflow-x-auto">
          <pre className="text-xs font-mono leading-relaxed">
            {content.split('\n').map((line, i) => (
              <div key={i} className="flex">
                <span className="text-[#7aa2f7] select-none mr-2 shrink-0">$</span>
                <code className="text-[#a9b1d6] whitespace-pre-wrap break-all">{line}</code>
              </div>
            ))}
          </pre>
        </div>

        {/* Bottom copy/save buttons - only show for longer code blocks */}
        {lineCount > 15 && (
          <div className="flex justify-end px-3 py-1.5 bg-[#16161e] border-t border-[#2a2b3d]">
            <div className="flex items-center gap-2">
              <CopyButton content={content} />
              <SaveToFileButton content={content} language={language} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative group my-2 rounded-md overflow-hidden bg-void/80">
      {/* Header with language and top copy button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-void/90 border-b border-border-subtle">
        <span className="text-xs text-text-muted font-medium">{language}</span>
        <div className="flex items-center gap-2">
          <CopyButton content={content} />
          <SaveToFileButton content={content} language={language} />
        </div>
      </div>

      {/* Code content with syntax highlighting */}
      {isLoaded && SyntaxHighlighterComponent && oneDarkTheme ? (
        <SyntaxHighlighterComponent
          language={normalizedLang}
          style={oneDarkTheme}
          customStyle={customStyle}
          wrapLongLines
          showLineNumbers={lineCount > 5}
          lineNumberStyle={lineNumberStyle}
        >
          {content}
        </SyntaxHighlighterComponent>
      ) : (
        // Fallback while syntax highlighter is loading
        <div className="p-3">
          <div className="flex items-center gap-2 text-text-muted text-xs mb-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Loading syntax highlighter...</span>
          </div>
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap">{content}</pre>
        </div>
      )}

      {/* Bottom copy/save buttons - only show for longer code blocks */}
      {lineCount > 15 && (
        <div className="flex justify-end px-3 py-1.5 bg-void/90 border-t border-border-subtle">
          <div className="flex items-center gap-2">
            <CopyButton content={content} />
            <SaveToFileButton content={content} language={language} />
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Renders a tool/function call block with special formatting
 */
function ToolCallBlock({ content, language }: { content: string; language: string }) {
  // Try to parse and pretty-print the JSON
  let parsedContent = content;
  let toolName = 'Tool Call';

  try {
    const parsed = JSON.parse(content);
    toolName = parsed.function_name || parsed.tool_name || parsed.name || 'Tool Call';
    parsedContent = JSON.stringify(parsed, null, 2);
  } catch {
    // Keep original if not valid JSON
  }

  return (
    <div className="my-2 rounded-md border border-accent-primary/30 bg-accent-primary/5 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-primary/10 border-b border-accent-primary/20">
        <div className="h-2 w-2 rounded-full bg-accent-primary animate-pulse" />
        <span className="text-xs font-medium text-accent-primary">{toolName}</span>
        <span className="text-xs text-text-muted ml-auto">{language}</span>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed">
        <code className="text-text-secondary whitespace-pre-wrap break-words">{parsedContent}</code>
      </pre>
    </div>
  );
}

/**
 * Main Markdown Renderer Component.
 * Memoized to prevent re-parsing unchanged content.
 */
export const MarkdownRenderer = React.memo<MarkdownRendererProps>(function MarkdownRenderer({
  content,
  className,
  onFileClick,
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={cn('markdown-content space-y-2 overflow-hidden', className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const level = block.level ?? 1;
            const headingSizes: Record<number, string> = {
              1: 'text-lg font-bold',
              2: 'text-base font-bold',
              3: 'text-sm font-semibold',
              4: 'text-sm font-medium',
              5: 'text-xs font-medium',
              6: 'text-xs font-medium text-text-secondary',
            };
            const HeadingElement = ({ children }: { children: React.ReactNode }) => {
              const className = cn(
                headingSizes[level],
                'mt-3 first:mt-0 break-words overflow-hidden'
              );
              switch (level) {
                case 1:
                  return <h1 className={className}>{children}</h1>;
                case 2:
                  return <h2 className={className}>{children}</h2>;
                case 3:
                  return <h3 className={className}>{children}</h3>;
                case 4:
                  return <h4 className={className}>{children}</h4>;
                case 5:
                  return <h5 className={className}>{children}</h5>;
                default:
                  return <h6 className={className}>{children}</h6>;
              }
            };
            return (
              <HeadingElement key={index}>
                {parseInlineMarkdown(block.content, onFileClick)}
              </HeadingElement>
            );
          }

          case 'paragraph':
            return (
              <p key={index} className="leading-relaxed break-words overflow-hidden">
                {parseInlineMarkdown(block.content, onFileClick)}
              </p>
            );

          case 'code':
            return (
              <CodeBlock key={index} content={block.content} language={block.language || 'text'} />
            );

          case 'tool_call':
            return (
              <ToolCallBlock
                key={index}
                content={block.content}
                language={block.language || 'json'}
              />
            );

          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            // Use nestedItems for proper nested list rendering, fall back to flat items
            const itemsToRender = block.nestedItems || block.items?.map((content) => ({ content }));
            return (
              <ListTag
                key={index}
                className={cn('pl-4 space-y-1', block.ordered ? 'list-decimal' : 'list-disc')}
              >
                {itemsToRender?.map((item, itemIndex) => (
                  <ListItemRenderer
                    key={itemIndex}
                    item={typeof item === 'string' ? { content: item } : item}
                    ordered={block.ordered || false}
                    onFileClick={onFileClick}
                  />
                ))}
              </ListTag>
            );
          }

          case 'blockquote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-accent-primary/50 pl-3 py-1 italic text-text-secondary break-words overflow-hidden"
              >
                {parseInlineMarkdown(block.content, onFileClick)}
              </blockquote>
            );

          case 'table': {
            if (!block.tableData) return null;
            const { headers, rows, alignments } = block.tableData;
            const getAlignClass = (align: 'left' | 'center' | 'right' | undefined) => {
              switch (align) {
                case 'center':
                  return 'text-center';
                case 'right':
                  return 'text-right';
                default:
                  return 'text-left';
              }
            };
            return (
              <div key={index} className="my-2 overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      {headers.map((header, colIndex) => (
                        <th
                          key={colIndex}
                          className={cn(
                            'px-3 py-2 font-semibold text-text-primary bg-surface-elevated/50',
                            getAlignClass(alignments[colIndex]),
                            'break-words'
                          )}
                        >
                          {parseInlineMarkdown(header.content, onFileClick)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr
                        key={rowIndex}
                        className={cn(
                          'border-b border-border-subtle',
                          rowIndex % 2 === 1 && 'bg-surface-elevated/20'
                        )}
                      >
                        {row.map((cell, colIndex) => (
                          <td
                            key={colIndex}
                            className={cn(
                              'px-3 py-2 text-text-secondary',
                              getAlignClass(alignments[colIndex]),
                              'break-words'
                            )}
                          >
                            {parseInlineMarkdown(cell.content, onFileClick)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case 'hr':
            return <hr key={index} className="border-border-subtle my-3" />;

          default:
            return null;
        }
      })}
    </div>
  );
});
