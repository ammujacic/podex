'use client';

import React from 'react';
import { MessageBubbleBase } from './MessageBubbleBase';
import type { AgentMessage } from '@/stores/session';

interface MobileMessageBubbleProps {
  message: AgentMessage;
  /** Callback when a file link is clicked in a message */
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}

/**
 * Mobile-optimized message bubble component.
 * Wraps MessageBubbleBase with mobile-specific settings (larger touch targets).
 */
export const MobileMessageBubble = React.memo<MobileMessageBubbleProps>(
  function MobileMessageBubble({ message, onFileClick }) {
    return <MessageBubbleBase message={message} isMobile={true} onFileClick={onFileClick} />;
  },
  (prevProps, nextProps) =>
    prevProps.message === nextProps.message && prevProps.onFileClick === nextProps.onFileClick
);
