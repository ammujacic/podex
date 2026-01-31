'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Clock,
  GitBranch,
  Server,
  Circle,
  AlertCircle,
  Loader2,
  WifiOff,
  ExternalLink,
  FolderGit2,
  Check,
  X,
} from 'lucide-react';
import { PodCardControls } from './PodCardControls';
import type { Session, PodTemplate } from '@/lib/api';

// Template icon configuration with CDN URLs
const templateIconConfig: Record<string, { url: string; color: string }> = {
  nodejs: { url: 'https://cdn.simpleicons.org/nodedotjs/339933', color: '#339933' },
  python: { url: 'https://cdn.simpleicons.org/python/3776AB', color: '#3776AB' },
  go: { url: 'https://cdn.simpleicons.org/go/00ADD8', color: '#00ADD8' },
  rust: { url: 'https://cdn.simpleicons.org/rust/000000', color: '#DEA584' },
  ruby: { url: 'https://cdn.simpleicons.org/ruby/CC342D', color: '#CC342D' },
  java: { url: 'https://cdn.simpleicons.org/openjdk/ED8B00', color: '#ED8B00' },
  typescript: { url: 'https://cdn.simpleicons.org/typescript/3178C6', color: '#3178C6' },
  react: { url: 'https://cdn.simpleicons.org/react/61DAFB', color: '#61DAFB' },
  vue: { url: 'https://cdn.simpleicons.org/vuedotjs/4FC08D', color: '#4FC08D' },
  angular: { url: 'https://cdn.simpleicons.org/angular/DD0031', color: '#DD0031' },
  svelte: { url: 'https://cdn.simpleicons.org/svelte/FF3E00', color: '#FF3E00' },
  nextjs: { url: 'https://cdn.simpleicons.org/nextdotjs/FFFFFF', color: '#FFFFFF' },
  docker: { url: 'https://cdn.simpleicons.org/docker/2496ED', color: '#2496ED' },
  kubernetes: { url: 'https://cdn.simpleicons.org/kubernetes/326CE5', color: '#326CE5' },
  terraform: { url: 'https://cdn.simpleicons.org/terraform/844FBA', color: '#844FBA' },
  php: { url: 'https://cdn.simpleicons.org/php/777BB4', color: '#777BB4' },
  elixir: { url: 'https://cdn.simpleicons.org/elixir/4B275F', color: '#4B275F' },
  scala: { url: 'https://cdn.simpleicons.org/scala/DC322F', color: '#DC322F' },
  csharp: { url: 'https://cdn.simpleicons.org/csharp/512BD4', color: '#512BD4' },
  swift: { url: 'https://cdn.simpleicons.org/swift/F05138', color: '#F05138' },
  default: { url: '', color: '#9333ea' },
};

type DisplayStatus = 'running' | 'stopped' | 'pending' | 'error' | 'offline';

interface StatusConfig {
  color: string;
  bg: string;
  label: string;
  icon: React.ReactNode;
}

