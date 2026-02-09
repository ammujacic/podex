/**
 * Platform-agnostic session store slice.
 * Manages core session and agent state without platform-specific dependencies.
 *
 * @example
 * ```typescript
 * // Web app with localStorage persistence
 * import { create } from 'zustand';
 * import { persist, devtools } from 'zustand/middleware';
 * import { createSessionSlice, SessionState } from '@podex/state';
 *
 * export const useSessionStore = create<SessionState>()(
 *   devtools(
 *     persist(createSessionSlice, { name: 'podex-session' }),
 *     { name: 'session' }
 *   )
 * );
 *
 * // Mobile app with SecureStore
 * import { createJSONStorage } from 'zustand/middleware';
 * import * as SecureStore from 'expo-secure-store';
 *
 * const secureStorage = createJSONStorage(() => ({
 *   getItem: SecureStore.getItemAsync,
 *   setItem: SecureStore.setItemAsync,
 *   removeItem: SecureStore.deleteItemAsync,
 * }));
 * ```
 */

import { create, type StateCreator } from 'zustand';
import type {
  AgentCore,
  AgentMessage,
  AgentStatus,
  ConversationSession,
  SessionCore,
  StreamingMessage,
  WorkspaceStatus,
} from '../types/session';

// ============================================================================
// State Interface
// ============================================================================

export interface SessionState {
  // Core state
  sessions: Record<string, SessionCore>;
  agents: Record<string, AgentCore[]>; // sessionId -> agents
  conversations: Record<string, ConversationSession[]>; // sessionId -> conversations
  messages: Record<string, AgentMessage[]>; // conversationId -> messages

  currentSessionId: string | null;
  currentAgentId: string | null;

  // Streaming state
  streamingMessages: Record<string, StreamingMessage>; // messageId -> streaming state

  // Connection state
  isConnected: boolean;

  // Session actions
  setCurrentSession: (sessionId: string | null) => void;
  setCurrentAgent: (agentId: string | null) => void;
  addSession: (session: SessionCore) => void;
  updateSession: (sessionId: string, updates: Partial<SessionCore>) => void;
  removeSession: (sessionId: string) => void;
  setSessions: (sessions: SessionCore[]) => void;

  // Agent actions
  setAgents: (sessionId: string, agents: AgentCore[]) => void;
  updateAgentStatus: (sessionId: string, agentId: string, status: AgentStatus) => void;
  updateAgent: (sessionId: string, agentId: string, updates: Partial<AgentCore>) => void;

  // Conversation actions
  setConversations: (sessionId: string, conversations: ConversationSession[]) => void;
  addConversation: (sessionId: string, conversation: ConversationSession) => void;
  updateConversation: (
    sessionId: string,
    conversationId: string,
    updates: Partial<ConversationSession>
  ) => void;
  removeConversation: (sessionId: string, conversationId: string) => void;

  // Message actions
  setMessages: (conversationId: string, messages: AgentMessage[]) => void;
  addMessage: (conversationId: string, message: AgentMessage) => void;
  updateMessage: (
    conversationId: string,
    messageId: string,
    updates: Partial<AgentMessage>
  ) => void;

  // Streaming actions
  startStreaming: (messageId: string, agentId: string, sessionId: string) => void;
  appendStreamToken: (messageId: string, token: string) => void;
  appendThinkingToken: (messageId: string, thinking: string) => void;
  endStreaming: (messageId: string, finalContent?: string) => void;

  // Workspace actions
  setWorkspaceStatus: (sessionId: string, status: WorkspaceStatus) => void;
  setWorkspaceError: (sessionId: string, error: string | null) => void;

  // Connection actions
  setConnected: (connected: boolean) => void;

  // Utilities
  getSession: (sessionId: string) => SessionCore | undefined;
  getAgents: (sessionId: string) => AgentCore[];
  getConversations: (sessionId: string) => ConversationSession[];
  getMessages: (conversationId: string) => AgentMessage[];
  getStreamingMessage: (messageId: string) => StreamingMessage | undefined;
  getCurrentAgent: () => AgentCore | undefined;
}

