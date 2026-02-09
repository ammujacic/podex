'use client';

import { useState, useCallback } from 'react';
import { Edit3, Loader2, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type AgentMode } from '@/stores/session';
import { updateAgentMode } from '@/lib/api';

interface PlanApprovalActionsProps {
  sessionId: string;
  agentId: string;
  agentName: string;
  onApprove: (newMode: AgentMode) => void;
  onRefine: (feedback: string) => void;
  onReject: () => void;
}

export function PlanApprovalActions({
  sessionId,
  agentId,
  agentName,
  onApprove,
  onRefine,
  onReject,
}: PlanApprovalActionsProps) {
  const [isApproving, setIsApproving] = useState(false);
  const [showRefinementInput, setShowRefinementInput] = useState(false);
  const [refinementText, setRefinementText] = useState('');
  const [selectedMode, setSelectedMode] = useState<AgentMode>('auto');

  const handleApprove = useCallback(async () => {
    setIsApproving(true);
    try {
      // Switch agent to the selected execution mode
      await updateAgentMode(sessionId, agentId, selectedMode);
      onApprove(selectedMode);
    } catch (error) {
      console.error('Failed to approve plan:', error);
    } finally {
      setIsApproving(false);
    }
  }, [sessionId, agentId, selectedMode, onApprove]);

  const handleRefine = useCallback(() => {
    if (refinementText.trim()) {
      onRefine(refinementText.trim());
      setRefinementText('');
      setShowRefinementInput(false);
    }
  }, [refinementText, onRefine]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRefine();
    }
    if (e.key === 'Escape') {
      setShowRefinementInput(false);
      setRefinementText('');
    }
  };

  if (showRefinementInput) {
    return (
      <div className="rounded-lg border border-border-default bg-elevated p-3 space-y-3">
        <div className="text-sm font-medium text-text-primary">What would you like to change?</div>
        <textarea
          value={refinementText}
          onChange={(e) => setRefinementText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe the changes you'd like to see in the plan..."
          className="w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none resize-none"
          rows={3}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => {
              setShowRefinementInput(false);
              setRefinementText('');
            }}
            className="rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-text-secondary hover:bg-overlay"
          >
            Cancel
          </button>
          <button
            onClick={handleRefine}
            disabled={!refinementText.trim()}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              refinementText.trim()
                ? 'bg-accent-primary text-text-inverse hover:bg-opacity-90'
                : 'bg-elevated text-text-muted cursor-not-allowed'
            )}
          >
            Send Feedback
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-sm font-medium text-blue-400">Plan Ready for Review</span>
      </div>

      <p className="text-xs text-text-muted">
        {agentName} has created a plan. Review it above, then choose how to proceed:
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Approve & Execute */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleApprove}
            disabled={isApproving}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isApproving
                ? 'bg-elevated text-text-muted cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            )}
          >
            {isApproving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Approve & Execute
          </button>

          {/* Mode selector dropdown */}
          <select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value as AgentMode)}
            disabled={isApproving}
            className="rounded-md border border-border-default bg-elevated px-2 py-1.5 text-xs text-text-secondary focus:border-border-focus focus:outline-none"
          >
            <option value="auto">Auto mode</option>
            <option value="ask">Ask mode (approval each step)</option>
            <option value="sovereign">Sovereign mode (full autonomy)</option>
          </select>
        </div>

        {/* Request Refinements */}
        <button
          onClick={() => setShowRefinementInput(true)}
          className="flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-sm text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors"
        >
          <Edit3 className="h-3.5 w-3.5" />
          Refine Plan
        </button>

        {/* Reject */}
        <button
          onClick={onReject}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
