'use client';

import { useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { FilePreviewCard } from './FilePreviewCard';
import { useSessionStore, type FilePreview } from '@/stores/session';
import { useUIStore } from '@/stores/ui';

interface FilePreviewLayerProps {
  sessionId: string;
}

export function FilePreviewLayer({ sessionId }: FilePreviewLayerProps) {
  // Use specific selectors to prevent unnecessary re-renders
  const filePreviews = useSessionStore(
    useShallow((state) => state.sessions[sessionId]?.filePreviews || [])
  );
  const closeFilePreview = useSessionStore((state) => state.closeFilePreview);
  const updateFilePreview = useSessionStore((state) => state.updateFilePreview);
  const pinFilePreview = useSessionStore((state) => state.pinFilePreview);
  const dockFilePreview = useSessionStore((state) => state.dockFilePreview);
  const openModal = useUIStore((state) => state.openModal);

  // Only show floating (non-docked) previews in this layer - memoized
  const floatingPreviews = useMemo(() => filePreviews.filter((p) => !p.docked), [filePreviews]);

  const handleClose = useCallback(
    (previewId: string) => {
      closeFilePreview(sessionId, previewId);
    },
    [sessionId, closeFilePreview]
  );

  const handlePin = useCallback(
    (previewId: string, pinned: boolean) => {
      pinFilePreview(sessionId, previewId, pinned);
    },
    [sessionId, pinFilePreview]
  );

  const handleDock = useCallback(
    (previewId: string) => {
      dockFilePreview(sessionId, previewId, true);
    },
    [sessionId, dockFilePreview]
  );

  const handleExpand = useCallback(
    (preview: FilePreview) => {
      // Open in full editor modal
      openModal('full-editor', {
        path: preview.path,
        content: preview.content,
        language: preview.language,
      });
    },
    [openModal]
  );

  const handleUpdate = useCallback(
    (previewId: string, updates: Partial<FilePreview>) => {
      updateFilePreview(sessionId, previewId, updates);
    },
    [sessionId, updateFilePreview]
  );

  if (floatingPreviews.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <AnimatePresence>
        {floatingPreviews.map((preview) => (
          <div key={preview.id} className="pointer-events-auto">
            <FilePreviewCard
              preview={preview}
              onClose={() => handleClose(preview.id)}
              onPin={(pinned) => handlePin(preview.id, pinned)}
              onExpand={() => handleExpand(preview)}
              onUpdate={(updates) => handleUpdate(preview.id, updates)}
              onDock={() => handleDock(preview.id)}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
