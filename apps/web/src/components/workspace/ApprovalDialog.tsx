'use client';

import { useState, useCallback } from 'react';
import { AlertTriangle, Check, FileEdit, Loader2, Terminal, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { type PendingApproval, respondToApproval } from '@/lib/api';
import { type AgentMode } from '@/stores/session';

interface ApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: PendingApproval | null;
  sessionId: string;
  agentName: string;
  agentMode: AgentMode;
  onApprovalComplete?: (approved: boolean, addedToAllowlist: boolean) => void;
}

export function ApprovalDialog({
  open,
  onOpenChange,
  approval,
  sessionId,
  agentName,
  agentMode,
  onApprovalComplete,
}: ApprovalDialogProps) {
  const [addToAllowlist, setAddToAllowlist] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResponse = useCallback(
    async (approved: boolean) => {
      if (!approval) return;

      setIsSubmitting(true);
      try {
        await respondToApproval(sessionId, approval.agent_id, approval.id, {
          approved,
          add_to_allowlist: approved && addToAllowlist,
        });
        onApprovalComplete?.(approved, approved && addToAllowlist);
        onOpenChange(false);
      } catch (error) {
        console.error('Failed to respond to approval:', error);
      } finally {
        setIsSubmitting(false);
        setAddToAllowlist(false);
      }
    },
    [approval, sessionId, addToAllowlist, onApprovalComplete, onOpenChange]
  );

  if (!approval) return null;

  const isCommandAction = approval.action_type === 'command_execute';
  const isFileAction = approval.action_type === 'file_write';
  const showAllowlistOption = agentMode === 'auto' && isCommandAction;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'rounded-full p-2',
                isCommandAction ? 'bg-yellow-500/20' : 'bg-blue-500/20'
              )}
            >
              {isCommandAction ? (
                <Terminal className="h-5 w-5 text-yellow-400" />
              ) : (
                <FileEdit className="h-5 w-5 text-blue-400" />
              )}
            </div>
            <div>
              <DialogTitle>Approval Required</DialogTitle>
              <DialogDescription>
                {agentName} wants to {isCommandAction ? 'execute a command' : 'modify a file'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Action details */}
          <div className="rounded-lg border border-border-default bg-elevated p-4">
            {isCommandAction && approval.action_details.command && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <Terminal className="h-3 w-3" />
                  Command
                </div>
                <code className="block rounded-md bg-surface p-3 text-sm font-mono text-text-primary whitespace-pre-wrap break-all">
                  {approval.action_details.command}
                </code>
              </div>
            )}

            {isFileAction && approval.action_details.file_path && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <FileEdit className="h-3 w-3" />
                  File
                </div>
                <code className="block rounded-md bg-surface p-3 text-sm font-mono text-text-primary">
                  {approval.action_details.file_path}
                </code>
                {approval.action_details.tool_name && (
                  <div className="text-xs text-text-muted">
                    Action: {approval.action_details.tool_name}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Add to allowlist option (Auto mode only) */}
          {showAllowlistOption && (
            <label className="flex items-start gap-3 rounded-lg border border-border-default p-3 cursor-pointer hover:bg-elevated transition-colors">
              <input
                type="checkbox"
                checked={addToAllowlist}
                onChange={(e) => setAddToAllowlist(e.target.checked)}
                className="mt-0.5 rounded border-border-default bg-elevated text-accent-primary focus:ring-accent-primary"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">
                  Allow this command for this agent
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  The command will be added to the agent&apos;s allowlist and won&apos;t require
                  approval next time.
                </div>
              </div>
            </label>
          )}

          {/* Security warning for sovereign-like actions */}
          {isCommandAction && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-text-muted">
                <span className="font-medium text-yellow-400">Caution: </span>
                Review the command carefully before approving. Commands have full access to your
                workspace.
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            onClick={() => handleResponse(false)}
            disabled={isSubmitting}
            className="flex items-center gap-2 rounded-md border border-border-default px-4 py-2 text-sm text-text-secondary hover:bg-elevated disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Reject
          </button>
          <button
            onClick={() => handleResponse(true)}
            disabled={isSubmitting}
            className={cn(
              'flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors',
              isSubmitting
                ? 'bg-elevated text-text-muted cursor-not-allowed'
                : 'bg-accent-primary text-text-inverse hover:bg-opacity-90'
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Approve
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
