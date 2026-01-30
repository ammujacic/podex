'use client';

import { Bot } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { getRoleIcon } from '@/lib/agentConstants';

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
        <div className="p-3 space-y-2">
          {agents.map((agent) => {
            const isActive = session?.activeAgentId === agent.id;
            const RoleIcon = getRoleIcon(agent.role);
            return (
              <button
                key={agent.id}
                onClick={() => setActiveAgent(sessionId, agent.id)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-accent-primary text-text-inverse' : 'bg-elevated hover:bg-overlay'
                )}
              >
                <RoleIcon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-text-inverse' : 'text-text-muted'
                  )}
                />
                <div className="flex-1 truncate">
                  <div
                    className={cn(
                      'font-medium',
                      isActive ? 'text-text-inverse' : 'text-text-primary'
                    )}
                  >
                    {agent.name}
                  </div>
                  <div
                    className={cn(
                      'text-xs capitalize',
                      isActive ? 'text-text-inverse/70' : 'text-text-muted'
                    )}
                  >
                    {agent.role}
                  </div>
                </div>
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    agent.status === 'active'
                      ? isActive
                        ? 'bg-text-inverse animate-pulse'
                        : 'bg-accent-success animate-pulse'
                      : agent.status === 'error'
                        ? isActive
                          ? 'bg-text-inverse'
                          : 'bg-accent-error'
                        : isActive
                          ? 'bg-text-inverse/50'
                          : 'bg-text-muted'
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
