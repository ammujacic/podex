'use client';

import { useState } from 'react';
import { Loader2, Download, DollarSign, Zap, Cpu, Activity, AlertCircle } from 'lucide-react';
import { Button } from '@podex/ui';
import { useUsageData } from '@/hooks/useUsageData';
import { QuotaProgressBar } from '@/components/billing';
import { formatCost, formatTokens } from '@/stores/cost';

type Period = 'current' | 'last_month';

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

export default function UsagePage() {
  const [period, setPeriod] = useState<Period>('current');
  const { summary, quotas, history, loading, error, refetch } = useUsageData({ period });

  // Debug logging
  if (summary) {
    console.warn('Usage Summary:', {
      tokensTotal: summary.tokensTotal,
      usageByModel: summary.usageByModel,
      usageByAgent: summary.usageByAgent,
    });
  }

  const handleExportCSV = () => {
    if (!history || history.length === 0) return;

    const headers = [
      'Date',
      'Type',
      'Quantity',
      'Unit',
      'Cost',
      'Model',
      'Tier',
      'Agent ID',
      'Session ID',
    ];
    const rows = history.map((record) => [
      new Date(record.created_at).toLocaleString(),
      record.usage_type,
      record.quantity.toString(),
      record.unit,
      `$${record.cost.toFixed(4)}`,
      record.model || '',
      record.tier || '',
      record.agent_id || '',
      record.session_id || '',
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage-${period}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
              <Button variant="secondary" size="sm" className="mt-3" onClick={refetch}>
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Usage</h1>
          <p className="text-sm text-text-muted mt-1">Track your resource consumption and costs</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="bg-surface border border-border-default rounded-lg pl-4 pr-10 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary appearance-none cursor-pointer"
            >
              <option value="current">Current Period</option>
              <option value="last_month">Last Month</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
              <svg
                className="w-4 h-4 text-text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExportCSV}
            disabled={!history || history.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Period Info */}
      {summary && (
        <div className="text-sm text-text-muted mb-6">
          {new Date(summary.periodStart).toLocaleDateString()} -{' '}
          {new Date(summary.periodEnd).toLocaleDateString()}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface border border-border-default rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-muted">Tokens Used</span>
            <Zap className="w-5 h-5 text-accent-primary" />
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {summary ? formatTokens(summary.tokensTotal) : '0'}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {summary ? `$${summary.tokensCost.toFixed(2)}` : '$0.00'}
          </div>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-muted">Compute Credits</span>
            <Cpu className="w-5 h-5 text-accent-secondary" />
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {summary ? `$${summary.computeCreditsUsed.toFixed(2)}` : '$0.00'}
          </div>
          <div className="text-xs text-text-muted mt-1">
            {summary ? `${summary.computeHours.toFixed(1)} hours` : '0 hours'}
          </div>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-muted">Token Cost</span>
            <Activity className="w-5 h-5 text-info" />
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {summary ? `$${summary.tokensCost.toFixed(2)}` : '$0.00'}
          </div>
          <div className="text-xs text-text-muted mt-1">all models</div>
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-text-muted">Total Cost</span>
            <DollarSign className="w-5 h-5 text-accent-success" />
          </div>
          <div className="text-2xl font-semibold text-text-primary">
            {summary ? formatCost(summary.totalCost) : '$0.00'}
          </div>
          <div className="text-xs text-text-muted mt-1">this period</div>
        </div>
      </div>

      {/* Quotas Section */}
      {quotas && quotas.length > 0 && (
        <div className="bg-surface border border-border-default rounded-xl p-6 mb-8">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Resource Quotas</h2>
          <div className="space-y-4">
            {quotas.map((quota) => (
              <QuotaProgressBar key={quota.id} quota={quota} showDetails />
            ))}
          </div>
        </div>
      )}

      {/* Usage Breakdown */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* By Model */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Usage by Model</h2>
            {summary.usageByModel && Object.keys(summary.usageByModel).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(summary.usageByModel).map(([model, data]) => (
                  <div
                    key={model}
                    className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                  >
                    <div>
                      <div className="font-medium text-text-primary text-sm">{model}</div>
                      <div className="text-xs text-text-muted">
                        {formatTokens(data.input + data.output)} tokens
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-text-primary text-sm">
                        ${data.cost.toFixed(2)}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatTokens(data.input)} in / {formatTokens(data.output)} out
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted text-center py-8">No usage data available</p>
            )}
          </div>

          {/* By Agent */}
          <div className="bg-surface border border-border-default rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text-primary mb-4">Usage by Agent</h2>
            {summary.usageByAgent && Object.keys(summary.usageByAgent).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(summary.usageByAgent).map(([agentId, data]) => (
                  <div
                    key={agentId}
                    className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0"
                  >
                    <div>
                      <div className="font-medium text-text-primary text-sm">
                        Agent {agentId.slice(0, 8)}
                      </div>
                      <div className="text-xs text-text-muted">
                        {formatTokens(data.tokens)} tokens
                      </div>
                    </div>
                    <div className="font-medium text-text-primary text-sm">
                      ${data.cost.toFixed(2)}
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

      {/* Usage History Table */}
      {history && history.length > 0 && (
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Recent Usage Records</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Date</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Type</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">
                    Quantity
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Model</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Tier</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">Cost</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 50).map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-border-subtle last:border-0 hover:bg-overlay"
                  >
                    <td className="py-3 px-4 text-sm text-text-secondary">
                      {new Date(record.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary">
                      {record.usage_type.replace('tokens_', '')}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-primary text-right">
                      {formatNumber(record.quantity)} {record.unit}
                    </td>
                    <td className="py-3 px-4 text-sm text-text-secondary">{record.model || '-'}</td>
                    <td className="py-3 px-4 text-sm text-text-secondary">{record.tier || '-'}</td>
                    <td className="py-3 px-4 text-sm text-text-primary text-right">
                      ${record.cost.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length > 50 && (
            <div className="text-center mt-4">
              <p className="text-sm text-text-muted">
                Showing 50 of {history.length} records. Export CSV for full history.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !summary && !error && (
        <div className="flex flex-col items-center justify-center py-16">
          <Activity className="w-16 h-16 text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Usage Data</h3>
          <p className="text-sm text-text-muted text-center max-w-md">
            Usage data will appear here once you start using the platform. Create a session and
            start working to see your usage statistics.
          </p>
        </div>
      )}
    </div>
  );
}
