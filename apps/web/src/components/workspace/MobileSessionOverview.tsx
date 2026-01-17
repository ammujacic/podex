'use client';

import { useMemo } from 'react';
import {
  Bell,
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
import { useAttentionStore } from '@/stores/attention';
import {
  getAgentColor,
  getAttentionTypeStyles,
  getAttentionTypeLabel,
  formatTime,
} from '@/lib/ui-utils';
import { AvatarAttentionBadge } from '@/components/ui/AttentionBadge';

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

  // Attention state
  const { getUnreadCountForAgent, getHighestPriorityAttention, hasUnreadForAgent } =
    useAttentionStore();

  const agents = useMemo(() => session?.agents ?? [], [session?.agents]);

  const isAgentProcessing = (agentId: string) => {
    return Object.values(streamingMessages).some(
      (msg) => msg.agentId === agentId && msg.isStreaming
    );
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
    return formatTime(lastMessage.timestamp);
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
        <h2
          id="agents-list-heading"
          className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-3"
        >
          Active Agents ({agents.length})
        </h2>

        {agents.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-12 text-center"
            role="status"
          >
            <div
              className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mb-4"
              aria-hidden="true"
            >
              <Bot className="h-8 w-8 text-text-tertiary" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary mb-2">No agents yet</h3>
            <p className="text-sm text-text-secondary max-w-xs mb-4">
              Create your first AI agent to start coding with assistance.
            </p>
            <button
              onClick={onAddAgent}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg min-h-[44px]',
                'bg-accent-primary text-text-inverse',
                'active:bg-accent-primary/90',
                'transition-colors touch-manipulation'
              )}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">Create Agent</span>
            </button>
          </div>
        ) : (
          <ul className="space-y-2" role="list" aria-labelledby="agents-list-heading">
            {agents.map((agent) => {
              const isProcessing = isAgentProcessing(agent.id);
              const color = getAgentColor(agent);
              const lastMessageTime = getLastMessageTime(agent);
              const messageCount = agent.messages?.length ?? 0;

              // Attention state for this agent
              const agentUnreadCount = getUnreadCountForAgent(sessionId, agent.id);
              const agentHasUnread = hasUnreadForAgent(sessionId, agent.id);
              const agentHighestPriority = getHighestPriorityAttention(sessionId, agent.id);
              const attentionStyles = agentHighestPriority
                ? getAttentionTypeStyles(agentHighestPriority.type)
                : null;

              return (
                <li key={agent.id}>
                  <button
                    onClick={() => onAgentSelect(agent.id)}
                    aria-label={`${agent.name}${isProcessing ? ', working' : ''}${agentHasUnread ? `, ${agentUnreadCount} unread notifications` : ''}`}
                    className={cn(
                      'w-full flex items-center gap-3 p-4 rounded-xl min-h-[72px]',
                      'bg-surface-hover border border-border-subtle',
                      'active:bg-surface-active',
                      'transition-colors touch-manipulation text-left',
                      'focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-1',
                      // Highlight if has unread attention
                      agentHasUnread && attentionStyles && `ring-1 ${attentionStyles.ring}`
                    )}
                  >
                    {/* Agent avatar */}
                    <div
                      className="relative w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${color}20` }}
                      aria-hidden="true"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-6 w-6 animate-spin" style={{ color }} />
                      ) : (
                        <Bot className="h-6 w-6" style={{ color }} />
                      )}
                      {/* Unread attention badge on avatar */}
                      {agentHasUnread && (
                        <AvatarAttentionBadge count={agentUnreadCount} hasUnread={agentHasUnread} />
                      )}
                    </div>

                    {/* Agent info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-text-primary truncate">{agent.name}</h3>
                        {isProcessing && (
                          <span
                            className="text-2xs px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary font-medium"
                            role="status"
                          >
                            Working
                          </span>
                        )}
                        {/* Attention type badge */}
                        {agentHighestPriority && attentionStyles && (
                          <span
                            className={cn(
                              'text-2xs px-1.5 py-0.5 rounded font-medium flex items-center gap-1',
                              attentionStyles.bg.replace('/20', '/10'),
                              attentionStyles.text
                            )}
                            role="status"
                          >
                            <Bell className="h-2.5 w-2.5" aria-hidden="true" />
                            {getAttentionTypeLabel(agentHighestPriority.type)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-text-secondary truncate mt-0.5">
                        {getLastMessagePreview(agent)}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" aria-hidden="true" />
                          <span>
                            {messageCount} {messageCount === 1 ? 'message' : 'messages'}
                          </span>
                        </span>
                        {lastMessageTime && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            <time>{lastMessageTime}</time>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Chevron */}
                    <ChevronRight
                      className="h-5 w-5 text-text-tertiary flex-shrink-0"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
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
