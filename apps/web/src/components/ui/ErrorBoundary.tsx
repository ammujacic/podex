'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { Button } from '@podex/ui';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleGoHome = () => {
    window.location.href = '/dashboard';
  };

  handleReportIssue = () => {
    const { error, errorInfo } = this.state;
    const subject = encodeURIComponent(`Bug Report: ${error?.message || 'Unknown error'}`);
    const body = encodeURIComponent(
      `**Error:**\n\`\`\`\n${error?.message}\n\`\`\`\n\n**Stack Trace:**\n\`\`\`\n${error?.stack}\n\`\`\`\n\n**Component Stack:**\n\`\`\`\n${errorInfo?.componentStack}\n\`\`\`\n\n**Browser:** ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}\n**URL:** ${typeof window !== 'undefined' ? window.location.href : 'Unknown'}`
    );
    // Open GitHub issues page - users can file issues at the podex repository
    window.open(
      `https://github.com/podex-dev/podex/issues/new?title=${subject}&body=${body}&labels=bug`,
      '_blank'
    );
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, showDetails = process.env.NODE_ENV === 'development' } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-accent-error/10 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-accent-error" />
              </div>
            </div>

            {/* Title */}
            <h2 className="text-xl font-semibold text-text-primary mb-2">Something went wrong</h2>

            {/* Description */}
            <p className="text-text-secondary mb-6">
              We encountered an unexpected error. Please try again or return to the dashboard.
            </p>

            {/* Error details (development only) */}
            {showDetails && error && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-text-muted hover:text-text-secondary transition-colors">
                  View error details
                </summary>
                <div className="mt-2 p-3 bg-elevated rounded-lg overflow-auto max-h-48">
                  <p className="text-sm font-mono text-accent-error mb-2">{error.message}</p>
                  {error.stack && (
                    <pre className="text-xs text-text-muted whitespace-pre-wrap">{error.stack}</pre>
                  )}
                  {errorInfo?.componentStack && (
                    <pre className="text-xs text-text-muted whitespace-pre-wrap mt-2 pt-2 border-t border-border-subtle">
                      {errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={this.handleRetry} variant="primary">
                <RefreshCw className="w-4 h-4" />
                Try Again
              </Button>
              <Button onClick={this.handleGoHome} variant="secondary">
                <Home className="w-4 h-4" />
                Go to Dashboard
              </Button>
              <Button onClick={this.handleReportIssue} variant="ghost">
                <Bug className="w-4 h-4" />
                Report Issue
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

// Inline error display for smaller components
interface InlineErrorProps {
  error: Error | string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ error, onRetry, className }: InlineErrorProps) {
  const message = typeof error === 'string' ? error : error.message;

  return (
    <div
      className={`flex items-center gap-3 p-3 bg-accent-error/10 border border-accent-error/20 rounded-lg ${className}`}
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 text-accent-error flex-shrink-0" />
      <p className="text-sm text-text-primary flex-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-accent-primary hover:underline flex-shrink-0"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// Empty state component
interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-4 text-center ${className}`}
    >
      {icon && (
        <div className="w-16 h-16 rounded-full bg-elevated flex items-center justify-center mb-4">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-text-primary mb-1">{title}</h3>
      {description && <p className="text-sm text-text-secondary max-w-sm mb-4">{description}</p>}
      {action && (
        <Button onClick={action.onClick} variant="primary" size="sm">
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Loading error retry component
interface LoadingErrorProps {
  error: Error | string;
  onRetry: () => void;
  isRetrying?: boolean;
}

export function LoadingError({ error, onRetry, isRetrying }: LoadingErrorProps) {
  const message = typeof error === 'string' ? error : error.message;

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <AlertTriangle className="w-10 h-10 text-accent-error mb-4" />
      <p className="text-text-secondary text-center mb-4 max-w-sm">{message}</p>
      <Button onClick={onRetry} variant="secondary" disabled={isRetrying}>
        {isRetrying ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Retrying...
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4" />
            Try Again
          </>
        )}
      </Button>
    </div>
  );
}
