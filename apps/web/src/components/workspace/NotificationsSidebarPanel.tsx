'use client';

import { useState } from 'react';
import {
  Bell,
  Check,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  MessageCircle,
  X,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAttentionStore, type AgentAttention } from '@/stores/attention';
import type { AgentAttentionType } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { emitAttentionRead, emitAttentionDismiss } from '@/lib/socket';

interface NotificationsSidebarPanelProps {
  sessionId: string;
}

const ATTENTION_ICONS: Record<AgentAttentionType, typeof Bell> = {
  needs_approval: AlertTriangle,
  completed: CheckCircle,
  error: AlertCircle,
  waiting_input: MessageCircle,
};

const ATTENTION_COLORS: Record<AgentAttentionType, string> = {
  needs_approval: 'text-warning',
  completed: 'text-success',
  error: 'text-error',
  waiting_input: 'text-info',
};

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString();
}

function CompactNotification({
  attention,
  onMarkRead,
  onDismiss,
}: {
  attention: AgentAttention;
  onMarkRead: () => void;
  onDismiss: () => void;
}) {
  const Icon = ATTENTION_ICONS[attention.type];
  const colorClass = ATTENTION_COLORS[attention.type];

  return (
    <div
      className={cn(
        'px-3 py-2 border-b border-border-subtle last:border-0 hover:bg-overlay group',
        !attention.read && 'bg-accent-primary/5'
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', colorClass)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-muted truncate">{attention.agentName}</span>
            <span className="text-[10px] text-text-muted shrink-0">
              {formatTimestamp(attention.createdAt)}
            </span>
          </div>
          <p className="text-xs text-text-primary line-clamp-2 mt-0.5">{attention.title}</p>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!attention.read && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMarkRead();
              }}
              className="p-0.5 rounded text-text-muted hover:text-success"
              title="Mark read"
            >
              <Check className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="p-0.5 rounded text-text-muted hover:text-error"
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotificationsSidebarPanel({ sessionId }: NotificationsSidebarPanelProps) {
  const {
    getAttentionsForSession,
    markAsRead,
    dismissAttention,
    dismissAllForSession,
    ttsEnabled,
    setTTSEnabled,
    getUnreadCount,
  } = useAttentionStore();

  const attentions = getAttentionsForSession(sessionId);
  const unreadCount = getUnreadCount(sessionId);
  const [filter, setFilter] = useState<AgentAttentionType | 'all'>('all');

  const filteredAttentions =
    filter === 'all' ? attentions : attentions.filter((a) => a.type === filter);

  const handleMarkRead = (attentionId: string) => {
    markAsRead(sessionId, attentionId);
    emitAttentionRead(sessionId, attentionId);
  };

  const handleDismiss = (attentionId: string) => {
    dismissAttention(sessionId, attentionId);
    emitAttentionDismiss(sessionId, attentionId);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-accent-primary" />
          {unreadCount > 0 && (
            <span className="text-xs bg-accent-primary text-void px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTTSEnabled(!ttsEnabled)}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title={ttsEnabled ? 'Mute' : 'Unmute'}
          >
            {ttsEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => dismissAllForSession(sessionId)}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Clear all"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-border-subtle overflow-x-auto">
        {(['all', 'needs_approval', 'error', 'completed'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              'px-2 py-0.5 text-[10px] rounded whitespace-nowrap',
              filter === type
                ? 'bg-accent-primary text-void'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
          >
            {type === 'all'
              ? 'All'
              : type === 'needs_approval'
                ? 'Approval'
                : type === 'error'
                  ? 'Errors'
                  : 'Done'}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      <div className="flex-1 overflow-y-auto">
        {filteredAttentions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bell className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No notifications</p>
          </div>
        ) : (
          filteredAttentions.map((attention) => (
            <CompactNotification
              key={attention.id}
              attention={attention}
              onMarkRead={() => handleMarkRead(attention.id)}
              onDismiss={() => handleDismiss(attention.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
