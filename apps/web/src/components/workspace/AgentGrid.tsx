'use client';

import { useRef, Component, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Plus, AlertTriangle, RefreshCw, FileCode, X, Globe } from 'lucide-react';
import { useSessionStore, type Agent } from '@/stores/session';
import { AgentCard } from './AgentCard';
import { DraggableAgentCard } from './DraggableAgentCard';
import { DraggableEditorCard } from './DraggableEditorCard';
import { DraggablePreviewCard } from './DraggablePreviewCard';
import { ResizableGridCard } from './ResizableGridCard';
import { DockedFilePreviewCard } from './DockedFilePreviewCard';
import { EditorGridCard } from './EditorGridCard';
import { PreviewGridCard } from './PreviewGridCard';
import { PreviewPanel } from './PreviewPanel';
import { GridProvider } from './GridContext';
import { useUIStore } from '@/stores/ui';
import { deleteAgent as deleteAgentApi } from '@/lib/api';

// Dynamic imports to prevent Monaco from loading during SSR
const CodeEditor = dynamic(() => import('./CodeEditor').then((mod) => mod.CodeEditor), {
  ssr: false,
});
const EnhancedCodeEditor = dynamic(
  () => import('@/components/editor/EnhancedCodeEditor').then((mod) => mod.EnhancedCodeEditor),
  { ssr: false }
);

// Error boundary for individual agent cards to prevent one broken card from crashing the entire grid
interface AgentCardErrorBoundaryProps {
  children: ReactNode;
  agentName: string;
  onReset?: () => void;
  onRemove?: () => void;
}

interface AgentCardErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class AgentCardErrorBoundary extends Component<
  AgentCardErrorBoundaryProps,
  AgentCardErrorBoundaryState
