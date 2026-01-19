'use client';

import { useEffect, useState, useMemo } from 'react';
import {
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
  Copy,
  Settings,
  Shield,
} from 'lucide-react';

// Custom Sentry icon component
function SentryIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 72 66"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M29,2.26a4.67,4.67,0,0,0-8,0L14.42,13.53A32.21,32.21,0,0,1,32.17,40.19H27.55A27.68,27.68,0,0,0,12.09,17.47L6,28a15.92,15.92,0,0,1,9.23,12.17H4.62A.76.76,0,0,1,4,39.06l2.94-5a10.74,10.74,0,0,0-3.36-1.9l-2.91,5a4.54,4.54,0,0,0,1.69,6.24A4.66,4.66,0,0,0,4.62,44H19.15a19.4,19.4,0,0,0-8-17.31l2.31-4A23.87,23.87,0,0,1,23.76,44H36.07a35.88,35.88,0,0,0-16.41-31.8l4.67-8a.77.77,0,0,1,1.05-.27c.53.29,20.29,34.77,20.66,35.17a.76.76,0,0,1-.68,1.13H40.6q.09,1.91,0,3.81h4.78A4.59,4.59,0,0,0,50,39.43a4.49,4.49,0,0,0-.62-2.28Z"
        transform="translate(11, 11)"
      />
    </svg>
  );
}

