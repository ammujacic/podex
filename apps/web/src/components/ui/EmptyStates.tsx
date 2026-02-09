'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Bot,
  FileCode,
  FolderOpen,
  GitBranch,
  Inbox,
  MessageSquare,
  Plus,
  Search,
  Server,
  Terminal,
  Zap,
} from 'lucide-react';
import { Button } from '@podex/ui';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center ${className}`}>
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-overlay flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-text-primary mb-2">{title}</h3>
      <p className="text-text-muted text-sm max-w-sm mb-6">{description}</p>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action &&
            (action.href ? (
              <Link href={action.href}>
                <Button variant="primary">
                  <Plus className="w-4 h-4 mr-2" />
                  {action.label}
                </Button>
              </Link>
            ) : (
              <Button variant="primary" onClick={action.onClick}>
                <Plus className="w-4 h-4 mr-2" />
                {action.label}
              </Button>
            ))}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Link href={secondaryAction.href}>
                <Button variant="ghost">{secondaryAction.label}</Button>
              </Link>
            ) : (
              <Button variant="ghost" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

// Pre-configured empty states for common scenarios

export function NoSessionsEmpty({ onCreateClick }: { onCreateClick?: () => void }) {
  return (
    <EmptyState
      icon={<Server className="w-8 h-8 text-text-muted" />}
      title="No pods yet"
      description="Create your first pod to start building with AI-powered development environments."
      action={{
        label: 'Create Pod',
        href: onCreateClick ? undefined : '/session/new',
        onClick: onCreateClick,
      }}
    />
  );
}

export function NoAgentsEmpty({ onAddClick }: { onAddClick?: () => void }) {
  return (
    <EmptyState
      icon={<Bot className="w-8 h-8 text-text-muted" />}
      title="No agents"
      description="Add an AI agent to help you with coding, reviewing, testing, or architecture decisions."
      action={{
        label: 'Add Agent',
        onClick: onAddClick,
      }}
    />
  );
}

export function NoMessagesEmpty() {
  return (
    <EmptyState
      icon={<MessageSquare className="w-8 h-8 text-text-muted" />}
      title="Start a conversation"
      description="Send a message to begin collaborating with this agent."
      className="py-12"
    />
  );
}

export function NoFilesEmpty({ onCreateClick }: { onCreateClick?: () => void }) {
  return (
    <EmptyState
      icon={<FolderOpen className="w-8 h-8 text-text-muted" />}
      title="No files"
      description="This workspace is empty. Create a new file or clone a repository to get started."
      action={{
        label: 'Create File',
        onClick: onCreateClick,
      }}
    />
  );
}

export function NoSearchResults({ query }: { query: string }) {
  return (
    <EmptyState
      icon={<Search className="w-8 h-8 text-text-muted" />}
      title="No results found"
      description={`No matches for "${query}". Try a different search term.`}
    />
  );
}

export function NoNotificationsEmpty() {
  return (
    <EmptyState
      icon={<Inbox className="w-8 h-8 text-text-muted" />}
      title="All caught up"
      description="You have no notifications at the moment."
      className="py-6"
    />
  );
}

export function NoActivityEmpty() {
  return (
    <EmptyState
      icon={<Zap className="w-8 h-8 text-text-muted" />}
      title="No recent activity"
      description="Activity will appear here as you work with your pods and agents."
      className="py-6"
    />
  );
}

export function NoGitChangesEmpty() {
  return (
    <EmptyState
      icon={<GitBranch className="w-8 h-8 text-text-muted" />}
      title="No changes"
      description="Your working directory is clean. Make some changes to see them here."
      className="py-6"
    />
  );
}

export function NoTerminalEmpty({ onOpenClick }: { onOpenClick?: () => void }) {
  return (
    <EmptyState
      icon={<Terminal className="w-8 h-8 text-text-muted" />}
      title="Terminal closed"
      description="Open a terminal to run commands in your workspace."
      action={{
        label: 'Open Terminal',
        onClick: onOpenClick,
      }}
      className="py-6"
    />
  );
}

export function NoPreviewEmpty() {
  return (
    <EmptyState
      icon={<FileCode className="w-8 h-8 text-text-muted" />}
      title="No file selected"
      description="Select a file from the sidebar to preview its contents."
      className="py-12"
    />
  );
}

// Compact empty state for smaller areas
export function CompactEmptyState({
  icon,
  message,
  className = '',
}: {
  icon?: ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center p-4 text-center ${className}`}>
      {icon && <div className="mb-2 text-text-muted">{icon}</div>}
      <p className="text-sm text-text-muted">{message}</p>
    </div>
  );
}
