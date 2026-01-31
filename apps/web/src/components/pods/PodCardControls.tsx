'use client';

import { useState } from 'react';
import { Play, Square, MoreVertical, Loader2 } from 'lucide-react';
import { PodCardMenu } from './PodCardMenu';

type DisplayStatus = 'running' | 'stopped' | 'pending' | 'error' | 'offline';

interface PodCardControlsProps {
  sessionId: string;
  workspaceId: string | null;
  displayStatus: DisplayStatus;
  isPinned: boolean;
  onStart: () => void;
  onStop: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  isStarting: boolean;
  isStopping: boolean;
  isPinning: boolean;
  isDeleting: boolean;
}

export function PodCardControls({
  sessionId,
  workspaceId,
  displayStatus,
  isPinned,
  onStart,
  onStop,
  onRename,
  onTogglePin,
  onDelete,
  isStarting,
  isStopping,
  isPinning,
  isDeleting,
}: PodCardControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const canStart = displayStatus === 'stopped' || displayStatus === 'error';
  const canStop = displayStatus === 'running';
  const isLoading = displayStatus === 'pending' || isStarting || isStopping;
  const isDisabled = displayStatus === 'offline' || !workspaceId;

  const handleStartStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLoading || isDisabled) return;

    if (canStop) {
      onStop();
    } else if (canStart) {
      onStart();
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  return (
    <div className="flex items-center gap-1">
      {/* Start/Stop Button */}
      <button
        onClick={handleStartStop}
        disabled={isLoading || isDisabled}
        className={`p-1.5 rounded transition-colors ${
          isDisabled
            ? 'text-text-muted cursor-not-allowed opacity-50'
            : isLoading
              ? 'text-accent-warning cursor-wait'
              : canStop
                ? 'text-text-secondary hover:text-accent-error hover:bg-accent-error/10'
                : 'text-text-secondary hover:text-accent-success hover:bg-accent-success/10'
        }`}
        title={
          isDisabled
            ? 'Workspace unavailable'
            : isLoading
              ? 'Please wait...'
              : canStop
                ? 'Stop pod'
                : 'Start pod'
        }
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : canStop ? (
          <Square className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4" />
        )}
      </button>

      {/* Menu Button */}
      <div className="relative">
        <button
          onClick={handleMenuToggle}
          className="p-1.5 rounded text-text-muted hover:text-text-secondary hover:bg-overlay transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        <PodCardMenu
          sessionId={sessionId}
          isPinned={isPinned}
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
          onRename={onRename}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
          isPinning={isPinning}
          isDeleting={isDeleting}
        />
      </div>
    </div>
  );
}
