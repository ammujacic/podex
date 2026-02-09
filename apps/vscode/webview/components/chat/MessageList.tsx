/**
 * Message list component for displaying chat history.
 */

import React, { useEffect, useRef } from 'react';
import { Message } from './Message';
import { StreamingMessage, ThinkingIndicator } from './StreamingMessage';
import type { ChatMessage } from '../../types/messages';
import './MessageList.css';

interface MessageListProps {
  messages: ChatMessage[];
  streamingMessage?: {
    agentName?: string;
    agentColor?: string;
    content: string;
    isComplete: boolean;
  };
  isThinking?: boolean;
  thinkingAgentName?: string;
}

export function MessageList({
  messages,
  streamingMessage,
  isThinking,
  thinkingAgentName,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage?.content]);

  if (messages.length === 0 && !streamingMessage && !isThinking) {
    return (
      <div className="message-list message-list--empty">
        <div className="message-list__placeholder">
          <div className="message-list__placeholder-icon">💬</div>
          <div className="message-list__placeholder-text">
            Start a conversation with your agents
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list" ref={listRef}>
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}

      {isThinking && !streamingMessage && <ThinkingIndicator agentName={thinkingAgentName} />}

      {streamingMessage && (
        <StreamingMessage
          agentName={streamingMessage.agentName}
          agentColor={streamingMessage.agentColor}
          content={streamingMessage.content}
          isComplete={streamingMessage.isComplete}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
