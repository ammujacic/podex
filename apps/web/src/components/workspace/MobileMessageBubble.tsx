'use client';

import React from 'react';
import { MessageBubbleBase } from './MessageBubbleBase';
import type { AgentMessage } from '@/stores/session';

interface MobileMessageBubbleProps {
  message: AgentMessage;
}

/**
 * Mobile-optimized message bubble component.
 * Wraps MessageBubbleBase with mobile-specific settings (larger touch targets).
 */
export const MobileMessageBubble = React.memo<MobileMessageBubbleProps>(
  function MobileMessageBubble({ message }) {
    return <MessageBubbleBase message={message} isMobile={true} />;
  },
  (prevProps, nextProps) => prevProps.message === nextProps.message
);
