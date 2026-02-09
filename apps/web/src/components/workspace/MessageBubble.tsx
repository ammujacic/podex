'use client';

import React from 'react';
import { MessageBubbleBase } from './MessageBubbleBase';
import type { AgentMessage } from '@/stores/session';

interface MessageBubbleProps {
  message: AgentMessage;
}

/**
 * Desktop message bubble component for displaying agent/user messages.
 * Wraps MessageBubbleBase with desktop-specific settings.
 */
export const MessageBubble = React.memo<MessageBubbleProps>(
  function MessageBubble({ message }) {
    return <MessageBubbleBase message={message} isMobile={false} />;
  },
  (prevProps, nextProps) => prevProps.message === nextProps.message
);
