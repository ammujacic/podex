'use client';

import { X, AlertCircle, CreditCard, ArrowUpCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface BillingErrorDetail {
  error_code: string;
  message: string;
  quota_remaining: number;
  credits_remaining: number;
  resource_type?: 'tokens' | 'compute';
  upgrade_url?: string;
  add_credits_url?: string;
}

interface CreditExhaustedModalProps {
  isOpen: boolean;
  onClose: () => void;
  errorDetail?: BillingErrorDetail | null;
  resourceType?: 'tokens' | 'compute';
  customMessage?: string;
}

export function CreditExhaustedModal({
  isOpen,
  onClose,
  errorDetail,
  resourceType,
  customMessage,
}: CreditExhaustedModalProps) {
  const router = useRouter();

  if (!isOpen) return null;

  const effectiveResourceType = resourceType || errorDetail?.resource_type || 'credits';
  const message = customMessage || errorDetail?.message || 'Your credits have been exhausted.';
  const upgradeUrl = errorDetail?.upgrade_url || '/settings/plans';
  const addCreditsUrl = errorDetail?.add_credits_url || '/settings/billing';

  const handleUpgrade = () => {
    router.push(upgradeUrl);
    onClose();
  };

  const handleAddCredits = () => {
    router.push(addCreditsUrl);
    onClose();
  };

  const getTitle = () => {
    switch (effectiveResourceType) {
      case 'tokens':
        return 'Token Credits Exhausted';
      case 'compute':
        return 'Compute Credits Exhausted';
      default:
        return 'Credits Exhausted';
    }
  };

  const getIcon = () => {
    switch (effectiveResourceType) {
      case 'tokens':
        return <AlertCircle className="w-12 h-12 text-yellow-500" />;
      case 'compute':
        return <AlertCircle className="w-12 h-12 text-orange-500" />;
      default:
        return <AlertCircle className="w-12 h-12 text-red-500" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-[#1a1a2e] border border-[#2a2a4a] rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="p-6">
          {/* Icon and Title */}
          <div className="flex flex-col items-center text-center mb-6">
            {getIcon()}
            <h2 className="mt-4 text-xl font-semibold text-white">{getTitle()}</h2>
          </div>

          {/* Message */}
          <p className="text-gray-300 text-center mb-6">{message}</p>

          {/* Stats (if available) */}
          {errorDetail && (
            <div className="flex justify-center gap-6 mb-6 text-sm">
              <div className="text-center">
                <div className="text-gray-500">Quota Remaining</div>
                <div className="text-white font-medium">
                  {errorDetail.quota_remaining.toLocaleString()}
                </div>
              </div>
              <div className="text-center">
                <div className="text-gray-500">Credits Balance</div>
                <div className="text-white font-medium">
                  ${(errorDetail.credits_remaining / 100).toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleUpgrade}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-lg transition-all"
            >
              <ArrowUpCircle className="w-5 h-5" />
              Upgrade Plan
            </button>
            <button
              onClick={handleAddCredits}
              className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#2a2a4a] hover:bg-[#3a3a5a] text-white font-medium rounded-lg transition-colors"
            >
              <CreditCard className="w-5 h-5" />
              Add Credits
            </button>
            <button
              onClick={onClose}
              className="w-full py-2 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
