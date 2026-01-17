'use client';

import { useMemo } from 'react';
import {
  Bot,
  Plus,
  MessageSquare,
  Loader2,
  GitBranch,
  FolderOpen,
  Clock,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSessionStore, type Agent } from '@/stores/session';

interface MobileSessionOverviewProps {
  sessionId: string;
  onAgentSelect: (agentId: string) => void;
  onAddAgent: () => void;
}

export function MobileSessionOverview({
  sessionId,
  onAgentSelect,
  onAddAgent,
}: MobileSessionOverviewProps) {
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const streamingMessages = useSessionStore((state) => state.streamingMessages);

  const agents = useMemo(() => session?.agents ?? [], [session?.agents]);

  const isAgentProcessing = (agentId: string) => {
    return Object.values(streamingMessages).some(
      (msg) => msg.agentId === agentId && msg.isStreaming
    );
  };

  const getAgentColor = (agent: Agent) => {
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

  const getLastMessagePreview = (agent: Agent) => {
    const lastMessage = agent.messages?.[agent.messages.length - 1];
    if (!lastMessage) return 'No messages yet';
    const content = lastMessage.content || '';
    if (content.length > 60) return content.slice(0, 60) + '...';
    return content || 'No content';
  };

  const getLastMessageTime = (agent: Agent) => {
    const lastMessage = agent.messages?.[agent.messages.length - 1];
    if (!lastMessage?.timestamp) return null;
    const date =
      typeof lastMessage.timestamp === 'string'
        ? new Date(lastMessage.timestamp)
        : lastMessage.timestamp;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto overscroll-contain">
      {/* Session info header */}
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          {session?.branch && (
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-4 w-4" />
              <span>{session.branch}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <FolderOpen className="h-4 w-4" />
            <span>{session?.name || 'Workspace'}</span>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex gap-2">
          <button
            onClick={onAddAgent}
            data-tour="new-agent-button"
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl',
              'bg-accent-primary text-text-inverse',
              'active:bg-accent-primary/90',
              'transition-colors touch-manipulation'
            )}
          >
            <Plus className="h-5 w-5" />
            <span className="font-medium">New Agent</span>
          </button>
        </div>
      </div>

      {/* Agents list */}
      <div className="px-4 py-3" data-tour="agents-list">
        <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-3">
          Active Agents ({agents.length})
        </h2>

        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mb-4">
              <Bot className="h-8 w-8 text-text-tertiary" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">No agents yet</h3>
            <p className="text-sm text-text-secondary max-w-xs mb-4">
              Create your first AI agent to start coding with assistance.
            </p>
            <button
              onClick={onAddAgent}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg',
                'bg-accent-primary text-text-inverse',
                'active:bg-accent-primary/90',
                'transition-colors touch-manipulation'
              )}
            >
              <Plus className="h-4 w-4" />
              <span className="font-medium">Create Agent</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => {
              const isProcessing = isAgentProcessing(agent.id);
              const color = getAgentColor(agent);
              const lastMessageTime = getLastMessageTime(agent);
              const messageCount = agent.messages?.length ?? 0;

              return (
                <button
                  key={agent.id}
                  onClick={() => onAgentSelect(agent.id)}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-xl',
                    'bg-surface-hover border border-border-subtle',
                    'active:bg-surface-active',
                    'transition-colors touch-manipulation text-left'
                  )}
                >
                  {/* Agent avatar */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    {isProcessing ? (
                      <Loader2 className="h-6 w-6 animate-spin" style={{ color }} />
                    ) : (
                      <Bot className="h-6 w-6" style={{ color }} />
                    )}
                  </div>

                  {/* Agent info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-text-primary truncate">{agent.name}</h3>
                      {isProcessing && (
                        <span className="text-2xs px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary font-medium">
                          Working
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary truncate mt-0.5">
                      {getLastMessagePreview(agent)}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {messageCount} {messageCount === 1 ? 'message' : 'messages'}
                      </span>
                      {lastMessageTime && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {lastMessageTime}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chevron */}
                  <ChevronRight className="h-5 w-5 text-text-tertiary flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tips section */}
      <div className="px-4 py-4 border-t border-border-subtle bg-surface/50">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-accent-primary/5 border border-accent-primary/10">
          <Zap className="h-5 w-5 text-accent-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-text-primary">Pro tip</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Use voice input for hands-free coding. Tap the microphone in any agent chat!
            </p>
          </div>
        </div>
      </div>

      {/* Safe area */}
      <div className="h-safe-bottom" />
    </div>
  );
}
