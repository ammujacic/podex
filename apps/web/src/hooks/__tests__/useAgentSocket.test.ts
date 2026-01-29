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
  AgentAutoModeSwitchEvent,
  AgentStreamStartEvent,
  AgentTokenEvent,
  AgentThinkingTokenEvent,
  AgentStreamEndEvent,
  AgentConfigUpdateEvent,
  WorkspaceStatusEvent,
  PermissionRequestEvent,
  NativeApprovalRequestEvent,
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
  handleAutoModeSwitch: vi.fn(),
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

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSocket();

    // Reset mock store state
    mockStoreState.sessions = {
      [sessionId]: {
        id: sessionId,
        agents: [
          {
            id: agentId,
            name: 'Test Agent',
            role: 'architect',
            model: 'claude-opus-4-5-20251101',
            status: 'idle',
            color: 'agent-1',
            messages: [],
            mode: 'auto',
          },
        ],
      } as any,
    };

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
        'agent_auto_mode_switch',
        expect.any(Function)
      );
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
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'permission_request',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'native_approval_request',
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
        expect(mockSessionStore.addAgentMessage).toHaveBeenCalledWith(
          sessionId,
          agentId,
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
        expect(mockSessionStore.addAgentMessage).toHaveBeenCalledWith(
          sessionId,
          agentId,
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
        expect(mockSessionStore.addAgentMessage).toHaveBeenCalledWith(
          sessionId,
          agentId,
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
        expect(mockSessionStore.addAgentMessage).not.toHaveBeenCalled();
      });
    });

    it('should skip duplicate messages by ID', async () => {
      mockSessionStore.sessions[sessionId].agents[0].messages = [
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
        expect(mockSessionStore.addAgentMessage).not.toHaveBeenCalled();
      });
    });

    it('should replace temp user message with real ID', async () => {
      mockSessionStore.sessions[sessionId].agents[0].messages = [
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

      await waitFor(() => {
        expect(mockSessionStore.updateMessageId).toHaveBeenCalledWith(
          sessionId,
          agentId,
          'temp-001',
          'msg-006'
        );
      });
    });

    it('should replace streaming message with database ID', async () => {
      mockSessionStore.sessions[sessionId].agents[0].messages = [
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

      await waitFor(() => {
        expect(mockSessionStore.updateMessageId).toHaveBeenCalledWith(
          sessionId,
          agentId,
          'stream-001',
          'msg-007'
        );
      });
    });

    it('should handle message when session not yet loaded', async () => {
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

      await waitFor(() => {
        expect(mockSessionStore.addAgentMessage).toHaveBeenCalled();
      });
    });

    it('should handle message when agent not yet in store', async () => {
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

      await waitFor(() => {
        expect(mockSessionStore.addAgentMessage).toHaveBeenCalled();
      });
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
  // Auto Mode Switch Tests
  // ========================================

  describe('Auto Mode Switch Events', () => {
    it('should handle mode switch with auto-revert', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const modeSwitchEvent: AgentAutoModeSwitchEvent = {
        session_id: sessionId,
        agent_id: agentId,
        agent_name: 'Test Agent',
        old_mode: 'auto',
        new_mode: 'ask',
        reason: 'User confirmation needed',
        trigger_phrase: null,
        auto_revert: true,
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_auto_mode_switch', modeSwitchEvent);

      await waitFor(() => {
        expect(mockSessionStore.handleAutoModeSwitch).toHaveBeenCalledWith(
          sessionId,
          agentId,
          'ask',
          'auto'
        );
        expect(toast.info).toHaveBeenCalledWith(
          'Test Agent switched to Ask mode',
          expect.objectContaining({
            description: 'User confirmation needed',
          })
        );
      });
    });

    it('should handle mode revert', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const modeSwitchEvent: AgentAutoModeSwitchEvent = {
        session_id: sessionId,
        agent_id: agentId,
        agent_name: 'Test Agent',
        old_mode: 'ask',
        new_mode: 'auto',
        reason: 'Task completed',
        trigger_phrase: null,
        auto_revert: false,
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_auto_mode_switch', modeSwitchEvent);

      await waitFor(() => {
        expect(mockSessionStore.handleAutoModeSwitch).toHaveBeenCalledWith(
          sessionId,
          agentId,
          'auto',
          null
        );
        expect(toast.info).toHaveBeenCalledWith(
          'Test Agent returned to Auto mode',
          expect.objectContaining({
            description: 'Task completed',
          })
        );
      });
    });

    it('should ignore mode switch from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const modeSwitchEvent: AgentAutoModeSwitchEvent = {
        session_id: 'other-session',
        agent_id: agentId,
        agent_name: 'Test Agent',
        old_mode: 'auto',
        new_mode: 'ask',
        reason: 'Test',
        trigger_phrase: null,
        auto_revert: true,
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('agent_auto_mode_switch', modeSwitchEvent);

      await waitFor(() => {
        expect(mockSessionStore.handleAutoModeSwitch).not.toHaveBeenCalled();
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
          model: 'claude-sonnet-4-5-20250929',
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
            model: 'claude-sonnet-4-5-20250929',
          })
        );
        expect(toast.info).toHaveBeenCalledWith(
          'Model switched to Sonnet 4.5',
          expect.objectContaining({
            description: 'Changed via CLI command',
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
        expect(toast.info).toHaveBeenCalledWith(
          'Mode changed to plan',
          expect.objectContaining({
            description: 'Changed via CLI command',
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
          model: 'claude-opus-4-5-20251101',
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
          model: 'claude-opus-4-5-20251101',
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

  // ========================================
  // Permission Request Tests
  // ========================================

  describe('Permission Request Events', () => {
    it('should handle CLI permission request', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const permissionEvent: PermissionRequestEvent = {
        session_id: sessionId,
        agent_id: agentId,
        request_id: 'req-001',
        command: 'rm -rf /tmp/files',
        description: 'Remove temporary files',
        tool_name: 'bash',
        attention_id: 'attention-001',
        action_type: 'command_execute',
        action_details: {
          command: 'rm -rf /tmp/files',
          tool_name: 'bash',
        },
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('permission_request', permissionEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            pendingPermission: expect.objectContaining({
              requestId: 'req-001',
              command: 'rm -rf /tmp/files',
              description: 'Remove temporary files',
              toolName: 'bash',
              attentionId: 'attention-001',
            }),
          })
        );
      });
    });

    it('should use default attention ID if not provided', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const permissionEvent: PermissionRequestEvent = {
        session_id: sessionId,
        agent_id: agentId,
        request_id: 'req-002',
        command: 'ls -la',
        description: 'List files',
        tool_name: 'bash',
        action_type: 'command_execute',
        action_details: {
          command: 'ls -la',
          tool_name: 'bash',
        },
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('permission_request', permissionEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            pendingPermission: expect.objectContaining({
              attentionId: 'permission-req-002',
            }),
          })
        );
      });
    });

    it('should ignore permission requests from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const permissionEvent: PermissionRequestEvent = {
        session_id: 'other-session',
        agent_id: agentId,
        request_id: 'req-003',
        command: 'pwd',
        description: 'Get directory',
        tool_name: 'bash',
        action_type: 'command_execute',
        action_details: {
          command: 'pwd',
          tool_name: 'bash',
        },
        timestamp: new Date().toISOString(),
      };

      triggerSocketEvent('permission_request', permissionEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Native Approval Request Tests
  // ========================================

  describe('Native Approval Request Events', () => {
    it('should handle native approval request with command', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const approvalEvent: NativeApprovalRequestEvent = {
        approval_id: 'approval-001',
        session_id: sessionId,
        agent_id: agentId,
        agent_name: 'Test Agent',
        action_type: 'command_execute',
        action_details: {
          tool_name: 'bash',
          command: 'git push origin main',
        },
        can_add_to_allowlist: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };

      triggerSocketEvent('native_approval_request', approvalEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            pendingPermission: expect.objectContaining({
              requestId: 'approval-001',
              command: 'git push origin main',
              description: 'bash: git push origin main',
              toolName: 'bash',
              attentionId: 'approval-approval-001',
            }),
          })
        );
        expect(toast.info).toHaveBeenCalledWith(
          'Test Agent needs your approval',
          expect.objectContaining({
            description: 'bash: git push origin main',
          })
        );
      });
    });

    it('should handle native approval request with file path', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const approvalEvent: NativeApprovalRequestEvent = {
        approval_id: 'approval-002',
        session_id: sessionId,
        agent_id: agentId,
        agent_name: 'Test Agent',
        action_type: 'file_write',
        action_details: {
          tool_name: 'file_write',
          file_path: '/home/user/config.json',
        },
        can_add_to_allowlist: false,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };

      triggerSocketEvent('native_approval_request', approvalEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).toHaveBeenCalledWith(
          sessionId,
          agentId,
          expect.objectContaining({
            pendingPermission: expect.objectContaining({
              command: '/home/user/config.json',
              description: 'file_write: /home/user/config.json',
            }),
          })
        );
      });
    });

    it('should ignore native approval from different sessions', async () => {
      renderHook(() => useAgentSocket({ sessionId, userId, authToken }));

      const approvalEvent: NativeApprovalRequestEvent = {
        approval_id: 'approval-003',
        session_id: 'other-session',
        agent_id: agentId,
        agent_name: 'Test Agent',
        action_type: 'command_execute',
        action_details: {
          tool_name: 'bash',
          command: 'pwd',
        },
        can_add_to_allowlist: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };

      triggerSocketEvent('native_approval_request', approvalEvent);

      await waitFor(() => {
        expect(mockSessionStore.updateAgent).not.toHaveBeenCalled();
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
