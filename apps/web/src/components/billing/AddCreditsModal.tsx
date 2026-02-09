'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2 } from 'lucide-react';
import { initiateCreditsCheckout } from '@/lib/billing-utils';
import { useBillingConfig, useBillingStore } from '@/stores/billing';

// Fallback values if billing config hasn't loaded
const DEFAULT_CREDIT_PACKAGES = [
  { amountCents: 1000, label: '$10' },
  { amountCents: 2500, label: '$25' },
  { amountCents: 5000, label: '$50' },
  { amountCents: 10000, label: '$100' },
];
const DEFAULT_MIN_CENTS = 500; // $5.00
const DEFAULT_MAX_CENTS = 100000; // $1,000.00

interface AddCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddCreditsModal({ isOpen, onClose }: AddCreditsModalProps) {
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billingConfig = useBillingConfig();
  const fetchBillingConfig = useBillingStore((state) => state.fetchBillingConfig);

  // Fetch billing config when modal opens
  useEffect(() => {
    if (isOpen && !billingConfig) {
      fetchBillingConfig();
    }
  }, [isOpen, billingConfig, fetchBillingConfig]);

  // Use config values or fallbacks
  const creditPackages = useMemo(() => {
    if (billingConfig?.creditPackages?.length) {
      return billingConfig.creditPackages.map((p) => ({
        amount: p.amountCents / 100,
        label: p.label,
      }));
    }
    return DEFAULT_CREDIT_PACKAGES.map((p) => ({
      amount: p.amountCents / 100,
      label: p.label,
    }));
  }, [billingConfig]);

  const minAmount = (billingConfig?.minCreditPurchaseCents ?? DEFAULT_MIN_CENTS) / 100;
  const maxAmount = (billingConfig?.maxCreditPurchaseCents ?? DEFAULT_MAX_CENTS) / 100;

  if (!isOpen) return null;

  const handlePurchase = async () => {
    let amount = selectedPackage;
    if (!amount && customAmount) {
      amount = parseFloat(customAmount);
    }

    if (!amount || amount < minAmount) {
      setError(`Minimum purchase is ${formatCurrency(minAmount)}`);
      return;
    }

    if (amount > maxAmount) {
      setError(`Maximum purchase is ${formatCurrency(maxAmount)}`);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await initiateCreditsCheckout(amount);
      // Note: This will redirect to Stripe, so we won't reach here normally
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate checkout');
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getButtonText = () => {
    if (loading) return 'Redirecting to checkout...';
    if (selectedPackage) return `Continue with ${formatCurrency(selectedPackage)}`;
    if (customAmount) {
      const amount = parseFloat(customAmount) || 0;
      return `Continue with ${formatCurrency(amount)}`;
    }
    return 'Select an amount';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-border-default rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle">
          <h2 className="text-xl font-semibold text-text-primary">Add Credits</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <p className="text-text-muted text-sm">
            Credits are used for pay-as-you-go usage when you exceed your plan limits.
          </p>

          {error && (
            <div className="p-3 bg-accent-error/10 border border-accent-error/20 rounded-lg text-accent-error text-sm">
              {error}
            </div>
          )}

          {/* Credit Packages */}
          <div className="grid grid-cols-2 gap-3">
            {creditPackages.map((pkg) => (
              <button
                key={pkg.amount}
                onClick={() => {
                  setSelectedPackage(pkg.amount);
                  setCustomAmount('');
                  setError(null);
                }}
                disabled={loading}
                className={`p-4 rounded-lg border transition-colors ${
                  selectedPackage === pkg.amount
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-border-default hover:border-border-hover bg-elevated'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <p className="text-xl font-bold text-text-primary">{pkg.label}</p>
              </button>
            ))}
          </div>

          {/* Custom Amount */}
          <div>
            <label className="block text-sm text-text-muted mb-2">Or enter custom amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">$</span>
              <input
                type="number"
                min={minAmount}
                max={maxAmount}
                step="0.01"
                placeholder="0.00"
                value={customAmount}
                disabled={loading}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedPackage(null);
                  setError(null);
                }}
                className="w-full pl-7 pr-4 py-2 bg-elevated border border-border-default rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary disabled:opacity-50"
              />
            </div>
          </div>

          {/* Purchase Button */}
          <button
            onClick={handlePurchase}
            disabled={loading || (!selectedPackage && !customAmount)}
            className="w-full py-3 bg-accent-primary hover:bg-accent-primary/90 disabled:bg-elevated disabled:text-text-muted disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {getButtonText()}
          </button>

          <p className="text-xs text-text-muted text-center">
            You'll be redirected to Stripe to complete your purchase securely.
            <br />
            Minimum: {formatCurrency(minAmount)} · Maximum: {formatCurrency(maxAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}
