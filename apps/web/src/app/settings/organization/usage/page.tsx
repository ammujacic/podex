'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Download,
  DollarSign,
  Zap,
  Cpu,
  Users,
  ChevronLeft,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { getOrgUsageBreakdown, type OrgUsageResponse } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsOrgOwner, useOrgContext } from '@/stores/organization';
import Link from 'next/link';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toLocaleString();
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export default function OrganizationUsagePage() {
  useDocumentTitle('Organization Usage');
  const router = useRouter();
  const isOwner = useIsOrgOwner();
  const orgContext = useOrgContext();

  const [usage, setUsage] = useState<OrgUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not owner/admin
  useEffect(() => {
    if (!isOwner && orgContext !== null) {
      router.push('/settings/organization');
    }
  }, [isOwner, orgContext, router]);

  // Fetch usage data
  useEffect(() => {
    const fetchUsage = async () => {
      if (!orgContext) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getOrgUsageBreakdown(orgContext.organization.id);
        setUsage(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load usage data');
      } finally {
        setLoading(false);
      }
    };
    fetchUsage();
  }, [orgContext]);

  const handleExportCSV = () => {
    if (!usage) return;

    // Export by member
    const headers = ['Member', 'Email', 'Tokens', 'Compute', 'Total Cost'];
    const rows = usage.by_member.map((member) => [
      member.user_name || 'Unknown',
      member.user_email || '',
      member.total_tokens.toString(),
      formatCents(member.total_compute_cents),
      formatCents(member.total_cost_cents),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `org-usage-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOwner) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="bg-accent-error/10 border border-accent-error/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent-error flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-accent-error">Error Loading Usage Data</h3>
              <p className="text-sm text-text-secondary mt-1">{error}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => window.location.reload()}
              >
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/settings/organization/billing"
          className="inline-flex items-center text-sm text-text-muted hover:text-text-primary mb-4"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Billing
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Organization Usage</h1>
            <p className="text-sm text-text-muted mt-1">
              Detailed usage breakdown for your organization
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleExportCSV} disabled={!usage}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Period Info */}
      {usage && (
        <div className="text-sm text-text-muted mb-6">
          {new Date(usage.period_start).toLocaleDateString()} -{' '}
          {new Date(usage.period_end).toLocaleDateString()}
        </div>
      )}

      {/* Summary Cards */}
      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted">Total Tokens</span>
              <Zap className="w-5 h-5 text-accent-primary" />
            </div>
            <div className="text-2xl font-semibold text-text-primary">
              {formatTokens(usage.total_tokens)}
            </div>
          </div>

          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted">Compute Credits</span>
              <Cpu className="w-5 h-5 text-accent-secondary" />
            </div>
            <div className="text-2xl font-semibold text-text-primary">
              {formatCents(usage.total_compute_cents)}
            </div>
          </div>

          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted">Total Cost</span>
              <DollarSign className="w-5 h-5 text-accent-success" />
            </div>
            <div className="text-2xl font-semibold text-text-primary">
              {formatCents(usage.total_cost_cents)}
            </div>
          </div>

          <div className="bg-surface border border-border-default rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-muted">Active Members</span>
              <Users className="w-5 h-5 text-info" />
            </div>
            <div className="text-2xl font-semibold text-text-primary">{usage.by_member.length}</div>
          </div>
        </div>
      )}

      {/* Usage Breakdown */}
      {usage && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* By Model */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Usage by Model</h2>
            {usage.by_model.length > 0 ? (
              <div className="space-y-3">
                {usage.by_model.map((model) => (
                  <div
                    key={model.model}
                    className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                  >
                    <div>
                      <div className="font-medium text-text-primary text-sm">{model.model}</div>
                      <div className="text-xs text-text-muted">
                        {formatTokens(model.total_tokens)} tokens · {model.record_count} requests
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-text-primary text-sm">
                        {formatCents(model.total_cost_cents)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-8">No usage data available</p>
            )}
          </div>

          {/* By Session */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Usage by Pod</h2>
            {usage.by_session.length > 0 ? (
              <div className="space-y-3">
                {usage.by_session.map((session) => (
                  <div
                    key={session.session_id}
                    className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                  >
                    <div>
                      <div className="font-medium text-text-primary text-sm">
                        {session.session_name || `Pod ${session.session_id.slice(0, 8)}`}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatTokens(session.total_tokens)} tokens
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-text-primary text-sm">
                        {formatCents(session.total_cost_cents)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-8">No usage data available</p>
            )}
          </div>
        </div>
      )}

      {/* Usage by Member */}
      {usage && (
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Usage by Member</h2>
          {usage.by_member.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">
                      Member
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">
                      Tokens
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">
                      Compute
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">
                      Total Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usage.by_member.map((member) => (
                    <tr
                      key={member.user_id}
                      className="border-b border-border-subtle last:border-0 hover:bg-overlay"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-text-primary text-sm">
                          {member.user_name || 'Unknown'}
                        </div>
                        <div className="text-xs text-text-muted">{member.user_email}</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-text-primary text-right">
                        {formatNumber(member.total_tokens)}
                      </td>
                      <td className="py-3 px-4 text-sm text-text-primary text-right">
                        {formatCents(member.total_compute_cents)}
                      </td>
                      <td className="py-3 px-4 text-sm text-text-primary text-right font-medium">
                        {formatCents(member.total_cost_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-text-muted text-center py-8">No usage data available</p>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !usage && !error && (
        <div className="flex flex-col items-center justify-center py-16">
          <Zap className="w-16 h-16 text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Usage Data</h3>
          <p className="text-sm text-text-muted text-center max-w-md">
            Usage data will appear here once your organization members start using the platform.
          </p>
        </div>
      )}
    </div>
  );
}
