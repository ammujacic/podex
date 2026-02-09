'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Check, FileEdit, Loader2, Terminal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type PendingApproval } from '@/lib/api';
import { type AgentMode } from '@/stores/session';

interface ApprovalDialogProps {
  approval: PendingApproval | null;
  agentMode: AgentMode;
  onClose: () => void;
  onApprovalComplete?: (approved: boolean, addedToAllowlist: boolean) => void;
}

export function ApprovalDialog({
  approval,
  agentMode,
  onClose,
  onApprovalComplete,
}: ApprovalDialogProps) {
  const [addToAllowlist, setAddToAllowlist] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        // Click outside - treat as rejection
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleResponse = useCallback(
    (approved: boolean) => {
      if (!approval) return;

      setIsSubmitting(true);
      try {
        // Notify parent of the decision - parent handles the websocket emission
        onApprovalComplete?.(approved, approved && addToAllowlist);
      } catch (error) {
        console.error('Failed to respond to approval:', error);
      } finally {
        setIsSubmitting(false);
        setAddToAllowlist(false);
      }
    },
    [approval, addToAllowlist, onApprovalComplete]
  );

  if (!approval) return null;

  const isCommandAction = approval.action_type === 'command_execute';
  const showAllowlistOption = agentMode === 'auto';

  // Determine the action description
  const toolName = approval.action_details.tool_name || 'Bash';
  const command = approval.action_details.command;
  const filePath = approval.action_details.file_path;

  // Build a readable action string
  let actionDescription = '';
  if (toolName === 'Write' || toolName === 'Edit') {
    actionDescription = `${toolName} ${filePath || command || 'file'}`;
  } else if (toolName === 'Bash') {
    actionDescription = command || 'execute command';
  } else {
    actionDescription = `${toolName}: ${command || filePath || 'action'}`;
  }

  return (
    <div
      ref={dialogRef}
      className="absolute z-50 w-full rounded-lg border border-border-default bg-surface shadow-xl"
      style={{
        bottom: '100%',
        left: 0,
        marginBottom: '8px',
      }}
    >
      {/* Compact single-row layout */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Icon */}
        <div
          className={cn(
            'rounded-full p-1.5 shrink-0',
            isCommandAction ? 'bg-yellow-500/20' : 'bg-blue-500/20'
          )}
        >
          {isCommandAction ? (
            <Terminal className="h-3.5 w-3.5 text-yellow-400" />
          ) : (
            <FileEdit className="h-3.5 w-3.5 text-blue-400" />
          )}
        </div>

        {/* Action info */}
        <div className="flex-1 min-w-0">
          <code className="text-xs font-mono text-text-primary truncate block">
            {actionDescription}
          </code>
        </div>

        {/* Allowlist checkbox (Auto mode only) */}
        {showAllowlistOption && (
          <label className="flex items-center gap-1.5 shrink-0 cursor-pointer text-xs text-text-muted hover:text-text-secondary">
            <input
              type="checkbox"
              checked={addToAllowlist}
              onChange={(e) => setAddToAllowlist(e.target.checked)}
              className="rounded border-border-default bg-elevated text-accent-primary focus:ring-accent-primary h-3.5 w-3.5"
            />
            Allow for this agent
          </label>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => handleResponse(false)}
            disabled={isSubmitting}
            className="flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-elevated disabled:opacity-50 transition-colors"
          >
            <X className="h-3 w-3" />
            Reject
          </button>
          <button
            onClick={() => handleResponse(true)}
            disabled={isSubmitting}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              isSubmitting
                ? 'bg-elevated text-text-muted cursor-not-allowed'
                : 'bg-accent-primary text-text-inverse hover:bg-opacity-90'
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <>
                <Check className="h-3 w-3" />
                Approve
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