// ============================================================================
// Store Slice Creator
// ============================================================================

export const createSessionSlice: StateCreator<SessionState> = (set, get) => ({
  // Initial state
  sessions: {},
  agents: {},
  conversations: {},
  messages: {},
  currentSessionId: null,
  currentAgentId: null,
  streamingMessages: {},
  isConnected: false,

  // Session actions
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  setCurrentAgent: (agentId) => set({ currentAgentId: agentId }),

  addSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    })),

  updateSession: (sessionId, updates) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, ...updates },
        },
      };
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      const { [sessionId]: __, ...restAgents } = state.agents;
      const { [sessionId]: ___, ...restConversations } = state.conversations;
      return {
        sessions: rest,
        agents: restAgents,
        conversations: restConversations,
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      };
    }),

  setSessions: (sessions) =>
    set({
      sessions: sessions.reduce(
        (acc, session) => {
          acc[session.id] = session;
          return acc;
        },
        {} as Record<string, SessionCore>
      ),
    }),

  // Agent actions
  setAgents: (sessionId, agents) =>
    set((state) => ({
      agents: { ...state.agents, [sessionId]: agents },
    })),

  updateAgentStatus: (sessionId, agentId, status) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [sessionId]: (state.agents[sessionId] || []).map((agent) =>
          agent.id === agentId ? { ...agent, status } : agent
        ),
      },
    })),

  updateAgent: (sessionId, agentId, updates) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [sessionId]: (state.agents[sessionId] || []).map((agent) =>
          agent.id === agentId ? { ...agent, ...updates } : agent
        ),
      },
    })),

  // Conversation actions
  setConversations: (sessionId, conversations) =>
    set((state) => ({
      conversations: { ...state.conversations, [sessionId]: conversations },
    })),

  addConversation: (sessionId, conversation) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [sessionId]: [...(state.conversations[sessionId] || []), conversation],
      },
    })),

  updateConversation: (sessionId, conversationId, updates) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [sessionId]: (state.conversations[sessionId] || []).map((conv) =>
          conv.id === conversationId ? { ...conv, ...updates } : conv
        ),
      },
    })),

  removeConversation: (sessionId, conversationId) =>
    set((state) => ({
      conversations: {
        ...state.conversations,
        [sessionId]: (state.conversations[sessionId] || []).filter((c) => c.id !== conversationId),
      },
    })),

  // Message actions
  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), message],
      },
    })),

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        ),
      },
    })),

  // Streaming actions
  startStreaming: (messageId, agentId, sessionId) =>
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

  appendStreamToken: (messageId, token) =>
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

  endStreaming: (messageId, _finalContent) =>
    set((state) => {
      const existing = state.streamingMessages[messageId];
      if (!existing) return state;

      // Remove from streaming messages
      const { [messageId]: _, ...rest } = state.streamingMessages;
      return {
        streamingMessages: rest,
      };
    }),

  // Workspace actions
  setWorkspaceStatus: (sessionId, status) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, workspaceStatus: status },
        },
      };
    }),

  setWorkspaceError: (sessionId, error) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, workspaceError: error },
        },
      };
    }),

  // Connection actions
  setConnected: (connected) => set({ isConnected: connected }),

  // Utilities
  getSession: (sessionId) => get().sessions[sessionId],

  getAgents: (sessionId) => get().agents[sessionId] || [],

  getConversations: (sessionId) => get().conversations[sessionId] || [],

  getMessages: (conversationId) => get().messages[conversationId] || [],

  getStreamingMessage: (messageId) => get().streamingMessages[messageId],

  getCurrentAgent: () => {
    const state = get();
    if (!state.currentSessionId || !state.currentAgentId) return undefined;
    const agents = state.agents[state.currentSessionId] || [];
    return agents.find((a) => a.id === state.currentAgentId);
  },
});

// ============================================================================
// Standalone Store Creator (for simple use cases)
// ============================================================================

/**
 * Create a standalone session store without persistence.
 * Use createSessionSlice for integration with custom middleware.
 */
export const createSessionStore = () => create<SessionState>(createSessionSlice);
