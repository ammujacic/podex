'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getCreditBalance,
  getCreditHistory,
  purchaseCredits,
  type CreditBalanceResponse,
  type CreditTransactionResponse,
} from '@/lib/api';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const transactionTypeLabels: Record<string, { label: string; color: string }> = {
  purchase: { label: 'Purchase', color: 'text-emerald-400' },
  bonus: { label: 'Bonus', color: 'text-blue-400' },
  referral: { label: 'Referral', color: 'text-purple-400' },
  refund: { label: 'Refund', color: 'text-amber-400' },
  usage: { label: 'Usage', color: 'text-red-400' },
  expiry: { label: 'Expired', color: 'text-neutral-400' },
  subscription_credit: { label: 'Subscription', color: 'text-blue-400' },
};

const creditPackages = [
  { amount: 1000, bonus: 0, label: '$10' },
  { amount: 2500, bonus: 250, label: '$25' },
  { amount: 5000, bonus: 750, label: '$50' },
  { amount: 10000, bonus: 2000, label: '$100' },
];

export default function CreditsPage() {
  const [balance, setBalance] = useState<CreditBalanceResponse | null>(null);
  const [history, setHistory] = useState<CreditTransactionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [balanceData, historyData] = await Promise.all([
          getCreditBalance(),
          getCreditHistory(1, 20),
        ]);
        setBalance(balanceData);
        setHistory(historyData);
        setHasMore(historyData.length === 20);
      } catch (err) {
        console.error('Failed to load credits:', err);
        setError('Failed to load credit information');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handlePurchase = async () => {
    let amount = selectedPackage;
    if (!amount && customAmount) {
      amount = Math.round(parseFloat(customAmount) * 100);
    }

    if (!amount || amount < 500) {
      setError('Minimum purchase is $5.00');
      return;
    }

    if (amount > 100000) {
      setError('Maximum purchase is $1,000.00');
      return;
    }

    try {
      setPurchaseLoading(true);
      setError(null);

      await purchaseCredits(amount);

      // Reload balance and history
      const [balanceData, historyData] = await Promise.all([
        getCreditBalance(),
        getCreditHistory(1, 20),
      ]);
      setBalance(balanceData);
      setHistory(historyData);

      setSuccess(`Successfully added ${formatCurrency(amount / 100)} to your balance!`);
      setSelectedPackage(null);
      setCustomAmount('');

      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Failed to purchase credits:', err);
      setError('Failed to process purchase. Please try again.');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    try {
      const data = await getCreditHistory(page + 1, 20);
      setHistory((prev) => [...prev, ...data]);
      setPage((prev) => prev + 1);
      setHasMore(data.length === 20);
    } catch (err) {
      console.error('Failed to load more history:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-700 rounded w-1/4" />
          <div className="h-32 bg-neutral-700 rounded" />
          <div className="h-64 bg-neutral-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <div>
        <Link
          href="/settings/billing"
          className="text-sm text-neutral-400 hover:text-white mb-2 block"
        >
          &larr; Back to Billing
        </Link>
        <h1 className="text-2xl font-bold text-white">Credits</h1>
        <p className="text-neutral-400 mt-1">Purchase credits for pay-as-you-go usage</p>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
          {success}
        </div>
      )}

      {/* Current Balance */}
      {balance && (
        <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Current Balance</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-neutral-400">Available</p>
              <p className="text-3xl font-bold text-emerald-400">
                {formatCurrency(balance.balance)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-400">Pending</p>
              <p className="text-xl font-semibold text-neutral-300">
                {formatCurrency(balance.pending)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-400">Total Purchased</p>
              <p className="text-xl font-semibold text-neutral-300">
                {formatCurrency(balance.total_purchased)}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-400">Total Used</p>
              <p className="text-xl font-semibold text-neutral-300">
                {formatCurrency(balance.total_used)}
              </p>
            </div>
          </div>
          {balance.expiring_soon > 0 && (
            <p className="text-sm text-amber-400 mt-4">
              {formatCurrency(balance.expiring_soon)} expiring in the next 30 days
            </p>
          )}
        </div>
      )}

      {/* Purchase Credits */}
      <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Add Credits</h2>
        <p className="text-neutral-400 text-sm mb-6">
          Credits are used for pay-as-you-go usage when you exceed your plan limits. Larger packages
          include bonus credits!
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {creditPackages.map((pkg) => (
            <button
              key={pkg.amount}
              onClick={() => {
                setSelectedPackage(pkg.amount);
                setCustomAmount('');
              }}
              className={`p-4 rounded-lg border transition-colors ${
                selectedPackage === pkg.amount
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-neutral-600 hover:border-neutral-500 bg-neutral-700/30'
              }`}
            >
              <p className="text-xl font-bold text-white">{pkg.label}</p>
              {pkg.bonus > 0 && (
                <p className="text-sm text-emerald-400 mt-1">
                  +{formatCurrency(pkg.bonus / 100)} bonus
                </p>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1">
            <label className="block text-sm text-neutral-400 mb-2">Or enter custom amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">$</span>
              <input
                type="number"
                min="5"
                max="1000"
                step="0.01"
                placeholder="0.00"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedPackage(null);
                }}
                className="w-full pl-7 pr-4 py-2 bg-neutral-700 border border-neutral-600 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handlePurchase}
          disabled={purchaseLoading || (!selectedPackage && !customAmount)}
          className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {purchaseLoading
            ? 'Processing...'
            : selectedPackage
              ? `Purchase ${formatCurrency(selectedPackage / 100)}`
              : customAmount
                ? `Purchase ${formatCurrency(parseFloat(customAmount) || 0)}`
                : 'Select an amount'}
        </button>

        <p className="text-xs text-neutral-500 mt-4 text-center">
          Credits do not expire and can be used across all services. Minimum purchase: $5.00.
          Maximum purchase: $1,000.00.
        </p>
      </div>

      {/* Transaction History */}
      <div className="bg-neutral-800/50 rounded-xl border border-neutral-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Transaction History</h2>

        {history.length > 0 ? (
          <>
            <div className="space-y-3">
              {history.map((tx) => {
                const typeInfo = transactionTypeLabels[tx.transaction_type] || {
                  label: tx.transaction_type,
                  color: 'text-neutral-400',
                };
                const isPositive = tx.amount > 0;

                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between py-3 border-b border-neutral-700 last:border-0"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${typeInfo.color}`}>
                          {typeInfo.label}
                        </span>
                        {tx.expires_at && (
                          <span className="text-xs text-neutral-500">
                            Expires {formatDate(tx.expires_at)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-neutral-400 mt-0.5">{tx.description}</p>
                      <p className="text-xs text-neutral-500">{formatDate(tx.created_at)}</p>
                    </div>
                    <span
                      className={`text-lg font-semibold ${
                        isPositive ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {formatCurrency(tx.amount)}
                    </span>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  onClick={loadMoreHistory}
                  className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-center text-neutral-500 py-8">No transactions yet</p>
        )}
      </div>
    </div>
  );
}
