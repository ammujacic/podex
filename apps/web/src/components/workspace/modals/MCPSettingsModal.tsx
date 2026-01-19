'use client';

import React from 'react';
import { X, Plug } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { MCPSettings } from '@/components/settings/MCPSettings';

interface MCPSettingsModalProps {
  onClose: () => void;
}

/**
 * Modal for configuring MCP (Model Context Protocol) integrations.
 */
export function MCPSettingsModal({ onClose }: MCPSettingsModalProps) {
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
        aria-labelledby="mcp-settings-title"
        className="relative w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10"
              aria-hidden="true"
            >
              <Plug className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 id="mcp-settings-title" className="text-lg font-semibold text-text-primary">
                MCP Integrations
              </h2>
              <p className="text-sm text-text-muted">
                Configure Model Context Protocol servers and tools
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary min-w-[40px] min-h-[40px] flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* MCPSettings content */}
        <div className="flex-1 overflow-hidden">
          <MCPSettings className="h-full" />
        </div>
      </div>
    </div>
  );
}
