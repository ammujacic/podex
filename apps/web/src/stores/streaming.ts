import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import type { StreamingMessage, ToolCall } from './sessionTypes';

// ============================================================================
// Types
// ============================================================================

interface StreamingState {
  /** Active streaming messages keyed by messageId */
  streamingMessages: Record<string, StreamingMessage>;

  // Actions
  startStreamingMessage: (sessionId: string, agentId: string, messageId: string) => void;
  appendStreamingToken: (messageId: string, token: string) => void;
  appendThinkingToken: (messageId: string, thinking: string) => void;
  /**
   * Mark streaming as complete and return the finalized message data.
   * The returned data can be used to add the message to the session store.
   */
  completeStreaming: (
    messageId: string,
    fullContent: string,
    toolCalls?: ToolCall[]
  ) => StreamingMessage | null;
  /** Get a streaming message by ID */
  getStreamingMessage: (messageId: string) => StreamingMessage | undefined;
  /** Check if a message is currently streaming */
  isMessageStreaming: (messageId: string) => boolean;
  /** Get all streaming messages for an agent */
  getAgentStreamingMessages: (agentId: string) => StreamingMessage[];
  /** Clear all streaming messages (for cleanup on unmount) */
  clearAllStreaming: () => void;
}

// ============================================================================
// Store
// ============================================================================

export const useStreamingStore = create<StreamingState>()(
  devtools(
    (set, get) => ({
      streamingMessages: {},

      startStreamingMessage: (sessionId, agentId, messageId) =>
        set((state) => ({
          streamingMessages: {
            ...state.streamingMessages,
            [messageId]: {
              messageId,
              agentId,
              sessionId,
              content: '',
              thinkingContent: '',
              isStreaming: true,
              startedAt: new Date(),
            },
          },
        })),

      appendStreamingToken: (messageId, token) =>
        set((state) => {
          const existing = state.streamingMessages[messageId];
          if (!existing) return state;
          return {
            streamingMessages: {
              ...state.streamingMessages,
              [messageId]: {
                ...existing,
                content: existing.content + token,
              },
            },
          };
        }),

      appendThinkingToken: (messageId, thinking) =>
        set((state) => {
          const existing = state.streamingMessages[messageId];
          if (!existing) return state;
          return {
            streamingMessages: {
              ...state.streamingMessages,
              [messageId]: {
                ...existing,
                thinkingContent: existing.thinkingContent + thinking,
              },
            },
          };
        }),

      completeStreaming: (messageId, _fullContent, _toolCalls) => {
        const state = get();
        const streaming = state.streamingMessages[messageId];
        if (!streaming) return null;

        // Remove from streaming messages
        set((s) => {
          const { [messageId]: _removed, ...remaining } = s.streamingMessages;
          return { streamingMessages: remaining };
        });

        // Return the streaming data for the caller to handle
        return streaming;
      },

      getStreamingMessage: (messageId) => get().streamingMessages[messageId],

      isMessageStreaming: (messageId) => {
        const msg = get().streamingMessages[messageId];
        return msg?.isStreaming ?? false;
      },

      getAgentStreamingMessages: (agentId) =>
        Object.values(get().streamingMessages).filter((m) => m.agentId === agentId),

      clearAllStreaming: () => set({ streamingMessages: {} }),
    }),
    {
      name: 'podex-streaming',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// ============================================================================
// Convenience Hooks
// ============================================================================

export const useStreamingMessage = (messageId: string) =>
  useStreamingStore((s) => s.streamingMessages[messageId]);

export const useIsStreaming = (messageId: string) =>
  useStreamingStore((s) => s.isMessageStreaming(messageId));
