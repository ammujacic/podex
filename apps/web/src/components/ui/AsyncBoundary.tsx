'use client';

import React, { Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

// ============================================================================
// Error Boundary Component
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  level?: 'page' | 'section' | 'component';
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AsyncBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error!, this.handleReset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const level = this.props.level || 'component';

      // Page-level error
      if (level === 'page') {
        return (
          <div className="min-h-[400px] flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="h-8 w-8 text-red-400" />
              </div>
              <h2 className="text-lg font-medium text-text-primary mb-2">Something went wrong</h2>
              <p className="text-sm text-text-muted mb-4">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <button
                onClick={this.handleReset}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-void text-sm font-medium hover:bg-opacity-90"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
            </div>
          </div>
        );
      }

      // Section-level error
      if (level === 'section') {
        return (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary mb-1">
                  Failed to load this section
                </p>
                <p className="text-xs text-text-muted mb-2">
                  {this.state.error?.message || 'An error occurred'}
                </p>
                <button
                  onClick={this.handleReset}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Component-level error (compact)
      return (
        <div className="p-2 bg-red-500/10 border border-red-500/30 rounded text-xs">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-3 w-3" />
            <span className="flex-1 truncate">{this.state.error?.message || 'Error'}</span>
            <button
              onClick={this.handleReset}
              className="p-1 rounded hover:bg-red-500/20"
              aria-label="Retry"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Loading Fallbacks
// ============================================================================

function DefaultLoadingFallback({ level }: { level: 'page' | 'section' | 'component' }) {
  if (level === 'page') {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
          <span className="text-sm text-text-muted">Loading...</span>
        </div>
      </div>
    );
  }

  if (level === 'section') {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  // Component level
  return (
    <div className="p-4 flex items-center justify-center">
      <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
    </div>
  );
}

// ============================================================================
// AsyncBoundary Component
// ============================================================================

interface AsyncBoundaryProps {
  children: ReactNode;
  level?: 'page' | 'section' | 'component';
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * AsyncBoundary combines ErrorBoundary and Suspense for easy async component handling.
 *
 * @example
 * // Wrap any async component
 * <AsyncBoundary level="section">
 *   <SomeAsyncComponent />
 * </AsyncBoundary>
 *
 * @example
 * // With custom fallbacks
 * <AsyncBoundary
 *   level="component"
 *   loadingFallback={<MySkeleton />}
 *   errorFallback={(error, reset) => <MyError error={error} onRetry={reset} />}
 * >
 *   <SomeAsyncComponent />
 * </AsyncBoundary>
 */
export function AsyncBoundary({
  children,
  level = 'component',
  loadingFallback,
  errorFallback,
  onError,
}: AsyncBoundaryProps) {
  return (
    <PanelErrorBoundary level={level} fallback={errorFallback} onError={onError}>
      <Suspense fallback={loadingFallback || <DefaultLoadingFallback level={level} />}>
        {children}
      </Suspense>
    </PanelErrorBoundary>
  );
}

// ============================================================================
// Specialized Wrappers
// ============================================================================

/**
 * Wrapper for workspace panels (terminal, editor, etc.)
 */
export function PanelBoundary({
  children,
  name,
  loadingFallback,
}: {
  children: ReactNode;
  name: string;
  loadingFallback?: ReactNode;
}) {
  return (
    <AsyncBoundary
      level="section"
      loadingFallback={loadingFallback}
      errorFallback={(error, reset) => (
        <div className="h-full flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">{name} failed to load</p>
            <p className="text-xs text-text-muted mb-3">{error.message}</p>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-overlay text-text-secondary hover:text-text-primary hover:bg-elevated"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </AsyncBoundary>
  );
}

/**
 * Wrapper for card components (agent cards, file previews, etc.)
 */
export function CardBoundary({
  children,
  loadingFallback,
}: {
  children: ReactNode;
  loadingFallback?: ReactNode;
}) {
  return (
    <AsyncBoundary level="component" loadingFallback={loadingFallback}>
      {children}
    </AsyncBoundary>
  );
}

// Re-export the error boundary for direct use
export { PanelErrorBoundary as ErrorBoundary };
