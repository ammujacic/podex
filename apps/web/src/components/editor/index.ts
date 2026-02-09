// Main editor components
export { EnhancedCodeEditor, SplitView, LayoutToggle } from './EnhancedCodeEditor';
export { EditorTabs, EditorEmptyState } from './EditorTabs';
export { Breadcrumbs, convertMonacoSymbolKind, useDocumentSymbols } from './Breadcrumbs';
export type { BreadcrumbSymbol, BreadcrumbItem, SymbolKind } from './Breadcrumbs';

// AI Features
export { ExplanationPanel, ExplanationProvider, useExplanation } from './ExplanationPanel';
export type { CodeExplanation } from './ExplanationPanel';

// Collaboration Features
export {
  useCollaborativeCursors,
  useYjsAwareness,
  CollaboratorAvatars,
  collaborativeCursorStyles,
  getCollaboratorColor,
} from './CollaborativeCursors';
export type { Collaborator, CollaborativeCursorsConfig } from './CollaborativeCursors';

export {
  CommentThreadPanel,
  useCommentsStore,
  useCommentGutter,
  commentGutterStyles,
} from './CommentThread';
export type { Comment, CommentThread, CommentGutterProps } from './CommentThread';
