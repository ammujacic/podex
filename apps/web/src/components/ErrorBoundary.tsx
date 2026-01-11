'use client';

import React, { Component, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  RefreshCw,
  Home,
  Bug,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  level?: 'page' | 'section' | 'component';
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// ============================================================================
// Error Boundary Class Component
// ============================================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Log to error reporting service
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Call custom error handler
    this.props.onError?.(error, errorInfo);

    // Store error for recovery
    try {
      const errorData = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        url: window.location.href,
      };
      sessionStorage.setItem('lastError', JSON.stringify(errorData));
    } catch {
      // Ignore storage errors
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error!, this.handleReset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI based on level
      return (
        <ErrorFallback
          error={this.state.error!}
          errorInfo={this.state.errorInfo}
          reset={this.handleReset}
          level={this.props.level || 'section'}
          showDetails={this.props.showDetails}
        />
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Error Fallback UI
// ============================================================================

interface ErrorFallbackProps {
  error: Error;
  errorInfo: React.ErrorInfo | null;
  reset: () => void;
  level: 'page' | 'section' | 'component';
  showDetails?: boolean;
}

function ErrorFallback({
  error,
  errorInfo,
  reset,
  level,
  showDetails = false,
}: ErrorFallbackProps) {
  const [showStack, setShowStack] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copyErrorInfo = () => {
    const info = `
Error: ${error.message}
Stack: ${error.stack}
Component Stack: ${errorInfo?.componentStack || 'N/A'}
URL: ${window.location.href}
Time: ${new Date().toISOString()}
    `.trim();

    navigator.clipboard.writeText(info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Page-level error
  if (level === 'page') {
    return (
      <div className="min-h-screen bg-void flex items-center justify-center p-8">
        <div className="max-w-lg w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Something went wrong</h1>
          <p className="text-text-muted mb-6">
            We're sorry, but something unexpected happened. Please try refreshing the page.
          </p>

          <div className="flex justify-center gap-3 mb-6">
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-void"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            <Link
              href="/"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border-default text-text-secondary hover:text-text-primary"
            >
              <Home className="h-4 w-4" />
              Go Home
            </Link>
          </div>

          {(showDetails || process.env.NODE_ENV === 'development') && (
            <div className="text-left">
              <button
                onClick={() => setShowStack(!showStack)}
                className="flex items-center gap-2 text-sm text-text-muted hover:text-text-secondary mb-2"
              >
                <Bug className="h-4 w-4" />
                {showStack ? 'Hide' : 'Show'} error details
                {showStack ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {showStack && (
                <div className="relative">
                  <button
                    onClick={copyErrorInfo}
                    className="absolute top-2 right-2 p-1.5 rounded bg-overlay text-text-muted hover:text-text-primary"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                  <pre className="p-4 rounded-lg bg-surface border border-border-subtle text-xs text-text-muted overflow-auto max-h-48">
                    {error.stack}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Section-level error
  if (level === 'section') {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-text-primary mb-1">
              This section encountered an error
            </h3>
            <p className="text-sm text-text-muted mb-3">{error.message}</p>
            <button
              onClick={reset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30"
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
    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm">
      <div className="flex items-center gap-2 text-red-400">
        <AlertTriangle className="h-4 w-4" />
        <span>Error loading component</span>
        <button onClick={reset} className="ml-auto p-1 rounded hover:bg-red-500/20">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Session Recovery
// ============================================================================

interface SessionRecoveryState {
  lastSession: {
    sessionId: string;
    files: { path: string; content: string; isDirty: boolean }[];
    activeFile: string | null;
    timestamp: string;
  } | null;
}

interface SessionRecoveryProps {
  onRecover: (session: SessionRecoveryState['lastSession']) => void;
  onDiscard: () => void;
}

export function SessionRecovery({ onRecover, onDiscard }: SessionRecoveryProps) {
  const [lastSession, setLastSession] = React.useState<SessionRecoveryState['lastSession']>(null);
  const [isVisible, setIsVisible] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('sessionBackup');
      if (saved) {
        const session = JSON.parse(saved);
        const sessionAge = Date.now() - new Date(session.timestamp).getTime();
        // Only show recovery if session is less than 24 hours old
        if (sessionAge < 24 * 60 * 60 * 1000 && session.files?.length > 0) {
          setLastSession(session);
          setIsVisible(true);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const handleRecover = () => {
    if (lastSession) {
      onRecover(lastSession);
      setIsVisible(false);
      localStorage.removeItem('sessionBackup');
    }
  };

  const handleDiscard = () => {
    onDiscard();
    setIsVisible(false);
    localStorage.removeItem('sessionBackup');
  };

  if (!isVisible || !lastSession) return null;

  const sessionDate = new Date(lastSession.timestamp);
  const dirtyFiles = lastSession.files.filter((f) => f.isDirty);

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-surface border border-border-default rounded-lg shadow-xl p-4 z-50">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="h-5 w-5 text-warning" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-text-primary mb-1">Recover previous session?</h3>
          <p className="text-sm text-text-muted mb-2">
            Found unsaved changes from {sessionDate.toLocaleString()}
          </p>
          {dirtyFiles.length > 0 && (
            <div className="text-xs text-text-muted mb-3">
              <span className="font-medium">{dirtyFiles.length} unsaved file(s):</span>
              <ul className="mt-1 space-y-0.5">
                {dirtyFiles.slice(0, 3).map((f) => (
                  <li key={f.path} className="truncate">
                    • {f.path.split('/').pop()}
                  </li>
                ))}
                {dirtyFiles.length > 3 && <li>...and {dirtyFiles.length - 3} more</li>}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleRecover}
              className="flex-1 px-3 py-1.5 rounded text-sm bg-accent-primary text-void"
            >
              Recover
            </button>
            <button
              onClick={handleDiscard}
              className="flex-1 px-3 py-1.5 rounded text-sm border border-border-default text-text-secondary hover:text-text-primary"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Auto-save Hook
// ============================================================================

interface AutoSaveOptions {
  interval?: number;
  key?: string;
}

export function useAutoSave<T>(
  data: T,
  options?: AutoSaveOptions
): { lastSaved: Date | null; save: () => void } {
  const { interval = 30000, key = 'autoSave' } = options || {};
  const [lastSaved, setLastSaved] = React.useState<Date | null>(null);
  const dataRef = React.useRef(data);

  // Update ref when data changes
  React.useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Save function
  const save = React.useCallback(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          data: dataRef.current,
          timestamp: new Date().toISOString(),
        })
      );
      setLastSaved(new Date());
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  }, [key]);

  // Auto-save interval
  React.useEffect(() => {
    const timer = setInterval(save, interval);
    return () => clearInterval(timer);
  }, [save, interval]);

  // Save on page unload
  React.useEffect(() => {
    const handleBeforeUnload = () => {
      save();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [save]);

  return { lastSaved, save };
}

// ============================================================================
// Async Error Boundary Hook
// ============================================================================

interface AsyncErrorState {
  error: Error | null;
  isError: boolean;
  reset: () => void;
}

export function useAsyncErrorBoundary(): [(error: Error) => void, AsyncErrorState] {
  const [error, setError] = React.useState<Error | null>(null);

  const throwError = React.useCallback((err: Error) => {
    setError(err);
  }, []);

  const reset = React.useCallback(() => {
    setError(null);
  }, []);

  // Re-throw to trigger ErrorBoundary
  if (error) {
    throw error;
  }

  return [throwError, { error, isError: !!error, reset }];
}
