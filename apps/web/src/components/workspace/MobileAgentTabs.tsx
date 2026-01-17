'use client';

import { useRef, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore, type Agent } from '@/stores/session';

interface MobileAgentTabsProps {
  sessionId: string;
  activeAgentId: string | null;
  onAgentSelect: (agentId: string) => void;
  onAddAgent: () => void;
}

export function MobileAgentTabs({
  sessionId,
  activeAgentId,
  onAgentSelect,
  onAddAgent,
}: MobileAgentTabsProps) {
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const streamingMessages = useSessionStore((state) => state.streamingMessages);
  const agents = session?.agents ?? [];
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll active agent into view
  useEffect(() => {
    if (activeAgentId && scrollContainerRef.current) {
      const activeButton = scrollContainerRef.current.querySelector(
        `[data-agent-id="${activeAgentId}"]`
      );
      if (activeButton) {
        activeButton.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      }
    }
  }, [activeAgentId]);

  const getAgentColor = (agent: Agent) => {
    // Use agent color if available, otherwise generate based on name
    if (agent.color) return agent.color;
    const colors = [
      '#8B5CF6', // Purple
      '#3B82F6', // Blue
      '#10B981', // Green
      '#F59E0B', // Amber
      '#EF4444', // Red
      '#EC4899', // Pink
      '#06B6D4', // Cyan
    ];
    const index = agent.name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const isAgentProcessing = (agentId: string) => {
    // Check if there's a streaming message for this agent
    return Object.values(streamingMessages).some(
      (msg) => msg.agentId === agentId && msg.isStreaming
    );
  };

  return (
    <nav
      className="md:hidden border-t border-border-subtle bg-surface/95 backdrop-blur-sm"
      data-tour="agent-tabs"
      aria-label="Agent tabs"
    >
      <div
        ref={scrollContainerRef}
        role="tablist"
        aria-label="Available agents"
        className="flex items-center gap-1 px-2 py-2 overflow-x-auto scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {agents.map((agent, index) => {
          const isActive = agent.id === activeAgentId;
          const isProcessing = isAgentProcessing(agent.id);
          const color = getAgentColor(agent);

          return (
            <button
              key={agent.id}
              role="tab"
              id={`agent-tab-${agent.id}`}
              aria-selected={isActive}
              aria-controls={`agent-panel-${agent.id}`}
              tabIndex={isActive ? 0 : -1}
              data-agent-id={agent.id}
              onClick={() => onAgentSelect(agent.id)}
              onKeyDown={(e) => {
                // Arrow key navigation for tabs
                if (e.key === 'ArrowRight' && index < agents.length - 1) {
                  const nextAgent = agents[index + 1];
                  if (nextAgent) {
                    e.preventDefault();
                    onAgentSelect(nextAgent.id);
                  }
                } else if (e.key === 'ArrowLeft' && index > 0) {
                  const prevAgent = agents[index - 1];
                  if (prevAgent) {
                    e.preventDefault();
                    onAgentSelect(prevAgent.id);
                  }
                }
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg',
                'whitespace-nowrap flex-shrink-0',
                'transition-colors touch-manipulation',
                isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover/50 active:bg-surface-hover'
              )}
            >
              {/* Color dot / Processing indicator */}
              <span className="relative flex-shrink-0">
                {isProcessing ? (
                  <Loader2 className="h-3 w-3 animate-spin" style={{ color }} />
                ) : (
                  <span className="block w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                )}
              </span>

              {/* Agent name */}
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive ? 'text-text-primary' : 'text-text-secondary'
                )}
              >
                {agent.name}
              </span>
            </button>
          );
        })}

        {/* Add agent button */}
        <button
          onClick={onAddAgent}
          className={cn(
            'flex items-center justify-center',
            'w-10 h-10 rounded-lg flex-shrink-0',
            'hover:bg-surface-hover active:bg-surface-active',
            'transition-colors touch-manipulation'
          )}
          aria-label="Add agent"
        >
          <Plus className="h-5 w-5 text-text-secondary" />
        </button>
      </div>

      {/* Safe area spacer */}
      <div className="h-safe-bottom" />
    </nav>
  );
}
