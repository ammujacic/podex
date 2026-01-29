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
export { DiagnosticsSidebarPanel } from './DiagnosticsSidebarPanel';
export { UsageSidebarPanel } from './UsageSidebarPanel';
export { NotificationsSidebarPanel } from './NotificationsSidebarPanel';
export { PresenceSidebarPanel } from './PresenceSidebarPanel';

// Editor components
export { CodeEditor } from './CodeEditor';
export { FilePreviewCard } from './FilePreviewCard';
export { FilePreviewLayer } from './FilePreviewLayer';
export { PreviewPanel } from './PreviewPanel';
export { TerminalPanel } from './TerminalPanel';

// Agent components
export { AgentCard } from './AgentCard';
export { AgentGrid } from './AgentGrid';
export { AgentModeSelector } from './AgentModeSelector';
export { ApprovalDialog } from './ApprovalDialog';
export { PlanApprovalActions } from './PlanApprovalActions';
export { MarkdownRenderer } from './MarkdownRenderer';

// Context window components
export { ContextUsageRing, ContextUsageBadge } from './ContextUsageRing';
export { CompactionDialog } from './CompactionDialog';

// Checkpoint components
export { CheckpointTimeline, CheckpointTimelineCompact } from './CheckpointTimeline';
export { CheckpointRestoreDialog } from './CheckpointRestoreDialog';

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

export { SymbolOutline, SymbolQuickPick } from './SymbolOutline';
export type { DocumentSymbol, OutlineState } from './SymbolOutline';
export { SymbolKind } from './SymbolOutline';

// Diagnostics
export {
  ProblemsPanel,
  ProblemsStatus,
  useDiagnosticsStore,
  useMonacoDiagnostics,
} from './ProblemsPanel';
export type { Diagnostic, FileDiagnostics } from './ProblemsPanel';
export { DiagnosticSeverity } from './ProblemsPanel';

// Planning components
export { ParallelPlansPanel } from './ParallelPlansPanel';
export { PlanComparisonView } from './PlanComparisonView';

// Parallel agent components
export { ConflictWarningPanel } from './ConflictWarningPanel';
export { ParallelAgentLauncher } from './ParallelAgentLauncher';

// Knowledge & Memory components
export { PodexMdEditor } from './PodexMdEditor';
export { WikiPanel } from './WikiPanel';
export { CodebaseQA } from './CodebaseQA';

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
export { AgentCostBreakdown } from './AgentCostBreakdown';
export { BudgetAlertDialog, AlertBell, AlertList } from './BudgetAlertDialog';
