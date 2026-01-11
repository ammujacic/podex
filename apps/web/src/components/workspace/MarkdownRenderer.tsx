'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

interface NestedListItem {
  content: string;
  children?: NestedListItem[];
}

interface ParsedBlock {
  type: 'paragraph' | 'code' | 'heading' | 'list' | 'blockquote' | 'hr' | 'tool_call';
  content: string;
  language?: string;
  level?: number;
  ordered?: boolean;
  items?: string[];
  nestedItems?: NestedListItem[];
}

/**
 * Parses inline markdown elements (bold, italic, code, links)
 */
function parseInlineMarkdown(text: string): React.ReactNode[] {
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
          className="rounded bg-void/50 px-1.5 py-0.5 text-xs font-mono text-accent-primary"
        >
          {match}
        </code>
      ),
    },
    // Bold with asterisks
    {
      regex: /\*\*([^*]+)\*\*/,
      render: (match: string) => (
        <strong key={key++} className="font-semibold">
          {match}
        </strong>
      ),
    },
    // Bold with underscores - use lookbehind/lookahead to avoid snake_case
    {
      regex: /(?<![a-zA-Z0-9])__([^_]+)__(?![a-zA-Z0-9])/,
      render: (match: string) => (
        <strong key={key++} className="font-semibold">
          {match}
        </strong>
      ),
    },
    // Italic with asterisks
    {
      regex: /\*([^*]+)\*/,
      render: (match: string) => (
        <em key={key++} className="italic">
          {match}
        </em>
      ),
    },
    // Italic with underscores - use lookbehind/lookahead to avoid matching snake_case
    // e.g. _italic_ matches, but create_execution_plan does not
    {
      regex: /(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/,
      render: (match: string) => (
        <em key={key++} className="italic">
          {match}
        </em>
      ),
    },
    // Links
    {
      regex: /\[([^\]]+)\]\(([^)]+)\)/,
      render: (_text: string, url: string) => (
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-primary hover:underline"
        >
          {_text}
        </a>
      ),
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

    // Regular paragraph - collect consecutive non-empty lines
    const paragraphLines: string[] = [trimmedLine];
    i++;
    while (i < lines.length) {
      const currentLine = lines[i] ?? '';
      const currentTrimmed = currentLine.trim();
      if (
        currentTrimmed === '' ||
        currentTrimmed.startsWith('```') ||
        currentTrimmed.startsWith('#') ||
        currentTrimmed.startsWith('>') ||
        /^[-*+]\s/.test(currentTrimmed) ||
        /^\d+\.\s/.test(currentTrimmed) ||
        /^[-*_]{3,}$/.test(currentTrimmed)
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
function ListItemRenderer({ item, ordered: _ordered }: { item: NestedListItem; ordered: boolean }) {
  return (
    <li className="leading-relaxed">
      {parseInlineMarkdown(item.content)}
      {item.children && item.children.length > 0 && (
        <ul className="pl-4 mt-1 space-y-1 list-disc">
          {item.children.map((child, childIndex) => (
            <ListItemRenderer key={childIndex} item={child} ordered={false} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Renders a code block with syntax highlighting hints
 */
function CodeBlock({ content, language }: { content: string; language: string }) {
  return (
    <div className="relative group my-2">
      <div className="absolute right-2 top-2 text-xs text-text-muted opacity-60 group-hover:opacity-100 transition-opacity">
        {language}
      </div>
      <pre className="rounded-md bg-void/80 p-3 overflow-x-auto text-xs font-mono leading-relaxed">
        <code className="text-text-secondary whitespace-pre-wrap break-words">{content}</code>
      </pre>
    </div>
  );
}

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
 * Main Markdown Renderer Component
 */
export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={cn('markdown-content space-y-2', className)}>
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
              const props = { key: index, className: cn(headingSizes[level], 'mt-3 first:mt-0') };
              switch (level) {
                case 1:
                  return <h1 {...props}>{children}</h1>;
                case 2:
                  return <h2 {...props}>{children}</h2>;
                case 3:
                  return <h3 {...props}>{children}</h3>;
                case 4:
                  return <h4 {...props}>{children}</h4>;
                case 5:
                  return <h5 {...props}>{children}</h5>;
                default:
                  return <h6 {...props}>{children}</h6>;
              }
            };
            return (
              <HeadingElement key={index}>{parseInlineMarkdown(block.content)}</HeadingElement>
            );
          }

          case 'paragraph':
            return (
              <p key={index} className="leading-relaxed">
                {parseInlineMarkdown(block.content)}
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
                  />
                ))}
              </ListTag>
            );
          }

          case 'blockquote':
            return (
              <blockquote
                key={index}
                className="border-l-2 border-accent-primary/50 pl-3 py-1 italic text-text-secondary"
              >
                {parseInlineMarkdown(block.content)}
              </blockquote>
            );

          case 'hr':
            return <hr key={index} className="border-border-subtle my-3" />;

          default:
            return null;
        }
      })}
    </div>
  );
}
