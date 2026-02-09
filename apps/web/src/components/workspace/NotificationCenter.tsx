'use client';

import { useState } from 'react';
import {
  Bell,
  X,
  Check,
  AlertTriangle,
  CheckCircle,
  AlertCircle,
  MessageCircle,
  Volume2,
  VolumeX,
  Trash2,
} from 'lucide-react';
import { useAttentionStore, type AgentAttention } from '@/stores/attention';
import type { AgentAttentionType } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { emitAttentionRead, emitAttentionDismiss } from '@/lib/socket';

interface NotificationCenterProps {
  sessionId: string;
}

const ATTENTION_ICONS: Record<AgentAttentionType, typeof Bell> = {
  needs_approval: AlertTriangle,
  completed: CheckCircle,
  error: AlertCircle,
  waiting_input: MessageCircle,
};

const ATTENTION_STYLES: Record<AgentAttentionType, { bg: string; border: string; icon: string }> = {
  needs_approval: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    icon: 'text-yellow-500',
  },
  completed: {
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    icon: 'text-green-500',
  },
  error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    icon: 'text-red-500',
  },
  waiting_input: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    icon: 'text-blue-500',
  },
};

const FILTER_LABELS: Record<AgentAttentionType | 'all', string> = {
  all: 'All',
  needs_approval: 'Approval',
  completed: 'Completed',
  error: 'Errors',
  waiting_input: 'Input',
};

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function NotificationCenter({ sessionId }: NotificationCenterProps) {
  const {
    panelOpen,
    closePanel,
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

  // Handle mark as read with socket sync
  const handleMarkRead = (attentionId: string) => {
    markAsRead(sessionId, attentionId);
    emitAttentionRead(sessionId, attentionId);
  };

  // Handle dismiss with socket sync
  const handleDismiss = (attentionId: string) => {
    dismissAttention(sessionId, attentionId);
    emitAttentionDismiss(sessionId, attentionId);
  };

  // Handle dismiss all
  const handleDismissAll = () => {
    dismissAllForSession(sessionId);
    // Note: dismiss all event would need to be added to backend
  };

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 bg-surface border-l border-border-default shadow-xl flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-text-primary" />
          <h2 className="font-semibold text-text-primary">Notifications</h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-accent-primary px-2 py-0.5 text-xs text-text-inverse">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTTSEnabled(!ttsEnabled)}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
            title={ttsEnabled ? 'Disable voice announcements' : 'Enable voice announcements'}
          >
            {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            onClick={handleDismissAll}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
            title="Dismiss all"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={closePanel}
            className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border-subtle px-4 py-2 overflow-x-auto">
        {(['all', 'needs_approval', 'completed', 'error', 'waiting_input'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors',
              filter === type
                ? 'bg-accent-primary text-text-inverse'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
          >
            {FILTER_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredAttentions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            <Bell className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          filteredAttentions.map((attention) => (
            <NotificationItem
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

interface NotificationItemProps {
  attention: AgentAttention;
  onMarkRead: () => void;
  onDismiss: () => void;
}

function NotificationItem({ attention, onMarkRead, onDismiss }: NotificationItemProps) {
  const Icon = ATTENTION_ICONS[attention.type];
  const styles = ATTENTION_STYLES[attention.type];

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        styles.bg,
        styles.border,
        !attention.read && 'ring-1 ring-accent-primary/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('rounded-full p-1.5', styles.bg)}>
          <Icon className={cn('h-4 w-4', styles.icon)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-muted">{attention.agentName}</span>
            <span className="text-xs text-text-muted">{formatTimestamp(attention.createdAt)}</span>
          </div>

          <h4 className="font-medium text-text-primary mt-1">{attention.title}</h4>

          <p className="text-sm text-text-secondary mt-1 line-clamp-2">{attention.message}</p>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            {attention.type === 'needs_approval' && (
              <button
                onClick={onDismiss}
                className="rounded-md bg-accent-primary px-3 py-1 text-xs font-medium text-text-inverse hover:bg-opacity-90"
              >
                Approve
              </button>
            )}
            {!attention.read && (
              <button
                onClick={onMarkRead}
                className="rounded-md bg-elevated px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
              >
                <Check className="h-3 w-3 inline mr-1" />
                Mark Read
              </button>
            )}
            <button
              onClick={onDismiss}
              className="rounded-md px-3 py-1 text-xs font-medium text-text-muted hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
