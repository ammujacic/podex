/**
 * Single chat message component.
 */

import React from 'react';
import type { ChatMessage } from '../../types/messages';
import './Message.css';

interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={`message ${isUser ? 'message--user' : ''} ${isSystem ? 'message--system' : ''}`}
    >
      {!isUser && message.agent_name && (
        <div
          className="message__agent"
          style={{
            color: message.agent_color ? `var(--vscode-charts-${message.agent_color})` : undefined,
          }}
        >
          {message.agent_name}
        </div>
      )}
      <div className="message__content">
        <MessageContent content={message.content} />
      </div>
      <div className="message__time">{formatTime(message.timestamp)}</div>
    </div>
  );
}

/**
 * Render message content with code blocks.
 */
function MessageContent({ content }: { content: string }) {
  // Simple code block detection
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3);
          const firstNewline = code.indexOf('\n');
          const language = firstNewline > 0 ? code.slice(0, firstNewline).trim() : '';
          const codeContent = firstNewline > 0 ? code.slice(firstNewline + 1) : code;

          return (
            <pre key={index} className="message__code">
              {language && <div className="message__code-lang">{language}</div>}
              <code>{codeContent}</code>
            </pre>
          );
        }

        // Regular text - handle inline code
        const inlineParts = part.split(/(`[^`]+`)/g);
        return (
          <span key={index}>
            {inlineParts.map((inline, i) => {
              if (inline.startsWith('`') && inline.endsWith('`')) {
                return (
                  <code key={i} className="message__inline-code">
                    {inline.slice(1, -1)}
                  </code>
                );
              }
              return inline;
            })}
          </span>
        );
      })}
    </>
  );
}

/**
 * Format timestamp to local time.
 */
function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
