import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Mock the streaming store before importing the session store so that
// finalizeStreamingMessage uses the mocked implementation.
vi.mock('../streaming', () => {
  const streamingMessage = {
    messageId: 'stream-msg-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    content: 'Hello! How can I assist you today?',
    thinkingContent: '',
    isStreaming: false,
    startedAt: new Date(),
  };

  const state = {
    getStreamingMessage: vi.fn((messageId: string) =>
      messageId === streamingMessage.messageId ? streamingMessage : undefined
    ),
    completeStreaming: vi.fn(() => streamingMessage),
  };

  const useStreamingStore = Object.assign(
    (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
    {
      getState: () => state,
    }
  );

  return { useStreamingStore };
});

import { useSessionStore } from '../session';
import type { Agent, AgentMessage, Session } from '../sessionTypes';
import { mockAgent, mockSession } from '@/__tests__/fixtures/api-responses';

describe('sessionStore streaming integration', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useSessionStore.setState({
        sessions: {},
        currentSessionId: null,
        recentFiles: [],
      });
    });
  });

  it('finalizeStreamingMessage does not duplicate an existing assistant message with same ID', () => {
    const { result } = renderHook(() => useSessionStore());

    const session: Session = {
      ...mockSession,
      id: 'session-1',
      agents: [],
      // Ensure conversationSessions array exists for this test
      // (type may mark this as optional depending on version).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      conversationSessions: [] as any,
    };

    const agent: Agent = {
      ...mockAgent,
      id: 'agent-1',
    };

    let conversationId = '';

    act(() => {
      // Seed session and agent
      result.current.createSession(session);
      result.current.addAgent(session.id, agent);

      // Create and attach a conversation to the agent
      const conversation = result.current.createConversationSession(session.id);
      conversationId = conversation.id;
      result.current.attachConversationToAgent(session.id, conversationId, agent.id);

      // Add an assistant message that should be equivalent to the streaming one
      const existingMessage: AgentMessage = {
        id: 'stream-msg-1',
        role: 'assistant',
        content: 'Hello! How can I assist you today?',
        timestamp: new Date(),
      };
      result.current.addConversationMessage(session.id, conversationId, existingMessage);
    });

    act(() => {
      // Finalize the same streaming message; it should NOT create a duplicate
      result.current.finalizeStreamingMessage('stream-msg-1', 'Hello! How can I assist you today?');
    });

    const finalSession = useSessionStore.getState().sessions[session.id];
    const conversation = finalSession.conversationSessions.find((c) => c.id === conversationId)!;

    const matchingMessages = conversation.messages.filter(
      (m) => m.id === 'stream-msg-1' && m.content === 'Hello! How can I assist you today?'
    );

    expect(matchingMessages).toHaveLength(1);
  });
});
