import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// Import types and helpers from extracted modules
import {
  type Agent,
  type AgentMessage,
  type AgentMode,
  type AgentPosition,
  type FilePreview,
  type GridSpan,
  type Session,
  type StandbySettings,
  type StreamingMessage,
  type ToolCall,
  getLanguageFromPath,
  MAX_MESSAGES_PER_AGENT,
  MAX_RECENT_FILES,
} from './sessionTypes';
import { createDebouncedStorage } from './sessionStorage';
import { useStreamingStore } from './streaming';

// Re-export types for backward compatibility
export type {
  Agent,
  AgentMessage,
  AgentMode,
  AgentPosition,
  AgentRole,
  FilePreview,
  GridSpan,
  PendingPermission,
  Session,
  StandbySettings,
  StreamingMessage,
  ToolCall,
  ViewMode,
  WorkspaceStatus,
} from './sessionTypes';

// ============================================================================
// Session State Interface
// ============================================================================

interface SessionState {
  sessions: Record<string, Session>;
  currentSessionId: string | null;
  recentFiles: string[]; // List of recently opened file paths

  // Session actions
  createSession: (session: Session) => void;
  deleteSession: (sessionId: string) => void;
  setCurrentSession: (sessionId: string) => void;

  // Agent actions
  addAgent: (sessionId: string, agent: Agent) => void;
  removeAgent: (sessionId: string, agentId: string) => void;
  updateAgent: (sessionId: string, agentId: string, updates: Partial<Agent>) => void;
  setActiveAgent: (sessionId: string, agentId: string | null) => void;
  addAgentMessage: (sessionId: string, agentId: string, message: AgentMessage) => void;
  deleteAgentMessage: (sessionId: string, agentId: string, messageId: string) => void;
  updateMessageId: (sessionId: string, agentId: string, oldId: string, newId: string) => void;
  updateAgentPosition: (
    sessionId: string,
    agentId: string,
    position: Partial<AgentPosition>
  ) => void;
  updateAgentGridSpan: (sessionId: string, agentId: string, gridSpan: GridSpan) => void;
  bringAgentToFront: (sessionId: string, agentId: string) => void;

  // File preview actions
  openFilePreview: (sessionId: string, pathOrPreview: string | FilePreview) => void;
  closeFilePreview: (sessionId: string, previewId: string) => void;
  updateFilePreview: (sessionId: string, previewId: string, updates: Partial<FilePreview>) => void;
  pinFilePreview: (sessionId: string, previewId: string, pinned: boolean) => void;
  dockFilePreview: (sessionId: string, previewId: string, docked: boolean) => void;
  updateFilePreviewGridSpan: (sessionId: string, previewId: string, gridSpan: GridSpan) => void;

  // Editor grid card actions (consolidated tabbed editor in grid)
  createEditorGridCard: (sessionId: string) => string;
  removeEditorGridCard: (sessionId: string) => void;
  updateEditorGridSpan: (sessionId: string, gridSpan: GridSpan) => void;
  updateEditorFreeformPosition: (sessionId: string, position: Partial<AgentPosition>) => void;

  // Recent files
  addRecentFile: (path: string) => void;
  clearRecentFiles: () => void;

  // View actions
  setViewMode: (sessionId: string, mode: 'grid' | 'focus' | 'freeform') => void;

  // Workspace status actions
  setWorkspaceStatus: (
    sessionId: string,
    status: Session['workspaceStatus'],
    standbyAt?: string | null
  ) => void;
  setWorkspaceStatusChecking: (sessionId: string, checking: boolean) => void;
  setStandbySettings: (sessionId: string, settings: StandbySettings | null) => void;
  // Update session workspace ID (for syncing from API when stale in localStorage)
  updateSessionWorkspaceId: (sessionId: string, workspaceId: string) => void;
  updateSessionInfo: (
    sessionId: string,
    updates: Partial<Pick<Session, 'name' | 'branch' | 'gitUrl'>>
  ) => void;
  updateSessionWorkspaceTier: (sessionId: string, tier: string) => void;

  // Agent mode auto-switch actions
  handleAutoModeSwitch: (
    sessionId: string,
    agentId: string,
    newMode: AgentMode,
    previousMode: AgentMode | null
  ) => void;

  // Extended thinking config action
  updateAgentThinking: (
    sessionId: string,
    agentId: string,
    thinkingConfig: Agent['thinkingConfig']
  ) => void;

