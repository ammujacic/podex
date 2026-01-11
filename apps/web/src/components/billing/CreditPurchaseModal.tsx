'use client';

import { useState } from 'react';
import { X, CreditCard, Sparkles } from 'lucide-react';

interface CreditPackage {
  amount: number;
  bonus: number;
  label: string;
}

interface CreditPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPurchase: (amountCents: number) => Promise<void>;
  packages?: CreditPackage[];
}

const defaultPackages: CreditPackage[] = [
  { amount: 1000, bonus: 0, label: '$10' },
  { amount: 2500, bonus: 250, label: '$25' },
  { amount: 5000, bonus: 750, label: '$50' },
  { amount: 10000, bonus: 2000, label: '$100' },
];

const formatCurrency = (cents: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
};

export function CreditPurchaseModal({
  isOpen,
  onClose,
  onPurchase,
  packages = defaultPackages,
}: CreditPurchaseModalProps) {
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePurchase = async () => {
    let amountCents = selectedPackage;
    if (!amountCents && customAmount) {
      amountCents = Math.round(parseFloat(customAmount) * 100);
    }

    if (!amountCents || amountCents < 500) {
      setError('Minimum purchase is $5.00');
      return;
    }

    if (amountCents > 100000) {
      setError('Maximum purchase is $1,000.00');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onPurchase(amountCents);
      onClose();
    } catch {
      setError('Failed to process purchase. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedPkg = packages.find((p) => p.amount === selectedPackage);
  const totalCredits = selectedPackage
    ? selectedPackage + (selectedPkg?.bonus || 0)
    : customAmount
      ? Math.round(parseFloat(customAmount) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-neutral-800 rounded-xl border border-neutral-700 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-700">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Purchase Credits</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Package selection */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-3">
              Select a package
            </label>
            <div className="grid grid-cols-2 gap-3">
              {packages.map((pkg) => (
                <button
                  key={pkg.amount}
                  onClick={() => {
                    setSelectedPackage(pkg.amount);
                    setCustomAmount('');
                    setError(null);
                  }}
                  className={`p-4 rounded-lg border transition-all ${
                    selectedPackage === pkg.amount
                      ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/20'
                      : 'border-neutral-600 hover:border-neutral-500 bg-neutral-700/30'
                  }`}
                >
                  <p className="text-xl font-bold text-white">{pkg.label}</p>
                  {pkg.bonus > 0 && (
                    <div className="flex items-center gap-1 mt-1 text-sm text-emerald-400">
                      <Sparkles className="w-3 h-3" />
                      <span>+{formatCurrency(pkg.bonus)} bonus</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-2">
              Or enter custom amount
            </label>
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
                  setError(null);
                }}
                className="w-full pl-7 pr-4 py-3 bg-neutral-700 border border-neutral-600 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <p className="text-xs text-neutral-500 mt-2">Min: $5.00 | Max: $1,000.00</p>
          </div>

          {/* Summary */}
          {totalCredits > 0 && (
            <div className="p-4 bg-neutral-700/30 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-neutral-400">Credits to add</span>
                <span className="text-white font-medium">{formatCurrency(totalCredits)}</span>
              </div>
              {selectedPkg?.bonus && selectedPkg.bonus > 0 && (
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-neutral-400">Includes bonus</span>
                  <span className="text-emerald-400">+{formatCurrency(selectedPkg.bonus)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-neutral-700">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-neutral-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePurchase}
            disabled={loading || (!selectedPackage && !customAmount)}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Processing...' : 'Purchase'}
          </button>
        </div>
      </div>
    </div>
  );
}
