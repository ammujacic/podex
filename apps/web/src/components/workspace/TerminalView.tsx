'use client';

import { useEffect, useRef, useState } from 'react';
import { useTerminalManager, type TerminalStatus } from '@/contexts/TerminalManager';

export interface TerminalViewProps {
  terminalId: string;
  workspaceId: string;
  shell: string;
  isActive?: boolean;
  onReady?: () => void;
  onStatusChange?: (status: TerminalStatus) => void;
}

/**
 * Lightweight terminal view component.
 * Uses TerminalManager for connection management.
 * Can be mounted/unmounted without losing the terminal connection.
 */
export function TerminalView({
  terminalId,
  workspaceId,
  shell,
  isActive = true,
  onReady,
  onStatusChange,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    createTerminal,
    attachToContainer,
    detachFromContainer,
    hasTerminal,
    focusTerminal,
    resizeTerminal,
    getStatus,
  } = useTerminalManager();

  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const initializedRef = useRef(false);

  // Create terminal connection if it doesn't exist
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      if (!hasTerminal(terminalId)) {
        await createTerminal(terminalId, workspaceId, shell);
      }
    };

    init();
  }, [terminalId, workspaceId, shell, createTerminal, hasTerminal]);

  // Attach to container when mounted, detach when unmounted
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let attached = false;

    // Poll until terminal is ready (has xterm instance) then attach
    // createTerminal is async - the terminal ID exists in the map before
    // xterm is initialized, so we need to retry attachment
    const waitAndAttach = async () => {
      const maxAttempts = 50; // 5 seconds max (50 * 100ms)
      for (let attempt = 0; attempt < maxAttempts && !cancelled && !attached; attempt++) {
        if (hasTerminal(terminalId)) {
          // attachToContainer checks if term is ready internally
          // It returns early if term is null, so we check if container has children
          attachToContainer(terminalId, container);
          // Check if attachment succeeded by seeing if terminal element was added
          if (container.children.length > 0) {
            attached = true;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    waitAndAttach();

    return () => {
      cancelled = true;
      // Detach but keep connection alive
      detachFromContainer(terminalId);
    };
  }, [terminalId, attachToContainer, detachFromContainer, hasTerminal]);

  // Focus when active
  useEffect(() => {
    if (isActive) {
      focusTerminal(terminalId);
    }
  }, [isActive, terminalId, focusTerminal]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (isActive) {
        resizeTerminal(terminalId);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [terminalId, isActive, resizeTerminal]);

  // ResizeObserver for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        resizeTerminal(terminalId);
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [terminalId, resizeTerminal]);

  // Poll status (simple approach - could use subscription pattern)
  useEffect(() => {
    const interval = setInterval(() => {
      const newStatus = getStatus(terminalId);
      if (newStatus !== status) {
        setStatus(newStatus);
        onStatusChange?.(newStatus!);
        if (newStatus === 'connected') {
          onReady?.();
        }
      }
    }, 500);

    return () => clearInterval(interval);
  }, [terminalId, status, getStatus, onReady, onStatusChange]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden p-1"
      style={{ backgroundColor: '#0d0d12' }}
    />
  );
}
