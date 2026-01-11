'use client';

import type { ComponentType, ReactNode } from 'react';
import { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface LazyComponentProps {
  children: ReactNode;
  fallback?: ReactNode;
  className?: string;
}

interface LazyLoadOnVisibleProps {
  children: ReactNode;
  fallback?: ReactNode;
  rootMargin?: string;
  threshold?: number;
  className?: string;
}

// ============================================================================
// Default Fallback
// ============================================================================

function DefaultFallback({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center p-8', className)}>
      <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
    </div>
  );
}

// ============================================================================
// Lazy Component Wrapper
// ============================================================================

export function LazyComponent({ children, fallback, className }: LazyComponentProps) {
  return (
    <Suspense fallback={fallback || <DefaultFallback className={className} />}>{children}</Suspense>
  );
}

// ============================================================================
// Lazy Load on Visible (Intersection Observer)
// ============================================================================

export function LazyLoadOnVisible({
  children,
  fallback,
  rootMargin = '100px',
  threshold = 0,
  className,
}: LazyLoadOnVisibleProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [rootMargin, threshold]);

  return (
    <div ref={ref} className={className}>
      {isVisible ? children : fallback || <DefaultFallback />}
    </div>
  );
}

// ============================================================================
// Create Lazy Component Factory
// ============================================================================

export function createLazyComponent<T extends ComponentType<Record<string, unknown>>>(
  importFn: () => Promise<{ default: T }>,
  fallback?: ReactNode
) {
  const LazyComp = lazy(importFn);

  return function LazyWrapper(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={fallback || <DefaultFallback />}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <LazyComp {...(props as any)} />
      </Suspense>
    );
  };
}

// ============================================================================
// Preload Component
// ============================================================================

const preloadedComponents = new Map<
  string,
  Promise<{ default: ComponentType<Record<string, unknown>> }>
>();

export function preloadComponent<T extends ComponentType<Record<string, unknown>>>(
  id: string,
  importFn: () => Promise<{ default: T }>
): Promise<{ default: T }> {
  if (!preloadedComponents.has(id)) {
    preloadedComponents.set(
      id,
      importFn() as Promise<{ default: ComponentType<Record<string, unknown>> }>
    );
  }
  return preloadedComponents.get(id) as Promise<{ default: T }>;
}

// ============================================================================
// Lazy Panel (for collapsible/tab panels)
// ============================================================================

interface LazyPanelProps {
  isActive: boolean;
  children: ReactNode;
  fallback?: ReactNode;
  keepMounted?: boolean;
  className?: string;
}

export function LazyPanel({
  isActive,
  children,
  fallback,
  keepMounted = false,
  className,
}: LazyPanelProps) {
  const [hasBeenActive, setHasBeenActive] = useState(isActive);

  useEffect(() => {
    if (isActive && !hasBeenActive) {
      setHasBeenActive(true);
    }
  }, [isActive, hasBeenActive]);

  const shouldRender = keepMounted ? hasBeenActive : isActive;
  const shouldShow = isActive;

  if (!shouldRender) {
    return null;
  }

  return (
    <div className={cn(className, !shouldShow && 'hidden')} aria-hidden={!shouldShow}>
      <Suspense fallback={fallback || <DefaultFallback />}>{children}</Suspense>
    </div>
  );
}

// ============================================================================
// Skeleton Components
// ============================================================================

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animate?: boolean;
}

export function Skeleton({
  className,
  variant = 'text',
  width,
  height,
  animate = true,
}: SkeletonProps) {
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  return (
    <div
      className={cn('bg-overlay', animate && 'animate-pulse', variantClasses[variant], className)}
      style={{
        width: width,
        height: height || (variant === 'text' ? '1em' : undefined),
      }}
    />
  );
}

// Common skeleton layouts
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('p-4 rounded-lg border border-border-subtle', className)}>
      <div className="flex items-center gap-3 mb-3">
        <Skeleton variant="circular" width={40} height={40} />
        <div className="flex-1">
          <Skeleton width="60%" height={16} className="mb-2" />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      <Skeleton width="100%" height={12} className="mb-2" />
      <Skeleton width="80%" height={12} />
    </div>
  );
}

export function SkeletonList({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="circular" width={32} height={32} />
          <div className="flex-1">
            <Skeleton width={`${60 + Math.random() * 30}%`} height={14} className="mb-1" />
            <Skeleton width={`${40 + Math.random() * 20}%`} height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)}>
      {/* Header */}
      <div className="flex gap-4 pb-3 border-b border-border-subtle mb-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width={`${100 / columns}%`} height={14} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 py-2">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton key={colIdx} width={`${100 / columns}%`} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}