> {
  constructor(props: AgentCardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): AgentCardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`Error in agent card "${this.props.agentName}":`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onReset?.();
  };

  handleRemove = () => {
    this.props.onRemove?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative flex flex-col items-center justify-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center min-h-[300px]">
          {/* Close button in top-right corner */}
          {this.props.onRemove && (
            <button
              onClick={this.handleRemove}
              className="absolute top-2 right-2 p-1.5 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Remove agent"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-primary">
              Error in "{this.props.agentName}"
            </p>
            <p className="text-xs text-text-muted max-w-[200px]">
              {this.state.error?.message || 'Something went wrong'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              Try Again
            </button>
            {this.props.onRemove && (
              <button
                onClick={this.handleRemove}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs bg-elevated text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface AgentGridProps {
  sessionId: string;
}

// Demo agents for initial state
const demoAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Architect',
    role: 'architect',
    // Use canonical Opus 4.5 ID
    model: 'claude-opus-4-5',
    status: 'active',
    color: 'agent-1',
    mode: 'auto',
    conversationSessionId: null,
  },
  {
    id: 'agent-2',
    name: 'Frontend Dev',
    role: 'coder',
    // Use canonical Sonnet 4.5 ID
    model: 'claude-sonnet-4-5',
    status: 'active',
    color: 'agent-2',
    mode: 'auto',
    conversationSessionId: null,
  },
  {
    id: 'agent-3',
    name: 'Backend Dev',
    role: 'coder',
    // Use canonical Sonnet 4.5 ID
    model: 'claude-sonnet-4-5',
    status: 'active',
    color: 'agent-3',
    mode: 'auto',
    conversationSessionId: null,
  },
  {
    id: 'agent-4',
    name: 'QA Engineer',
    role: 'tester',
    model: 'gpt-4o',
    status: 'idle',
    color: 'agent-4',
    mode: 'ask',
    conversationSessionId: null,
  },
];

export function AgentGrid({ sessionId }: AgentGridProps) {
  const { sessions, setActiveAgent, closeFilePreview, removeAgent, removeEditorGridCard } =
    useSessionStore();
  const { openModal, gridConfig } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Use demo agents if session doesn't exist yet
  const session = sessions[sessionId];
  // Filter out corrupted agents (missing required fields like color) to prevent render errors
  const rawAgents = session?.agents ?? demoAgents;
  const agents = rawAgents.filter((agent): agent is Agent => {
    if (!agent || typeof agent !== 'object') return false;
    if (!agent.id || !agent.name) return false;
    // Ensure color exists - if missing, auto-fix it
    if (!agent.color) {
      // Silently fix corrupted agent by assigning a default color
      const index = rawAgents.indexOf(agent);
      const defaultColors = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'];
      (agent as Agent).color = defaultColors[index % defaultColors.length] ?? 'agent-1';
    }
    return true;
  });
  const viewMode = session?.viewMode ?? 'grid';
  const activeAgentId = session?.activeAgentId;
  const workspaceId = session?.workspaceId ?? '';
  const filePreviews = session?.filePreviews ?? [];
  const dockedPreviews = filePreviews.filter((p) => p.docked);
  const editorGridCardId = session?.editorGridCardId;
  const previewGridCardId = session?.previewGridCardId;

  const handleAddAgent = () => {
    openModal('create-agent');
  };

  // Remove agent from both backend and frontend
  const handleRemoveAgent = async (agent: Agent) => {
    try {
      // Delete from backend first
      await deleteAgentApi(sessionId, agent.id);
    } catch (err) {
      console.error('Failed to delete agent from backend:', err);
      // Still remove from frontend even if backend fails
    }
    // Remove from local store (and localStorage via persist)
    removeAgent(sessionId, agent.id);
  };

  // Freeform mode: draggable and resizable windows
  if (viewMode === 'freeform') {
    return (
      <div
        ref={containerRef}
        className="h-full relative overflow-hidden bg-background"
        data-tour="agent-grid"
      >
        {agents.map((agent) => {
          return (
            <AgentCardErrorBoundary
              key={agent.id}
              agentName={agent.name}
              onRemove={() => handleRemoveAgent(agent)}
            >
              <DraggableAgentCard agent={agent} sessionId={sessionId} containerRef={containerRef} />
            </AgentCardErrorBoundary>
          );
        })}

        {/* Draggable editor card in freeform mode */}
        {editorGridCardId && (
          <DraggableEditorCard sessionId={sessionId} paneId="main" containerRef={containerRef} />
        )}

        {/* Draggable preview card in freeform mode */}
        {previewGridCardId && workspaceId && (
          <DraggablePreviewCard
            sessionId={sessionId}
            workspaceId={workspaceId}
            containerRef={containerRef}
          />
        )}

        {/* Floating add agent button */}
        <button
          onClick={handleAddAgent}
          className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-text-inverse shadow-lg hover:bg-opacity-90 transition-colors z-50 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">Add Agent</span>
        </button>
      </div>
    );
  }

  // Focus mode: show only the active agent (or first agent if none selected)
  // Also supports showing file previews, editor, and live preview as tabs
  if (
    viewMode === 'focus' &&
    (agents.length > 0 || dockedPreviews.length > 0 || editorGridCardId || previewGridCardId)
  ) {
    // Find focused agent: if activeAgentId is set, try to find it; if not found (stale ID), fall back to first agent
    const focusedAgent =
      agents.length > 0
        ? activeAgentId
          ? (agents.find((a) => a.id === activeAgentId) ?? agents[0])
          : agents[0]
        : null;
    // Check if activeAgentId is actually a file preview ID
    const focusedFilePreview = activeAgentId
      ? dockedPreviews.find((p) => p.id === activeAgentId)
      : (dockedPreviews[0] ?? null);
    // Check if activeAgentId is the editor
    const isEditorFocused =
      activeAgentId === 'editor' ||
      (!activeAgentId && !focusedAgent && !focusedFilePreview && !!editorGridCardId);
    // Check if activeAgentId is the live preview
    const isPreviewFocused =
      activeAgentId === 'preview' ||
      (!activeAgentId &&
        !focusedAgent &&
        !focusedFilePreview &&
        !isEditorFocused &&
        !!previewGridCardId);

    if (
      focusedAgent ||
      focusedFilePreview ||
      isEditorFocused ||
      isPreviewFocused ||
      editorGridCardId ||
      previewGridCardId
    ) {
      return (
        <div className="h-full flex flex-col" data-tour="agent-grid">
          {/* Agent and file preview tabs in focus mode */}
          <div className="flex items-center gap-1 px-2 py-2 border-b border-border-subtle bg-surface overflow-x-auto">
            {/* Agent tabs */}
            {agents.map((agent) => {
              // Use focusedAgent.id for highlighting since activeAgentId might be stale
              const isActive = agent.id === focusedAgent?.id && !focusedFilePreview;
              return (
                <button
                  key={agent.id}
                  onClick={() => setActiveAgent(sessionId, agent.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-overlay'
                  }`}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
                  {agent.name}
                </button>
              );
            })}

            {/* File preview tabs */}
            {dockedPreviews.length > 0 && (
              <div className="h-4 w-px bg-border-subtle mx-1" /> // Separator
            )}
            {dockedPreviews.map((preview) => {
              const fileName = preview.path.split('/').pop() || preview.path;
              return (
                <button
                  key={preview.id}
                  onClick={() => setActiveAgent(sessionId, preview.id)}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                    preview.id === activeAgentId
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-overlay'
                  }`}
                >
                  <FileCode
                    className={`h-3.5 w-3.5 ${preview.id === activeAgentId ? 'text-text-inverse' : 'text-accent-secondary'}`}
                  />
                  <span className="max-w-[120px] truncate">{fileName}</span>
                  <X
                    className={`h-3.5 w-3.5 ${preview.id === activeAgentId ? 'text-text-inverse/70 hover:text-text-inverse' : 'text-text-muted hover:text-accent-error'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFilePreview(sessionId, preview.id);
                    }}
                  />
                </button>
              );
            })}

            {/* Editor tab */}
            {editorGridCardId && (
              <>
                <div className="h-4 w-px bg-border-subtle mx-1" />
                <button
                  onClick={() => setActiveAgent(sessionId, 'editor')}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                    isEditorFocused
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-overlay'
                  }`}
                >
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${isEditorFocused ? 'bg-text-inverse' : 'bg-accent-primary'}`}
                  />
                  Editor
                  <X
                    className={`h-3.5 w-3.5 ${isEditorFocused ? 'text-text-inverse/70 hover:text-text-inverse' : 'text-text-muted hover:text-accent-error'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEditorGridCard(sessionId);
                      // If editor was focused, switch to first agent
                      if (isEditorFocused && agents.length > 0) {
                        setActiveAgent(sessionId, agents[0]?.id ?? null);
                      }
                    }}
                  />
                </button>
              </>
            )}

            {/* Live Preview tab */}
            {previewGridCardId && (
              <>
                <div className="h-4 w-px bg-border-subtle mx-1" />
                <button
                  onClick={() => setActiveAgent(sessionId, 'preview')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                    isPreviewFocused
                      ? 'bg-accent-primary text-text-inverse'
                      : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-overlay'
                  }`}
                >
                  <Globe
                    className={`h-3.5 w-3.5 ${isPreviewFocused ? 'text-text-inverse' : 'text-accent-secondary'}`}
                  />
                  Preview
                </button>
              </>
            )}

            <button
              onClick={handleAddAgent}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-elevated/50 border border-dashed border-border-default text-text-muted hover:text-text-primary hover:bg-elevated hover:border-border-strong cursor-pointer transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {/* Focused content view */}
          <div className="flex-1 p-4 overflow-auto">
            <div className="h-full max-w-4xl mx-auto">
              {isPreviewFocused && workspaceId ? (
                // Render live preview
                <div className="h-full rounded-lg border border-border-default bg-surface overflow-hidden flex flex-col">
                  <PreviewPanel workspaceId={workspaceId} />
                </div>
              ) : isEditorFocused ? (
                // Render editor
                <div className="h-full rounded-lg border border-border-default bg-surface overflow-hidden flex flex-col">
                  <EnhancedCodeEditor paneId="main" className="h-full" />
                </div>
              ) : focusedFilePreview ? (
                // Render file preview
                <div className="h-full rounded-lg border border-border-default bg-surface overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode className="h-4 w-4 text-accent-secondary shrink-0" />
                      <span className="text-sm font-medium text-text-primary truncate">
                        {focusedFilePreview.path.split('/').pop()}
                      </span>
                      <span className="text-xs text-text-muted hidden sm:inline truncate">
                        {focusedFilePreview.path}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <CodeEditor
                      value={focusedFilePreview.content}
                      language={focusedFilePreview.language}
                      onChange={() => {}}
                      readOnly
                      className="h-full"
                    />
                  </div>
                </div>
              ) : focusedAgent ? (
                // Render agent
                <AgentCardErrorBoundary
                  agentName={focusedAgent.name}
                  onRemove={() => handleRemoveAgent(focusedAgent)}
                >
                  <AgentCard agent={focusedAgent} sessionId={sessionId} expanded />
                </AgentCardErrorBoundary>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
  }

  // Grid mode (default)
  // Calculate dynamic maxCols: 0 means match grid columns
  const dynamicMaxCols = gridConfig.maxCols === 0 ? gridConfig.columns : gridConfig.maxCols;

  return (
    <GridProvider gridRef={gridRef}>
      <div className="h-full p-4 overflow-auto" data-tour="agent-grid">
        <div
          ref={gridRef}
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${gridConfig.columns}, minmax(0, 1fr))`,
            gridAutoRows: `${gridConfig.rowHeight}px`,
          }}
        >
          {agents.map((agent) => (
            <AgentCardErrorBoundary
              key={agent.id}
              agentName={agent.name}
              onRemove={() => handleRemoveAgent(agent)}
            >
              <ResizableGridCard agent={agent} sessionId={sessionId} maxCols={dynamicMaxCols} />
            </AgentCardErrorBoundary>
          ))}

          {/* Docked file previews */}
          {dockedPreviews.map((preview) => (
            <DockedFilePreviewCard
              key={preview.id}
              preview={preview}
              sessionId={sessionId}
              maxCols={dynamicMaxCols}
            />
          ))}

          {/* Consolidated editor grid card */}
          {editorGridCardId && (
            <EditorGridCard
              key={editorGridCardId}
              sessionId={sessionId}
              paneId="main"
              maxCols={dynamicMaxCols}
            />
          )}

          {/* Live preview grid card */}
          {previewGridCardId && workspaceId && (
            <PreviewGridCard
              key={previewGridCardId}
              sessionId={sessionId}
              workspaceId={workspaceId}
              maxCols={dynamicMaxCols}
            />
          )}

          {/* Add agent button */}
          <button
            onClick={handleAddAgent}
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default bg-surface/50 p-8 text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary cursor-pointer"
            style={{ minHeight: `${gridConfig.rowHeight}px` }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
              <Plus className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium">Add Agent</span>
          </button>
        </div>
      </div>
    </GridProvider>
  );
}
