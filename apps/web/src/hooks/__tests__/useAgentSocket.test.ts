/**
 * Comprehensive tests for useAgentSocket hook
 * Tests WebSocket communication, message handling, and real-time events
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgentSocket, useSendAgentMessage } from '../useAgentSocket';
import { useSessionStore } from '@/stores/session';
import { useBillingStore } from '@/stores/billing';
import * as socketLib from '@/lib/socket';
import * as api from '@/lib/api';
import { toast } from 'sonner';
import {
  mockSocket,
  socketHandlers,
  triggerSocketEvent,
  resetMockSocket,
} from '@/__tests__/mocks/socket';
import type {
  AgentMessageEvent,
  AgentStatusEvent,
  AgentStreamStartEvent,
  AgentTokenEvent,
  AgentThinkingTokenEvent,
  AgentStreamEndEvent,
  AgentConfigUpdateEvent,
  WorkspaceStatusEvent,
} from '@/lib/socket';

// Mock dependencies
vi.mock('@/lib/socket', () => ({
  connectSocket: vi.fn(),
  joinSession: vi.fn(),
  leaveSession: vi.fn(),
  onSocketEvent: vi.fn((event, handler) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

vi.mock('@/lib/api', () => ({
  sendAgentMessage: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/model-utils', () => ({
  parseModelIdToDisplayName: vi.fn((modelId) => {
    if (modelId.includes('opus')) return 'Opus 4.5';
    if (modelId.includes('sonnet')) return 'Sonnet 4.5';
    return modelId;
  }),
}));

// Create mock store functions that we can spy on
const mockStoreState = {
  sessions: {},
  addConversationMessage: vi.fn(),
  getConversationForAgent: vi.fn(),
  handleConversationEvent: vi.fn(),
  updateAgent: vi.fn(),
  startStreamingMessage: vi.fn(),
  appendStreamingToken: vi.fn(),
  appendThinkingToken: vi.fn(),
  finalizeStreamingMessage: vi.fn(),
  setWorkspaceStatus: vi.fn(),
};

// Mock Zustand stores
vi.mock('@/stores/session', () => ({
  useSessionStore: Object.assign(
    (selector?: any) => {
      if (selector) {
        return selector(mockStoreState);
      }
      return mockStoreState;
    },
    {
      getState: () => mockStoreState,
    }
  ),
}));

vi.mock('@/stores/billing', () => ({
  useBillingStore: {
    getState: vi.fn(() => ({
      showCreditExhaustedModal: vi.fn(),
    })),
  },
}));

describe('useAgentSocket', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';
  const authToken = 'auth-token-789';
  const agentId = 'agent-001';

  let mockSessionStore: ReturnType<typeof useSessionStore>;
  let mockBillingStore: ReturnType<typeof useBillingStore.getState>;

  const mockConversationId = 'conv-001';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSocket();

    // Reset mock store state with conversation-based architecture
    mockStoreState.sessions = {
      [sessionId]: {
        id: sessionId,
        agents: [
          {
            id: agentId,
            name: 'Test Agent',
            role: 'architect',
            model: 'claude-opus-4.5-20251101',
            status: 'idle',
            color: 'agent-1',
            mode: 'auto',
            conversationSessionId: mockConversationId,
          },
        ],
        conversationSessions: [
          {
            id: mockConversationId,
            name: 'Test Conversation',
            messages: [],
            attachedAgentIds: [agentId],
            messageCount: 0,
            lastMessageAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      } as any,
    };

    // Mock getConversationForAgent to return the conversation
    mockStoreState.getConversationForAgent = vi.fn((sid: string, aid: string) => {
      const session = mockStoreState.sessions[sid];
      if (!session) return null;
      const agent = session.agents.find((a: any) => a.id === aid);
      if (!agent?.conversationSessionId) return null;
      return (
        session.conversationSessions?.find((c: any) => c.id === agent.conversationSessionId) ?? null
      );
    });

    mockSessionStore = mockStoreState as any;

    mockBillingStore = {
      showCreditExhaustedModal: vi.fn(),
    } as any;

    (useBillingStore.getState as any).mockReturnValue(mockBillingStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Connection & Initialization Tests
  // ========================================

  describe('Connection & Initialization', () => {
    it('should connect to socket on mount', () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      expect(socketLib.connectSocket).toHaveBeenCalledTimes(1);
    });

    it('should join session on mount', () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      expect(socketLib.joinSession).toHaveBeenCalledWith(sessionId, userId, authToken);
    });

    it('should not connect when sessionId is missing', () => {
      renderHook(() => useAgentSocket({ sessionId: '', userId, authToken }));

      expect(socketLib.connectSocket).not.toHaveBeenCalled();
      expect(socketLib.joinSession).not.toHaveBeenCalled();
    });

    it('should not connect when userId is missing', () => {
      renderHook(() => useAgentSocket({ sessionId, userId: '', authToken }));

      expect(socketLib.connectSocket).not.toHaveBeenCalled();
      expect(socketLib.joinSession).not.toHaveBeenCalled();
    });

    it('should handle missing authToken', () => {
      renderHook(() => useAgentSocket({ sessionId, userId }));

      expect(socketLib.joinSession).toHaveBeenCalledWith(sessionId, userId, undefined);
    });

    it('should leave session on unmount', () => {
      const { unmount } = renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      unmount();

      expect(socketLib.leaveSession).toHaveBeenCalledWith(sessionId, userId);
    });

    it('should setup all event listeners on mount', () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('agent_message', expect.any(Function));
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('agent_status', expect.any(Function));
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'agent_stream_start',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('agent_token', expect.any(Function));
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'agent_thinking_token',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'agent_stream_end',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'agent_config_update',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'workspace_status',
        expect.any(Function)
      );
      // Also verify conversation lifecycle events
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_created',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_updated',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_deleted',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_attached',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_detached',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'conversation_message',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'workspace_billing_standby',
        expect.any(Function)
      );
    });
  });

  // ========================================
  // Agent Message Event Tests
  // ========================================

  describe('Agent Message Events', () => {
    it('should add user message to store', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-001',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'Hello, world!',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).toHaveBeenCalledWith(
          sessionId,
          mockConversationId,
          expect.objectContaining({
            id: 'msg-001',
            role: 'user',
            content: 'Hello, world!',
          })
        );
      });
    });

    it('should add assistant message to store', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-002',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'assistant',
        content: 'Hello! How can I help?',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).toHaveBeenCalledWith(
          sessionId,
          mockConversationId,
          expect.objectContaining({
            id: 'msg-002',
            role: 'assistant',
            content: 'Hello! How can I help?',
          })
        );
      });
    });

    it('should include tool calls in message', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-003',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'assistant',
        content: 'Running command...',
        session_id: sessionId,
        created_at: new Date().toISOString(),
        tool_calls: [
          {
            id: 'tool-1',
            name: 'bash',
            args: { command: 'ls -la' },
            status: 'completed',
            result: 'file1.txt\nfile2.txt',
          },
        ],
      };

      triggerSocketEvent('agent_message', messageEvent);

      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).toHaveBeenCalledWith(
          sessionId,
          mockConversationId,
          expect.objectContaining({
            toolCalls: expect.arrayContaining([
              expect.objectContaining({
                id: 'tool-1',
                name: 'bash',
              }),
            ]),
          })
        );
      });
    });

    it('should ignore messages from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-004',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'Wrong session',
        session_id: 'other-session',
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).not.toHaveBeenCalled();
      });
    });

    it('should skip duplicate messages by ID', async () => {
      mockSessionStore.sessions[sessionId].conversationSessions[0].messages = [
        {
          id: 'msg-005',
          role: 'user',
          content: 'Existing message',
          timestamp: new Date(),
        },
      ];

      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-005',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'Existing message',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).not.toHaveBeenCalled();
      });
    });

    it('should add message even if temp message exists (store handles deduplication)', async () => {
      mockSessionStore.sessions[sessionId].conversationSessions[0].messages = [
        {
          id: 'temp-001',
          role: 'user',
          content: 'Optimistic message',
          timestamp: new Date(),
        },
      ];

      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-006',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'Optimistic message',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      // Hook calls addConversationMessage; the store handles deduplication internally
      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).toHaveBeenCalledWith(
          sessionId,
          mockConversationId,
          expect.objectContaining({
            id: 'msg-006',
            role: 'user',
            content: 'Optimistic message',
          })
        );
      });
    });

    it('should add message even if streaming message exists (store handles deduplication)', async () => {
      mockSessionStore.sessions[sessionId].conversationSessions[0].messages = [
        {
          id: 'stream-001',
          role: 'assistant',
          content: 'Streaming content',
          timestamp: new Date(),
        },
      ];

      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-007',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'assistant',
        content: 'Streaming content',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      // Hook calls addConversationMessage; the store handles deduplication internally
      await waitFor(() => {
        expect(mockSessionStore.addConversationMessage).toHaveBeenCalledWith(
          sessionId,
          mockConversationId,
          expect.objectContaining({
            id: 'msg-007',
            role: 'assistant',
            content: 'Streaming content',
          })
        );
      });
    });

    it('should skip message when session not yet loaded', async () => {
      mockSessionStore.sessions = {};

      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-008',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'Early message',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      // Hook guards against missing session - message should NOT be added
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockSessionStore.addConversationMessage).not.toHaveBeenCalled();
    });

    it('should skip message when agent not yet in store', async () => {
      mockSessionStore.sessions[sessionId].agents = [];

      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const messageEvent: AgentMessageEvent = {
        id: 'msg-009',
        agent_id: agentId,
        agent_name: 'Test Agent',
        role: 'user',
        content: 'New agent message',
        session_id: sessionId,
        created_at: new Date().toISOString(),
      };

      triggerSocketEvent('agent_message', messageEvent);

      // Hook guards against missing agent - message should NOT be added
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockSessionStore.addConversationMessage).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Agent Status Event Tests
  // ========================================

  describe('Agent Status Events', () => {
    it('should update agent status to active', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: AgentStatusEvent = {
        agent_id: agentId,
        session_id: sessionId,
        status: 'active',
      };

      triggerSocketEvent('agent_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(sessionId, agentId, {
          status: 'active',
        });
      });
    });

    it('should update agent status to idle', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: AgentStatusEvent = {
        agent_id: agentId,
        session_id: sessionId,
        status: 'idle',
      };

      triggerSocketEvent('agent_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(sessionId, agentId, {
          status: 'idle',
        });
      });
    });

    it('should update agent status to error', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: AgentStatusEvent = {
        agent_id: agentId,
        session_id: sessionId,
        status: 'error',
        error: 'Connection failed',
      };

      triggerSocketEvent('agent_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(sessionId, agentId, {
          status: 'error',
        });
      });
    });

    it('should ignore status from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: AgentStatusEvent = {
        agent_id: agentId,
        session_id: 'other-session',
        status: 'active',
      };

      triggerSocketEvent('agent_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Streaming Events Tests
  // ========================================

  describe('Streaming Events', () => {
    it('should handle stream start', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const streamStartEvent: AgentStreamStartEvent = {
        session_id: sessionId,
        agent_id: agentId,
        message_id: 'msg-stream-001',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_stream_start', streamStartEvent);

      await waitFor(() => {
        expect(mockSessionStore.startStreamingMessage).toHaveBeenCalledWith(
          sessionId,
          agentId,
          'msg-stream-001'
        );
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(sessionId, agentId, {
          status: 'active',
        });
      });
    });

    it('should handle streaming tokens', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const tokenEvent: AgentTokenEvent = {
        session_id: sessionId,
        agent_id: agentId,
        message_id: 'msg-stream-001',
        token: 'Hello',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_token', tokenEvent);

      await waitFor(() => {
        expect(mockSessionStore.appendStreamingToken).toHaveBeenCalledWith(
          'msg-stream-001',
          'Hello'
        );
      });
    });

    it('should handle multiple streaming tokens', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const tokens = ['Hello', ' ', 'world', '!'];

      for (const token of tokens) {
        const tokenEvent: AgentTokenEvent = {
          session_id: sessionId,
          agent_id: agentId,
          message_id: 'msg-stream-001',
          token,
          timestamp: new Date().toISOString(),
        };
        triggerSocketEvent('agent_token', tokenEvent);
      }

      await waitFor(() => {
        expect(mockSessionStore.appendStreamingToken).toHaveBeenCalledTimes(4);
      });
    });

    it('should handle thinking tokens', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const thinkingEvent: AgentThinkingTokenEvent = {
        session_id: sessionId,
        agent_id: agentId,
        message_id: 'msg-stream-001',
        thinking: 'I need to analyze this...',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_thinking_token', thinkingEvent);

      await waitFor(() => {
        expect(mockSessionStore.appendThinkingToken).toHaveBeenCalledWith(
          'msg-stream-001',
          'I need to analyze this...'
        );
      });
    });

    it('should handle stream end', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const streamEndEvent: AgentStreamEndEvent = {
        session_id: sessionId,
        agent_id: agentId,
        message_id: 'msg-stream-001',
        full_content: 'Hello world! Complete response.',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_stream_end', streamEndEvent);

      await waitFor(() => {
        expect(mockSessionStore.finalizeStreamingMessage).toHaveBeenCalledWith(
          'msg-stream-001',
          'Hello world! Complete response.',
          undefined
        );
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(sessionId, agentId, {
          status: 'idle',
        });
      });
    });

    it('should handle stream end with tool calls', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const streamEndEvent: AgentStreamEndEvent = {
        session_id: sessionId,
        agent_id: agentId,
        message_id: 'msg-stream-001',
        full_content: 'Running command',
        tool_calls: [
          {
            id: 'tool-1',
            name: 'bash',
            args: { command: 'pwd' },
            status: 'completed',
            result: '/home/user',
          },
        ],
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_stream_end', streamEndEvent);

      await waitFor(() => {
        expect(mockSessionStore.finalizeStreamingMessage).toHaveBeenCalledWith(
          'msg-stream-001',
          'Running command',
          expect.arrayContaining([expect.objectContaining({ id: 'tool-1' })])
        );
      });
    });

    it('should ignore streaming events from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const tokenEvent: AgentTokenEvent = {
        session_id: 'other-session',
        agent_id: agentId,
        message_id: 'msg-stream-001',
        token: 'Test',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_token', tokenEvent);

      await waitFor(() => {
        expect(mockSessionStore.appendStreamingToken).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Config Update Tests
  // ========================================

  describe('Config Update Events', () => {
    it('should update agent model from CLI', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const configEvent: AgentConfigUpdateEvent = {
        session_id: sessionId,
        agent_id: agentId,
        updates: {
          model: 'claude-sonnet-4.5-20250929',
        },
        source: 'cli',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_config_update', configEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            model: 'claude-sonnet-4.5-20250929',
          })
        );
      });
    });

    it('should update agent mode from CLI', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const configEvent: AgentConfigUpdateEvent = {
        session_id: sessionId,
        agent_id: agentId,
        updates: {
          mode: 'plan',
        },
        source: 'cli',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_config_update', configEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            mode: 'plan',
          })
        );
      });
    });

    it('should update thinking config', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const configEvent: AgentConfigUpdateEvent = {
        session_id: sessionId,
        agent_id: agentId,
        updates: {
          thinking_enabled: true,
          thinking_budget: 20000,
        },
        source: 'user',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_config_update', configEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            thinkingConfig: {
              enabled: true,
              budgetTokens: 20000,
            },
          })
        );
      });
    });

    it('should not show toast for non-CLI updates', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const configEvent: AgentConfigUpdateEvent = {
        session_id: sessionId,
        agent_id: agentId,
        updates: {
          model: 'claude-opus-4.5-20251101',
        },
        source: 'user',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_config_update', configEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalled();
        expect(toast.info).not.toHaveBeenCalled();
      });
    });

    it('should ignore config updates from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const configEvent: AgentConfigUpdateEvent = {
        session_id: 'other-session',
        agent_id: agentId,
        updates: {
          model: 'claude-opus-4.5-20251101',
        },
        source: 'cli',
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_config_update', configEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Workspace Status Tests
  // ========================================

  describe('Workspace Status Events', () => {
    it('should handle workspace error status', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: WorkspaceStatusEvent = {
        workspace_id: 'ws-001',
        status: 'error',
        error: 'Container failed to start',
      };

      triggerSocketEvent('workspace_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.setWorkspaceStatus).toHaveBeenCalledWith(sessionId, 'error');
        expect(toast.error).toHaveBeenCalledWith(
          'Workspace error',
          expect.objectContaining({
            description: 'Container failed to start',
          })
        );
      });
    });

    it('should handle workspace running status', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: WorkspaceStatusEvent = {
        workspace_id: 'ws-001',
        status: 'running',
      };

      triggerSocketEvent('workspace_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.setWorkspaceStatus).toHaveBeenCalledWith(sessionId, 'running');
      });
    });

    it('should handle workspace stopped status', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const statusEvent: WorkspaceStatusEvent = {
        workspace_id: 'ws-001',
        status: 'stopped',
      };

      triggerSocketEvent('workspace_status', statusEvent);

      await waitFor(() => {
        expect(mockSessionStore.setWorkspaceStatus).toHaveBeenCalledWith(sessionId, 'stopped');
      });
    });
  });
});

// ========================================
// useSendAgentMessage Hook Tests
// ========================================

describe('useSendAgentMessage', () => {
  const sessionId = 'session-123';
  const agentId = 'agent-001';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock implementation to default
    (api.sendAgentMessage as any).mockResolvedValue(undefined);
  });

  it('should send message via API', async () => {
    const { result } = renderHook(() => useSendAgentMessage(sessionId));

    await result.current.sendMessage(agentId, 'Hello, agent!');

    expect(api.sendAgentMessage).toHaveBeenCalledWith(sessionId, agentId, 'Hello, agent!');
  });

  it('should handle API errors', async () => {
    (api.sendAgentMessage as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useSendAgentMessage(sessionId));

    await expect(result.current.sendMessage(agentId, 'Test')).rejects.toThrow('Network error');
  });

  it('should use correct sessionId from hook', async () => {
    const { result } = renderHook(() => useSendAgentMessage('custom-session'));

    await result.current.sendMessage(agentId, 'Test message');

    expect(api.sendAgentMessage).toHaveBeenCalledWith('custom-session', agentId, 'Test message');
  });
});
