'use client';

import { useEffect, useState } from 'react';
import {
  Bug,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Check,
  X,
  AlertCircle,
  CheckCircle,
  Shield,
  Copy,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useSentryStore,
  selectUnresolvedCount,
  selectFilteredIssues,
  selectIsLoading,
  type StatusFilter,
} from '@/stores/sentry';
import type { SentryIssue } from '@/lib/api/sentry';

interface SentryPanelProps {
  sessionId: string;
}

// ============================================================================
// Setup Wizard Component
// ============================================================================

function SentrySetupWizard() {
  const {
    setupToken,
    setupShowToken,
    setupValidationStatus,
    setupValidationError,
    setupIsEnabling,
    setupShowInstructions,
    setSetupToken,
    toggleSetupShowToken,
    toggleSetupInstructions,
    validateToken,
    connectSentry,
    error,
  } = useSentryStore();

  const [isValidating, setIsValidating] = useState(false);

  // Debounced token validation
  useEffect(() => {
    if (!setupToken.trim()) return;

    const timeoutId = setTimeout(async () => {
      setIsValidating(true);
      await validateToken();
      setIsValidating(false);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [setupToken, validateToken]);

  const handleConnect = async () => {
    if (setupValidationStatus !== 'valid') {
      // Validate first if not already valid
      const isValid = await validateToken();
      if (!isValid) return;
    }
    await connectSentry();
  };

  const handleCopyScope = (scope: string) => {
    navigator.clipboard.writeText(scope);
  };

  const canConnect = setupValidationStatus === 'valid' && !setupIsEnabling;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="text-center pt-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent-primary/10 mb-3">
            <Bug className="h-6 w-6 text-accent-primary" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary">Connect to Sentry</h3>
          <p className="text-sm text-text-secondary mt-1">
            See the same errors your AI agents can see and fix.
          </p>
        </div>

        {/* Benefits */}
        <div className="space-y-2 bg-surface rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Check className="h-4 w-4 text-success shrink-0" />
            <span>View issues across all projects</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Check className="h-4 w-4 text-success shrink-0" />
            <span>Track error trends &amp; impact</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Check className="h-4 w-4 text-success shrink-0" />
            <span>Jump to errors in your code</span>
          </div>
        </div>

        {/* Instructions (collapsible) */}
        <div className="border border-border-subtle rounded-lg overflow-hidden">
          <button
            onClick={toggleSetupInstructions}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-text-primary hover:bg-overlay transition-colors"
          >
            <span>How to get your auth token</span>
            {setupShowInstructions ? (
              <ChevronDown className="h-4 w-4 text-text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-muted" />
            )}
          </button>

          {setupShowInstructions && (
            <div className="px-3 pb-3 space-y-3 border-t border-border-subtle bg-surface/50">
              <div className="pt-3">
                <p className="text-xs font-medium text-text-secondary mb-1">
                  1. Go to Sentry Settings
                </p>
                <a
                  href="https://sentry.io/settings/auth-tokens/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-accent-primary hover:underline"
                >
                  Open Sentry Settings
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <div>
                <p className="text-xs font-medium text-text-secondary mb-1">
                  2. Create a new auth token with these scopes:
                </p>
                <div className="bg-void rounded p-2 space-y-1">
                  {['project:read', 'event:read', 'org:read'].map((scope) => (
                    <div key={scope} className="flex items-center justify-between">
                      <code className="text-xs text-text-primary font-mono">{scope}</code>
                      <button
                        onClick={() => handleCopyScope(scope)}
                        className="p-1 text-text-muted hover:text-text-primary transition-colors"
                        title="Copy scope"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-text-secondary">
                  3. Copy and paste your token below
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Token Input */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Sentry Auth Token</label>
          <div className="relative">
            <input
              type={setupShowToken ? 'text' : 'password'}
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="sntrk_..."
              className={cn(
                'w-full px-3 py-2 pr-20 bg-surface border rounded-md text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:ring-2 focus:ring-accent-primary/50',
                setupValidationStatus === 'invalid' && 'border-error',
                setupValidationStatus === 'valid' && 'border-success',
                setupValidationStatus !== 'invalid' &&
                  setupValidationStatus !== 'valid' &&
                  'border-border-default'
              )}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {/* Validation indicator */}
              {isValidating || setupValidationStatus === 'checking' ? (
                <Loader2 className="h-4 w-4 text-text-muted animate-spin" />
              ) : setupValidationStatus === 'valid' ? (
                <CheckCircle className="h-4 w-4 text-success" />
              ) : setupValidationStatus === 'invalid' ? (
                <AlertCircle className="h-4 w-4 text-error" />
              ) : null}

              {/* Show/hide toggle */}
              <button
                type="button"
                onClick={toggleSetupShowToken}
                className="p-1 text-text-muted hover:text-text-primary transition-colors"
              >
                {setupShowToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Validation error message */}
          {setupValidationStatus === 'invalid' && setupValidationError && (
            <p className="text-xs text-error">{setupValidationError}</p>
          )}

          {/* Validation success message */}
          {setupValidationStatus === 'valid' && (
            <p className="text-xs text-success">Token is valid</p>
          )}
        </div>

        {/* Connect Button */}
        <button
          onClick={handleConnect}
          disabled={!canConnect}
          className={cn(
            'w-full py-2.5 rounded-md text-sm font-medium transition-colors',
            'flex items-center justify-center gap-2',
            canConnect
              ? 'bg-accent-primary text-text-inverse hover:bg-accent-primary/90'
              : 'bg-overlay text-text-muted cursor-not-allowed'
          )}
        >
          {setupIsEnabling ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Sentry'
          )}
        </button>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-error/10 border border-error/20 rounded-md">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        {/* Security note */}
        <div className="flex items-start gap-2 text-xs text-text-muted">
          <Shield className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Your token is encrypted and stored securely</span>
        </div>

        {/* Help links */}
        <div className="flex items-center justify-center gap-4 pt-2">
          <a
            href="https://docs.sentry.io/api/auth/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Documentation
          </a>
          <span className="text-text-muted">·</span>
          <a
            href="https://sentry.io/privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Privacy Info
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Issue Row Component
// ============================================================================

interface IssueRowProps {
  issue: SentryIssue;
  isExpanded: boolean;
  onToggle: () => void;
}

function IssueRow({ issue, isExpanded, onToggle }: IssueRowProps) {
  const levelColors = {
    fatal: 'bg-error',
    error: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-text-muted',
  };

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 text-left hover:bg-overlay transition-colors"
      >
        <div className="flex items-start gap-2">
          {/* Severity indicator */}
          <div
            className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', levelColors[issue.level])}
            title={issue.level}
          />

          <div className="flex-1 min-w-0">
            {/* Title */}
            <p className="text-sm text-text-primary font-medium truncate">{issue.title}</p>

            {/* Location */}
            <p className="text-xs text-text-muted truncate mt-0.5">{issue.culprit}</p>

            {/* Stats */}
            <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
              <span>{issue.count} events</span>
              <span>·</span>
              <span>{issue.userCount} users</span>
              <span>·</span>
              <span>{formatTimeAgo(issue.lastSeen)}</span>
            </div>
          </div>

          {/* Expand indicator */}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted shrink-0" />
          )}
        </div>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 pl-7 space-y-3 bg-surface/50">
          {/* Issue ID */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">ID:</span>
            <code className="text-text-primary font-mono">{issue.shortId}</code>
          </div>

          {/* Project */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Project:</span>
            <span className="text-text-primary">{issue.project.name}</span>
          </div>

          {/* First seen */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">First seen:</span>
            <span className="text-text-primary">{formatTimeAgo(issue.firstSeen)}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <a
              href={issue.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
            >
              View in Sentry
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(issue.permalink)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Issues List Component
// ============================================================================

function SentryIssuesList() {
  const {
    projects,
    selectedProjectSlug,
    statusFilter,
    isLoadingProjects,
    isLoadingIssues,
    expandedIssueId,
    error,
    selectProject,
    setStatusFilter,
    toggleIssueExpanded,
    refresh,
    disconnectSentry,
  } = useSentryStore();

  const filteredIssues = useSentryStore(selectFilteredIssues);
  const unresolvedCount = useSentryStore(selectUnresolvedCount);
  const isLoading = useSentryStore(selectIsLoading);

  const [showSettings, setShowSettings] = useState(false);

  const filterTabs: { value: StatusFilter; label: string }[] = [
    { value: 'unresolved', label: 'Unresolved' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border-subtle space-y-2">
        {/* Project selector and actions */}
        <div className="flex items-center gap-2">
          <select
            value={selectedProjectSlug || ''}
            onChange={(e) => selectProject(e.target.value || null)}
            disabled={isLoadingProjects}
            className="flex-1 px-2 py-1.5 bg-surface border border-border-default rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            {projects.length === 0 ? (
              <option value="">No projects found</option>
            ) : (
              projects.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))
            )}
          </select>

          <button
            onClick={() => refresh()}
            disabled={isLoading}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>

            {showSettings && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-elevated border border-border-default rounded-md shadow-lg z-50">
                <button
                  className="w-full px-3 py-2 text-left text-sm text-error hover:bg-overlay flex items-center gap-2"
                  onClick={() => {
                    setShowSettings(false);
                    disconnectSentry();
                  }}
                >
                  <X className="h-4 w-4" />
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-surface rounded-md p-0.5">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                'flex-1 px-2 py-1 text-xs font-medium rounded transition-colors',
                statusFilter === tab.value
                  ? 'bg-accent-primary text-text-inverse'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {tab.label}
              {tab.value === 'unresolved' && unresolvedCount > 0 && (
                <span className="ml-1">({unresolvedCount})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Issues list */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingIssues ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-text-muted animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-center">
            <AlertCircle className="h-8 w-8 text-error mx-auto mb-2" />
            <p className="text-sm text-error">{error}</p>
            <button
              onClick={() => refresh()}
              className="mt-2 text-sm text-accent-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : filteredIssues.length === 0 ? (
          <div className="p-4 text-center">
            <CheckCircle className="h-8 w-8 text-success mx-auto mb-2" />
            <p className="text-sm text-text-muted">
              {statusFilter === 'unresolved'
                ? 'No unresolved issues!'
                : statusFilter === 'resolved'
                  ? 'No resolved issues'
                  : 'No issues found'}
            </p>
          </div>
        ) : (
          <div>
            {filteredIssues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                isExpanded={expandedIssueId === issue.id}
                onToggle={() => toggleIssueExpanded(issue.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border-subtle">
        <a
          href="https://sentry.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Open Sentry Dashboard
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Main Panel Component
// ============================================================================

export function SentryPanel({ sessionId: _sessionId }: SentryPanelProps) {
  const { isConfigured, isCheckingConfig, checkConfiguration } = useSentryStore();

  // Check configuration on mount
  useEffect(() => {
    checkConfiguration();
  }, [checkConfiguration]);

  // Show loading while checking configuration
  if (isCheckingConfig) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 text-text-muted animate-spin" />
      </div>
    );
  }

  // Show setup wizard or issues list based on configuration status
  return isConfigured ? <SentryIssuesList /> : <SentrySetupWizard />;
}
