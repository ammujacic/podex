/**
 * Comprehensive tests for useAgentAttention hook
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAgentAttention } from '@/hooks/useAgentAttention';
import type { AgentAttentionEvent } from '@/lib/socket';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

// Create event handlers map that persists across all tests
const eventHandlers = new Map<string, Set<Function>>();

vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event: string, handler: Function) => {
    if (!eventHandlers.has(event)) {
      eventHandlers.set(event, new Set());
    }
    eventHandlers.get(event)!.add(handler);
    return () => {
      eventHandlers.get(event)?.delete(handler);
    };
  }),
}));

// Helper functions to trigger events in tests
const triggerSocketEvent = (event: string, data: any) => {
  const handlers = eventHandlers.get(event);
  if (handlers) {
    handlers.forEach((handler) => handler(data));
  }
};

const clearSocketHandlers = () => {
  eventHandlers.clear();
};

vi.mock('@/lib/api', () => ({
  synthesizeSpeech: vi.fn().mockResolvedValue({ audio_b64: 'base64data' }),
  markAttentionRead: vi.fn().mockResolvedValue({}),
  getAttentionItems: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('@/hooks/useAudioPlayback', () => ({
  useAudioPlayback: vi.fn(() => ({
    playAudioBase64: vi.fn(),
  })),
}));

vi.mock('@/hooks/useVisibilityTracking', () => ({
  useVisibilityStore: vi.fn((selector) =>
    selector({
      isFocused: true,
      isVisible: true,
      lastFocusedAt: Date.now(),
      lastBlurredAt: null,
      unfocusedDuration: 0,
    })
  ),
  useOnFocusReturn: vi.fn(),
}));

// Mock attention store
vi.mock('@/stores/attention', () => {
  const mockStore = {
    addAttention: vi.fn(),
    markAsRead: vi.fn(),
    dismissAttention: vi.fn(),
    dismissAllForAgent: vi.fn(),
    dismissAllForSession: vi.fn(),
    ttsEnabled: true,
    announcePriorities: ['high', 'critical'],
    getAttentionsForSession: vi.fn(() => []),
    getUnreadCount: vi.fn(() => 0),
    openPanel: vi.fn(),
    panelOpen: false,
  };

  return {
    useAttentionStore: Object.assign(
      vi.fn(() => mockStore),
      {
        getState: () => mockStore,
      }
    ),
  };
});

import * as socket from '@/lib/socket';
import * as api from '@/lib/api';
import { useAttentionStore } from '@/stores/attention';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { useVisibilityStore, useOnFocusReturn } from '@/hooks/useVisibilityTracking';

// Get getMockAttentionStore() from the module
const getMockStore = () => (useAttentionStore as any).getState();

describe('useAgentAttention', () => {
  const getMockAttentionStore = () => getMockStore();
  const mockSessionId = 'session-123';
  const mockAgentId = 'agent-456';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSocketHandlers();

    // Reset mock store functions
    const store = getMockAttentionStore();
    store.addAttention.mockClear();
    store.markAsRead.mockClear();
    store.dismissAttention.mockClear();
    store.dismissAllForAgent.mockClear();
    store.dismissAllForSession.mockClear();
    store.openPanel.mockClear();
    store.getAttentionsForSession.mockReturnValue([]);
    store.getUnreadCount.mockReturnValue(0);

    // Reset API mocks to default resolved values
    vi.mocked(api.synthesizeSpeech).mockResolvedValue({ audio_b64: 'base64data' });
    vi.mocked(api.markAttentionRead).mockResolvedValue({});
    vi.mocked(api.getAttentionItems).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize hook with default options', () => {
      const { result } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(result.current).toBeDefined();
      expect(result.current.attentions).toBeDefined();
      expect(result.current.unreadCount).toBeDefined();
      expect(result.current.markAsRead).toBeDefined();
      expect(result.current.dismiss).toBeDefined();
    });

    it('should fetch persisted attention items on mount', async () => {
      const mockItems = [
        {
          id: 'att-1',
          agent_id: mockAgentId,
          agent_name: 'Test Agent',
          session_id: mockSessionId,
          attention_type: 'needs_approval',
          title: 'Test',
          message: 'Test message',
          metadata: {},
          priority: 'high',
          is_read: false,
          is_dismissed: false,
          created_at: new Date().toISOString(),
          expires_at: null,
        },
      ];

      vi.mocked(api.getAttentionItems).mockResolvedValue({ items: mockItems });

      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      await waitFor(() => {
        expect(api.getAttentionItems).toHaveBeenCalledWith(mockSessionId);
        expect(getMockAttentionStore().addAttention).toHaveBeenCalled();
      });
    });

    it('should handle failed fetch of attention items gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getAttentionItems).mockRejectedValueOnce(new Error('Fetch failed'));

      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to load attention history:',
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it('should not fetch items when disabled', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, enabled: false }));

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(api.getAttentionItems).not.toHaveBeenCalled();
    });

    it('should cancel fetch on unmount', async () => {
      const { unmount } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      unmount();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });

  describe('Socket Event Subscription', () => {
    it('should subscribe to agent_attention events', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
    });

    it('should subscribe to agent_attention_read events', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(socket.onSocketEvent).toHaveBeenCalledWith(
        'agent_attention_read',
        expect.any(Function)
      );
    });

    it('should subscribe to agent_attention_dismiss events', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(socket.onSocketEvent).toHaveBeenCalledWith(
        'agent_attention_dismiss',
        expect.any(Function)
      );
    });

    it('should subscribe to agent_attention_dismiss_all events', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(socket.onSocketEvent).toHaveBeenCalledWith(
        'agent_attention_dismiss_all',
        expect.any(Function)
      );
    });

    it('should not subscribe when disabled', () => {
      socket.onSocketEvent.mockClear();

      renderHook(() => useAgentAttention({ sessionId: mockSessionId, enabled: false }));

      expect(socket.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const unsubscribeMock = vi.fn();
      socket.onSocketEvent.mockReturnValueOnce(unsubscribeMock);
      socket.onSocketEvent.mockReturnValueOnce(unsubscribeMock);
      socket.onSocketEvent.mockReturnValueOnce(unsubscribeMock);
      socket.onSocketEvent.mockReturnValueOnce(unsubscribeMock);

      const { unmount } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      unmount();

      expect(unsubscribeMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('Attention Event Handling', () => {
    it('should handle incoming needs_approval attention', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for the hook to set up event listeners
      await waitFor(
        () => {
          expect(socket.onSocketEvent).toHaveBeenCalledWith(
            'agent_attention',
            expect.any(Function)
          );
        },
        { timeout: 2000 }
      );

      // Small delay to ensure handlers are registered
      await new Promise((resolve) => setTimeout(resolve, 50));

      const event: AgentAttentionEvent = {
        id: 'att-1',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Approval Required',
        message: 'Please approve this action',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(
        () => {
          expect(getMockAttentionStore().addAttention).toHaveBeenCalledWith(
            expect.objectContaining({
              id: 'att-1',
              type: 'needs_approval',
              title: 'Approval Required',
            })
          );
        },
        { timeout: 2000 }
      );
    });

    it('should handle completed attention', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-2',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'completed',
        title: 'Task Completed',
        message: 'Task finished successfully',
        priority: 'medium',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(getMockAttentionStore().addAttention).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'completed' })
        );
      });
    });

    it('should handle error attention', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-3',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'error',
        title: 'Error Occurred',
        message: 'An error happened',
        priority: 'critical',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(getMockAttentionStore().addAttention).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', priority: 'critical' })
        );
      });
    });

    it('should handle waiting_input attention', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-4',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'waiting_input',
        title: 'Input Required',
        message: 'Waiting for input',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(getMockAttentionStore().addAttention).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'waiting_input' })
        );
      });
    });

    it('should ignore events from different sessions', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      const event: AgentAttentionEvent = {
        id: 'att-5',
        session_id: 'other-session',
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Test',
        message: 'Test',
        priority: 'low',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      expect(getMockAttentionStore().addAttention).not.toHaveBeenCalled();
    });
  });

  describe('Toast Notifications', () => {
    it('should show toast for needs_approval with action button', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, showToasts: true }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-1',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Approval Required',
        message: 'Please review',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith('Approval Required', {
          description: 'Please review',
          icon: expect.anything(),
          action: expect.objectContaining({ label: 'View' }),
          duration: 5000,
        });
      });
    });

    it('should show toast with longer duration for critical priority', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, showToasts: true }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-2',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'error',
        title: 'Critical Error',
        message: 'Urgent attention needed',
        priority: 'critical',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith('Critical Error', {
          description: 'Urgent attention needed',
          icon: expect.anything(),
          action: undefined,
          duration: 10000,
        });
      });
    });

    it('should not show toast when showToasts is false', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, showToasts: false }));

      const event: AgentAttentionEvent = {
        id: 'att-3',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'completed',
        title: 'Done',
        message: 'Task finished',
        priority: 'low',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      expect(toast).not.toHaveBeenCalled();
    });

    it('should open panel when View action is clicked', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, showToasts: true }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-1',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Approval Required',
        message: 'Please review',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(toast).toHaveBeenCalled();
      });

      const toastCall = vi.mocked(toast).mock.calls[0];
      const action = toastCall[1]?.action as { label: string; onClick: () => void };

      act(() => {
        action.onClick();
      });

      expect(getMockAttentionStore().openPanel).toHaveBeenCalled();
    });
  });

  describe('TTS Announcements', () => {
    it('should announce high priority attention via TTS', async () => {
      const mockPlayAudio = vi.fn();
      vi.mocked(useAudioPlayback).mockReturnValue({
        playAudioBase64: mockPlayAudio,
        isPlaying: false,
        playingMessageId: null,
        playAudioUrl: vi.fn(),
        stopPlayback: vi.fn(),
      } as any);

      renderHook(() => useAgentAttention({ sessionId: mockSessionId, useTTS: true }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-1',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Approval Required',
        message: 'Please review',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(api.synthesizeSpeech).toHaveBeenCalledWith(
          mockSessionId,
          expect.stringContaining('Test Agent needs your approval')
        );
        expect(mockPlayAudio).toHaveBeenCalledWith('attention-att-1', 'base64data', 'audio/mpeg');
      });
    });

    it('should not announce low priority attention', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, useTTS: true }));

      const event: AgentAttentionEvent = {
        id: 'att-2',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'completed',
        title: 'Done',
        message: 'Task finished',
        priority: 'low',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(api.synthesizeSpeech).not.toHaveBeenCalled();
    });

    it('should not announce when useTTS is false', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId, useTTS: false }));

      const event: AgentAttentionEvent = {
        id: 'att-3',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'error',
        title: 'Error',
        message: 'Error occurred',
        priority: 'critical',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(api.synthesizeSpeech).not.toHaveBeenCalled();
    });

    it('should not announce when ttsEnabled store flag is false', async () => {
      const store = getMockAttentionStore();
      store.ttsEnabled = false;

      renderHook(() => useAgentAttention({ sessionId: mockSessionId, useTTS: true }));

      const event: AgentAttentionEvent = {
        id: 'att-4',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Test',
        message: 'Test',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      act(() => {
        triggerSocketEvent('agent_attention', event);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(api.synthesizeSpeech).not.toHaveBeenCalled();

      store.ttsEnabled = true;
    });

    it('should handle TTS synthesis error gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.synthesizeSpeech).mockRejectedValueOnce(new Error('TTS failed'));

      renderHook(() => useAgentAttention({ sessionId: mockSessionId, useTTS: true }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-5',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'error',
        title: 'Error',
        message: 'Error occurred',
        priority: 'critical',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        const errorCalls = consoleErrorSpy.mock.calls.filter(
          (call) => call[0] === 'Failed to synthesize attention announcement:'
        );
        expect(errorCalls.length).toBeGreaterThan(0);
        expect(errorCalls[0][1]).toBeInstanceOf(Error);
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Read/Dismiss Event Handling', () => {
    it('should handle attention_read event', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith(
          'agent_attention_read',
          expect.any(Function)
        );
      });

      await act(async () => {
        triggerSocketEvent('agent_attention_read', {
          session_id: mockSessionId,
          attention_id: 'att-1',
        });
      });

      await waitFor(() => {
        expect(getMockAttentionStore().markAsRead).toHaveBeenCalledWith(mockSessionId, 'att-1');
      });
    });

    it('should handle attention_dismiss event', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith(
          'agent_attention_dismiss',
          expect.any(Function)
        );
      });

      await act(async () => {
        triggerSocketEvent('agent_attention_dismiss', {
          session_id: mockSessionId,
          attention_id: 'att-1',
          agent_id: null,
        });
      });

      await waitFor(() => {
        expect(getMockAttentionStore().dismissAttention).toHaveBeenCalledWith(
          mockSessionId,
          'att-1'
        );
      });
    });

    it('should dismiss all for agent when agent_id is provided without attention_id', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith(
          'agent_attention_dismiss',
          expect.any(Function)
        );
      });

      await act(async () => {
        triggerSocketEvent('agent_attention_dismiss', {
          session_id: mockSessionId,
          attention_id: null,
          agent_id: mockAgentId,
        });
      });

      await waitFor(() => {
        expect(getMockAttentionStore().dismissAllForAgent).toHaveBeenCalledWith(
          mockSessionId,
          mockAgentId
        );
      });
    });

    it('should handle attention_dismiss_all event', async () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith(
          'agent_attention_dismiss_all',
          expect.any(Function)
        );
      });

      await act(async () => {
        triggerSocketEvent('agent_attention_dismiss_all', {
          session_id: mockSessionId,
        });
      });

      await waitFor(() => {
        expect(getMockAttentionStore().dismissAllForSession).toHaveBeenCalledWith(mockSessionId);
      });
    });

    it('should ignore read events from different sessions', () => {
      renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      act(() => {
        triggerSocketEvent('agent_attention_read', {
          session_id: 'other-session',
          attention_id: 'att-1',
        });
      });

      expect(getMockAttentionStore().markAsRead).not.toHaveBeenCalled();
    });
  });

  describe('Focus Tracking and Auto-Mark Read', () => {
    it('should register focus return callback', () => {
      renderHook(() =>
        useAgentAttention({
          sessionId: mockSessionId,
          autoMarkReadOnFocus: true,
        })
      );

      expect(useOnFocusReturn).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ minUnfocusedTime: 1000, enabled: true })
      );
    });

    it('should not register focus callback when disabled', () => {
      vi.mocked(useOnFocusReturn).mockClear();

      renderHook(() =>
        useAgentAttention({
          sessionId: mockSessionId,
          autoMarkReadOnFocus: false,
        })
      );

      expect(useOnFocusReturn).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ enabled: false })
      );
    });

    it('should track notifications that arrive while unfocused', async () => {
      // Mock the store to return unfocused state
      const mockVisibilityState = {
        isFocused: false,
        isVisible: false,
        lastFocusedAt: null,
        lastBlurredAt: Date.now(),
        unfocusedDuration: 0,
        _setVisible: vi.fn(),
        _setFocused: vi.fn(),
      };

      vi.mocked(useVisibilityStore).mockImplementation((selector: any) => {
        if (typeof selector === 'function') {
          return selector(mockVisibilityState);
        }
        return mockVisibilityState.isFocused;
      });

      const { unmount } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      // Wait for event listener setup
      await waitFor(() => {
        expect(socket.onSocketEvent).toHaveBeenCalledWith('agent_attention', expect.any(Function));
      });

      const event: AgentAttentionEvent = {
        id: 'att-unfocused',
        session_id: mockSessionId,
        agent_id: mockAgentId,
        agent_name: 'Test Agent',
        type: 'needs_approval',
        title: 'Test',
        message: 'Test',
        priority: 'high',
        metadata: {},
        read: false,
        dismissed: false,
        created_at: new Date().toISOString(),
      };

      await act(async () => {
        triggerSocketEvent('agent_attention', event);
      });

      await waitFor(() => {
        expect(getMockAttentionStore().addAttention).toHaveBeenCalled();
      });

      unmount();

      // Reset the mock for other tests
      vi.mocked(useVisibilityStore).mockImplementation((selector: any) =>
        selector({
          isFocused: true,
          isVisible: true,
          lastFocusedAt: Date.now(),
          lastBlurredAt: null,
          unfocusedDuration: 0,
        })
      );
    });
  });

  describe('Hook Return Values', () => {
    it('should return attentions for session', () => {
      const mockAttentions = [
        {
          id: 'att-1',
          agentId: mockAgentId,
          agentName: 'Test Agent',
          sessionId: mockSessionId,
          type: 'needs_approval' as const,
          title: 'Test',
          message: 'Test',
          priority: 'high' as const,
          read: false,
          dismissed: false,
          createdAt: new Date(),
        },
      ];

      getMockAttentionStore().getAttentionsForSession.mockReturnValue(mockAttentions);

      const { result } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(result.current.attentions).toEqual(mockAttentions);
    });

    it('should return unread count', () => {
      getMockAttentionStore().getUnreadCount.mockReturnValue(5);

      const { result } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      expect(result.current.unreadCount).toBe(5);
    });

    it('should provide markAsRead function', () => {
      const { result } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      act(() => {
        result.current.markAsRead('att-1');
      });

      expect(getMockAttentionStore().markAsRead).toHaveBeenCalledWith(mockSessionId, 'att-1');
    });

    it('should provide dismiss function', () => {
      const { result } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      act(() => {
        result.current.dismiss('att-1');
      });

      expect(getMockAttentionStore().dismissAttention).toHaveBeenCalledWith(mockSessionId, 'att-1');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup socket subscriptions on unmount', () => {
      const unsubscribeMock = vi.fn();
      vi.mocked(socket.onSocketEvent).mockReturnValue(unsubscribeMock);

      const { unmount } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      unmount();

      expect(unsubscribeMock).toHaveBeenCalledTimes(4);
    });

    it('should cancel pending API requests on unmount', async () => {
      const { unmount } = renderHook(() => useAgentAttention({ sessionId: mockSessionId }));

      unmount();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
