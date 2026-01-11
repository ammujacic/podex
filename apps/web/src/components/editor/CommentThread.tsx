'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Send, MoreHorizontal, Trash2, Edit2, Check, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import type { editor } from 'monaco-editor';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  userColor: string;
  content: string;
  timestamp: Date;
  edited?: boolean;
}

export interface CommentThread {
  id: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
  resolved: boolean;
  comments: Comment[];
  createdAt: Date;
}

// ============================================================================
// Comment Input Component
// ============================================================================

interface CommentInputProps {
  onSubmit: (content: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  initialValue?: string;
  submitLabel?: string;
}

function CommentInput({
  onSubmit,
  onCancel,
  placeholder = 'Add a comment...',
  autoFocus = false,
  initialValue = '',
  submitLabel = 'Comment',
}: CommentInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
  }, [value, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape' && onCancel) {
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-[60px] w-full resize-none rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
        rows={2}
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-overlay"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="flex items-center gap-1.5 rounded bg-accent-primary px-3 py-1.5 text-xs font-medium text-text-inverse hover:bg-accent-primary/90 disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Single Comment Component
// ============================================================================

interface CommentItemProps {
  comment: Comment;
  isOwner: boolean;
  onEdit: (content: string) => void;
  onDelete: () => void;
}

function CommentItem({ comment, isOwner, onEdit, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSaveEdit = useCallback(
    (content: string) => {
      onEdit(content);
      setIsEditing(false);
    },
    [onEdit]
  );

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="group flex gap-3 py-2">
      {/* Avatar */}
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: comment.userColor }}
      >
        {comment.userName.charAt(0).toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{comment.userName}</span>
          <span className="text-xs text-text-muted">
            {formatTime(comment.timestamp)}
            {comment.edited && ' (edited)'}
          </span>

          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="ml-auto rounded p-1 opacity-0 transition-opacity hover:bg-overlay group-hover:opacity-100">
                  <MoreHorizontal className="h-4 w-4 text-text-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditing(true)}>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-accent-error">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {isEditing ? (
          <div className="mt-2">
            <CommentInput
              initialValue={comment.content}
              onSubmit={handleSaveEdit}
              onCancel={() => setIsEditing(false)}
              submitLabel="Save"
              autoFocus
            />
          </div>
        ) : (
          <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap">{comment.content}</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Comment Thread Panel
// ============================================================================

interface CommentThreadPanelProps {
  thread: CommentThread;
  currentUserId: string;
  onAddComment: (threadId: string, content: string) => void;
  onEditComment: (threadId: string, commentId: string, content: string) => void;
  onDeleteComment: (threadId: string, commentId: string) => void;
  onResolve: (threadId: string) => void;
  onClose: () => void;
  className?: string;
}

export function CommentThreadPanel({
  thread,
  currentUserId,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onResolve,
  onClose,
  className,
}: CommentThreadPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={cn('flex w-80 flex-col border-l border-border-default bg-elevated', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Line {thread.lineNumber}</span>
          {thread.resolved && (
            <span className="rounded-full bg-accent-success/20 px-2 py-0.5 text-xs text-accent-success">
              Resolved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!thread.resolved && (
            <button
              onClick={() => onResolve(thread.id)}
              className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-accent-success"
              title="Resolve thread"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Code context */}
      <div className="border-b border-border-subtle bg-surface px-4 py-2">
        <pre className="overflow-x-auto font-mono text-xs text-text-muted">
          <code>{thread.lineContent.trim()}</code>
        </pre>
      </div>

      {/* Comments */}
      <div className="flex-1 overflow-y-auto px-4">
        {thread.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            isOwner={comment.userId === currentUserId}
            onEdit={(content) => onEditComment(thread.id, comment.id, content)}
            onDelete={() => onDeleteComment(thread.id, comment.id)}
          />
        ))}
      </div>

      {/* Add comment */}
      {!thread.resolved && (
        <div className="border-t border-border-subtle p-4">
          <CommentInput
            onSubmit={(content) => onAddComment(thread.id, content)}
            placeholder="Reply..."
          />
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// Comment Gutter Component (for Monaco)
// ============================================================================

export interface CommentGutterProps {
  threads: CommentThread[];
  onThreadClick: (thread: CommentThread) => void;
  onCreateThread: (lineNumber: number) => void;
}

export function useCommentGutter(
  editorInstance: editor.IStandaloneCodeEditor | null,
  threads: CommentThread[]
): editor.IEditorDecorationsCollection | null {
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!editorInstance) return;

    // Clear existing decorations
    decorationsRef.current?.clear();

    // Create decorations for threads
    const decorations = threads.map((thread) => ({
      range: {
        startLineNumber: thread.lineNumber,
        startColumn: 1,
        endLineNumber: thread.lineNumber,
        endColumn: 1,
      },
      options: {
        glyphMarginClassName: thread.resolved
          ? 'comment-glyph comment-glyph-resolved'
          : 'comment-glyph',
        glyphMarginHoverMessage: {
          value: `**${thread.comments.length} comment${thread.comments.length > 1 ? 's' : ''}**\n\n${thread.comments[0]?.content.slice(0, 100) || ''}${(thread.comments[0]?.content.length || 0) > 100 ? '...' : ''}`,
        },
      },
    }));

    decorationsRef.current = editorInstance.createDecorationsCollection(decorations);

    return () => {
      decorationsRef.current?.clear();
    };
  }, [editorInstance, threads]);

  return decorationsRef.current;
}

// ============================================================================
// Comment Gutter Styles
// ============================================================================

export const commentGutterStyles = `
  .comment-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .comment-glyph::before {
    content: '';
    width: 14px;
    height: 14px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2300e5ff' stroke-width='2'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'%3E%3C/path%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }

  .comment-glyph-resolved::before {
    opacity: 0.5;
    filter: grayscale(1);
  }
`;

// ============================================================================
// Comments Store Hook
// ============================================================================

import { create } from 'zustand';

interface CommentsState {
  threads: Record<string, CommentThread[]>; // keyed by filePath
  activeThreadId: string | null;

  addThread: (filePath: string, thread: CommentThread) => void;
  removeThread: (filePath: string, threadId: string) => void;
  addComment: (filePath: string, threadId: string, comment: Comment) => void;
  updateComment: (filePath: string, threadId: string, commentId: string, content: string) => void;
  deleteComment: (filePath: string, threadId: string, commentId: string) => void;
  resolveThread: (filePath: string, threadId: string) => void;
  setActiveThread: (threadId: string | null) => void;
  getThreadsForFile: (filePath: string) => CommentThread[];
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  threads: {},
  activeThreadId: null,

  addThread: (filePath, thread) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: [...(state.threads[filePath] || []), thread],
      },
    })),

  removeThread: (filePath, threadId) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: (state.threads[filePath] || []).filter((t) => t.id !== threadId),
      },
    })),

  addComment: (filePath, threadId, comment) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: (state.threads[filePath] || []).map((t) =>
          t.id === threadId ? { ...t, comments: [...t.comments, comment] } : t
        ),
      },
    })),

  updateComment: (filePath, threadId, commentId, content) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: (state.threads[filePath] || []).map((t) =>
          t.id === threadId
            ? {
                ...t,
                comments: t.comments.map((c) =>
                  c.id === commentId ? { ...c, content, edited: true } : c
                ),
              }
            : t
        ),
      },
    })),

  deleteComment: (filePath, threadId, commentId) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: (state.threads[filePath] || []).map((t) =>
          t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t
        ),
      },
    })),

  resolveThread: (filePath, threadId) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [filePath]: (state.threads[filePath] || []).map((t) =>
          t.id === threadId ? { ...t, resolved: true } : t
        ),
      },
    })),

  setActiveThread: (threadId) => set({ activeThreadId: threadId }),

  getThreadsForFile: (filePath) => get().threads[filePath] || [],
}));
