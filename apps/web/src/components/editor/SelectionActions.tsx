'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Wand2, Bug, FileCode, TestTube, BookOpen, Copy, Scissors, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateBoundedPosition } from '@/lib/ui-utils';
import type { editor } from '@codingame/monaco-vscode-editor-api';

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
  onAIAction: (prompt: string, selectedText: string) => void;
}

export function SelectionActions({ editor, onAIAction }: SelectionActionsProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to update selection text and position, used by both selection
  // changes and explicit context menu (right click).
  const showForCurrentSelectionAt = useCallback(
    (clientX?: number, clientY?: number) => {
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

      const domNode = editor.getDomNode();
      if (!domNode) return;

      const editorRect = domNode.getBoundingClientRect();

      let x: number;
      let y: number;

      if (typeof clientX === 'number' && typeof clientY === 'number') {
        // Position at the mouse cursor (right click).
        x = clientX;
        y = clientY;
      } else {
        // Fallback: position just under the selection, similar to the
        // original behaviour in updatePosition.
        const endPosition = selection.getEndPosition();
        const scrollTop = editor.getScrollTop();
        const top = editor.getTopForLineNumber(endPosition.lineNumber) - scrollTop;
        const lineHeightOption = editor.getOption(66); // LineHeight
        const lineHeight = typeof lineHeightOption === 'number' ? lineHeightOption : 18;

        x = editorRect.left + 60; // Fixed offset from left edge
        y = editorRect.top + top + lineHeight + 5;
      }

      const boundedPos = calculateBoundedPosition(x, y, 200, 350);
      setPosition(boundedPos);

      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setVisible(true);
      }, 300);
    },
    [editor]
  );

  // Update position based on selection
  const updatePosition = useCallback(() => {
    showForCurrentSelectionAt();
  }, [showForCurrentSelectionAt]);

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

  // Also show the menu when the user right-clicks inside an existing
  // non-empty selection. Monaco suppresses the native browser menu, so
  // we hook into its context menu event to show our selection actions.
  useEffect(() => {
    const disposable = editor.onContextMenu((e) => {
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return;

      const model = editor.getModel();
      if (!model) return;

      const text = model.getValueInRange(selection);
      if (!text.trim()) return;

      const browserEvent = (e.event as { browserEvent?: MouseEvent }).browserEvent;
      const clientX = browserEvent?.clientX;
      const clientY = browserEvent?.clientY;

      // Position the menu at the cursor if possible.
      showForCurrentSelectionAt(clientX, clientY);

      // Prevent any underlying default context menu.
      if (browserEvent) {
        browserEvent.preventDefault();
        browserEvent.stopPropagation();
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [editor, showForCurrentSelectionAt]);

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
          if (action.aiPrompt) {
            onAIAction(action.aiPrompt, selectedText);
          }
          break;
      }

      // Refocus editor
      editor.focus();
    },
    [editor, selectedText, onAIAction]
  );

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 min-w-[160px] rounded-lg border border-border-default bg-surface shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="Selection actions"
    >
      <div className="py-1" role="group">
        {actions.map((action, index) => {
          if (action.id === 'divider') {
            return <div key={index} className="h-px bg-border-subtle my-1 mx-2" role="separator" />;
          }

          return (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm min-h-[36px]',
                'text-text-secondary hover:bg-overlay hover:text-text-primary',
                'transition-colors focus:outline-none focus:bg-overlay focus:text-text-primary'
              )}
              role="menuitem"
              aria-keyshortcuts={action.shortcut?.replace('⌘', 'Meta+').replace('⇧', 'Shift+')}
            >
              <span className="text-text-muted" aria-hidden="true">
                {action.icon}
              </span>
              <span className="flex-1">{action.label}</span>
              {action.shortcut && (
                <span className="text-xs text-text-muted" aria-hidden="true">
                  {action.shortcut}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection info */}
      <div
        className="border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted flex items-center gap-1"
        role="status"
      >
        <span>{selectedText.split('\n').length} lines</span>
        <span className="text-border-subtle" aria-hidden="true">
          •
        </span>
        <span>{selectedText.length} chars</span>
      </div>
    </div>
  );
}
