'use client';

import { useCallback, useState } from 'react';
import {
  File,
  Folder,
  X,
  ExternalLink,
  Copy,
  Edit3,
  FolderInput,
  Share2,
  Trash2,
  Loader2,
  Check,
  FileCode,
  Download,
  CloudSync,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/ui';
import { triggerHaptic } from '@/hooks/useGestures';

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void | Promise<void>;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

interface SyncInfo {
  isSynced: boolean;
  syncType: 'user' | 'session' | null;
}

interface MobileFileActionsSheetProps {
  sessionId: string;
  onOpen?: (path: string) => void;
  onCopyPath?: (path: string) => void;
  onRename?: (path: string) => void;
  onDuplicate?: (path: string) => void;
  onMoveTo?: (path: string) => void;
  onShare?: (path: string) => void;
  onDelete?: (path: string) => void;
  onDownload?: (path: string) => void;
  onToggleSync?: (path: string) => void;
  getSyncInfo?: (path: string) => SyncInfo;
}

export function MobileFileActionsSheet({
  sessionId: _sessionId,
  onOpen,
  onCopyPath: _onCopyPath,
  onRename,
  onDuplicate,
  onMoveTo,
  onShare,
  onDelete,
  onDownload,
  onToggleSync,
  getSyncInfo,
}: MobileFileActionsSheetProps) {
  const target = useUIStore((state) => state.mobileFileActionsTarget);
  const closeSheet = useUIStore((state) => state.closeMobileFileActions);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);

  const handleAction = useCallback(
    async (actionId: string, handler?: (path: string) => void | Promise<void>) => {
      if (!target || !handler) return;

      triggerHaptic('light');
      setLoadingAction(actionId);

      try {
        await handler(target.path);

        // Special handling for copy path
        if (actionId === 'copy') {
          setCopiedPath(true);
          setTimeout(() => setCopiedPath(false), 2000);
        }

        // Close sheet after action (with small delay for visual feedback)
        setTimeout(closeSheet, 200);
      } catch (error) {
        console.error(`Action ${actionId} failed:`, error);
      } finally {
        setLoadingAction(null);
      }
    },
    [target, closeSheet]
  );

  const handleCopyPath = useCallback(async () => {
    if (!target) return;

    try {
      await navigator.clipboard.writeText(target.path);
      triggerHaptic('light');
      setCopiedPath(true);
      setTimeout(() => {
        setCopiedPath(false);
        closeSheet();
      }, 1000);
    } catch (error) {
      console.error('Failed to copy path:', error);
    }
  }, [target, closeSheet]);

  if (!target) return null;

  const isDirectory = target.type === 'directory';
  const syncInfo = getSyncInfo ? getSyncInfo(target.path) : { isSynced: false, syncType: null };

  const actions: ActionItem[] = [
    {
      id: 'open',
      label: isDirectory ? 'Open Folder' : 'Open File',
      icon: <ExternalLink className="w-5 h-5" />,
      onClick: () => handleAction('open', onOpen),
    },
    {
      id: 'copy',
      label: copiedPath ? 'Copied!' : 'Copy Path',
      icon: copiedPath ? (
        <Check className="w-5 h-5 text-green-400" />
      ) : (
        <Copy className="w-5 h-5" />
      ),
      onClick: handleCopyPath,
    },
    {
      id: 'rename',
      label: 'Rename',
      icon: <Edit3 className="w-5 h-5" />,
      onClick: () => handleAction('rename', onRename),
      disabled: !onRename,
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <FileCode className="w-5 h-5" />,
      onClick: () => handleAction('duplicate', onDuplicate),
      disabled: !onDuplicate || isDirectory,
    },
    {
      id: 'moveto',
      label: 'Move to...',
      icon: <FolderInput className="w-5 h-5" />,
      onClick: () => handleAction('moveto', onMoveTo),
      disabled: !onMoveTo,
    },
    {
      id: 'download',
      label: 'Download',
      icon: <Download className="w-5 h-5" />,
      onClick: () => handleAction('download', onDownload),
      disabled: !onDownload || isDirectory,
    },
    {
      id: 'share',
      label: 'Share',
      icon: <Share2 className="w-5 h-5" />,
      onClick: () => handleAction('share', onShare),
      disabled: !onShare,
    },
    ...(onToggleSync && syncInfo.syncType !== 'session'
      ? [
          {
            id: 'toggle-sync' as const,
            label: syncInfo.isSynced ? 'Remove from sync' : 'Add to user sync',
            icon: <CloudSync className="w-5 h-5" />,
            onClick: () => handleAction('toggle-sync', onToggleSync),
          },
        ]
      : []),
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-5 h-5" />,
      onClick: () => handleAction('delete', onDelete),
      variant: 'danger' as const,
      disabled: !onDelete,
    },
  ].filter((action) => !action.disabled);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-void/80 backdrop-blur-sm z-40 md:hidden"
        onClick={closeSheet}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 md:hidden',
          'bg-surface border-t border-border-default rounded-t-2xl',
          'animate-in slide-in-from-bottom duration-200',
          'flex flex-col max-h-[80vh]'
        )}
        role="dialog"
        aria-modal="true"
        aria-label={`Actions for ${target.name}`}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1.5 bg-border-strong rounded-full" />
        </div>

        {/* Header with file info */}
        <div className="px-4 pb-3 border-b border-border-subtle">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {isDirectory ? (
                <Folder className="w-8 h-8 text-accent-primary shrink-0" />
              ) : (
                <File className="w-8 h-8 text-text-muted shrink-0" />
              )}
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary truncate">
                  {target.name}
                </h2>
                <p className="text-xs text-text-muted truncate">{target.path}</p>
              </div>
            </div>
            <button
              onClick={closeSheet}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-surface-hover transition-colors touch-manipulation"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-text-secondary" />
            </button>
          </div>
        </div>

        {/* Actions list */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          <div className="space-y-1">
            {actions.map((action) => (
              <button
                key={action.id}
                onClick={action.onClick}
                disabled={loadingAction === action.id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg',
                  'text-left touch-manipulation transition-colors',
                  action.variant === 'danger'
                    ? 'text-red-400 active:bg-red-500/10'
                    : 'text-text-primary active:bg-surface-hover',
                  loadingAction === action.id && 'opacity-50'
                )}
              >
                {loadingAction === action.id ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <span
                    className={cn(action.variant === 'danger' ? 'text-red-400' : 'text-text-muted')}
                  >
                    {action.icon}
                  </span>
                )}
                <span className="text-base">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Safe area */}
        <div className="h-safe-bottom flex-shrink-0" />
      </div>
    </>
  );
}