  // Streaming message actions (delegated to streaming store for new code)
  // Kept for backward compatibility
  streamingMessages: Record<string, StreamingMessage>;
  startStreamingMessage: (sessionId: string, agentId: string, messageId: string) => void;
  appendStreamingToken: (messageId: string, token: string) => void;
  appendThinkingToken: (messageId: string, thinking: string) => void;
  finalizeStreamingMessage: (
    messageId: string,
    fullContent: string,
    toolCalls?: ToolCall[]
  ) => void;
  getStreamingMessage: (messageId: string) => StreamingMessage | undefined;
}

// ============================================================================
// Store Implementation
// ============================================================================

const sessionStoreCreator: StateCreator<SessionState> = (set, get) => ({
  sessions: {},
  currentSessionId: null,
  recentFiles: [],
  streamingMessages: {},

  // ========================================================================
  // Session Actions
  // ========================================================================

  createSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
      currentSessionId: session.id,
    })),

  deleteSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _deleted, ...remaining } = state.sessions;
      return {
        sessions: remaining,
        currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      };
    }),

  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

  // ========================================================================
  // Agent Actions
  // ========================================================================

  addAgent: (sessionId, agent) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: [...session.agents, agent],
          },
        },
      };
    }),

  removeAgent: (sessionId, agentId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.filter((a) => a.id !== agentId),
            activeAgentId: session.activeAgentId === agentId ? null : session.activeAgentId,
          },
        },
      };
    }),

  updateAgent: (sessionId, agentId, updates) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => (a.id === agentId ? { ...a, ...updates } : a)),
          },
        },
      };
    }),

  setActiveAgent: (sessionId, agentId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, activeAgentId: agentId },
        },
      };
    }),

  // ========================================================================
  // Message Actions (with deduplication)
  // ========================================================================

  addAgentMessage: (sessionId, agentId, message) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => {
              if (a.id !== agentId) return a;

              // Deduplication: check if message already exists by ID
              if (a.messages.some((m) => m.id === message.id)) {
                return a; // Message already exists, don't add duplicate
              }

              // Deduplication: for user messages with temp IDs (optimistic updates),
              // check if a real message with same content already exists
              if (message.role === 'user' && message.id.startsWith('temp-')) {
                const existingRealMessage = a.messages.find(
                  (m) =>
                    m.role === 'user' && m.content === message.content && !m.id.startsWith('temp-')
                );
                if (existingRealMessage) {
                  return a; // Real message already exists, don't add temp duplicate
                }
              }

              // Deduplication: for user messages with real IDs,
              // check if a temp message with same content exists
              if (message.role === 'user' && !message.id.startsWith('temp-')) {
                const existingTempMessage = a.messages.find(
                  (m) =>
                    m.role === 'user' && m.content === message.content && m.id.startsWith('temp-')
                );
                if (existingTempMessage) {
                  // Replace temp message with real one
                  return {
                    ...a,
                    messages: a.messages.map((m) =>
                      m.id === existingTempMessage.id ? { ...m, id: message.id } : m
                    ),
                  };
                }
              }

              // Deduplication: for assistant messages, check by content
              if (message.role === 'assistant') {
                const existingByContent = a.messages.find(
                  (m) => m.role === 'assistant' && m.content === message.content
                );
                if (existingByContent) {
                  // Update the ID to the real one if different
                  if (existingByContent.id !== message.id) {
                    return {
                      ...a,
                      messages: a.messages.map((m) =>
                        m.id === existingByContent.id ? { ...m, id: message.id } : m
                      ),
                    };
                  }
                  return a; // Same content already exists
                }
              }

              // Add message and enforce limit to prevent localStorage overflow
              const newMessages = [...a.messages, message];
              const limitedMessages =
                newMessages.length > MAX_MESSAGES_PER_AGENT
                  ? newMessages.slice(-MAX_MESSAGES_PER_AGENT)
                  : newMessages;
              return { ...a, messages: limitedMessages };
            }),
          },
        },
      };
    }),

  deleteAgentMessage: (sessionId, agentId, messageId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => {
              if (a.id !== agentId) return a;
              return {
                ...a,
                messages: a.messages.filter((m) => m.id !== messageId),
              };
            }),
          },
        },
      };
    }),

  updateMessageId: (sessionId, agentId, oldId, newId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => {
              if (a.id !== agentId) return a;
              return {
                ...a,
                messages: a.messages.map((m) => (m.id === oldId ? { ...m, id: newId } : m)),
              };
            }),
          },
        },
      };
    }),

  // ========================================================================
  // Agent Position/Grid Actions
  // ========================================================================

  updateAgentPosition: (sessionId, agentId, position) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) =>
              a.id === agentId
                ? { ...a, position: { ...a.position, ...position } as AgentPosition }
                : a
            ),
          },
        },
      };
    }),

  updateAgentGridSpan: (sessionId, agentId, gridSpan) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => (a.id === agentId ? { ...a, gridSpan } : a)),
          },
        },
      };
    }),

  bringAgentToFront: (sessionId, agentId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const maxZ = Math.max(...session.agents.map((a) => a.position?.zIndex ?? 0));
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) =>
              a.id === agentId
                ? { ...a, position: { ...a.position, zIndex: maxZ + 1 } as AgentPosition }
                : a
            ),
          },
        },
      };
    }),

  // ========================================================================
  // File Preview Actions
  // ========================================================================

  openFilePreview: (sessionId, pathOrPreview) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      // Handle string path or FilePreview object
      const preview: FilePreview =
        typeof pathOrPreview === 'string'
          ? {
              id: `preview-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              path: pathOrPreview,
              content: '', // Content will be loaded separately
              language: getLanguageFromPath(pathOrPreview),
              pinned: false,
              position: { x: 100, y: 100 },
              docked: session.viewMode !== 'freeform',
            }
          : pathOrPreview;

      const existing = session.filePreviews.find((p) => p.path === preview.path);
      if (existing) return state;

      // Add to recent files
      const newRecentFiles = [
        preview.path,
        ...state.recentFiles.filter((p) => p !== preview.path),
      ].slice(0, 20); // Keep last 20

      return {
        recentFiles: newRecentFiles,
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: [...session.filePreviews, preview],
          },
        },
      };
    }),

  closeFilePreview: (sessionId, previewId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: session.filePreviews.filter((p) => p.id !== previewId),
          },
        },
      };
    }),

  updateFilePreview: (sessionId, previewId, updates) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: session.filePreviews.map((p) =>
              p.id === previewId ? { ...p, ...updates } : p
            ),
          },
        },
      };
    }),

  pinFilePreview: (sessionId, previewId, pinned) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: session.filePreviews.map((p) =>
              p.id === previewId ? { ...p, pinned } : p
            ),
          },
        },
      };
    }),

  dockFilePreview: (sessionId, previewId, docked) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: session.filePreviews.map((p) =>
              p.id === previewId ? { ...p, docked } : p
            ),
          },
        },
      };
    }),

  updateFilePreviewGridSpan: (sessionId, previewId, gridSpan) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            filePreviews: session.filePreviews.map((p) =>
              p.id === previewId ? { ...p, gridSpan } : p
            ),
          },
        },
      };
    }),

  // ========================================================================
  // Editor Grid Card Actions
  // ========================================================================

  createEditorGridCard: (sessionId) => {
    const id = `editor-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            editorGridCardId: id,
            editorGridSpan: { colSpan: 2, rowSpan: 2 },
          },
        },
      };
    });
    return id;
  },

  removeEditorGridCard: (sessionId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            editorGridCardId: null,
            editorGridSpan: undefined,
          },
        },
      };
    }),

  updateEditorGridSpan: (sessionId, gridSpan) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            editorGridSpan: gridSpan,
          },
        },
      };
    }),

  updateEditorFreeformPosition: (sessionId, position) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const currentPosition = session.editorFreeformPosition ?? {
        x: 100,
        y: 100,
        width: 600,
        height: 500,
        zIndex: 1,
      };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            editorFreeformPosition: { ...currentPosition, ...position },
          },
        },
      };
    }),

  // ========================================================================
  // Recent Files Actions
  // ========================================================================

  addRecentFile: (path) =>
    set((state) => ({
      recentFiles: [path, ...state.recentFiles.filter((p) => p !== path)].slice(0, 20),
    })),

  clearRecentFiles: () => set({ recentFiles: [] }),

  // ========================================================================
  // View Mode Actions
  // ========================================================================

  setViewMode: (sessionId, mode) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, viewMode: mode },
        },
      };
    }),

  // ========================================================================
  // Workspace Status Actions
  // ========================================================================

  setWorkspaceStatus: (sessionId, status, standbyAt = null) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            workspaceStatus: status,
            workspaceStatusChecking: false,
            standbyAt: standbyAt ?? null,
          },
        },
      };
    }),

  setWorkspaceStatusChecking: (sessionId, checking) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      if (session.workspaceStatusChecking === checking) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            workspaceStatusChecking: checking,
          },
        },
      };
    }),

  setStandbySettings: (sessionId, settings) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            standbySettings: settings,
          },
        },
      };
    }),

  updateSessionWorkspaceId: (sessionId, workspaceId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      // Only update if the workspace ID has changed
      if (session.workspaceId === workspaceId) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, workspaceId },
        },
      };
    }),

  updateSessionInfo: (sessionId, updates) =>
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

  updateSessionWorkspaceTier: (sessionId, tier) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, workspaceTier: tier },
        },
      };
    }),

  // ========================================================================
  // Agent Mode Actions
  // ========================================================================

  handleAutoModeSwitch: (sessionId, agentId, newMode, previousMode) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) =>
              a.id === agentId
                ? {
                    ...a,
                    mode: newMode,
                    previousMode: previousMode ?? undefined,
                  }
                : a
            ),
          },
        },
      };
    }),

  updateAgentThinking: (sessionId, agentId, thinkingConfig) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.map((a) => (a.id === agentId ? { ...a, thinkingConfig } : a)),
          },
        },
      };
    }),

  // ========================================================================
  // Streaming Message Actions
  // Delegated to streaming store but kept here for backward compatibility
  // ========================================================================

  startStreamingMessage: (sessionId, agentId, messageId) => {
    // Delegate to streaming store
    useStreamingStore.getState().startStreamingMessage(sessionId, agentId, messageId);
    // Update local state for backward compat
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
    }));
  },

  appendStreamingToken: (messageId, token) => {
    // Delegate to streaming store
    useStreamingStore.getState().appendStreamingToken(messageId, token);
    // Update local state for backward compat
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
    });
  },

  appendThinkingToken: (messageId, thinking) => {
    // Delegate to streaming store
    useStreamingStore.getState().appendThinkingToken(messageId, thinking);
    // Update local state for backward compat
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
    });
  },

  finalizeStreamingMessage: (messageId, fullContent, toolCalls) => {
    const state = get();
    const streaming = state.streamingMessages[messageId];
    if (!streaming) return;

    // Complete in streaming store
    useStreamingStore.getState().completeStreaming(messageId, fullContent, toolCalls);

    // Remove from streaming messages
    const { [messageId]: _removed, ...remainingStreaming } = state.streamingMessages;

    // Add as a completed message to the agent
    const session = state.sessions[streaming.sessionId];
    if (!session) {
      set({ streamingMessages: remainingStreaming });
      return;
    }

    const newMessage: AgentMessage = {
      id: messageId,
      role: 'assistant',
      content: fullContent,
      thinking: streaming.thinkingContent || undefined,
      timestamp: new Date(),
      toolCalls: toolCalls,
    };

    set({
      streamingMessages: remainingStreaming,
      sessions: {
        ...state.sessions,
        [streaming.sessionId]: {
          ...session,
          agents: session.agents.map((a) => {
            if (a.id !== streaming.agentId) return a;
            // Add message and enforce limit
            const newMessages = [...a.messages, newMessage];
            const limitedMessages =
              newMessages.length > MAX_MESSAGES_PER_AGENT
                ? newMessages.slice(-MAX_MESSAGES_PER_AGENT)
                : newMessages;
            return { ...a, messages: limitedMessages };
          }),
        },
      },
    });
  },

  getStreamingMessage: (messageId) => get().streamingMessages[messageId],
});

