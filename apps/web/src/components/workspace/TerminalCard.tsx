'use client';

import { useState, useCallback, useRef } from 'react';
import { MoreVertical, Pencil, Terminal, Trash2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';
import { useSessionStore, type TerminalWindow } from '@/stores/session';
import { TerminalView } from './TerminalView';
import { useTerminalManager } from '@/contexts/TerminalManager';
import { ConfirmDialog, PromptDialog } from '@/components/ui/Dialogs';

export interface TerminalCardProps {
  terminalWindow: TerminalWindow;
  sessionId: string;
  workspaceId: string;
  expanded?: boolean;
}

/**
 * A terminal window card that can appear in Grid/Focus/Freeform layouts.
 * Wraps TerminalInstance with a card header for name, status, and controls.
 */
export function TerminalCard({
  terminalWindow,
  sessionId,
  workspaceId,
  expanded = false,
}: TerminalCardProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Store actions
  const { removeTerminalWindow, updateTerminalWindow, setActiveWindow } = useSessionStore();
  const { destroyTerminal } = useTerminalManager();

  // Handle terminal ready
  const handleReady = useCallback(() => {
    updateTerminalWindow(sessionId, terminalWindow.id, { status: 'connected' });
  }, [sessionId, terminalWindow.id, updateTerminalWindow]);

  // Handle rename
  const handleRename = useCallback(
    (newName: string) => {
      if (newName.trim()) {
        updateTerminalWindow(sessionId, terminalWindow.id, { name: newName.trim() });
      }
      setRenameDialogOpen(false);
    },
    [sessionId, terminalWindow.id, updateTerminalWindow]
  );

  // Handle delete
  const handleDelete = useCallback(() => {
    // Destroy the terminal connection first
    destroyTerminal(terminalWindow.id);
    // Then remove from session store
    removeTerminalWindow(sessionId, terminalWindow.id);
    setDeleteDialogOpen(false);
  }, [sessionId, terminalWindow.id, removeTerminalWindow, destroyTerminal]);

  // Handle card click to set active
  const handleCardClick = useCallback(() => {
    setActiveWindow(sessionId, terminalWindow.id);
  }, [sessionId, terminalWindow.id, setActiveWindow]);

  // Status indicator color
  const statusColor = {
    connected: 'bg-green-500',
    disconnected: 'bg-zinc-500',
    error: 'bg-red-500',
  }[terminalWindow.status];

  return (
    <>
      <div
        ref={cardRef}
        onClick={handleCardClick}
        className={cn(
          'flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/95',
          'shadow-lg backdrop-blur-sm',
          expanded ? 'h-full' : 'h-[300px]'
        )}
      >
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3">
          {/* Left: Icon + Name + Status */}
          <div className="flex items-center gap-2 overflow-hidden">
            <Terminal className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="truncate text-sm font-medium text-zinc-200">
              {terminalWindow.name}
            </span>
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
              {terminalWindow.shell}
            </span>
            <div className={cn('h-2 w-2 shrink-0 rounded-full', statusColor)} />
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setRenameDialogOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteDialogOpen(true)}
                  className="text-red-400 focus:text-red-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Close Terminal
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(true);
              }}
              className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body: Terminal View */}
        <div className="min-h-0 flex-1">
          <TerminalView
            terminalId={terminalWindow.id}
            workspaceId={workspaceId}
            shell={terminalWindow.shell}
            isActive={true}
            onReady={handleReady}
          />
        </div>
      </div>

      {/* Rename Dialog */}
      <PromptDialog
        isOpen={renameDialogOpen}
        title="Rename Terminal"
        message="Enter a new name for this terminal"
        defaultValue={terminalWindow.name}
        placeholder="Terminal name"
        onConfirm={(newName) => {
          handleRename(newName);
          setRenameDialogOpen(false);
        }}
        onCancel={() => setRenameDialogOpen(false)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        title="Close Terminal"
        message="Are you sure you want to close this terminal? The shell session will be terminated."
        confirmLabel="Close"
        confirmVariant="danger"
        onConfirm={() => {
          handleDelete();
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </>
  );
}
