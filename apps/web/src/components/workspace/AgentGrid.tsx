'use client';

import { useRef, Component, type ReactNode } from 'react';
import { Plus, AlertTriangle, RefreshCw, FileCode, X } from 'lucide-react';
import { useSessionStore, type Agent } from '@/stores/session';
import { AgentCard } from './AgentCard';
import { DraggableAgentCard } from './DraggableAgentCard';
import { DraggableTerminalCard } from './DraggableTerminalCard';
import { DraggableEditorCard } from './DraggableEditorCard';
import { ResizableGridCard } from './ResizableGridCard';
import { ResizableTerminalCard } from './ResizableTerminalCard';
import { TerminalAgentCell } from './TerminalAgentCell';
import { DockedFilePreviewCard } from './DockedFilePreviewCard';
import { EditorGridCard } from './EditorGridCard';
import { GridProvider } from './GridContext';
import { useUIStore } from '@/stores/ui';
import { CodeEditor } from './CodeEditor';
import { EnhancedCodeEditor } from '@/components/editor/EnhancedCodeEditor';
import { deleteAgent as deleteAgentApi } from '@/lib/api';

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
    model: 'claude-opus-4-5-20251101',
    status: 'active',
    color: 'agent-1',
    mode: 'auto',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Planning the authentication system architecture...',
        timestamp: new Date(),
      },
    ],
  },
  {
    id: 'agent-2',
    name: 'Frontend Dev',
    role: 'coder',
    model: 'claude-sonnet-4-20250514',
    status: 'active',
    color: 'agent-2',
    mode: 'auto',
    messages: [
      {
        id: 'm2',
        role: 'assistant',
        content: 'Building the login form with react-hook-form...',
        timestamp: new Date(),
      },
    ],
  },
  {
    id: 'agent-3',
    name: 'Backend Dev',
    role: 'coder',
    model: 'claude-sonnet-4-20250514',
    status: 'active',
    color: 'agent-3',
    mode: 'auto',
    messages: [
      {
        id: 'm3',
        role: 'assistant',
        content: 'Setting up the auth API endpoints...',
        timestamp: new Date(),
      },
    ],
  },
  {
    id: 'agent-4',
    name: 'QA Engineer',
    role: 'tester',
    model: 'gpt-4o',
    status: 'idle',
    color: 'agent-4',
    mode: 'ask',
    messages: [],
  },
];

