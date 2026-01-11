'use client';

import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { useSessionStore, type Agent } from '@/stores/session';
import { AgentCard } from './AgentCard';
import { DraggableAgentCard } from './DraggableAgentCard';
import { ResizableGridCard } from './ResizableGridCard';
import { DockedFilePreviewCard } from './DockedFilePreviewCard';
import { GridProvider } from './GridContext';
import { useUIStore } from '@/stores/ui';

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
  const { sessions, setActiveAgent } = useSessionStore();
  const { openModal } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Use demo agents if session doesn't exist yet
  const session = sessions[sessionId];
  const agents = session?.agents ?? demoAgents;
  const viewMode = session?.viewMode ?? 'grid';
  const activeAgentId = session?.activeAgentId;
  const filePreviews = session?.filePreviews ?? [];
  const dockedPreviews = filePreviews.filter((p) => p.docked);

  const handleAddAgent = () => {
    openModal('create-agent');
  };

  // Freeform mode: draggable and resizable windows
  if (viewMode === 'freeform') {
    return (
      <div
        ref={containerRef}
        className="h-full relative overflow-hidden bg-background"
        data-tour="agent-grid"
      >
        {agents.map((agent) => (
          <DraggableAgentCard
            key={agent.id}
            agent={agent}
            sessionId={sessionId}
            containerRef={containerRef}
          />
        ))}

        {/* Floating add agent button */}
        <button
          onClick={handleAddAgent}
          className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-text-inverse shadow-lg hover:bg-opacity-90 transition-colors z-50"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">Add Agent</span>
        </button>
      </div>
    );
  }

  // Focus mode: show only the active agent (or first agent if none selected)
  if (viewMode === 'focus' && agents.length > 0) {
    const focusedAgent = activeAgentId ? agents.find((a) => a.id === activeAgentId) : agents[0];

    if (focusedAgent) {
      return (
        <div className="h-full flex flex-col" data-tour="agent-grid">
          {/* Agent tabs in focus mode */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-border-subtle bg-surface overflow-x-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setActiveAgent(sessionId, agent.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                  agent.id === focusedAgent.id
                    ? 'bg-overlay text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay/50'
                }`}
              >
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
                {agent.name}
              </button>
            ))}
            <button
              onClick={handleAddAgent}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-text-muted hover:text-text-primary hover:bg-overlay/50"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {/* Focused agent view */}
          <div className="flex-1 p-4 overflow-auto">
            <div className="h-full max-w-4xl mx-auto">
              <AgentCard agent={focusedAgent} sessionId={sessionId} expanded />
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
        <div ref={gridRef} className="grid gap-4 grid-cols-1 md:grid-cols-2 auto-rows-min">
          {agents.map((agent) => (
            <ResizableGridCard key={agent.id} agent={agent} sessionId={sessionId} maxCols={2} />
          ))}

          {/* Docked file previews */}
          {dockedPreviews.map((preview) => (
            <DockedFilePreviewCard
              key={preview.id}
              preview={preview}
              sessionId={sessionId}
              maxCols={2}
            />
          ))}

          {/* Add agent button */}
          <button
            onClick={handleAddAgent}
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border-default bg-surface/50 p-8 text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary min-h-[300px]"
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