// ============================================================================
// Persistence Configuration
// ============================================================================

type PartializedSessionState = {
  currentSessionId: string | null;
  sessions: Record<string, Session>;
  recentFiles: string[];
};

const persistedSessionStore = persist(sessionStoreCreator, {
  name: 'podex-sessions',
  // Use debounced storage to prevent excessive writes during rapid updates
  storage: createDebouncedStorage<PartializedSessionState>('podex-sessions', 1000),
  partialize: (state) => ({
    currentSessionId: state.currentSessionId,
    // Limit persisted data to prevent localStorage overflow
    sessions: Object.fromEntries(
      Object.entries(state.sessions).map(([id, session]) => [
        id,
        {
          ...session,
          // Limit messages per agent for persistence
          agents: session.agents.map((agent) => ({
            ...agent,
            messages: agent.messages.slice(-MAX_MESSAGES_PER_AGENT),
          })),
          // Limit file previews (don't persist content, just metadata)
          filePreviews: session.filePreviews.slice(0, 20).map((fp) => ({
            ...fp,
            content: '', // Don't persist file content
          })),
        },
      ])
    ),
    recentFiles: state.recentFiles.slice(0, MAX_RECENT_FILES),
  }),
});

// ============================================================================
// Export Store
// ============================================================================

// Only enable devtools in development to prevent exposing message data in production
export const useSessionStore = create<SessionState>()(
  devtools(persistedSessionStore, {
    name: 'podex-sessions',
    enabled: process.env.NODE_ENV === 'development',
  })
);
