// Workspace layout
export { WorkspaceLayout } from './WorkspaceLayout';
export { SidebarContainer } from './SidebarContainer';
export { WorkspaceHeader } from './WorkspaceHeader';

// Sidebar panels
export { FilesPanel } from './FilesPanel';
export { AgentsPanel } from './AgentsPanel';
export { MCPPanel } from './MCPPanel';
export { ExtensionsPanel } from './ExtensionsPanel';
export { GitPanel } from './GitPanel';
export { SearchPanel, useSearchStore } from './SearchPanel';
export type {
  SearchMatch as SidebarSearchMatch,
  FileSearchResult as SidebarFileSearchResult,
  SearchOptions as SidebarSearchOptions,
} from './SearchPanel';
export { UsageSidebarPanel } from './UsageSidebarPanel';

// Editor components
export { CodeEditor } from './CodeEditor';
export { FilePreviewCard } from './FilePreviewCard';
export { FilePreviewLayer } from './FilePreviewLayer';
export { PreviewPanel } from './PreviewPanel';
export { TerminalPanel } from './TerminalPanel';

// Agent components
export { AgentCard } from './AgentCard';
export { AgentGrid } from './AgentGrid';

// Terminal window components
export { TerminalCard } from './TerminalCard';
export { DraggableTerminalCard } from './DraggableTerminalCard';
export { AgentModeSelector } from './AgentModeSelector';
export { ApprovalDialog } from './ApprovalDialog';
export { PlanApprovalActions } from './PlanApprovalActions';
export { MarkdownRenderer } from './MarkdownRenderer';

// Context window components
export { ContextUsageRing, ContextUsageBadge } from './ContextUsageRing';
export { CompactionDialog } from './CompactionDialog';

// Checkpoint components
export { CheckpointTimeline, CheckpointTimelineCompact } from './CheckpointTimeline';

// Worktree components
export { WorktreeStatus } from './WorktreeStatus';

// Diff/Change review components
export { AggregatedDiffModal } from './AggregatedDiffModal';
export { SplitDiffView, StandaloneSplitDiff } from './SplitDiffView';
export { ReviewChangesButton } from './ReviewChangesButton';
export {
  DiffPreview,
  usePendingChangesStore,
  type FileDiff,
  type DiffHunk,
  type DiffLine,
  type PendingChange,
} from './DiffPreview';

// Subagent components
export { SubagentIndicator, SubagentStatusDots, SubagentStatusList } from './SubagentIndicator';
export { SubagentPanel } from './SubagentPanel';

// Progress tracking components
export { TaskProgressPanel, TaskProgressIndicator, TaskProgressDots } from './TaskProgressPanel';

// Command palette
export { CommandPalette } from './CommandPalette';

// Search and navigation
export { GlobalSearch } from './GlobalSearch';
export type { SearchMatch, FileSearchResult, SearchOptions, SearchState } from './GlobalSearch';

// Visual feedback components
export { ThinkingDisplay } from './ThinkingDisplay';
export { EnhancedToolCallDisplay } from './EnhancedToolCallDisplay';
export { SyntaxHighlightedDiff } from './SyntaxHighlightedDiff';
export {
  FileTreeChangeIndicator,
  ChangeIndicatorBadge,
  InlineChangeIndicator,
} from './FileTreeChangeIndicator';
export type { FileChange, ChangeType } from './FileTreeChangeIndicator';

// Cost & Usage components
export { SessionCostCounter, MiniCostCounter } from './SessionCostCounter';
export { BudgetAlertDialog, AlertBell, AlertList } from './BudgetAlertDialog';
