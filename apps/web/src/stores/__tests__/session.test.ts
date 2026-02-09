import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSessionStore } from '../session';
import type { Agent, AgentMessage, Session } from '../sessionTypes';
import {
  mockAgent,
  mockSession,
  mockUserMessage,
  mockAssistantMessage,
  mockEmptyConversationSession,
} from '@/__tests__/fixtures/api-responses';

// Mock the streaming store
vi.mock('../streaming', () => ({
  useStreamingStore: vi.fn(() => ({
    startStreaming: vi.fn(),
    appendToken: vi.fn(),
    appendThinking: vi.fn(),
    finalizeMessage: vi.fn(),
    getMessage: vi.fn(),
  })),
}));

describe('sessionStore', () => {
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

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty sessions', () => {
      const { result } = renderHook(() => useSessionStore());
      expect(result.current.sessions).toEqual({});
    });

    it('has no current session', () => {
      const { result } = renderHook(() => useSessionStore());
      expect(result.current.currentSessionId).toBeNull();
    });

    it('has empty recent files', () => {
      const { result } = renderHook(() => useSessionStore());
      expect(result.current.recentFiles).toEqual([]);
    });
  });

  // ========================================================================
  // Session Actions
  // ========================================================================

  describe('Session Management', () => {
    describe('createSession', () => {
      it('adds new session to store', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
        });

        expect(result.current.sessions[mockSession.id]).toBeDefined();
        expect(result.current.sessions[mockSession.id]).toEqual(mockSession);
      });

      it('sets current session to newly created session', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
        });

        expect(result.current.currentSessionId).toBe(mockSession.id);
      });

      it('can create multiple sessions', () => {
        const { result } = renderHook(() => useSessionStore());
        const session2: Session = { ...mockSession, id: 'session-2', name: 'Session 2' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.createSession(session2);
        });

        expect(Object.keys(result.current.sessions)).toHaveLength(2);
        expect(result.current.sessions[mockSession.id]).toBeDefined();
        expect(result.current.sessions[session2.id]).toBeDefined();
      });
    });

    describe('deleteSession', () => {
      it('removes session from store', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.deleteSession(mockSession.id);
        });

        expect(result.current.sessions[mockSession.id]).toBeUndefined();
      });

      it('clears current session if deleted session was current', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.deleteSession(mockSession.id);
        });

        expect(result.current.currentSessionId).toBeNull();
      });

      it('keeps current session if deleted session was not current', () => {
        const { result } = renderHook(() => useSessionStore());
        const session2: Session = { ...mockSession, id: 'session-2' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.createSession(session2);
          result.current.setCurrentSession(mockSession.id);
          result.current.deleteSession(session2.id);
        });

        expect(result.current.currentSessionId).toBe(mockSession.id);
      });

      it('handles deleting non-existent session gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        expect(() => {
          act(() => {
            result.current.deleteSession('non-existent-id');
          });
        }).not.toThrow();
      });
    });

    describe('setCurrentSession', () => {
      it('sets the current session ID', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.setCurrentSession(mockSession.id);
        });

        expect(result.current.currentSessionId).toBe(mockSession.id);
      });

      it('can switch between sessions', () => {
        const { result } = renderHook(() => useSessionStore());
        const session2: Session = { ...mockSession, id: 'session-2' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.createSession(session2);
          result.current.setCurrentSession(mockSession.id);
        });

        expect(result.current.currentSessionId).toBe(mockSession.id);

        act(() => {
          result.current.setCurrentSession(session2.id);
        });

        expect(result.current.currentSessionId).toBe(session2.id);
      });
    });
  });

  // ========================================================================
  // Agent Actions
  // ========================================================================

  describe('Agent Management', () => {
    describe('addAgent', () => {
      it('adds agent to session', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.agents).toHaveLength(mockSession.agents.length + 1);
        expect(session.agents.find((a) => a.id === mockAgent.id)).toEqual(mockAgent);
      });

      it('handles adding agent to non-existent session gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        expect(() => {
          act(() => {
            result.current.addAgent('non-existent', mockAgent);
          });
        }).not.toThrow();
      });

      it('can add multiple agents to session', () => {
        const { result } = renderHook(() => useSessionStore());
        const agent2: Agent = { ...mockAgent, id: 'agent-2', name: 'Developer' };
        const agent3: Agent = { ...mockAgent, id: 'agent-3', name: 'Tester' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, agent2);
          result.current.addAgent(mockSession.id, agent3);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.agents).toHaveLength(mockSession.agents.length + 2);
      });
    });

    describe('removeAgent', () => {
      it('removes agent from session', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.removeAgent(mockSession.id, mockAgent.id);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.agents.find((a) => a.id === mockAgent.id)).toBeUndefined();
      });

      it('clears activeAgentId if removed agent was active', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.setActiveAgent(mockSession.id, mockAgent.id);
          result.current.removeAgent(mockSession.id, mockAgent.id);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.activeAgentId).toBeNull();
      });

      it('keeps activeAgentId if removed agent was not active', () => {
        const { result } = renderHook(() => useSessionStore());
        const agent2: Agent = { ...mockAgent, id: 'agent-2' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.addAgent(mockSession.id, agent2);
          result.current.setActiveAgent(mockSession.id, mockAgent.id);
          result.current.removeAgent(mockSession.id, agent2.id);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.activeAgentId).toBe(mockAgent.id);
      });

      it('handles removing non-existent agent gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
        });

        expect(() => {
          act(() => {
            result.current.removeAgent(mockSession.id, 'non-existent-agent');
          });
        }).not.toThrow();
      });
    });

    describe('updateAgent', () => {
      it('updates agent properties', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.updateAgent(mockSession.id, mockAgent.id, {
            name: 'Updated Name',
            status: 'thinking',
          });
        });

        const session = result.current.sessions[mockSession.id];
        const agent = session.agents.find((a) => a.id === mockAgent.id);
        expect(agent?.name).toBe('Updated Name');
        expect(agent?.status).toBe('thinking');
      });

      it('does not affect other agents', () => {
        const { result } = renderHook(() => useSessionStore());
        const agent2: Agent = { ...mockAgent, id: 'agent-2', name: 'Developer' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.addAgent(mockSession.id, agent2);
          result.current.updateAgent(mockSession.id, mockAgent.id, { name: 'Updated' });
        });

        const session = result.current.sessions[mockSession.id];
        const unchanged = session.agents.find((a) => a.id === agent2.id);
        expect(unchanged?.name).toBe('Developer');
      });

      it('handles updating non-existent agent gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
        });

        expect(() => {
          act(() => {
            result.current.updateAgent(mockSession.id, 'non-existent', { name: 'Test' });
          });
        }).not.toThrow();
      });
    });

    describe('setActiveAgent', () => {
      it('sets active agent for session', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.setActiveAgent(mockSession.id, mockAgent.id);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.activeAgentId).toBe(mockAgent.id);
      });

      it('can clear active agent by setting to null', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.setActiveAgent(mockSession.id, mockAgent.id);
          result.current.setActiveAgent(mockSession.id, null);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.activeAgentId).toBeNull();
      });

      it('can switch between agents', () => {
        const { result } = renderHook(() => useSessionStore());
        const agent2: Agent = { ...mockAgent, id: 'agent-2' };

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          result.current.addAgent(mockSession.id, agent2);
          result.current.setActiveAgent(mockSession.id, mockAgent.id);
        });

        expect(result.current.sessions[mockSession.id].activeAgentId).toBe(mockAgent.id);

        act(() => {
          result.current.setActiveAgent(mockSession.id, agent2.id);
        });

        expect(result.current.sessions[mockSession.id].activeAgentId).toBe(agent2.id);
      });
    });
  });

  // ========================================================================
  // Conversation Session Actions
  // ========================================================================

  describe('Conversation Session Management', () => {
    describe('createConversationSession', () => {
      it('creates a new conversation session', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.createConversationSession(mockSession.id, { name: 'New Conversation' });
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.conversationSessions).toHaveLength(1);
        expect(session.conversationSessions[0].name).toBe('New Conversation');
      });

      it('derives name from first message if provided', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.createConversationSession(mockSession.id, {
            firstMessage: 'Help me write a React component',
          });
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.conversationSessions[0].name).toContain('Help me write');
      });

      it('creates conversation with empty messages array', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.createConversationSession(mockSession.id);
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.conversationSessions[0].messages).toEqual([]);
        expect(session.conversationSessions[0].messageCount).toBe(0);
      });
    });

    describe('attachConversationToAgent', () => {
      it('attaches conversation to agent', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          const conv = result.current.createConversationSession(mockSession.id);
          result.current.attachConversationToAgent(mockSession.id, conv.id, mockAgent.id);
        });

        const session = result.current.sessions[mockSession.id];
        const agent = session.agents.find((a) => a.id === mockAgent.id);
        expect(agent?.conversationSessionId).toBe(session.conversationSessions[0].id);
      });
    });

    describe('addConversationMessage', () => {
      let conversationId: string;

      beforeEach(() => {
        const { result } = renderHook(() => useSessionStore());
        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          const conv = result.current.createConversationSession(mockSession.id);
          conversationId = conv.id;
          result.current.attachConversationToAgent(mockSession.id, conv.id, mockAgent.id);
        });
      });

      it('adds message to conversation', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(1);
        expect(conv?.messages[0]).toEqual(mockUserMessage);
      });

      it('prevents duplicate messages by ID', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(1);
      });

      it('replaces temp message with real message', () => {
        const { result } = renderHook(() => useSessionStore());
        const tempMessage: AgentMessage = {
          id: 'temp-123',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        };
        const realMessage: AgentMessage = {
          id: 'real-456',
          role: 'user',
          content: 'Hello',
          timestamp: new Date(),
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, tempMessage);
          result.current.addConversationMessage(mockSession.id, conversationId, realMessage);
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(1);
        expect(conv?.messages[0].id).toBe(realMessage.id);
      });

      it('deduplicates assistant messages within time window', () => {
        const { result } = renderHook(() => useSessionStore());
        const message1: AgentMessage = {
          id: 'msg-1',
          role: 'assistant',
          content: 'Response',
          timestamp: new Date(),
        };
        const message2: AgentMessage = {
          id: 'msg-2',
          role: 'assistant',
          content: 'Response',
          timestamp: new Date(Date.now() + 5000), // Within 10 second window
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, message1);
          result.current.addConversationMessage(mockSession.id, conversationId, message2);
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(1);
      });

      it('allows assistant messages with same content outside time window', () => {
        const { result } = renderHook(() => useSessionStore());
        const message1: AgentMessage = {
          id: 'msg-1',
          role: 'assistant',
          content: 'Response',
          timestamp: new Date(Date.now() - 15000), // 15 seconds ago
        };
        const message2: AgentMessage = {
          id: 'msg-2',
          role: 'assistant',
          content: 'Response',
          timestamp: new Date(),
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, message1);
          result.current.addConversationMessage(mockSession.id, conversationId, message2);
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(2);
      });

      it('enforces message limit per conversation', () => {
        const { result } = renderHook(() => useSessionStore());
        const MAX_MESSAGES = 100; // From sessionTypes MAX_MESSAGES_PER_CONVERSATION

        act(() => {
          // Add more than MAX_MESSAGES
          for (let i = 0; i < MAX_MESSAGES + 10; i++) {
            result.current.addConversationMessage(mockSession.id, conversationId, {
              id: `msg-${i}`,
              role: 'user',
              content: `Message ${i}`,
              timestamp: new Date(Date.now() + i),
            });
          }
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
      });

      it('keeps most recent messages when enforcing limit', () => {
        const { result } = renderHook(() => useSessionStore());
        const MAX_MESSAGES = 100; // From sessionTypes MAX_MESSAGES_PER_CONVERSATION

        act(() => {
          for (let i = 0; i < MAX_MESSAGES + 10; i++) {
            result.current.addConversationMessage(mockSession.id, conversationId, {
              id: `msg-${i}`,
              role: 'user',
              content: `Message ${i}`,
              timestamp: new Date(Date.now() + i),
            });
          }
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        // Should have the last MAX_MESSAGES messages (100)
        // We added 110 messages, so we keep messages 10-109
        expect(conv?.messages.length).toBe(MAX_MESSAGES);
        expect(conv?.messages[0]?.content).toBe('Message 10'); // First kept message
        expect(conv?.messages[conv.messages.length - 1]?.content).toBe(
          `Message ${MAX_MESSAGES + 9}`
        );
      });

      it('handles adding message to non-existent session gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        expect(() => {
          act(() => {
            result.current.addConversationMessage('non-existent', conversationId, mockUserMessage);
          });
        }).not.toThrow();
      });

      it('does not affect other conversations in the session', () => {
        const { result } = renderHook(() => useSessionStore());
        let conv2Id: string;

        act(() => {
          const conv2 = result.current.createConversationSession(mockSession.id);
          conv2Id = conv2.id;
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
        });

        const session = result.current.sessions[mockSession.id];
        const unchangedConv = session.conversationSessions.find((c) => c.id === conv2Id!);
        expect(unchangedConv?.messages).toHaveLength(0);
      });
    });

    describe('deleteConversationMessage', () => {
      let conversationId: string;

      beforeEach(() => {
        const { result } = renderHook(() => useSessionStore());
        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          const conv = result.current.createConversationSession(mockSession.id);
          conversationId = conv.id;
        });
      });

      it('removes message from conversation', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
          result.current.deleteConversationMessage(
            mockSession.id,
            conversationId,
            mockUserMessage.id
          );
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(0);
      });

      it('only removes specified message', () => {
        const { result } = renderHook(() => useSessionStore());
        const message2: AgentMessage = {
          ...mockAssistantMessage,
          id: 'msg-2',
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, mockUserMessage);
          result.current.addConversationMessage(mockSession.id, conversationId, message2);
          result.current.deleteConversationMessage(
            mockSession.id,
            conversationId,
            mockUserMessage.id
          );
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages).toHaveLength(1);
        expect(conv?.messages[0].id).toBe(message2.id);
      });

      it('handles deleting non-existent message gracefully', () => {
        const { result } = renderHook(() => useSessionStore());

        expect(() => {
          act(() => {
            result.current.deleteConversationMessage(
              mockSession.id,
              conversationId,
              'non-existent-msg'
            );
          });
        }).not.toThrow();
      });
    });

    describe('updateConversationMessageId', () => {
      let conversationId: string;

      beforeEach(() => {
        const { result } = renderHook(() => useSessionStore());
        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          const conv = result.current.createConversationSession(mockSession.id);
          conversationId = conv.id;
        });
      });

      it('updates message ID', () => {
        const { result } = renderHook(() => useSessionStore());
        const tempMessage: AgentMessage = {
          ...mockUserMessage,
          id: 'temp-123',
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, tempMessage);
          result.current.updateConversationMessageId(
            mockSession.id,
            conversationId,
            'temp-123',
            'real-456'
          );
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages[0].id).toBe('real-456');
      });

      it('preserves message content and properties', () => {
        const { result } = renderHook(() => useSessionStore());
        const tempMessage: AgentMessage = {
          id: 'temp-123',
          role: 'user',
          content: 'Test message',
          timestamp: new Date(),
        };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, tempMessage);
          result.current.updateConversationMessageId(
            mockSession.id,
            conversationId,
            'temp-123',
            'real-456'
          );
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages[0].content).toBe('Test message');
        expect(conv?.messages[0].role).toBe('user');
      });

      it('only updates specified message', () => {
        const { result } = renderHook(() => useSessionStore());
        const msg1: AgentMessage = { ...mockUserMessage, id: 'msg-1' };
        const msg2: AgentMessage = { ...mockAssistantMessage, id: 'msg-2' };

        act(() => {
          result.current.addConversationMessage(mockSession.id, conversationId, msg1);
          result.current.addConversationMessage(mockSession.id, conversationId, msg2);
          result.current.updateConversationMessageId(
            mockSession.id,
            conversationId,
            'msg-1',
            'updated-1'
          );
        });

        const session = result.current.sessions[mockSession.id];
        const conv = session.conversationSessions.find((c) => c.id === conversationId);
        expect(conv?.messages[0].id).toBe('updated-1');
        expect(conv?.messages[1].id).toBe('msg-2');
      });
    });

    describe('getConversationForAgent', () => {
      it('returns null when agent has no conversation attached', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
        });

        const conv = result.current.getConversationForAgent(mockSession.id, mockAgent.id);
        expect(conv).toBeNull();
      });

      it('returns conversation when attached to agent', () => {
        const { result } = renderHook(() => useSessionStore());
        let convId: string;

        act(() => {
          result.current.createSession(mockSession);
          result.current.addAgent(mockSession.id, mockAgent);
          const conv = result.current.createConversationSession(mockSession.id, {
            name: 'Test Conv',
          });
          convId = conv.id;
          result.current.attachConversationToAgent(mockSession.id, conv.id, mockAgent.id);
        });

        const conv = result.current.getConversationForAgent(mockSession.id, mockAgent.id);
        expect(conv).not.toBeNull();
        expect(conv?.id).toBe(convId!);
        expect(conv?.name).toBe('Test Conv');
      });
    });
  });

  // ========================================================================
  // Agent Position/Grid Actions
  // ========================================================================

  describe('Agent Position and Grid', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSessionStore());
      act(() => {
        result.current.createSession(mockSession);
        result.current.addAgent(mockSession.id, mockAgent);
      });
    });

    describe('updateAgentPosition', () => {
      it('updates agent position', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.updateAgentPosition(mockSession.id, mockAgent.id, { x: 100, y: 200 });
        });

        const agent = result.current.sessions[mockSession.id].agents.find(
          (a) => a.id === mockAgent.id
        );
        expect(agent?.position.x).toBe(100);
        expect(agent?.position.y).toBe(200);
      });

      it('partially updates position', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.updateAgentPosition(mockSession.id, mockAgent.id, { x: 50, y: 60 });
          result.current.updateAgentPosition(mockSession.id, mockAgent.id, { x: 100 });
        });

        const agent = result.current.sessions[mockSession.id].agents.find(
          (a) => a.id === mockAgent.id
        );
        expect(agent?.position.x).toBe(100);
        expect(agent?.position.y).toBe(60); // Unchanged
      });
    });

    describe('updateAgentGridSpan', () => {
      it('updates agent grid span', () => {
        const { result } = renderHook(() => useSessionStore());
        const newSpan = { colSpan: 2, rowSpan: 2 };

        act(() => {
          result.current.updateAgentGridSpan(mockSession.id, mockAgent.id, newSpan);
        });

        const agent = result.current.sessions[mockSession.id].agents.find(
          (a) => a.id === mockAgent.id
        );
        expect(agent?.gridSpan).toEqual(newSpan);
      });
    });

    describe('bringAgentToFront', () => {
      it('sets agent z-index higher than others', () => {
        const { result } = renderHook(() => useSessionStore());
        const agent2: Agent = {
          ...mockAgent,
          id: 'agent-2',
          position: { ...mockAgent.position!, zIndex: 5 },
        };
        const agent3: Agent = {
          ...mockAgent,
          id: 'agent-3',
          position: { ...mockAgent.position!, zIndex: 10 },
        };

        act(() => {
          result.current.addAgent(mockSession.id, agent2);
          result.current.addAgent(mockSession.id, agent3);
          result.current.bringAgentToFront(mockSession.id, mockAgent.id);
        });

        const agent = result.current.sessions[mockSession.id].agents.find(
          (a) => a.id === mockAgent.id
        );
        expect(agent?.position?.zIndex).toBeGreaterThan(10);
      });
    });
  });

  // ========================================================================
  // Recent Files
  // ========================================================================

  describe('Recent Files', () => {
    describe('addRecentFile', () => {
      it('adds file to recent files', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addRecentFile('/path/to/file.ts');
        });

        expect(result.current.recentFiles).toContain('/path/to/file.ts');
      });

      it('adds multiple files', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addRecentFile('/path/to/file1.ts');
          result.current.addRecentFile('/path/to/file2.ts');
        });

        expect(result.current.recentFiles).toHaveLength(2);
      });

      it('moves existing file to front', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addRecentFile('/file1.ts');
          result.current.addRecentFile('/file2.ts');
          result.current.addRecentFile('/file1.ts'); // Add again
        });

        expect(result.current.recentFiles[0]).toBe('/file1.ts');
      });

      it('enforces max recent files limit', () => {
        const { result } = renderHook(() => useSessionStore());
        const MAX_RECENT = 20; // From sessionTypes

        act(() => {
          for (let i = 0; i < MAX_RECENT + 5; i++) {
            result.current.addRecentFile(`/file${i}.ts`);
          }
        });

        expect(result.current.recentFiles.length).toBeLessThanOrEqual(MAX_RECENT);
      });

      it('keeps most recent files when enforcing limit', () => {
        const { result } = renderHook(() => useSessionStore());
        const MAX_RECENT = 20;

        act(() => {
          for (let i = 0; i < MAX_RECENT + 5; i++) {
            result.current.addRecentFile(`/file${i}.ts`);
          }
        });

        // Most recently added should be first
        expect(result.current.recentFiles[0]).toBe(`/file${MAX_RECENT + 4}.ts`);
      });
    });

    describe('clearRecentFiles', () => {
      it('clears all recent files', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.addRecentFile('/file1.ts');
          result.current.addRecentFile('/file2.ts');
          result.current.clearRecentFiles();
        });

        expect(result.current.recentFiles).toHaveLength(0);
      });
    });
  });

  // ========================================================================
  // View Mode
  // ========================================================================

  describe('View Mode', () => {
    it('sets view mode for session', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.createSession(mockSession);
        result.current.setViewMode(mockSession.id, 'focus');
      });

      expect(result.current.sessions[mockSession.id].viewMode).toBe('focus');
    });

    it('can switch between view modes', () => {
      const { result } = renderHook(() => useSessionStore());

      act(() => {
        result.current.createSession(mockSession);
        result.current.setViewMode(mockSession.id, 'grid');
        result.current.setViewMode(mockSession.id, 'freeform');
      });

      expect(result.current.sessions[mockSession.id].viewMode).toBe('freeform');
    });

    it('handles setting view mode for non-existent session gracefully', () => {
      const { result } = renderHook(() => useSessionStore());

      expect(() => {
        act(() => {
          result.current.setViewMode('non-existent', 'grid');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Workspace Status
  // ========================================================================

  describe('Workspace Status', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSessionStore());
      act(() => {
        result.current.createSession(mockSession);
      });
    });

    describe('setWorkspaceStatus', () => {
      it('sets workspace status to running', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceStatus(mockSession.id, 'running');
        });

        expect(result.current.sessions[mockSession.id].workspaceStatus).toBe('running');
      });

      it('sets workspace status to stopped', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceStatus(mockSession.id, 'stopped');
        });

        expect(result.current.sessions[mockSession.id].workspaceStatus).toBe('stopped');
      });

      it('sets workspace status to error', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceStatus(mockSession.id, 'error');
        });

        expect(result.current.sessions[mockSession.id].workspaceStatus).toBe('error');
      });
    });

    describe('setWorkspaceStatusChecking', () => {
      it('sets status checking flag', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceStatusChecking(mockSession.id, true);
        });

        expect(result.current.sessions[mockSession.id].workspaceStatusChecking).toBe(true);
      });
    });

    describe('setWorkspaceError', () => {
      it('sets workspace error message', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceError(mockSession.id, 'Connection failed');
        });

        expect(result.current.sessions[mockSession.id].workspaceError).toBe('Connection failed');
      });

      it('clears error when set to null', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.setWorkspaceError(mockSession.id, 'Error');
          result.current.setWorkspaceError(mockSession.id, null);
        });

        expect(result.current.sessions[mockSession.id].workspaceError).toBeNull();
      });
    });

    describe('updateSessionWorkspaceId', () => {
      it('updates workspace ID', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.updateSessionWorkspaceId(mockSession.id, 'new-workspace-id');
        });

        expect(result.current.sessions[mockSession.id].workspaceId).toBe('new-workspace-id');
      });
    });

    describe('updateSessionInfo', () => {
      it('updates session name', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.updateSessionInfo(mockSession.id, { name: 'Updated Name' });
        });

        expect(result.current.sessions[mockSession.id].name).toBe('Updated Name');
      });

      it('updates multiple fields', () => {
        const { result } = renderHook(() => useSessionStore());

        act(() => {
          result.current.updateSessionInfo(mockSession.id, {
            name: 'New Name',
            branch: 'feature-branch',
            gitUrl: 'https://github.com/user/repo',
          });
        });

        const session = result.current.sessions[mockSession.id];
        expect(session.name).toBe('New Name');
        expect(session.branch).toBe('feature-branch');
        expect(session.gitUrl).toBe('https://github.com/user/repo');
      });
    });
  });
});
