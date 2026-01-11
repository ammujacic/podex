'use client';

import { useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, GitBranch, Play, Trash2, Loader2, Pin, PinOff, Box } from 'lucide-react';
import type { Session, PodTemplate } from '@/lib/api';

// Status configuration
const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  active: {
    color: 'text-accent-success',
    bg: 'bg-accent-success/10',
    label: 'Running',
  },
  stopped: {
    color: 'text-text-muted',
    bg: 'bg-overlay',
    label: 'Stopped',
  },
  creating: {
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    label: 'Starting',
  },
  error: {
    color: 'text-accent-error',
    bg: 'bg-accent-error/10',
    label: 'Error',
  },
};

const getStatus = (status: string) =>
  statusConfig[status] ?? { color: 'text-text-muted', bg: 'bg-overlay', label: 'Unknown' };

// Template icon configuration
const templateIconConfig: Record<string, { url: string }> = {
  nodejs: { url: 'https://cdn.simpleicons.org/nodedotjs/339933' },
  python: { url: 'https://cdn.simpleicons.org/python/3776AB' },
  go: { url: 'https://cdn.simpleicons.org/go/00ADD8' },
  rust: { url: 'https://cdn.simpleicons.org/rust/DEA584' },
  typescript: { url: 'https://cdn.simpleicons.org/typescript/3178C6' },
  react: { url: 'https://cdn.simpleicons.org/react/61DAFB' },
  layers: { url: 'https://cdn.simpleicons.org/stackblitz/1389FD' },
};

function TemplateIcon({ icon, iconUrl }: { icon: string | null; iconUrl?: string | null }) {
  // Use iconUrl from API if available, otherwise fall back to local mapping
  const url = iconUrl || (icon ? templateIconConfig[icon]?.url : null);
  if (url) {
    return <Image src={url} alt={icon || 'template'} width={20} height={20} unoptimized />;
  }
  return <Box className="w-5 h-5 text-text-muted" />;
}

interface VirtualizedSessionListProps {
  sessions: Session[];
  templates: PodTemplate[];
  onDelete: (sessionId: string) => void;
  onPin: (sessionId: string, isPinned: boolean) => void;
  deleting: string | null;
  pinning: string | null;
}

export function VirtualizedSessionList({
  sessions,
  templates,
  onDelete,
  onPin,
  deleting,
  pinning,
}: VirtualizedSessionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const getTemplateForSession = useCallback(
    (session: Session): PodTemplate | undefined => {
      if (!session.template_id) return undefined;
      return templates.find((t) => t.id === session.template_id);
    },
    [templates]
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88, // Approximate row height
    overscan: 5,
  });

  if (sessions.length === 0) {
    return (
      <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
        <p className="text-text-secondary">No pods found.</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="bg-surface border border-border-default rounded-xl overflow-auto"
      style={{ maxHeight: '600px' }}
    >
      <table className="w-full">
        <thead className="sticky top-0 bg-surface z-10">
          <tr className="border-b border-border-default">
            <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
              Name
            </th>
            <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
              Template
            </th>
            <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
              Status
            </th>
            <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
              Last Active
            </th>
            <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
              Actions
            </th>
          </tr>
        </thead>
        <tbody
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          <AnimatePresence>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const session = sessions[virtualRow.index];
              if (!session) return null;

              const template = getTemplateForSession(session);
              const status = getStatus(session.status);

              return (
                <motion.tr
                  key={session.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="border-b border-border-subtle hover:bg-elevated transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href={`/session/${session.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-overlay flex items-center justify-center">
                        <TemplateIcon icon={template?.icon || null} iconUrl={template?.icon_url} />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary hover:text-accent-primary transition-colors">
                          {session.name}
                        </p>
                        {session.git_url && (
                          <p className="text-xs text-text-muted flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {session.branch}
                          </p>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-secondary">
                    {template?.name || 'Custom'}
                  </td>
                  <td className="px-4 py-3">
                    <div
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
                    >
                      {status.label}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(session.updated_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/session/${session.id}`}>
                        <button
                          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
                          aria-label={`Open ${session.name}`}
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      </Link>
                      <button
                        onClick={() => onPin(session.id, !!session.pinned)}
                        disabled={pinning === session.id}
                        className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
                        aria-label={session.pinned ? 'Unpin session' : 'Pin session'}
                      >
                        {pinning === session.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : session.pinned ? (
                          <PinOff className="w-4 h-4" />
                        ) : (
                          <Pin className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => onDelete(session.id)}
                        disabled={deleting === session.id}
                        className="p-1.5 rounded text-text-muted hover:text-accent-error hover:bg-overlay disabled:opacity-50"
                        aria-label={`Delete ${session.name}`}
                      >
                        {deleting === session.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
