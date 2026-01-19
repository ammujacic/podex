'use client';

import React from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ExtensionMarketplace } from '@/components/extensions';

interface ExtensionMarketplaceModalProps {
  onClose: () => void;
  workspaceId?: string;
}

/**
 * Modal wrapper for the extension marketplace.
 */
export function ExtensionMarketplaceModal({
  onClose,
  workspaceId,
}: ExtensionMarketplaceModalProps) {
  const modalRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="Extension Marketplace"
        className="relative w-full max-w-6xl h-[90vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden m-4"
      >
        <ExtensionMarketplace
          onClose={onClose}
          className="flex-1 min-h-0"
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
}
