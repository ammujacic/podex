'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getUsageSummary,
  getBillingUsageHistory,
  type UsageSummary,
  type UsageRecordResponse,
} from '@/lib/api';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const usageTypeLabels: Record<string, string> = {
  tokens_input: 'Input Tokens',
  tokens_output: 'Output Tokens',
  compute_seconds: 'Compute',
  storage_gb: 'Storage',
  api_calls: 'API Calls',
};

export default function UsagePage() {
  const [period, setPeriod] = useState<'current' | 'last_month' | 'all_time'>('current');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [history, setHistory] = useState<UsageRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filterType, setFilterType] = useState<string | undefined>();

  useEffect(() => {
    async function loadSummary() {
      try {
        setLoading(true);
        const data = await getUsageSummary(period);
        setSummary(data);
      } catch (err) {
        console.error('Failed to load usage summary:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSummary();
  }, [period]);

  useEffect(() => {
    async function loadHistory() {
      try {
        setHistoryLoading(true);
        const data = await getBillingUsageHistory(1, 50, filterType);
        setHistory(data);
        setPage(1);
        setHasMore(data.length === 50);
      } catch (err) {
        console.error('Failed to load usage history:', err);
      } finally {
        setHistoryLoading(false);
      }
    }
    loadHistory();
  }, [filterType]);

  const loadMore = async () => {
    try {
      setHistoryLoading(true);
      const data = await getBillingUsageHistory(page + 1, 50, filterType);
      setHistory((prev) => [...prev, ...data]);
      setPage((prev) => prev + 1);
      setHasMore(data.length === 50);
    } catch (err) {
      console.error('Failed to load more history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-700 rounded w-1/4" />
          <div className="h-40 bg-neutral-700 rounded" />
          <div className="h-64 bg-neutral-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/settings/billing"
            className="text-sm text-neutral-400 hover:text-white mb-2 block"
          >
            &larr; Back to Billing
          </Link>
          <h1 className="text-2xl font-bold text-white">Usage Details</h1>
          <p className="text-neutral-400 mt-1">Track your token, compute, and storage usage</p>
        </div>
        <div className="flex items-center gap-2">
          {(['current', 'last_month', 'all_time'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                period === p
                  ? 'bg-blue-500 text-white'
                  : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
              }`}
            >
              {p === 'current' ? 'This Period' : p === 'last_month' ? 'Last Month' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
              <p className="text-sm text-neutral-400">Input Tokens</p>
              <p className="text-xl font-semibold text-white mt-1">
                {formatNumber(summary.tokensInput)}
              </p>
            </div>
            <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
              <p className="text-sm text-neutral-400">Output Tokens</p>
              <p className="text-xl font-semibold text-white mt-1">
                {formatNumber(summary.tokensOutput)}
              </p>
            </div>
            <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
              <p className="text-sm text-neutral-400">Compute Credits</p>
              <p className="text-xl font-semibold text-white mt-1">
                {formatCurrency(summary.computeCreditsUsed)}
              </p>
              {summary.computeCreditsIncluded > 0 && (
                <p className="text-xs text-neutral-500 mt-1">
                  of {formatCurrency(summary.computeCreditsIncluded)} included
                </p>
              )}
            </div>
            <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
              <p className="text-sm text-neutral-400">Storage Used</p>
              <p className="text-xl font-semibold text-white mt-1">
                {summary.storageGb.toFixed(2)} GB
              </p>
            </div>
            <div className="p-4 bg-neutral-800/50 rounded-xl border border-neutral-700">
              <p className="text-sm text-neutral-400">Total Cost</p>
              <p className="text-xl font-semibold text-emerald-400 mt-1">
                {formatCurrency(summary.totalCost)}
              </p>
            </div>
          </div>

          {/* Usage by Model */}
          {Object.keys(summary.usageByModel).length > 0 && (
            <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Usage by Model</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-neutral-400 border-b border-neutral-700">
                      <th className="pb-3 font-medium">Model</th>
                      <th className="pb-3 font-medium text-right">Input Tokens</th>
                      <th className="pb-3 font-medium text-right">Output Tokens</th>
                      <th className="pb-3 font-medium text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-700">
                    {Object.entries(summary.usageByModel).map(([model, data]) => (
                      <tr key={model} className="text-sm">
                        <td className="py-3 text-white font-mono">{model}</td>
                        <td className="py-3 text-neutral-300 text-right">
                          {formatNumber(data.input)}
                        </td>
                        <td className="py-3 text-neutral-300 text-right">
                          {formatNumber(data.output)}
                        </td>
                        <td className="py-3 text-emerald-400 text-right">
                          {formatCurrency(data.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cost Breakdown */}
          <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Cost Breakdown</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Token Usage</span>
                <span className="text-white">{formatCurrency(summary.tokensCost)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Compute</span>
                <span className="text-white">{formatCurrency(summary.computeCost)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Storage</span>
                <span className="text-white">{formatCurrency(summary.storageCost)}</span>
              </div>
              <div className="pt-3 border-t border-neutral-700 flex justify-between items-center">
                <span className="text-white font-medium">Total</span>
                <span className="text-emerald-400 font-semibold">
                  {formatCurrency(summary.totalCost)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Usage History */}
      <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Usage History</h2>
          <select
            value={filterType || ''}
            onChange={(e) => setFilterType(e.target.value || undefined)}
            className="bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Types</option>
            <option value="tokens_input">Input Tokens</option>
            <option value="tokens_output">Output Tokens</option>
            <option value="compute_seconds">Compute</option>
            <option value="storage_gb">Storage</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-neutral-400 border-b border-neutral-700">
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Type</th>
                <th className="pb-3 font-medium">Model / Tier</th>
                <th className="pb-3 font-medium text-right">Quantity</th>
                <th className="pb-3 font-medium text-right">Cost</th>
                <th className="pb-3 font-medium text-center">Overage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-700">
              {history.map((record) => (
                <tr key={record.id} className="text-sm">
                  <td className="py-3 text-neutral-300">{formatDate(record.created_at)}</td>
                  <td className="py-3 text-white">
                    {usageTypeLabels[record.usage_type] || record.usage_type}
                  </td>
                  <td className="py-3 text-neutral-400 font-mono text-xs">
                    {record.model || record.tier || '-'}
                  </td>
                  <td className="py-3 text-neutral-300 text-right">
                    {formatNumber(record.quantity)} {record.unit}
                  </td>
                  <td className="py-3 text-emerald-400 text-right">
                    {formatCurrency(record.cost)}
                  </td>
                  <td className="py-3 text-center">
                    {record.is_overage ? (
                      <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">
                        Yes
                      </span>
                    ) : (
                      <span className="text-neutral-500">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {history.length === 0 && !historyLoading && (
          <p className="text-center text-neutral-500 py-8">No usage records found</p>
        )}

        {hasMore && (
          <div className="mt-4 text-center">
            <button
              onClick={loadMore}
              disabled={historyLoading}
              className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {historyLoading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
