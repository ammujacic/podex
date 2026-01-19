'use client';

import React from 'react';
import {
  Search,
  FileX,
  Users,
  AlertCircle,
  FolderOpen,
  CheckCircle2,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Generic empty state component for lists and panels.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  const sizeClasses = {
    sm: 'py-4 px-3',
    md: 'py-8 px-4',
    lg: 'py-12 px-6',
  };

  const iconSizes = {
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-14 w-14',
  };

  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizeClasses[size],
        className
      )}
      role="status"
    >
      <Icon className={cn('text-text-muted mb-3', iconSizes[size])} aria-hidden="true" />
      <h3 className={cn('font-medium text-text-primary', titleSizes[size])}>{title}</h3>
      {description && <p className="mt-1 text-sm text-text-muted max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Pre-configured empty states for common scenarios

export function SearchEmptyState({
  query,
  size = 'md',
}: {
  query?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <EmptyState
      icon={Search}
      title={query ? `No results for "${query}"` : 'No results found'}
      description="Try adjusting your search terms or filters"
      size={size}
    />
  );
}

export function NoFilesEmptyState({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <EmptyState
      icon={FileX}
      title="No files"
      description="This workspace doesn't have any files yet"
      size={size}
    />
  );
}

export function EmptyFolderState({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <EmptyState
      icon={FolderOpen}
      title="Empty folder"
      description="This folder doesn't contain any files or subfolders"
      size={size}
    />
  );
}

export function NoUsersEmptyState({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <EmptyState
      icon={Users}
      title="You're the only one here"
      description="Share this workspace to collaborate with others"
      size={size}
    />
  );
}

export function NoProblemsEmptyState({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <EmptyState
      icon={CheckCircle2}
      title="No issues found"
      description="Your code looks good! No errors or warnings detected."
      size={size}
    />
  );
}

export function NoMessagesEmptyState({
  agentName,
  size = 'md',
}: {
  agentName?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <EmptyState
      icon={Inbox}
      title="No messages yet"
      description={
        agentName
          ? `Start a conversation with ${agentName}`
          : 'Start a conversation to see messages here'
      }
      size={size}
    />
  );
}

export function ErrorEmptyState({
  message,
  onRetry,
  size = 'md',
}: {
  message?: string;
  onRetry?: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <EmptyState
      icon={AlertCircle}
      title="Something went wrong"
      description={message || 'An error occurred while loading data'}
      size={size}
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            Try again
          </button>
        )
      }
    />
  );
}
