'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { Clock, GitBranch, Circle, AlertCircle, Loader2, Box } from 'lucide-react';
import { SessionMenu } from './SessionMenu';

// Status configuration
const statusConfig: Record<
  string,
  { color: string; bg: string; label: string; icon: React.ReactNode }
> = {
  active: {
    color: 'text-accent-success',
    bg: 'bg-accent-success/10',
    label: 'Running',
    icon: <Circle className="w-2 h-2 fill-current" />,
  },
  stopped: {
    color: 'text-text-muted',
    bg: 'bg-overlay',
    label: 'Stopped',
    icon: <Circle className="w-2 h-2" />,
  },
  standby: {
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    label: 'Standby',
    icon: <Circle className="w-2 h-2 fill-current" />,
  },
  creating: {
    color: 'text-accent-warning',
    bg: 'bg-accent-warning/10',
    label: 'Starting',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  error: {
    color: 'text-accent-error',
    bg: 'bg-accent-error/10',
    label: 'Error',
    icon: <AlertCircle className="w-3 h-3" />,
  },
};

const defaultStatus = {
  color: 'text-text-muted',
  bg: 'bg-overlay',
  label: 'Unknown',
  icon: <Circle className="w-2 h-2" />,
};

export const getStatus = (status: string) => statusConfig[status] ?? defaultStatus;

// Template icon configuration
const templateIconConfig: Record<string, { url: string; color: string }> = {
  nodejs: { url: 'https://cdn.simpleicons.org/nodedotjs/339933', color: '#339933' },
  python: { url: 'https://cdn.simpleicons.org/python/3776AB', color: '#3776AB' },
  go: { url: 'https://cdn.simpleicons.org/go/00ADD8', color: '#00ADD8' },
  rust: { url: 'https://cdn.simpleicons.org/rust/DEA584', color: '#DEA584' },
  typescript: { url: 'https://cdn.simpleicons.org/typescript/3178C6', color: '#3178C6' },
  javascript: { url: 'https://cdn.simpleicons.org/javascript/F7DF1E', color: '#F7DF1E' },
  react: { url: 'https://cdn.simpleicons.org/react/61DAFB', color: '#61DAFB' },
  docker: { url: 'https://cdn.simpleicons.org/docker/2496ED', color: '#2496ED' },
  layers: { url: 'https://cdn.simpleicons.org/stackblitz/1389FD', color: '#1389FD' },
};

export const TemplateIcon = memo(function TemplateIcon({
  icon,
  iconUrl,
  size = 'md',
}: {
  icon: string | null;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' };
  const sizePixels = { sm: 16, md: 20, lg: 24 };

  const url = iconUrl || (icon ? templateIconConfig[icon]?.url : null);

  if (url) {
    return (
      <Image
        src={url}
        alt={icon || 'template'}
        width={sizePixels[size]}
        height={sizePixels[size]}
        className={sizeClasses[size]}
        unoptimized
      />
    );
  }

  return <Box className={`${sizeClasses[size]} text-text-muted`} />;
});

// Date formatting utility
export function formatDate(dateStr: string) {
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
}

export interface SessionCardProps {
  session: {
    id: string;
    name: string;
    status: string;
    updated_at: string;
    git_url?: string;
    branch?: string;
    pinned?: boolean;
    workspace_id?: string;
    template_id?: string;
  };
  template?: {
    icon?: string | null;
    icon_url?: string | null;
    name?: string;
  } | null;
  index?: number;
  // Menu state
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  // Actions
  onPin: () => void;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
  // Loading states
  isPinning: boolean;
  isDeleting: boolean;
  isPausing: boolean;
  isResuming: boolean;
  // Variant
  variant?: 'default' | 'pinned';
}

export const SessionCard = memo(function SessionCard({
  session,
  template,
  index = 0,
  isMenuOpen,
  onMenuToggle,
  onMenuClose,
  onPin,
  onDelete,
  onPause,
  onResume,
  isPinning,
  isDeleting,
  isPausing,
  isResuming,
  variant = 'default',
}: SessionCardProps) {
  const status = getStatus(session.status);
  const isPinned = variant === 'pinned' || session.pinned;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.02 }}
      className={`bg-surface border rounded-xl p-4 hover:bg-elevated transition-all group relative ${
        isPinned
          ? 'border-accent-primary/30 hover:border-accent-primary'
          : 'border-border-default hover:border-border-hover'
      }`}
    >
      {/* Menu Button */}
      <div className="absolute top-3 right-3 z-10">
        <SessionMenu
          sessionId={session.id}
          isPinned={!!session.pinned}
          status={session.status}
          workspaceId={session.workspace_id}
          isOpen={isMenuOpen}
          onToggle={onMenuToggle}
          onClose={onMenuClose}
          onPin={onPin}
          onDelete={onDelete}
          onPause={onPause}
          onResume={onResume}
          isPinning={isPinning}
          isDeleting={isDeleting}
          isPausing={isPausing}
          isResuming={isResuming}
        />
      </div>

      <Link href={`/session/${session.id}`} className="block">
        <div className="flex items-start gap-3 mb-3 pr-8">
          <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center flex-shrink-0">
            <TemplateIcon icon={template?.icon || null} iconUrl={template?.icon_url} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-text-primary truncate group-hover:text-accent-primary transition-colors">
              {session.name}
            </h3>
            <p className="text-xs text-text-muted">{template?.name || 'Custom template'}</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Clock className="w-3 h-3" />
            {formatDate(session.updated_at)}
          </div>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${status.color} ${status.bg}`}
          >
            {status.icon}
            {status.label}
          </div>
        </div>

        {session.git_url && session.branch && (
          <div className="flex items-center gap-2 text-xs text-text-muted mt-2">
            <GitBranch className="w-3 h-3" />
            {session.branch}
          </div>
        )}
      </Link>
    </motion.div>
  );
});
