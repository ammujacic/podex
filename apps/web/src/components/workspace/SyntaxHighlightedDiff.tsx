'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface SyntaxHighlightedDiffProps {
  diff: string;
  language?: string;
  className?: string;
  showLineNumbers?: boolean;
  theme?: 'dark' | 'light';
}

// Token types for syntax highlighting
type TokenType =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'property'
  | 'variable'
  | 'type'
  | 'plain';

interface Token {
  type: TokenType;
  content: string;
}

// Language-specific patterns
const LANGUAGE_PATTERNS: Record<string, Record<TokenType, RegExp>> = {
  javascript: {
    keyword:
      /\b(const|let|var|function|return|if|else|for|while|class|extends|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof)\b/,
    string: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/,
    number: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    function: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/,
    operator: /[+\-*/%=!<>&|^~?:]+/,
    punctuation: /[{}[\](),;.]/,
    property: /(?<=\.)\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/,
    variable: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/,
    type: /\b(string|number|boolean|object|any|void|never|null|undefined)\b/,
    plain: /./,
  },
  python: {
    keyword:
      /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|and|or|not|in|is|lambda|True|False|None|self)\b/,
    string: /(["'])(?:(?!\1)[^\\]|\\.)*\1|"""[\s\S]*?"""|'''[\s\S]*?'''/,
    number: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    comment: /#.*/,
    function: /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/,
    operator: /[+\-*/%=!<>&|^~@]+/,
    punctuation: /[{}[\](),;:]/,
    property: /(?<=\.)\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
    variable: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/,
    type: /\b(int|float|str|bool|list|dict|tuple|set|None)\b/,
    plain: /./,
  },
  typescript: {
    keyword:
      /\b(const|let|var|function|return|if|else|for|while|class|extends|implements|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|interface|type|enum|namespace|abstract|public|private|protected|readonly)\b/,
    string: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/,
    number: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/,
    comment: /\/\/.*$|\/\*[\s\S]*?\*\//,
    function: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\(|<)/,
    operator: /[+\-*/%=!<>&|^~?:]+/,
    punctuation: /[{}[\](),;.]/,
    property: /(?<=\.)\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/,
    variable: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/,
    type: /\b(string|number|boolean|object|any|void|never|null|undefined|Promise|Array|Map|Set|Record)\b/,
    plain: /./,
  },
};

// Fallback patterns
const DEFAULT_PATTERNS = LANGUAGE_PATTERNS.javascript;

export function SyntaxHighlightedDiff({
  diff,
  language = 'javascript',
  className,
  showLineNumbers = true,
  theme = 'dark',
}: SyntaxHighlightedDiffProps) {
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const patterns = (LANGUAGE_PATTERNS[language] ?? DEFAULT_PATTERNS) as Record<TokenType, RegExp>;

  return (
    <div className={cn('font-mono text-sm overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <DiffLineRow
              key={i}
              line={line}
              patterns={patterns}
              showLineNumbers={showLineNumbers}
              theme={theme}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = diff.split('\n');

  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith('@@')) {
      // Parse hunk header
      const match = rawLine.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match && match[1] && match[2]) {
        oldLine = parseInt(match[1], 10) - 1;
        newLine = parseInt(match[2], 10) - 1;
      }
      lines.push({ type: 'header', content: rawLine });
    } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      newLine++;
      lines.push({
        type: 'added',
        content: rawLine.slice(1),
        newLineNumber: newLine,
      });
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      oldLine++;
      lines.push({
        type: 'removed',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
      });
    } else if (rawLine.startsWith(' ')) {
      oldLine++;
      newLine++;
      lines.push({
        type: 'unchanged',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
    } else if (
      rawLine.startsWith('diff ') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('---') ||
      rawLine.startsWith('+++')
    ) {
      lines.push({ type: 'header', content: rawLine });
    }
  }

  return lines;
}

interface DiffLineRowProps {
  line: DiffLine;
  patterns: Record<TokenType, RegExp>;
  showLineNumbers: boolean;
  theme: 'dark' | 'light';
}

function DiffLineRow({ line, patterns, showLineNumbers, theme }: DiffLineRowProps) {
  const bgColor = {
    added: theme === 'dark' ? 'bg-green-500/10' : 'bg-green-100',
    removed: theme === 'dark' ? 'bg-red-500/10' : 'bg-red-100',
    unchanged: '',
    header: theme === 'dark' ? 'bg-blue-500/10' : 'bg-blue-50',
  }[line.type];

  const borderColor = {
    added: 'border-l-2 border-l-green-500',
    removed: 'border-l-2 border-l-red-500',
    unchanged: 'border-l-2 border-l-transparent',
    header: 'border-l-2 border-l-blue-500',
  }[line.type];

  if (line.type === 'header') {
    return (
      <tr className={cn(bgColor, borderColor)}>
        {showLineNumbers && (
          <>
            <td className="w-12 text-right px-2 py-0.5 text-text-muted select-none">...</td>
            <td className="w-12 text-right px-2 py-0.5 text-text-muted select-none">...</td>
          </>
        )}
        <td className="px-2 py-0.5 text-blue-400 italic">{line.content}</td>
      </tr>
    );
  }

  const tokens = tokenize(line.content, patterns);

  return (
    <tr className={cn(bgColor, borderColor, 'hover:bg-white/5')}>
      {showLineNumbers && (
        <>
          <td className="w-12 text-right px-2 py-0.5 text-text-muted select-none text-xs">
            {line.oldLineNumber || ''}
          </td>
          <td className="w-12 text-right px-2 py-0.5 text-text-muted select-none text-xs border-r border-border-subtle">
            {line.newLineNumber || ''}
          </td>
        </>
      )}
      <td className="px-2 py-0.5 whitespace-pre">
        <span
          className={cn(
            'mr-2 select-none',
            line.type === 'added' && 'text-green-500',
            line.type === 'removed' && 'text-red-500'
          )}
        >
          {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
        </span>
        {tokens.map((token, i) => (
          <span key={i} className={getTokenClassName(token.type)}>
            {token.content}
          </span>
        ))}
      </td>
    </tr>
  );
}

function tokenize(code: string, patterns: Record<TokenType, RegExp>): Token[] {
  const tokens: Token[] = [];
  let remaining = code;

  while (remaining.length > 0) {
    let matched = false;

    // Try each pattern in order of priority
    const orderedTypes: TokenType[] = [
      'comment',
      'string',
      'keyword',
      'type',
      'number',
      'function',
      'property',
      'operator',
      'punctuation',
      'variable',
    ];

    for (const type of orderedTypes) {
      const pattern = patterns[type];
      if (!pattern) continue;

      const match = remaining.match(new RegExp(`^${pattern.source}`));
      if (match && match[0]) {
        tokens.push({ type, content: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Handle whitespace or unknown characters
      const wsMatch = remaining.match(/^\s+/);
      if (wsMatch && wsMatch[0]) {
        tokens.push({ type: 'plain', content: wsMatch[0] });
        remaining = remaining.slice(wsMatch[0].length);
      } else {
        tokens.push({ type: 'plain', content: remaining[0] ?? '' });
        remaining = remaining.slice(1);
      }
    }
  }

  return tokens;
}

function getTokenClassName(type: TokenType): string {
  const classes: Record<TokenType, string> = {
    keyword: 'text-purple-400',
    string: 'text-green-400',
    number: 'text-blue-400',
    comment: 'text-gray-500 italic',
    function: 'text-yellow-400',
    operator: 'text-cyan-400',
    punctuation: 'text-gray-400',
    property: 'text-blue-300',
    variable: 'text-text-primary',
    type: 'text-cyan-400',
    plain: '',
  };
  return classes[type] || '';
}

export default SyntaxHighlightedDiff;