// Custom Seer AI icon component
function SeerIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 0.25C8.21 0.25 8.42 0.34 8.56 0.5C9.69 1.78 11.21 3.7 12.61 5.82C13.97 7.88 15.24 10.17 15.91 12.27C15.96 12.34 15.99 12.41 16 12.5C16.08 12.84 15.89 13.2 15.57 13.34C13.38 14.29 11.13 15 8 15C4.87 15 2.61 14.29 0.43 13.35C0.16 13.23 -0.02 12.95 -0.02 12.65C-0.02 12.53 0.02 12.4 0.08 12.3C0.75 10.2 2.03 7.9 3.39 5.83C4.79 3.71 6.31 1.78 7.44 0.5L7.49 0.45C7.63 0.32 7.81 0.25 8 0.25ZM13.65 10.66C12.05 11.19 10.1 11.5 8 11.5C5.9 11.5 3.95 11.19 2.35 10.66C2.1 11.2 1.87 11.73 1.68 12.24C3.53 12.99 5.43 13.5 8 13.5C10.56 13.5 12.47 12.99 14.32 12.24C14.13 11.72 13.9 11.19 13.65 10.66ZM8 5.5C5.92 5.5 4.02 7 3.12 9.33C4.03 9.61 5.08 9.81 6.22 9.92C6.08 9.64 6 9.33 6 9C6 7.9 6.9 7 8 7C9.1 7 10 7.9 10 9C10 9.33 9.92 9.64 9.78 9.92C10.92 9.81 11.96 9.61 12.88 9.33C11.98 7 10.08 5.5 8 5.5ZM8 2.15C7.49 2.76 6.93 3.46 6.35 4.23C6.88 4.08 7.43 4 8 4C8.57 4 9.13 4.08 9.65 4.24C9.07 3.46 8.51 2.76 8 2.15Z" />
    </svg>
  );
}
import { cn } from '@/lib/utils';
import { useSentryStore, SENTRY_REGIONS, type StatusFilter } from '@/stores/sentry';
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
    setupRegion,
    setupCustomHost,
    setupOpenAIKey,
    setupValidationStatus,
    setupValidationError,
    setupIsEnabling,
    setupShowInstructions,
    setSetupToken,
    setSetupRegion,
    setSetupCustomHost,
    setSetupOpenAIKey,
    toggleSetupShowToken,
    toggleSetupInstructions,
    validateToken,
    connectSentry,
    error,
  } = useSentryStore();

  const [isValidating, setIsValidating] = useState(false);

  // Debounced token validation (also depends on region)
  useEffect(() => {
    if (!setupToken.trim()) return;
    // For custom region, require custom host
    if (setupRegion === 'custom' && !setupCustomHost.trim()) return;

    const timeoutId = setTimeout(async () => {
      setIsValidating(true);
      await validateToken();
      setIsValidating(false);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [setupToken, setupRegion, setupCustomHost, validateToken]);

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

  // Check if custom host is provided when region is custom
  const hasRequiredHost = setupRegion !== 'custom' || setupCustomHost.trim().length > 0;
  const canConnect = setupValidationStatus === 'valid' && !setupIsEnabling && hasRequiredHost;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="text-center pt-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-accent-primary/10 mb-3">
            <SentryIcon className="h-6 w-6 text-accent-primary" />
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
                  {['org:read', 'project:read', 'project:write', 'team:read', 'event:write'].map(
                    (scope) => (
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
                    )
                  )}
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
              placeholder="sntrys_..."
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

        {/* Region Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">Sentry Region</label>
          <select
            value={setupRegion}
            onChange={(e) => setSetupRegion(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border-default rounded-md text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            {SENTRY_REGIONS.map((region) => (
              <option key={region.value} value={region.value}>
                {region.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            Select the region where your Sentry organization is hosted
          </p>
        </div>

        {/* Custom Host Input (only shown when "Self-hosted" is selected) */}
        {setupRegion === 'custom' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Custom Host</label>
            <input
              type="text"
              value={setupCustomHost}
              onChange={(e) => setSetupCustomHost(e.target.value)}
              placeholder="sentry.example.com"
              className="w-full px-3 py-2 bg-surface border border-border-default rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            />
            <p className="text-xs text-text-muted">
              Enter your self-hosted Sentry hostname (without https://)
            </p>
          </div>
        )}

        {/* OpenAI API Key Input (optional, for AI-powered issue search) */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text-primary">
            OpenAI API Key <span className="text-text-muted font-normal">(optional)</span>
          </label>
          <input
            type="password"
            value={setupOpenAIKey}
            onChange={(e) => setSetupOpenAIKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 bg-surface border border-border-default rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          />
          <p className="text-xs text-text-muted">
            Required for AI-powered issue search. Get one from{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline"
            >
              OpenAI
            </a>
          </p>
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
  organizationSlug: string;
  regionUrl?: string;
  onIssueUpdated: () => void;
}

function IssueRow({
  issue,
  isExpanded,
  onToggle,
  organizationSlug,
  regionUrl,
  onIssueUpdated,
}: IssueRowProps) {
  const [seerAnalysis, setSeerAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [seerError, setSeerError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleSeerAnalysis = async () => {
    if (isAnalyzing) return;

    setIsAnalyzing(true);
    setSeerError(null);

    try {
      // Import dynamically to avoid circular deps
      const { analyzeIssueWithSeer } = await import('@/lib/api/sentry');
      const analysis = await analyzeIssueWithSeer(organizationSlug, issue.shortId, { regionUrl });
      setSeerAnalysis(analysis);
    } catch (err) {
      setSeerError(err instanceof Error ? err.message : 'Failed to analyze issue');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResolve = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      const { resolveSentryIssue } = await import('@/lib/api/sentry');
      await resolveSentryIssue(organizationSlug, issue.shortId);
      onIssueUpdated();
    } catch (err) {
      console.error('Failed to resolve issue:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const levelColors = {
    fatal: 'bg-error',
    error: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-text-muted',
  };

  const formatTimeAgo = (dateString: string): string => {
    // If already a relative time string (from Sentry MCP), return as-is
    if (
      dateString.includes('ago') ||
      dateString.includes('just now') ||
      dateString.includes('hour') ||
      dateString.includes('day') ||
      dateString.includes('minute')
    ) {
      return dateString;
    }

    // Try to parse as ISO date
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if unparseable
    }

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
      <div
        onClick={onToggle}
        className="w-full px-3 py-2.5 text-left hover:bg-overlay transition-colors cursor-pointer"
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

          {/* Seer AI button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleSeerAnalysis();
            }}
            disabled={isAnalyzing}
            className={cn(
              'p-1.5 rounded transition-colors shrink-0',
              isAnalyzing ? 'text-text-muted cursor-wait' : 'text-purple-400 hover:bg-purple-500/10'
            )}
            title="Analyze with Seer"
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SeerIcon className="h-4 w-4" />
            )}
          </button>

          {/* Expand indicator */}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted shrink-0 mt-1" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted shrink-0 mt-1" />
          )}
        </div>
      </div>

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
          <div className="flex items-center gap-3 pt-2">
            <a
              href={issue.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-accent-primary hover:bg-accent-primary/10 rounded transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(issue.permalink)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            {issue.status === 'unresolved' && (
              <button
                onClick={handleResolve}
                disabled={isUpdating}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                  isUpdating ? 'text-text-muted cursor-wait' : 'text-success hover:bg-success/10'
                )}
              >
                {isUpdating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Resolve
              </button>
            )}
          </div>

          {/* Seer Analysis Results */}
          {seerError && (
            <div className="mt-3 p-2 bg-error/10 border border-error/20 rounded text-xs text-error">
              {seerError}
            </div>
          )}

          {seerAnalysis && (
            <div className="mt-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded">
              <div className="flex items-center gap-2 mb-2">
                <SeerIcon className="h-4 w-4 text-purple-400" />
                <span className="text-sm font-medium text-purple-400">Seer Analysis</span>
              </div>
              <div className="text-xs text-text-secondary whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                {seerAnalysis}
              </div>
            </div>
          )}
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
    organizations,
    selectedOrganizationSlug,
    projects,
    issues,
    selectedProjectSlug,
    statusFilter,
    isCheckingConfig,
    isLoadingOrganizations,
    isLoadingProjects,
    isLoadingIssues,
    expandedIssueId,
    error,
    selectOrganization,
    selectProject,
    setStatusFilter,
    toggleIssueExpanded,
    refresh,
    disconnectSentry,
  } = useSentryStore();

  // Memoize derived values to avoid infinite re-renders
  const filteredIssues = useMemo(() => {
    if (statusFilter === 'all') {
      return issues;
    }
    return issues.filter((i) => i.status === statusFilter);
  }, [issues, statusFilter]);

  const unresolvedCount = useMemo(
    () => issues.filter((i) => i.status === 'unresolved').length,
    [issues]
  );

  // Get regionUrl for the selected organization
  const selectedOrgRegionUrl = useMemo(() => {
    const org = organizations.find((o) => o.slug === selectedOrganizationSlug);
    return org?.regionUrl;
  }, [organizations, selectedOrganizationSlug]);

  const isLoading =
    isCheckingConfig || isLoadingOrganizations || isLoadingProjects || isLoadingIssues;

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
        {/* Organization selector (only if multiple orgs) */}
        {organizations.length > 1 && (
          <select
            value={selectedOrganizationSlug || ''}
            onChange={(e) => selectOrganization(e.target.value || null)}
            disabled={isLoadingOrganizations}
            className="w-full px-2 py-1.5 bg-surface border border-border-default rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            {organizations.map((org) => (
              <option key={org.slug} value={org.slug}>
                {org.name}
              </option>
            ))}
          </select>
        )}

        {/* Project selector and actions */}
        <div className="flex items-center gap-2">
          <select
            value={selectedProjectSlug || ''}
            onChange={(e) => selectProject(e.target.value || null)}
            disabled={isLoadingProjects}
            className="flex-1 px-2 py-1.5 bg-surface border border-border-default rounded text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            <option value="">All Projects</option>
            {projects.length === 0 && isLoadingProjects ? (
              <option value="" disabled>
                Loading...
              </option>
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
                organizationSlug={selectedOrganizationSlug || ''}
                regionUrl={selectedOrgRegionUrl}
                onIssueUpdated={refresh}
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
