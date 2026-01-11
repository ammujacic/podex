'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  Send,
  Wand2,
  Bug,
  FileCode,
  TestTube,
  BookOpen,
  Loader2,
  Check,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { editor } from 'monaco-editor';

interface InlineChatProps {
  editor: editor.IStandaloneCodeEditor;
  position: { x: number; y: number; lineNumber: number; column: number };
  selectedText?: string;
  onClose: () => void;
  onApply: (newCode: string) => void;
  sessionId: string;
}

interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  prompt: string;
}

const quickActions: QuickAction[] = [
  {
    id: 'explain',
    label: 'Explain',
    icon: <BookOpen className="h-3.5 w-3.5" />,
    prompt: 'Explain this code in detail',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: <Wand2 className="h-3.5 w-3.5" />,
    prompt: 'Refactor this code to be cleaner and more maintainable',
  },
  {
    id: 'fix',
    label: 'Fix',
    icon: <Bug className="h-3.5 w-3.5" />,
    prompt: 'Fix any bugs or issues in this code',
  },
  {
    id: 'test',
    label: 'Test',
    icon: <TestTube className="h-3.5 w-3.5" />,
    prompt: 'Generate unit tests for this code',
  },
  {
    id: 'doc',
    label: 'Document',
    icon: <FileCode className="h-3.5 w-3.5" />,
    prompt: 'Add documentation and comments to this code',
  },
];

type ChatState = 'idle' | 'loading' | 'streaming' | 'complete' | 'error';

