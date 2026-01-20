'use client';

import { useCreditExhaustedModal } from '@/stores/billing';
import { CreditExhaustedModal } from './CreditExhaustedModal';

/**
 * Global credit exhausted modal that listens to the billing store.
 * This component should be placed in the app providers to be available globally.
 */
export function GlobalCreditExhaustedModal() {
  const { isOpen, errorDetail, hide } = useCreditExhaustedModal();

  return <CreditExhaustedModal isOpen={isOpen} onClose={hide} errorDetail={errorDetail} />;
}
