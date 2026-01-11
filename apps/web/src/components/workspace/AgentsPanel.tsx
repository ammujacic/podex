'use client';

import { Bot } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';

interface AgentsPanelProps {
  sessionId: string;
}

export function AgentsPanel({ sessionId }: AgentsPanelProps) {
  const { sessions, setActiveAgent } = useSessionStore();
  const session = sessions[sessionId];
  const agents = session?.agents || [];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {agents.length === 0 ? (
        <div className="p-4 text-center text-text-muted text-sm">
          <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No agents yet.</p>
          <p className="mt-2 text-xs">
            Click &quot;Add Agent&quot; in the workspace to create one.
          </p>
        </div>
      ) : (
        <div className="p-2 space-y-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setActiveAgent(sessionId, agent.id)}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-overlay',
                session?.activeAgentId === agent.id && 'bg-overlay'
              )}
            >
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: agent.color }} />
              <div className="flex-1 truncate">
                <div className="font-medium text-text-primary">{agent.name}</div>
                <div className="text-xs text-text-muted capitalize">{agent.role}</div>
              </div>
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  agent.status === 'active'
                    ? 'bg-accent-success animate-pulse'
                    : agent.status === 'error'
                      ? 'bg-accent-error'
                      : 'bg-text-muted'
                )}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
