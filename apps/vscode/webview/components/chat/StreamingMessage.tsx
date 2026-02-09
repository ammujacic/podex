/**
 * Streaming message component for real-time token display.
 */

import React from 'react';
import './StreamingMessage.css';

interface StreamingMessageProps {
  agentName?: string;
  agentColor?: string;
  content: string;
  isComplete: boolean;
}

export function StreamingMessage({
  agentName,
  agentColor,
  content,
  isComplete,
}: StreamingMessageProps) {
  return (
    <div className="streaming-message">
      {agentName && (
        <div
          className="streaming-message__agent"
          style={{
            color: agentColor ? `var(--vscode-charts-${agentColor})` : undefined,
          }}
        >
          {agentName}
        </div>
      )}
      <div className="streaming-message__content">
        {content}
        {!isComplete && <span className="streaming-message__cursor" />}
      </div>
    </div>
  );
}

/**
 * Thinking indicator for when agent is processing.
 */
export function ThinkingIndicator({ agentName }: { agentName?: string }) {
  return (
    <div className="thinking-indicator">
      {agentName && <span className="thinking-indicator__agent">{agentName}</span>}
      <span className="thinking-indicator__text">is thinking</span>
      <span className="thinking-indicator__dots">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </div>
  );
}
