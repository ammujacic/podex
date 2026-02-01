'use client';

import { Bot, Terminal } from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { getRoleIcon, getAgentTextColor } from '@/lib/agentConstants';
import { parseModelIdToDisplayName } from '@/lib/model-utils';

interface AgentsPanelProps {
  sessionId: string;
}

export function AgentsPanel({ sessionId }: AgentsPanelProps) {
  const { sessions, setActiveWindow, getConversationForAgent } = useSessionStore();
  const session = sessions[sessionId];
  const agents = session?.agents || [];
  const terminalWindows = session?.terminalWindows || [];
  const activeWindowId = session?.activeWindowId;

  const hasContent = agents.length > 0 || terminalWindows.length > 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {!hasContent ? (
        <div className="p-4 text-center text-text-muted text-sm">
          <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No windows yet.</p>
          <p className="mt-2 text-xs">
            Click &quot;Add Agent&quot; or &quot;Add Terminal&quot; in the workspace.
          </p>
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {/* Agents section */}
          {agents.map((agent) => {
            const isActive = activeWindowId === agent.id;
            const RoleIcon = getRoleIcon(agent.role);
            const conversation = getConversationForAgent(sessionId, agent.id);
            const sessionTitle = conversation?.name || 'New Session';
            return (
              <button
                key={agent.id}
                onClick={() => setActiveWindow(sessionId, agent.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-accent-primary text-text-inverse' : 'bg-elevated hover:bg-overlay'
                )}
              >
                <RoleIcon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-text-inverse' : getAgentTextColor(agent.color)
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'font-medium truncate',
                      isActive ? 'text-text-inverse' : 'text-text-primary'
                    )}
                  >
                    {sessionTitle}
                  </div>
                  <div
                    className={cn(
                      'text-xs capitalize truncate',
                      isActive ? 'text-text-inverse/70' : 'text-text-muted'
                    )}
                  >
                    {agent.role}
                  </div>
                  <div
                    className={cn(
                      'text-xs truncate',
                      isActive ? 'text-text-inverse/60' : 'text-text-muted/80'
                    )}
                  >
                    {parseModelIdToDisplayName(agent.model)}
                  </div>
                </div>
                <div
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
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

          {/* Separator between agents and terminals */}
          {agents.length > 0 && terminalWindows.length > 0 && (
            <div className="h-px bg-border-subtle my-2" />
          )}

          {/* Terminal windows section */}
          {terminalWindows.map((terminal) => {
            const isActive = activeWindowId === terminal.id;
            return (
              <button
                key={terminal.id}
                onClick={() => setActiveWindow(sessionId, terminal.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-accent-primary text-text-inverse' : 'bg-elevated hover:bg-overlay'
                )}
              >
                <Terminal
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-text-inverse' : 'text-cyan-400'
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      'font-medium truncate',
                      isActive ? 'text-text-inverse' : 'text-text-primary'
                    )}
                  >
                    {terminal.name}
                  </div>
                  <div
                    className={cn(
                      'text-xs truncate',
                      isActive ? 'text-text-inverse/70' : 'text-text-muted'
                    )}
                  >
                    {terminal.shell}
                  </div>
                </div>
                <div
                  className={cn(
                    'h-2 w-2 rounded-full shrink-0',
                    terminal.status === 'connected'
                      ? isActive
                        ? 'bg-text-inverse'
                        : 'bg-green-500'
                      : terminal.status === 'error'
                        ? isActive
                          ? 'bg-text-inverse'
                          : 'bg-red-500'
                        : isActive
                          ? 'bg-text-inverse/50'
                          : 'bg-zinc-500'
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
