'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Terminal,
  MessageSquare,
  GitCommit,
  Search,
  Eye,
  Edit3,
  Trash2,
  Undo2,
  Clock,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export type ActivityType =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'command_run'
  | 'message_sent'
  | 'message_received'
  | 'tool_call'
  | 'git_operation'
  | 'error';

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  agentId: string;
  agentName: string;
  description: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  duration?: number; // ms
  canUndo?: boolean;
  undoData?: unknown;
}

// ============================================================================
// Constants
// ============================================================================

const activityTypeConfig: Record<
  ActivityType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  file_read: { label: 'Read File', icon: <Eye className="h-4 w-4" />, color: 'text-blue-400' },
  file_write: { label: 'Write File', icon: <Edit3 className="h-4 w-4" />, color: 'text-green-400' },
  file_delete: {
    label: 'Delete File',
    icon: <Trash2 className="h-4 w-4" />,
    color: 'text-red-400',
  },
  command_run: {
    label: 'Run Command',
    icon: <Terminal className="h-4 w-4" />,
    color: 'text-yellow-400',
  },
  message_sent: {
    label: 'Message Sent',
    icon: <MessageSquare className="h-4 w-4" />,
    color: 'text-purple-400',
  },
  message_received: {
    label: 'Response',
    icon: <Bot className="h-4 w-4" />,
    color: 'text-cyan-400',
  },
  tool_call: { label: 'Tool Call', icon: <Play className="h-4 w-4" />, color: 'text-orange-400' },
  git_operation: { label: 'Git', icon: <GitCommit className="h-4 w-4" />, color: 'text-pink-400' },
  error: { label: 'Error', icon: <AlertCircle className="h-4 w-4" />, color: 'text-red-500' },
};

const statusConfig: Record<ActivityStatus, { icon: React.ReactNode; color: string }> = {
  pending: { icon: <Clock className="h-3 w-3" />, color: 'text-text-muted' },
  running: { icon: <RefreshCw className="h-3 w-3 animate-spin" />, color: 'text-yellow-400' },
  completed: { icon: <CheckCircle className="h-3 w-3" />, color: 'text-green-400' },
  error: { icon: <XCircle className="h-3 w-3" />, color: 'text-red-400' },
};

// ============================================================================
// Activity Event Component
// ============================================================================

interface ActivityEventItemProps {
  event: ActivityEvent;
  expanded: boolean;
  onToggle: () => void;
  onUndo?: (eventId: string) => void;
}

function ActivityEventItem({ event, expanded, onToggle, onUndo }: ActivityEventItemProps) {
  const typeConfig = activityTypeConfig[event.type];
  const status = statusConfig[event.status];

  return (
    <div
      className={cn(
        'border-l-2 pl-4 pb-4 relative',
        event.status === 'error' ? 'border-red-500/50' : 'border-border-subtle'
      )}
    >
      {/* Timeline dot */}
      <div
        className={cn(
          'absolute -left-[9px] top-0 w-4 h-4 rounded-full flex items-center justify-center',
          event.status === 'error' ? 'bg-red-500/20' : 'bg-elevated',
          'border-2',
          event.status === 'error' ? 'border-red-500' : 'border-border-default'
        )}
      >
        <span className={status.color}>{status.icon}</span>
      </div>

      {/* Event card */}
      <div
        className={cn(
          'rounded-lg border bg-surface overflow-hidden',
          event.status === 'error' ? 'border-red-500/30' : 'border-border-subtle'
        )}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-elevated"
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}

          <span className={typeConfig.color}>{typeConfig.icon}</span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary truncate">
                {event.description}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{event.agentName}</span>
              <span>•</span>
              <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
              {event.duration && (
                <>
                  <span>•</span>
                  <span>{event.duration}ms</span>
                </>
              )}
            </div>
          </div>

          {event.canUndo && onUndo && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUndo(event.id);
              }}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-accent-primary"
              title="Undo this action"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Details */}
        {expanded && event.details && (
          <div className="px-3 py-2 border-t border-border-subtle bg-elevated">
            <pre className="text-xs text-text-secondary overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ActivityTimelineProps {
  sessionId: string;
  className?: string;
}

export function ActivityTimeline({ sessionId, className }: ActivityTimelineProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ActivityType | 'all'>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  // Load events
  useEffect(() => {
    async function loadEvents() {
      setLoading(true);
      try {
        const data = await api.get<ActivityEvent[]>(`/api/sessions/${sessionId}/activity`);
        setEvents(data);
      } catch {
        // Activity may not be available, set empty array
        setEvents([]);
      } finally {
        setLoading(false);
      }
    }

    loadEvents();
  }, [sessionId]);

  // Get unique agents for filter
  const agents = useMemo(() => {
    const agentMap = new Map<string, string>();
    for (const event of events) {
      agentMap.set(event.agentId, event.agentName);
    }
    return Array.from(agentMap.entries());
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (typeFilter !== 'all' && event.type !== typeFilter) return false;
      if (agentFilter !== 'all' && event.agentId !== agentFilter) return false;
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !event.description.toLowerCase().includes(searchLower) &&
          !event.agentName.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [events, typeFilter, agentFilter, search]);

  // Toggle event expansion
  const toggleEvent = useCallback((eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  // Handle undo
  const handleUndo = useCallback(
    async (eventId: string) => {
      const event = events.find((e) => e.id === eventId);
      if (!event?.canUndo) return;

      try {
        await api.post(`/api/sessions/${sessionId}/events/${eventId}/undo`, {});
        // Remove the event from the list after successful undo
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
      } catch {
        // Undo may not be supported for all event types - silently fail
      }
    },
    [events, sessionId]
  );

  // Export timeline
  const handleExport = useCallback(() => {
    const data = JSON.stringify(filteredEvents, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-${sessionId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredEvents, sessionId]);

  // Stats
  const stats = useMemo(() => {
    const counts: Record<ActivityType, number> = {} as Record<ActivityType, number>;
    let errors = 0;

    for (const event of events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
      if (event.status === 'error') errors++;
    }

    return { counts, errors, total: events.length };
  }, [events]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Activity Timeline</h2>
          <span className="text-sm text-text-muted">({events.length})</span>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-overlay hover:bg-elevated text-text-secondary text-sm"
        >
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border-subtle bg-elevated text-xs">
        {Object.entries(activityTypeConfig)
          .slice(0, 5)
          .map(([type, config]) => (
            <div key={type} className="flex items-center gap-1">
              <span className={config.color}>{config.icon}</span>
              <span className="text-text-muted">{stats.counts[type as ActivityType] || 0}</span>
            </div>
          ))}
        {stats.errors > 0 && (
          <div className="flex items-center gap-1 text-red-400">
            <AlertCircle className="h-4 w-4" />
            <span>{stats.errors} errors</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary text-sm"
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ActivityType | 'all')}
          className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          <option value="all">All Types</option>
          {Object.entries(activityTypeConfig).map(([key, config]) => (
            <option key={key} value={key}>
              {config.label}
            </option>
          ))}
        </select>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface text-text-primary text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
        >
          <option value="all">All Agents</option>
          {agents.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading activity...
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <Activity className="h-8 w-8 mb-2 opacity-50" />
            <p>No activity found</p>
          </div>
        ) : (
          <div className="pl-2">
            {filteredEvents.map((event) => (
              <ActivityEventItem
                key={event.id}
                event={event}
                expanded={expandedEvents.has(event.id)}
                onToggle={() => toggleEvent(event.id)}
                onUndo={event.canUndo ? handleUndo : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