const statusConfig: Record<DisplayStatus, StatusConfig> = {
  running: {
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
  pending: {
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
  offline: {
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    label: 'Offline',
    icon: <WifiOff className="w-3 h-3" />,
  },
};

function TemplateIcon({
  icon,
  iconUrl,
  size = 'md',
}: {
  icon: string | null;
  iconUrl?: string | null;
  size?: 'sm' | 'md';
}) {
  const sizeClass = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  if (iconUrl) {
    return (
      <Image
        src={iconUrl}
        alt="Template icon"
        width={size === 'sm' ? 16 : 20}
        height={size === 'sm' ? 16 : 20}
        className={sizeClass}
        unoptimized
      />
    );
  }

  const config = icon ? templateIconConfig[icon.toLowerCase()] : templateIconConfig.default;
  if (config?.url) {
    return (
      <Image
        src={config.url}
        alt={icon || 'Template'}
        width={size === 'sm' ? 16 : 20}
        height={size === 'sm' ? 16 : 20}
        className={sizeClass}
        unoptimized
      />
    );
  }

  return <Server className={`${sizeClass} text-accent-primary`} />;
}

function getGitHubInfo(gitUrl: string | null, branch: string) {
  if (!gitUrl) return null;

  try {
    let repoPath = '';
    if (gitUrl.startsWith('http://') || gitUrl.startsWith('https://')) {
      const url = new URL(gitUrl);
      repoPath = url.pathname.replace(/\.git$/, '').replace(/^\//, '');
    } else if (gitUrl.startsWith('git@')) {
      const match = gitUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
      if (match && match[1]) {
        repoPath = match[1];
      }
    }

    if (!repoPath) return null;

    const repoUrl = `https://github.com/${repoPath}`;
    const branchUrl = `${repoUrl}/tree/${encodeURIComponent(branch)}`;
    const repoName = repoPath.split('/').slice(-2).join('/');

    return { repoName, repoUrl, branchUrl, branch };
  } catch {
    return null;
  }
}

function formatDate(dateStr: string) {
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

interface PodCardProps {
  session: Session;
  template: PodTemplate | null;
  displayStatus: DisplayStatus;
  isPinned?: boolean;
  variant?: 'default' | 'pinned';
  onStart: () => void;
  onStop: () => void;
  onRename: (newName: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isStarting?: boolean;
  isStopping?: boolean;
  isPinning?: boolean;
  isDeleting?: boolean;
}

export function PodCard({
  session,
  template,
  displayStatus,
  isPinned = false,
  variant = 'default',
  onStart,
  onStop,
  onRename,
  onTogglePin,
  onDelete,
  isStarting = false,
  isStopping = false,
  isPinning = false,
  isDeleting = false,
}: PodCardProps) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const status = statusConfig[displayStatus] || statusConfig.stopped;
  const gitInfo = getGitHubInfo(session.git_url, session.branch);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameStart = () => {
    setRenameValue(session.name);
    setIsRenaming(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  };

  const handleRenameCancel = () => {
    setRenameValue(session.name);
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  const handleCardClick = () => {
    if (!isRenaming) {
      router.push(`/session/${session.id}`);
    }
  };

  const borderClass =
    variant === 'pinned'
      ? 'border-accent-primary/30 hover:border-accent-primary'
      : 'border-border-default hover:border-accent-primary/50';

  return (
    <div
      onClick={handleCardClick}
      className={`bg-surface border ${borderClass} rounded-xl p-4 hover:bg-elevated transition-all cursor-pointer group min-h-[160px] flex flex-col relative`}
    >
      {/* Top row: Icon + Controls */}
      <div className="flex items-start justify-between mb-2">
        <div className="w-10 h-10 rounded-lg bg-overlay flex items-center justify-center">
          <TemplateIcon icon={template?.icon || null} iconUrl={template?.icon_url} />
        </div>
        <PodCardControls
          sessionId={session.id}
          workspaceId={session.workspace_id}
          displayStatus={displayStatus}
          isPinned={isPinned}
          onStart={onStart}
          onStop={onStop}
          onRename={handleRenameStart}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
          isStarting={isStarting}
          isStopping={isStopping}
          isPinning={isPinning}
          isDeleting={isDeleting}
        />
      </div>

      {/* Pod name (with inline edit) */}
      {isRenaming ? (
        <div className="flex items-center gap-1 mb-2" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleRenameSubmit}
            className="flex-1 px-2 py-1 text-sm font-medium bg-overlay border border-border-default rounded focus:border-accent-primary focus:outline-none text-text-primary"
          />
          <button
            onClick={handleRenameSubmit}
            className="p-1 text-accent-success hover:bg-accent-success/10 rounded"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={handleRenameCancel}
            className="p-1 text-text-muted hover:bg-overlay rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <h3 className="font-medium text-text-primary mb-2 line-clamp-2 group-hover:text-accent-primary transition-colors min-h-[2.5rem]">
          {session.name}
        </h3>
      )}

      {/* Bottom section: Status + Time + Git info */}
      <div className="mt-auto space-y-1">
        {/* Status + Time row */}
        <div className="flex items-center gap-2 text-xs">
          <div className={`flex items-center gap-1.5 ${status.color}`}>
            {status.icon}
            <span>{status.label}</span>
          </div>
          <span className="text-text-muted/50">·</span>
          <div className="flex items-center gap-1 text-text-muted">
            <Clock className="w-3 h-3" />
            {formatDate(session.updated_at)}
          </div>
        </div>

        {/* Git info */}
        {gitInfo && (
          <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap">
            <a
              href={gitInfo.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:text-accent-primary transition-colors"
            >
              <FolderGit2 className="w-3 h-3" />
              <span className="truncate max-w-[120px]">{gitInfo.repoName}</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <span className="text-text-muted/50">·</span>
            <a
              href={gitInfo.branchUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 hover:text-accent-primary transition-colors"
            >
              <GitBranch className="w-3 h-3" />
              <span className="truncate">{gitInfo.branch}</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}

        {/* Local pod info */}
        {session.local_pod_id && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Server className="w-3 h-3 text-accent-secondary" />
            <span className="truncate">{session.local_pod_name || 'Local Pod'}</span>
            {session.mount_path && (
              <>
                <span className="text-text-muted/50">·</span>
                <span className="font-mono truncate max-w-[100px]" title={session.mount_path}>
                  {session.mount_path.split('/').pop()}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
