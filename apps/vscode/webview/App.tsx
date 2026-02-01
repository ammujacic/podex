/**
 * Main App component for the Podex webview workspace.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useVSCodeApi } from './hooks/useVSCodeApi';
import { MessageList, ChatInput } from './components/chat';
import type { ChatMessage, StreamToken, ApprovalRequest, AgentStatus } from './types/messages';
import './styles/app.css';

/**
 * Webview state persisted across reloads.
 */
interface WebviewState {
  sessionId: string | null;
  messages: ChatMessage[];
}

export default function App() {
  const { postMessage, onMessage, getState, setState } = useVSCodeApi();

  // Restore state from VSCode
  const savedState = getState<WebviewState>();

  const [sessionId, setSessionId] = useState<string | null>(savedState?.sessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(savedState?.messages ?? []);
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [streamingAgentName, setStreamingAgentName] = useState<string | undefined>();
  const [streamingAgentColor, setStreamingAgentColor] = useState<string | undefined>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingAgentName, setThinkingAgentName] = useState<string | undefined>();
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);

  // Persist state
  useEffect(() => {
    setState({ sessionId, messages });
  }, [sessionId, messages, setState]);

  // Set up message handlers
  useEffect(() => {
    // Tell extension we're ready
    postMessage('ready');

    // Session connected
    const unsubSession = onMessage('session:connected', (payload) => {
      const data = payload as { sessionId: string };
      setSessionId(data.sessionId);
      setMessages([]); // Clear messages for new session
    });

    // Chat message received
    const unsubMessage = onMessage('chat:message', (payload) => {
      const message = payload as ChatMessage;
      setMessages((prev) => [...prev, message]);

      // Clear streaming state when message is complete
      if (isStreaming) {
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingAgentName(undefined);
        setStreamingAgentColor(undefined);
      }

      // Clear thinking state
      setIsThinking(false);
      setThinkingAgentName(undefined);
    });

    // Streaming token
    const unsubToken = onMessage('chat:token', (payload) => {
      const token = payload as StreamToken;

      if (token.done) {
        // Streaming complete - convert to full message
        setIsStreaming(false);
        setStreamingContent('');
        setStreamingAgentName(undefined);
        setStreamingAgentColor(undefined);
      } else {
        setIsStreaming(true);
        setStreamingContent((prev) => prev + token.token);
        setIsThinking(false);
      }
    });

    // Agent status change
    const unsubAgentStatus = onMessage('agent:status', (payload) => {
      const status = payload as AgentStatus;

      if (status.status === 'thinking') {
        setIsThinking(true);
        setThinkingAgentName(status.current_task);
      } else if (status.status === 'idle' || status.status === 'error') {
        setIsThinking(false);
        setThinkingAgentName(undefined);
      }
    });

    // Approval request
    const unsubApproval = onMessage('approval:request', (payload) => {
      setApprovalRequest(payload as ApprovalRequest);
    });

    // Error
    const unsubError = onMessage('error', (payload) => {
      const error = payload as { message: string };
      // Add error as system message
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          session_id: sessionId || '',
          role: 'system',
          content: `Error: ${error.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    });

    return () => {
      unsubSession();
      unsubMessage();
      unsubToken();
      unsubAgentStatus();
      unsubApproval();
      unsubError();
    };
  }, [postMessage, onMessage, sessionId, isStreaming]);

  // Handle sending a message
  const handleSend = useCallback(
    (content: string) => {
      postMessage('chat:send', { content });
    },
    [postMessage]
  );

  // Handle approval response
  const handleApprovalResponse = useCallback(
    (approved: boolean, addToAllowlist = false) => {
      if (!approvalRequest) return;

      postMessage('approval:respond', {
        agentId: approvalRequest.agent_id,
        approvalId: approvalRequest.id,
        approved,
        addToAllowlist,
        isNative: approvalRequest.is_native,
      });

      setApprovalRequest(null);
    },
    [postMessage, approvalRequest]
  );

  // No session connected
  if (!sessionId) {
    return (
      <div className="workspace">
        <div className="workspace__empty">
          <div className="workspace__empty-icon">🔌</div>
          <h2>No Session Connected</h2>
          <p>Open a session from the sidebar to start chatting with agents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      {/* Header */}
      <div className="workspace__header">
        <h3>Session: {sessionId.slice(0, 8)}...</h3>
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        streamingMessage={
          isStreaming
            ? {
                agentName: streamingAgentName,
                agentColor: streamingAgentColor,
                content: streamingContent,
                isComplete: false,
              }
            : undefined
        }
        isThinking={isThinking}
        thinkingAgentName={thinkingAgentName}
      />

      {/* Approval prompt */}
      {approvalRequest && (
        <ApprovalPrompt
          request={approvalRequest}
          onApprove={() => handleApprovalResponse(true)}
          onDeny={() => handleApprovalResponse(false)}
          onAlwaysAllow={() => handleApprovalResponse(true, true)}
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={!sessionId || !!approvalRequest}
        placeholder={approvalRequest ? 'Respond to approval request above' : 'Type a message...'}
      />
    </div>
  );
}

/**
 * Approval prompt component.
 */
function ApprovalPrompt({
  request,
  onApprove,
  onDeny,
  onAlwaysAllow,
}: {
  request: ApprovalRequest;
  onApprove: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}) {
  return (
    <div className="approval-prompt">
      <div className="approval-prompt__header">
        <span className="approval-prompt__icon">⚠️</span>
        <span className="approval-prompt__title">Approval Required</span>
      </div>
      <div className="approval-prompt__content">
        <div className="approval-prompt__agent">{request.agent_name}</div>
        <div className="approval-prompt__description">{request.description}</div>
        <div className="approval-prompt__tool">
          <code>{request.tool_name}</code>
        </div>
        {request.tool_input && Object.keys(request.tool_input).length > 0 && (
          <pre className="approval-prompt__input">
            {JSON.stringify(request.tool_input, null, 2)}
          </pre>
        )}
      </div>
      <div className="approval-prompt__actions">
        <button className="approval-prompt__button approval-prompt__button--deny" onClick={onDeny}>
          Deny
        </button>
        <button
          className="approval-prompt__button approval-prompt__button--allow"
          onClick={onAlwaysAllow}
        >
          Always Allow
        </button>
        <button
          className="approval-prompt__button approval-prompt__button--approve"
          onClick={onApprove}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
