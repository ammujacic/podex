'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { editor } from 'monaco-editor';

// ============================================================================
// Types
// ============================================================================

export interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor: {
    line: number;
    column: number;
  };
  selection?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
}

export interface CollaborativeCursorsConfig {
  userId: string;
  sessionId: string;
  documentPath: string;
  onCursorUpdate?: (cursor: { line: number; column: number }) => void;
  onSelectionUpdate?: (
    selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null
  ) => void;
}

// ============================================================================
// Collaborator Colors
// ============================================================================

const COLLABORATOR_COLORS = [
  '#00e5ff', // Cyan
  '#a855f7', // Purple
  '#22c55e', // Green
  '#f97316', // Orange
  '#ec4899', // Pink
  '#eab308', // Yellow
  '#3b82f6', // Blue
  '#ef4444', // Red
];

export function getCollaboratorColor(index: number): string {
  return (
    COLLABORATOR_COLORS[index % COLLABORATOR_COLORS.length] ?? COLLABORATOR_COLORS[0] ?? '#00e5ff'
  );
}

// ============================================================================
// Cursor Decoration Styles
// ============================================================================

export const collaborativeCursorStyles = `
  .collaborative-cursor {
    position: relative;
    width: 2px !important;
    animation: cursor-blink 1s ease-in-out infinite;
  }

  @keyframes cursor-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .collaborative-cursor-label {
    position: absolute;
    top: -18px;
    left: 0;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
    z-index: 100;
  }

  .collaborative-selection {
    opacity: 0.2;
  }

  .collaborator-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 8px;
    font-weight: 600;
    color: white;
    margin-left: 2px;
  }
`;

// ============================================================================
// Hook for Collaborative Cursors
// ============================================================================

export function useCollaborativeCursors(
  editorInstance: editor.IStandaloneCodeEditor | null,
  collaborators: Collaborator[],
  config: CollaborativeCursorsConfig
): {
  updateLocalCursor: () => void;
  updateLocalSelection: () => void;
} {
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const localCursorRef = useRef<{ line: number; column: number } | null>(null);

  // Update decorations when collaborators change
  useEffect(() => {
    if (!editorInstance) return;

    // Clear existing decorations
    decorationsRef.current?.clear();

    // Create new decorations for each collaborator
    const decorations: editor.IModelDeltaDecoration[] = [];

    for (const collab of collaborators) {
      // Skip self
      if (collab.id === config.userId) continue;

      // Cursor decoration
      decorations.push({
        range: {
          startLineNumber: collab.cursor.line,
          startColumn: collab.cursor.column,
          endLineNumber: collab.cursor.line,
          endColumn: collab.cursor.column + 1,
        },
        options: {
          className: 'collaborative-cursor',
          beforeContentClassName: `collaborative-cursor-label`,
          stickiness: 1, // NeverGrowsWhenTypingAtEdges
          hoverMessage: { value: `**${collab.name}** is editing here` },
          inlineClassName: undefined,
          afterContentClassName: undefined,
          // Custom styling via CSS variables
        },
      });

      // Selection decoration (if any)
      if (collab.selection) {
        decorations.push({
          range: {
            startLineNumber: collab.selection.startLine,
            startColumn: collab.selection.startColumn,
            endLineNumber: collab.selection.endLine,
            endColumn: collab.selection.endColumn,
          },
          options: {
            className: 'collaborative-selection',
            stickiness: 1,
          },
        });
      }
    }

    decorationsRef.current = editorInstance.createDecorationsCollection(decorations);

    // Inject dynamic styles for each collaborator
    const styleId = 'collaborative-cursor-colors';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    const styles = collaborators
      .filter((c) => c.id !== config.userId)
      .map(
        (c) => `
        .collaborative-cursor-${c.id} { background-color: ${c.color}; }
        .collaborative-cursor-${c.id}::before {
          content: '${c.name}';
          background-color: ${c.color};
          color: white;
        }
        .collaborative-selection-${c.id} { background-color: ${c.color}; }
      `
      )
      .join('\n');

    styleEl.textContent = collaborativeCursorStyles + '\n' + styles;

    return () => {
      decorationsRef.current?.clear();
    };
  }, [editorInstance, collaborators, config.userId]);

  // Update local cursor position
  const updateLocalCursor = useCallback(() => {
    if (!editorInstance) return;

    const position = editorInstance.getPosition();
    if (position) {
      const cursor = {
        line: position.lineNumber,
        column: position.column,
      };
      localCursorRef.current = cursor;
      config.onCursorUpdate?.(cursor);
    }
  }, [editorInstance, config]);

  // Update local selection
  const updateLocalSelection = useCallback(() => {
    if (!editorInstance) return;

    const selection = editorInstance.getSelection();
    if (selection && !selection.isEmpty()) {
      config.onSelectionUpdate?.({
        startLine: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLine: selection.endLineNumber,
        endColumn: selection.endColumn,
      });
    } else {
      config.onSelectionUpdate?.(null);
    }
  }, [editorInstance, config]);

  // Listen to cursor changes
  useEffect(() => {
    if (!editorInstance) return;

    const cursorDisposable = editorInstance.onDidChangeCursorPosition(() => {
      updateLocalCursor();
    });

    const selectionDisposable = editorInstance.onDidChangeCursorSelection(() => {
      updateLocalSelection();
    });

    return () => {
      cursorDisposable.dispose();
      selectionDisposable.dispose();
    };
  }, [editorInstance, updateLocalCursor, updateLocalSelection]);

  return { updateLocalCursor, updateLocalSelection };
}

