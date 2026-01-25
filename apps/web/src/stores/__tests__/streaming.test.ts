import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStreamingStore } from '../streaming';
import type { ToolCall } from '../sessionTypes';

describe('streamingStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useStreamingStore.setState({
        streamingMessages: {},
      });
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty streaming messages', () => {
      const { result } = renderHook(() => useStreamingStore());
      expect(result.current.streamingMessages).toEqual({});
    });

    it('no messages are streaming initially', () => {
      const { result } = renderHook(() => useStreamingStore());
      expect(result.current.isMessageStreaming('any-id')).toBe(false);
    });
  });

  // ========================================================================
  // Stream Start
  // ========================================================================

  describe('Stream Start', () => {
    it('starts streaming message', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message).toBeDefined();
      expect(message?.messageId).toBe('msg-1');
      expect(message?.agentId).toBe('agent-1');
      expect(message?.sessionId).toBe('session-1');
    });

    it('initializes streaming message with empty content', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('');
      expect(message?.thinkingContent).toBe('');
    });

    it('sets isStreaming flag to true', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.isStreaming).toBe(true);
      expect(result.current.isMessageStreaming('msg-1')).toBe(true);
    });

    it('sets startedAt timestamp', () => {
      const { result } = renderHook(() => useStreamingStore());
      const before = new Date();

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
      });

      const message = result.current.getStreamingMessage('msg-1');
      const after = new Date();
      expect(message?.startedAt).toBeDefined();
      expect(message?.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(message?.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('starts multiple streaming messages independently', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-2');
      });

      expect(result.current.getStreamingMessage('msg-1')).toBeDefined();
      expect(result.current.getStreamingMessage('msg-2')).toBeDefined();
    });
  });

  // ========================================================================
  // Chunk Handling
  // ========================================================================

  describe('Chunk Handling', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useStreamingStore());
      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
      });
    });

    it('appends streaming token to content', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.appendStreamingToken('msg-1', 'Hello');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('Hello');
    });

    it('appends multiple tokens sequentially', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.appendStreamingToken('msg-1', 'Hello');
        result.current.appendStreamingToken('msg-1', ' ');
        result.current.appendStreamingToken('msg-1', 'World');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('Hello World');
    });

    it('appends thinking content', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.appendThinkingToken('msg-1', 'Analyzing...');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.thinkingContent).toBe('Analyzing...');
    });

    it('appends multiple thinking tokens', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.appendThinkingToken('msg-1', 'Processing');
        result.current.appendThinkingToken('msg-1', ' request');
        result.current.appendThinkingToken('msg-1', '...');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.thinkingContent).toBe('Processing request...');
    });

    it('content and thinking content are independent', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.appendStreamingToken('msg-1', 'Response');
        result.current.appendThinkingToken('msg-1', 'Thinking');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('Response');
      expect(message?.thinkingContent).toBe('Thinking');
    });

    it('handles appending to non-existent message gracefully', () => {
      const { result } = renderHook(() => useStreamingStore());

      expect(() => {
        act(() => {
          result.current.appendStreamingToken('non-existent', 'Hello');
        });
      }).not.toThrow();

      expect(result.current.getStreamingMessage('non-existent')).toBeUndefined();
    });

    it('handles appending thinking to non-existent message gracefully', () => {
      const { result } = renderHook(() => useStreamingStore());

      expect(() => {
        act(() => {
          result.current.appendThinkingToken('non-existent', 'Thinking');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Stream Completion
  // ========================================================================

  describe('Stream Completion', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useStreamingStore());
      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.appendStreamingToken('msg-1', 'Complete message');
      });
    });

    it('completes streaming and returns message data', () => {
      const { result } = renderHook(() => useStreamingStore());

      let completedMessage;
      act(() => {
        completedMessage = result.current.completeStreaming('msg-1', 'Complete message');
      });

      expect(completedMessage).toBeDefined();
      expect(completedMessage?.content).toBe('Complete message');
    });

    it('removes message from streaming messages', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.completeStreaming('msg-1', 'Complete message');
      });

      expect(result.current.getStreamingMessage('msg-1')).toBeUndefined();
      expect(result.current.isMessageStreaming('msg-1')).toBe(false);
    });

    it('completes streaming with tool calls', () => {
      const { result } = renderHook(() => useStreamingStore());
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          name: 'search',
          input: { query: 'test' },
        },
      ];

      let completedMessage;
      act(() => {
        completedMessage = result.current.completeStreaming('msg-1', 'Message', toolCalls);
      });

      expect(completedMessage).toBeDefined();
    });

    it('returns null for non-existent streaming message', () => {
      const { result } = renderHook(() => useStreamingStore());

      let completedMessage;
      act(() => {
        completedMessage = result.current.completeStreaming('non-existent', 'Message');
      });

      expect(completedMessage).toBeNull();
    });

    it('only removes specified message when completing', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-2');
        result.current.completeStreaming('msg-1', 'Complete');
      });

      expect(result.current.getStreamingMessage('msg-1')).toBeUndefined();
      expect(result.current.getStreamingMessage('msg-2')).toBeDefined();
    });
  });

  // ========================================================================
  // Stream Error Handling
  // ========================================================================

  describe('Stream Error Handling', () => {
    it('completes streaming on error', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.appendStreamingToken('msg-1', 'Partial');
      });

      let errorMessage;
      act(() => {
        errorMessage = result.current.completeStreaming('msg-1', 'Partial');
      });

      expect(errorMessage).toBeDefined();
      expect(result.current.isMessageStreaming('msg-1')).toBe(false);
    });

    it('handles completing already completed message gracefully', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.completeStreaming('msg-1', 'Done');
      });

      let secondComplete;
      act(() => {
        secondComplete = result.current.completeStreaming('msg-1', 'Done again');
      });

      expect(secondComplete).toBeNull();
    });
  });

  // ========================================================================
  // Get Agent Streaming Messages
  // ========================================================================

  describe('Get Agent Streaming Messages', () => {
    it('gets all streaming messages for agent', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-2');
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-3');
      });

      const agent1Messages = result.current.getAgentStreamingMessages('agent-1');
      expect(agent1Messages).toHaveLength(2);
      expect(agent1Messages.map((m) => m.messageId)).toContain('msg-1');
      expect(agent1Messages.map((m) => m.messageId)).toContain('msg-2');
    });

    it('returns empty array for agent with no streaming messages', () => {
      const { result } = renderHook(() => useStreamingStore());

      const messages = result.current.getAgentStreamingMessages('agent-999');
      expect(messages).toEqual([]);
    });

    it('excludes completed messages', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-2');
        result.current.completeStreaming('msg-1', 'Done');
      });

      const messages = result.current.getAgentStreamingMessages('agent-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('msg-2');
    });
  });

  // ========================================================================
  // Clear All Streaming
  // ========================================================================

  describe('Clear All Streaming', () => {
    it('clears all streaming messages', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-2');
        result.current.startStreamingMessage('session-2', 'agent-3', 'msg-3');
      });

      act(() => {
        result.current.clearAllStreaming();
      });

      expect(result.current.streamingMessages).toEqual({});
    });

    it('clearing empty store does not throw', () => {
      const { result } = renderHook(() => useStreamingStore());

      expect(() => {
        act(() => {
          result.current.clearAllStreaming();
        });
      }).not.toThrow();
    });

    it('messages are not streaming after clear', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.clearAllStreaming();
      });

      expect(result.current.isMessageStreaming('msg-1')).toBe(false);
    });
  });

  // ========================================================================
  // Multiple Concurrent Streams
  // ========================================================================

  describe('Multiple Concurrent Streams', () => {
    it('handles multiple concurrent streams independently', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-2');
        result.current.appendStreamingToken('msg-1', 'Agent 1 ');
        result.current.appendStreamingToken('msg-2', 'Agent 2 ');
        result.current.appendStreamingToken('msg-1', 'message');
        result.current.appendStreamingToken('msg-2', 'response');
      });

      expect(result.current.getStreamingMessage('msg-1')?.content).toBe('Agent 1 message');
      expect(result.current.getStreamingMessage('msg-2')?.content).toBe('Agent 2 response');
    });

    it('completes one stream without affecting others', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.startStreamingMessage('session-1', 'agent-2', 'msg-2');
        result.current.appendStreamingToken('msg-1', 'Complete');
        result.current.appendStreamingToken('msg-2', 'Still streaming');
        result.current.completeStreaming('msg-1', 'Complete');
      });

      expect(result.current.isMessageStreaming('msg-1')).toBe(false);
      expect(result.current.isMessageStreaming('msg-2')).toBe(true);
      expect(result.current.getStreamingMessage('msg-2')?.content).toBe('Still streaming');
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('handles empty token append', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.appendStreamingToken('msg-1', '');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('');
    });

    it('handles special characters in tokens', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.appendStreamingToken('msg-1', 'Hello\n');
        result.current.appendStreamingToken('msg-1', 'World\t!');
        result.current.appendStreamingToken('msg-1', ' 🎉');
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content).toBe('Hello\nWorld\t! 🎉');
    });

    it('handles very long content', () => {
      const { result } = renderHook(() => useStreamingStore());
      const longToken = 'a'.repeat(10000);

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        result.current.appendStreamingToken('msg-1', longToken);
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content.length).toBe(10000);
    });

    it('handles rapid token appends', () => {
      const { result } = renderHook(() => useStreamingStore());

      act(() => {
        result.current.startStreamingMessage('session-1', 'agent-1', 'msg-1');
        for (let i = 0; i < 100; i++) {
          result.current.appendStreamingToken('msg-1', `${i} `);
        }
      });

      const message = result.current.getStreamingMessage('msg-1');
      expect(message?.content.split(' ')).toHaveLength(101); // 100 numbers + 1 empty string
    });
  });
});
