'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'default' | 'shimmer' | 'pulse';
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  style?: React.CSSProperties;
}

export function Skeleton({ className, variant = 'shimmer', rounded = 'md', style }: SkeletonProps) {
  const roundedClasses = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  };

  return (
    <div
      className={cn(
        roundedClasses[rounded],
        variant === 'shimmer' && 'skeleton',
        variant === 'pulse' && 'animate-pulse bg-overlay',
        variant === 'default' && 'bg-elevated',
        className
      )}
      style={style}
      aria-hidden="true"
    />
  );
}

// Text skeleton with multiple lines
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

// Dashboard-specific skeletons
export function SessionCardSkeleton() {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-4 h-[140px] flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <Skeleton className="w-16 h-6 rounded-full" />
      </div>
      <Skeleton className="h-5 w-3/4 mb-2" />
      <div className="mt-auto">
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

export function StatsCardSkeleton() {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-6 w-16" />
        </div>
      </div>
      <Skeleton className="h-3 w-24 mt-2" />
    </div>
  );
}

export function ActivityItemSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <Skeleton className="w-8 h-8 rounded-lg flex-shrink-0" />
      <div className="flex-1">
        <Skeleton className="h-4 w-3/4 mb-2" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function TemplateCardSkeleton() {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-4 text-center">
      <Skeleton className="w-12 h-12 rounded-xl mx-auto mb-2" />
      <Skeleton className="h-4 w-16 mx-auto" />
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-4 h-full flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-5 w-24 mb-1" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="w-6 h-6 rounded" />
      </div>
      <div className="flex-1 space-y-3">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-3/4 rounded-lg ml-auto" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <div className="mt-4 pt-4 border-t border-border-subtle">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function FileTreeSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <Skeleton className="w-4 h-4" />
          <Skeleton className="h-4 flex-1" style={{ width: `${50 + Math.random() * 50}%` }} />
        </div>
      ))}
    </div>
  );
}

// Dashboard loading skeleton
export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-void">
      {/* Header skeleton */}
      <header className="bg-void/80 backdrop-blur-lg border-b border-border-subtle sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome section */}
        <div className="mb-8">
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>

        {/* Search bar */}
        <div className="mb-10">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-10">
          <StatsCardSkeleton />
          <StatsCardSkeleton />
          <StatsCardSkeleton />
          <StatsCardSkeleton />
        </div>

        {/* Quick actions */}
        <div className="flex gap-3 mb-10">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>

        {/* Charts and activity */}
        <div className="grid gap-6 lg:grid-cols-2 mb-10">
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <Skeleton className="h-5 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </div>
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <Skeleton className="h-5 w-32 mb-4" />
            <div className="space-y-3">
              <ActivityItemSkeleton />
              <ActivityItemSkeleton />
              <ActivityItemSkeleton />
            </div>
          </div>
        </div>

        {/* Recent pods */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        </div>

        {/* Templates */}
        <div className="mt-10">
          <Skeleton className="h-6 w-48 mb-4" />
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <TemplateCardSkeleton />
            <TemplateCardSkeleton />
            <TemplateCardSkeleton />
            <TemplateCardSkeleton />
            <TemplateCardSkeleton />
            <TemplateCardSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}