// ============================================================================
// Collaborator Avatars Component
// ============================================================================

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
  currentUserId: string;
  className?: string;
}

export function CollaboratorAvatars({
  collaborators,
  currentUserId,
  className,
}: CollaboratorAvatarsProps) {
  const others = collaborators.filter((c) => c.id !== currentUserId);

  if (others.length === 0) return null;

  return (
    <div className={`flex items-center gap-1 ${className || ''}`}>
      {others.slice(0, 5).map((collab) => (
        <div
          key={collab.id}
          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: collab.color }}
          title={collab.name}
        >
          {collab.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {others.length > 5 && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-overlay text-xs text-text-secondary">
          +{others.length - 5}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Integration with Yjs Awareness
// ============================================================================

import type { Awareness } from 'y-protocols/awareness';

export function useYjsAwareness(
  awareness: Awareness | null,
  userId: string,
  userName: string,
  userColor: string
): {
  collaborators: Collaborator[];
  updateCursor: (cursor: { line: number; column: number }) => void;
  updateSelection: (
    selection: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null
  ) => void;
} {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  useEffect(() => {
    if (!awareness) return;

    // Set local user info
    awareness.setLocalState({
      user: {
        id: userId,
        name: userName,
        color: userColor,
      },
      cursor: null,
      selection: null,
    });

    // Listen to awareness changes
    const handleChange = () => {
      const states = awareness.getStates();
      const collabs: Collaborator[] = [];

      states.forEach((state, clientId) => {
        if (state.user && state.cursor) {
          collabs.push({
            id: state.user.id || String(clientId),
            name: state.user.name || 'Anonymous',
            color: state.user.color || getCollaboratorColor(clientId),
            cursor: state.cursor,
            selection: state.selection,
          });
        }
      });

      setCollaborators(collabs);
    };

    awareness.on('change', handleChange);
    handleChange(); // Initial state

    return () => {
      awareness.off('change', handleChange);
    };
  }, [awareness, userId, userName, userColor]);

  // Update cursor in awareness
  const updateCursor = useCallback(
    (cursor: { line: number; column: number }) => {
      if (!awareness) return;
      const state = awareness.getLocalState() || {};
      awareness.setLocalState({ ...state, cursor });
    },
    [awareness]
  );

  // Update selection in awareness
  const updateSelection = useCallback(
    (
      selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      } | null
    ) => {
      if (!awareness) return;
      const state = awareness.getLocalState() || {};
      awareness.setLocalState({ ...state, selection });
    },
    [awareness]
  );

  return { collaborators, updateCursor, updateSelection };
}