export function AgentGrid({ sessionId }: AgentGridProps) {
  const { sessions, setActiveAgent, closeFilePreview } = useSessionStore();
  const { openModal } = useUIStore();
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
    handleRemoveAgent(agent);
  };

  const handleRemoveTerminalAgent = async (agent: Agent) => {
    // Close the terminal session on the backend
    if (agent.terminalSessionId) {
      try {
        await fetch(`/api/v1/terminal-agents/${agent.terminalSessionId}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.error('Failed to close terminal session:', err);
      }
    }
    // Remove from store
    handleRemoveAgent(agent);
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
          // Check if this is a terminal agent
          if (agent.terminalSessionId) {
            return (
              <AgentCardErrorBoundary
                key={agent.id}
                agentName={agent.name}
                onRemove={() => handleRemoveTerminalAgent(agent)}
              >
                <DraggableTerminalCard
                  agent={agent}
                  sessionId={sessionId}
                  workspaceId={workspaceId}
                  containerRef={containerRef}
                  onRemove={() => handleRemoveTerminalAgent(agent)}
                />
              </AgentCardErrorBoundary>
            );
          }

          // Regular Podex agent
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
  // Also supports showing file previews and editor as tabs
  if (
    viewMode === 'focus' &&
    (agents.length > 0 || dockedPreviews.length > 0 || editorGridCardId)
  ) {
    const focusedAgent =
      agents.length > 0
        ? activeAgentId
          ? agents.find((a) => a.id === activeAgentId)
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

    if (focusedAgent || focusedFilePreview || isEditorFocused || editorGridCardId) {
      return (
        <div className="h-full flex flex-col" data-tour="agent-grid">
          {/* Agent and file preview tabs in focus mode */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle bg-surface overflow-x-auto">
            {/* Agent tabs */}
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setActiveAgent(sessionId, agent.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                  agent.id === activeAgentId && !focusedFilePreview
                    ? 'bg-overlay text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay/50'
                }`}
              >
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
                {agent.name}
              </button>
            ))}

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
                      ? 'bg-overlay text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-overlay/50'
                  }`}
                >
                  <FileCode className="h-3.5 w-3.5 text-accent-secondary" />
                  <span className="max-w-[120px] truncate">{fileName}</span>
                  <X
                    className="h-3.5 w-3.5 text-text-muted hover:text-accent-error opacity-0 group-hover:opacity-100 transition-opacity"
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
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors cursor-pointer ${
                    isEditorFocused
                      ? 'bg-overlay text-text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-overlay/50'
                  }`}
                >
                  <div className="h-2 w-2 rounded-full bg-accent-primary shrink-0" />
                  Editor
                </button>
              </>
            )}

            <button
              onClick={handleAddAgent}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-text-muted hover:text-text-primary hover:bg-overlay/50 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {/* Focused content view */}
          <div className="flex-1 p-4 overflow-auto">
            <div className="h-full max-w-4xl mx-auto">
              {isEditorFocused ? (
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
                  onRemove={() =>
                    focusedAgent.terminalSessionId
                      ? handleRemoveTerminalAgent(focusedAgent)
                      : handleRemoveAgent(focusedAgent)
                  }
                >
                  {focusedAgent.terminalSessionId ? (
                    <div className="h-full rounded-lg border border-border-default bg-surface overflow-hidden">
                      <TerminalAgentCell
                        agent={focusedAgent}
                        sessionId={sessionId}
                        workspaceId={workspaceId}
                        onRemove={() => handleRemoveTerminalAgent(focusedAgent)}
                      />
                    </div>
                  ) : (
                    <AgentCard agent={focusedAgent} sessionId={sessionId} expanded />
                  )}
                </AgentCardErrorBoundary>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
  }

  // Grid mode (default)
  return (
    <GridProvider gridRef={gridRef}>
      <div className="h-full p-4 overflow-auto" data-tour="agent-grid">
        <div ref={gridRef} className="grid gap-4 grid-cols-1 md:grid-cols-2 auto-rows-[300px]">
          {agents.map((agent) => {
            // Check if this is a terminal agent
            if (agent.terminalSessionId) {
              return (
                <AgentCardErrorBoundary
                  key={agent.id}
                  agentName={agent.name}
                  onRemove={() => handleRemoveTerminalAgent(agent)}
                >
                  <ResizableTerminalCard
                    agent={agent}
                    sessionId={sessionId}
                    workspaceId={workspaceId}
                    maxCols={2}
                    onRemove={() => handleRemoveTerminalAgent(agent)}
                  />
                </AgentCardErrorBoundary>
              );
            }

            // Regular Podex agent
            return (
              <AgentCardErrorBoundary
                key={agent.id}
                agentName={agent.name}
                onRemove={() => handleRemoveAgent(agent)}
              >
                <ResizableGridCard agent={agent} sessionId={sessionId} maxCols={2} />
              </AgentCardErrorBoundary>
            );
          })}

          {/* Docked file previews */}
          {dockedPreviews.map((preview) => (
            <DockedFilePreviewCard
              key={preview.id}
              preview={preview}
              sessionId={sessionId}
              maxCols={2}
            />
          ))}

          {/* Consolidated editor grid card */}
          {editorGridCardId && (
            <EditorGridCard
              key={editorGridCardId}
              sessionId={sessionId}
              paneId="main"
              maxCols={2}
            />
          )}

          {/* Add agent button */}
          <button
            onClick={handleAddAgent}
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default bg-surface/50 p-8 text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary min-h-[300px] cursor-pointer"
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
