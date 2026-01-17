'use client';

import { useRef, useEffect, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { cn } from '@/lib/utils';

// Custom dark theme that matches Podex style
const podexTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--accent-primary)',
    padding: '8px 0',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent-primary)',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-overlay)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-overlay)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '40px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--accent-primary-20)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--accent-primary-10)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    WebkitOverflowScrolling: 'touch',
    maxHeight: '100%',
  },
  '&.cm-editor': {
    height: '100%',
    maxHeight: '100%',
  },
});

interface MobileCodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  className?: string;
  placeholder?: string;
}

// Get language extension based on file type or language name
function getLanguageExtension(language?: string): Extension | null {
  if (!language) return null;

  const lang = language.toLowerCase();

  // Handle file extensions
  if (lang.endsWith('.js') || lang.endsWith('.jsx') || lang === 'javascript' || lang === 'js') {
    return javascript({ jsx: true });
  }
  if (lang.endsWith('.ts') || lang.endsWith('.tsx') || lang === 'typescript' || lang === 'ts') {
    return javascript({ jsx: true, typescript: true });
  }
  if (lang.endsWith('.py') || lang === 'python') {
    return python();
  }
  if (lang.endsWith('.css') || lang === 'css') {
    return css();
  }
  if (lang.endsWith('.html') || lang === 'html') {
    return html();
  }
  if (lang.endsWith('.json') || lang === 'json') {
    return json();
  }
  if (lang.endsWith('.md') || lang === 'markdown') {
    return markdown();
  }

  return null;
}

export function MobileCodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  lineNumbers: showLineNumbers = true,
  className,
  placeholder,
}: MobileCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build extensions
    const extensions: Extension[] = [
      podexTheme,
      oneDark,
      syntaxHighlighting(defaultHighlightStyle),
      bracketMatching(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
        if (update.focusChanged) {
          setIsFocused(update.view.hasFocus);
        }
      }),
    ];

    if (showLineNumbers) {
      extensions.push(lineNumbers());
    }

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const langExt = getLanguageExtension(language);
    if (langExt) {
      extensions.push(langExt);
    }

    if (placeholder && !value) {
      extensions.push(EditorView.contentAttributes.of({ 'data-placeholder': placeholder }));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, []); // Only create editor once

  // Update content when value changes externally
  useEffect(() => {
    if (viewRef.current && value !== viewRef.current.state.doc.toString()) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: value,
        },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'mobile-code-editor',
        'rounded-lg border',
        isFocused ? 'border-accent-primary' : 'border-border-subtle',
        'bg-surface',
        'touch-manipulation',
        'overflow-hidden',
        className
      )}
      style={{
        minHeight: '100px',
        display: 'flex',
        flexDirection: 'column',
      }}
    />
  );
}

// Simplified read-only code viewer for mobile
interface MobileCodeViewerProps {
  code: string;
  language?: string;
  className?: string;
  maxLines?: number;
}

export function MobileCodeViewer({
  code,
  language: _language,
  className,
  maxLines,
}: MobileCodeViewerProps) {
  const lines = code.split('\n');
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines;
  const hasMore = maxLines && lines.length > maxLines;

  return (
    <div
      className={cn(
        'rounded-lg border border-border-subtle overflow-hidden',
        'bg-surface',
        className
      )}
    >
      <pre className="p-3 overflow-x-auto text-sm font-mono text-text-primary">
        <code>
          {displayLines.map((line, i) => (
            <div key={i} className="flex">
              <span className="select-none text-text-tertiary w-8 flex-shrink-0 text-right pr-3">
                {i + 1}
              </span>
              <span className="flex-1">{line || ' '}</span>
            </div>
          ))}
          {hasMore && (
            <div className="text-text-tertiary italic mt-2">
              ... {lines.length - maxLines} more lines
            </div>
          )}
        </code>
      </pre>
    </div>
  );
}