export function InlineChat({
  editor,
  position,
  selectedText,
  onClose,
  onApply,
  sessionId,
}: InlineChatProps) {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [state, setState] = useState<ChatState>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Delay to prevent immediate close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Get context from editor
  const getContext = useCallback(() => {
    const model = editor.getModel();
    if (!model) return { code: '', language: '', filePath: '' };

    const selection = editor.getSelection();
    let code = selectedText || '';

    if (!code && selection) {
      code = model.getValueInRange(selection);
    }

    // If no selection, get current function/block
    if (!code) {
      const lineContent = model.getLineContent(position.lineNumber);
      code = lineContent;
    }

    return {
      code,
      language: model.getLanguageId(),
      filePath: model.uri.path,
    };
  }, [editor, position, selectedText]);

  // Send message to AI
  const sendMessage = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return;

      setState('loading');
      setError(null);
      setResponse('');

      const context = getContext();

      try {
        const response = await fetch('/api/inline-chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session_id: sessionId,
            prompt,
            code: context.code,
            language: context.language,
            file_path: context.filePath,
            line_number: position.lineNumber,
          }),
        });

        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        // Handle streaming response
        if (response.body) {
          setState('streaming');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            setResponse((prev) => prev + chunk);
          }
        } else {
          const data = await response.json();
          setResponse(data.response || data.code || '');
        }

        setState('complete');
      } catch (err) {
        console.error('Inline chat error:', err);
        setError(err instanceof Error ? err.message : 'Failed to get response');
        setState('error');
      }
    },
    [getContext, position, sessionId]
  );

  // Handle quick action
  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      setInput(action.prompt);
      sendMessage(action.prompt);
    },
    [sendMessage]
  );

  // Handle submit
  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (input.trim()) {
        sendMessage(input);
      }
    },
    [input, sendMessage]
  );

  // Handle apply
  const handleApply = useCallback(() => {
    if (response) {
      // Extract code from response if it contains markdown code blocks
      let codeToApply = response;
      const codeBlockMatch = response.match(/```[\w]*\n?([\s\S]*?)```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        codeToApply = codeBlockMatch[1].trim();
      }
      onApply(codeToApply);
    }
  }, [response, onApply]);

  // Handle key press in input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-[450px] rounded-lg border border-border-default bg-surface shadow-2xl overflow-hidden"
      style={{
        left: Math.min(position.x, window.innerWidth - 470),
        top: Math.min(position.y, window.innerHeight - 400),
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Inline Chat</span>
          {selectedText && (
            <span className="text-xs text-text-muted">({selectedText.length} chars selected)</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Quick actions */}
      {state === 'idle' && (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border-subtle">
          {quickActions.map((action) => (
            <button
              key={action.id}
              onClick={() => handleQuickAction(action)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
                'bg-elevated hover:bg-overlay text-text-secondary hover:text-text-primary',
                'transition-colors'
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Response area */}
      {(state === 'loading' || state === 'streaming' || state === 'complete') && (
        <div className="max-h-[200px] overflow-y-auto px-3 py-2 border-b border-border-subtle">
          {state === 'loading' && (
            <div className="flex items-center gap-2 text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          )}
          {(state === 'streaming' || state === 'complete') && (
            <div className="text-sm text-text-secondary whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {response}
              {state === 'streaming' && (
                <span className="inline-block w-1.5 h-4 bg-accent-primary animate-pulse ml-0.5" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="px-3 py-2 border-b border-border-subtle">
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Actions for complete state */}
      {state === 'complete' && response && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-border-subtle bg-elevated/50">
          <button
            onClick={() => {
              setState('idle');
              setResponse('');
              setInput('');
            }}
            className="px-3 py-1.5 text-xs rounded bg-overlay hover:bg-elevated text-text-secondary hover:text-text-primary"
          >
            Retry
          </button>
          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-primary hover:bg-accent-primary/90 text-void font-medium"
          >
            <Check className="h-3.5 w-3.5" />
            Apply
          </button>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or describe what you want..."
            rows={2}
            disabled={state === 'loading' || state === 'streaming'}
            className={cn(
              'flex-1 resize-none rounded-lg border border-border-subtle bg-elevated px-3 py-2',
              'text-sm text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:ring-1 focus:ring-accent-primary',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
          <button
            type="submit"
            disabled={!input.trim() || state === 'loading' || state === 'streaming'}
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-lg',
              'bg-accent-primary hover:bg-accent-primary/90 text-void',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'transition-colors'
            )}
          >
            {state === 'loading' || state === 'streaming' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-text-muted">
          <span>
            <kbd className="rounded bg-elevated px-1">Enter</kbd> to send,{' '}
            <kbd className="rounded bg-elevated px-1">Shift+Enter</kbd> for newline
          </span>
          <span>
            <kbd className="rounded bg-elevated px-1">Esc</kbd> to close
          </span>
        </div>
      </form>
    </div>
  );
}

// Hook to manage inline chat state
export function useInlineChat(editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0, lineNumber: 1, column: 1 });
  const [selectedText, setSelectedText] = useState<string | undefined>();

  const openChat = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;

    const selection = ed.getSelection();
    const domNode = ed.getDomNode();
    if (!domNode) return;

    // Get cursor position in pixels
    const cursorPos = ed.getPosition();
    if (!cursorPos) return;

    const scrollTop = ed.getScrollTop();
    const lineHeightOption = ed.getOption(66); // LineHeight option
    const lineHeight = typeof lineHeightOption === 'number' ? lineHeightOption : 18;

    // Calculate position
    const editorRect = domNode.getBoundingClientRect();
    const x = editorRect.left + 50; // Fixed offset from left
    const y = editorRect.top + cursorPos.lineNumber * lineHeight - scrollTop + 20;

    // Get selected text
    let selected: string | undefined;
    if (selection && !selection.isEmpty()) {
      const model = ed.getModel();
      if (model) {
        selected = model.getValueInRange(selection);
      }
    }

    setPosition({
      x: Math.max(10, x),
      y: Math.max(10, Math.min(y, window.innerHeight - 300)),
      lineNumber: cursorPos.lineNumber,
      column: cursorPos.column,
    });
    setSelectedText(selected);
    setIsOpen(true);
  }, [editorRef]);

  const closeChat = useCallback(() => {
    setIsOpen(false);
    // Refocus editor
    editorRef.current?.focus();
  }, [editorRef]);

  const applyCode = useCallback(
    (newCode: string) => {
      const ed = editorRef.current;
      if (!ed) return;

      const selection = ed.getSelection();
      if (selection && !selection.isEmpty()) {
        // Replace selection
        ed.executeEdits('inline-chat', [
          {
            range: selection,
            text: newCode,
          },
        ]);
      } else {
        // Insert at cursor
        const pos = ed.getPosition();
        if (pos) {
          ed.executeEdits('inline-chat', [
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text: newCode,
            },
          ]);
        }
      }

      closeChat();
    },
    [editorRef, closeChat]
  );

  return {
    isOpen,
    position,
    selectedText,
    openChat,
    closeChat,
    applyCode,
  };
}
