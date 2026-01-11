'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Wand2,
  Bug,
  FileCode,
  TestTube,
  BookOpen,
  MessageSquare,
  Copy,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { editor } from 'monaco-editor';

interface SelectionAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: 'copy' | 'cut' | 'ai-action';
  aiPrompt?: string;
}

const actions: SelectionAction[] = [
  {
    id: 'explain',
    label: 'Explain',
    icon: <BookOpen className="h-3.5 w-3.5" />,
    shortcut: '⌘K E',
    action: 'ai-action',
    aiPrompt: 'Explain this code in detail',
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: <Wand2 className="h-3.5 w-3.5" />,
    shortcut: '⌘K R',
    action: 'ai-action',
    aiPrompt: 'Refactor this code to be cleaner',
  },
  {
    id: 'fix',
    label: 'Fix Issues',
    icon: <Bug className="h-3.5 w-3.5" />,
    shortcut: '⌘K F',
    action: 'ai-action',
    aiPrompt: 'Fix any bugs in this code',
  },
  {
    id: 'optimize',
    label: 'Optimize',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    action: 'ai-action',
    aiPrompt: 'Optimize this code for better performance',
  },
  {
    id: 'test',
    label: 'Generate Tests',
    icon: <TestTube className="h-3.5 w-3.5" />,
    shortcut: '⌘K T',
    action: 'ai-action',
    aiPrompt: 'Generate unit tests for this code',
  },
  {
    id: 'document',
    label: 'Add Docs',
    icon: <FileCode className="h-3.5 w-3.5" />,
    shortcut: '⌘K D',
    action: 'ai-action',
    aiPrompt: 'Add documentation comments to this code',
  },
  {
    id: 'chat',
    label: 'Ask AI',
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    shortcut: '⌘I',
    action: 'ai-action',
  },
  {
    id: 'divider',
    label: '',
    icon: null,
    action: 'copy',
  },
  {
    id: 'copy',
    label: 'Copy',
    icon: <Copy className="h-3.5 w-3.5" />,
    shortcut: '⌘C',
    action: 'copy',
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: <Scissors className="h-3.5 w-3.5" />,
    shortcut: '⌘X',
    action: 'cut',
  },
];

interface SelectionActionsProps {
  editor: editor.IStandaloneCodeEditor;
  onOpenInlineChat: (prompt?: string) => void;
  onAIAction: (prompt: string, selectedText: string) => void;
}

export function SelectionActions({ editor, onOpenInlineChat, onAIAction }: SelectionActionsProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update position based on selection
  const updatePosition = useCallback(() => {
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      setVisible(false);
      return;
    }

    const model = editor.getModel();
    if (!model) return;

    const text = model.getValueInRange(selection);
    if (!text.trim()) {
      setVisible(false);
      return;
    }

    setSelectedText(text);

    // Get the end position of selection for positioning
    const endPosition = selection.getEndPosition();
    const domNode = editor.getDomNode();
    if (!domNode) return;

    // Use Monaco's coordinate conversion
    const scrollTop = editor.getScrollTop();

    // Get top position of selection
    const top = editor.getTopForLineNumber(endPosition.lineNumber) - scrollTop;
    const lineHeightOption = editor.getOption(66); // LineHeight
    const lineHeight = typeof lineHeightOption === 'number' ? lineHeightOption : 18;

    const editorRect = domNode.getBoundingClientRect();
    const x = editorRect.left + 60; // Fixed offset from left edge
    const y = editorRect.top + top + lineHeight + 5;

    setPosition({
      x: Math.min(x, window.innerWidth - 200),
      y: Math.min(y, window.innerHeight - 300),
    });

    // Delay showing to avoid flicker during selection
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, 300);
  }, [editor]);

  // Listen for selection changes
  useEffect(() => {
    const disposable = editor.onDidChangeCursorSelection((e) => {
      // Only show on user-initiated selections, not programmatic ones
      if (e.reason === 0) {
        // Keyboard
        updatePosition();
      } else if (e.reason === 2) {
        // Mouse
        // Wait for mouse up
        const handleMouseUp = () => {
          updatePosition();
          document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mouseup', handleMouseUp);
      } else {
        setVisible(false);
      }
    });

    return () => disposable.dispose();
  }, [editor, updatePosition]);

  // Hide on scroll
  useEffect(() => {
    const disposable = editor.onDidScrollChange(() => {
      setVisible(false);
    });

    return () => disposable.dispose();
  }, [editor]);

  // Hide on content change
  useEffect(() => {
    const disposable = editor.onDidChangeModelContent(() => {
      setVisible(false);
    });

    return () => disposable.dispose();
  }, [editor]);

  // Close when clicking outside
  useEffect(() => {
    if (!visible) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [visible]);

  // Handle action click
  const handleAction = useCallback(
    (action: SelectionAction) => {
      setVisible(false);

      switch (action.action) {
        case 'copy':
          navigator.clipboard.writeText(selectedText);
          break;
        case 'cut': {
          navigator.clipboard.writeText(selectedText);
          const selection = editor.getSelection();
          if (selection) {
            editor.executeEdits('selection-actions', [{ range: selection, text: '' }]);
          }
          break;
        }
        case 'ai-action':
          if (action.id === 'chat') {
            onOpenInlineChat();
          } else if (action.aiPrompt) {
            onAIAction(action.aiPrompt, selectedText);
          }
          break;
      }

      // Refocus editor
      editor.focus();
    },
    [editor, selectedText, onOpenInlineChat, onAIAction]
  );

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-border-default bg-surface shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{ left: position.x, top: position.y }}
    >
      <div className="py-1">
        {actions.map((action, index) => {
          if (action.id === 'divider') {
            return <div key={index} className="h-px bg-border-subtle my-1 mx-2" />;
          }

          return (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm',
                'text-text-secondary hover:bg-overlay hover:text-text-primary',
                'transition-colors'
              )}
            >
              <span className="text-text-muted">{action.icon}</span>
              <span className="flex-1">{action.label}</span>
              {action.shortcut && (
                <span className="text-xs text-text-muted">{action.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection info */}
      <div className="border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted flex items-center gap-1">
        <span>{selectedText.split('\n').length} lines</span>
        <span className="text-border-subtle">•</span>
        <span>{selectedText.length} chars</span>
      </div>
    </div>
  );
}

// Hook to manage selection actions
export function useSelectionActions(
  _editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>,
  _sessionId: string
) {
  const [inlineChatOpen, setInlineChatOpen] = useState(false);
  const [pendingAIAction, setPendingAIAction] = useState<{
    prompt: string;
    text: string;
  } | null>(null);

  const openInlineChat = useCallback((prompt?: string) => {
    setInlineChatOpen(true);
    if (prompt) {
      setPendingAIAction({ prompt, text: '' });
    }
  }, []);

  const closeInlineChat = useCallback(() => {
    setInlineChatOpen(false);
    setPendingAIAction(null);
  }, []);

  const handleAIAction = useCallback((prompt: string, text: string) => {
    // For now, open inline chat with the prompt
    // In the future, this could directly send to the agent
    setInlineChatOpen(true);
    setPendingAIAction({ prompt, text });
  }, []);

  return {
    inlineChatOpen,
    pendingAIAction,
    openInlineChat,
    closeInlineChat,
    handleAIAction,
  };
}
