import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// Import types and helpers from extracted modules
import {
  type Agent,
  type AgentMessage,
  type AgentMode,
  type AgentPosition,
  type ConversationSession,
  type FilePreview,
  type GridSpan,
  type Session,
  type StreamingMessage,
  type ToolCall,
  deriveSessionName,
  getLanguageFromPath,
  MAX_MESSAGES_PER_CONVERSATION,
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
  ConversationSession,
  FilePreview,
  GridSpan,
  Session,
  StreamingMessage,
  ToolCall,
  ViewMode,
  WorkspaceStatus,
} from './sessionTypes';

// Re-export helpers
export { deriveSessionName, formatRelativeTime, getAgentDisplayTitle } from './sessionTypes';

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
  // Sync sessions with backend - removes orphaned sessions from localStorage
  syncSessionsWithBackend: (validSessionIds: Set<string>) => void;

  // Agent actions
  addAgent: (sessionId: string, agent: Agent) => void;
  removeAgent: (sessionId: string, agentId: string) => void;
  updateAgent: (sessionId: string, agentId: string, updates: Partial<Agent>) => void;
  setActiveAgent: (sessionId: string, agentId: string | null) => void;
  updateAgentPosition: (
    sessionId: string,
    agentId: string,
    position: Partial<AgentPosition>
  ) => void;
  updateAgentGridSpan: (sessionId: string, agentId: string, gridSpan: GridSpan) => void;
  bringAgentToFront: (sessionId: string, agentId: string) => void;

  // Conversation session actions
  createConversationSession: (
    sessionId: string,
    options?: { name?: string; firstMessage?: string }
  ) => ConversationSession;
  updateConversationSession: (
    sessionId: string,
    conversationId: string,
    updates: Partial<Pick<ConversationSession, 'name'>>
  ) => void;
  deleteConversationSession: (sessionId: string, conversationId: string) => void;
  attachConversationToAgent: (sessionId: string, conversationId: string, agentId: string) => void;
  detachConversationFromAgent: (sessionId: string, conversationId: string) => void;
  addConversationMessage: (
    sessionId: string,
    conversationId: string,
    message: AgentMessage
  ) => void;
  /**
   * Atomically merge new messages into a conversation's existing messages.
   * This is safe from race conditions unlike read-modify-write patterns.
   */
  mergeConversationMessages: (
    sessionId: string,
    conversationId: string,
    newMessages: AgentMessage[]
  ) => void;
  deleteConversationMessage: (sessionId: string, conversationId: string, messageId: string) => void;
  updateConversationMessageId: (
    sessionId: string,
    conversationId: string,
    oldId: string,
    newId: string
  ) => void;
  /** Get the conversation attached to an agent, if any */
  getConversationForAgent: (sessionId: string, agentId: string) => ConversationSession | null;
  /** Get all available (unattached) conversations for a session */
  getAvailableConversations: (sessionId: string) => ConversationSession[];
  /** Handle a WebSocket conversation event (created, updated, deleted, attached, detached) */
  handleConversationEvent: (
    sessionId: string,
    event: string,
    data: Record<string, unknown>
  ) => void;
  /** Replace all conversations for a session from backend source of truth */
  setConversationSessions: (sessionId: string, conversations: ConversationSession[]) => void;

  // File preview actions
  openFilePreview: (
    sessionId: string,
    pathOrPreview: string | FilePreview,
    options?: { startLine?: number; endLine?: number }
  ) => void;
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

  // Preview grid card actions (live preview in grid)
  createPreviewGridCard: (sessionId: string) => string;
  removePreviewGridCard: (sessionId: string) => void;
  updatePreviewGridSpan: (sessionId: string, gridSpan: GridSpan) => void;
  updatePreviewFreeformPosition: (sessionId: string, position: Partial<AgentPosition>) => void;

  // Recent files
  addRecentFile: (path: string) => void;
  clearRecentFiles: () => void;

  // View actions
  setViewMode: (sessionId: string, mode: 'grid' | 'focus' | 'freeform') => void;

  // Workspace status actions
  setWorkspaceStatus: (sessionId: string, status: Session['workspaceStatus']) => void;
  setWorkspaceStatusChecking: (sessionId: string, checking: boolean) => void;
  setWorkspaceError: (sessionId: string, error: string | null) => void;
  // Update session workspace ID (for syncing from API when stale in localStorage)
  updateSessionWorkspaceId: (sessionId: string, workspaceId: string) => void;
  updateSessionInfo: (
    sessionId: string,
    updates: Partial<
      Pick<Session, 'name' | 'branch' | 'gitUrl' | 'localPodId' | 'localPodName' | 'mount_path'>
    >
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

  // Streaming message actions (fully delegated to streaming store)
  // These methods are kept for backward compatibility but now delegate entirely
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

const sessionStoreCreator: StateCreator<SessionState> = (set, _get) => ({
  sessions: {},
  currentSessionId: null,
  recentFiles: [],

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

  // Sync sessions with backend - removes orphaned sessions from localStorage
  // This is called on app startup to clean up sessions that were deleted on other devices
  // or directly from the backend
  syncSessionsWithBackend: (validSessionIds: Set<string>) =>
    set((state) => {
      const currentSessions = state.sessions;
      const sessionIdsToRemove: string[] = [];

      // Find sessions in localStorage that don't exist on the backend
      for (const sessionId of Object.keys(currentSessions)) {
        if (!validSessionIds.has(sessionId)) {
          sessionIdsToRemove.push(sessionId);
        }
      }

      // If no sessions to remove, return unchanged state
      if (sessionIdsToRemove.length === 0) {
        return state;
      }

      // Remove orphaned sessions
      const updatedSessions = { ...currentSessions };
      for (const sessionId of sessionIdsToRemove) {
        delete updatedSessions[sessionId];
      }

      // Reset currentSessionId if it was removed
      const newCurrentSessionId =
        state.currentSessionId && sessionIdsToRemove.includes(state.currentSessionId)
          ? null
          : state.currentSessionId;

      console.warn(
        `[SessionSync] Removed ${sessionIdsToRemove.length} orphaned session(s) from localStorage`
      );

      return {
        sessions: updatedSessions,
        currentSessionId: newCurrentSessionId,
      };
    }),

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

      // Detach any conversations that were attached to this agent so they
      // return to the available pool (matches backend detach semantics).
      const updatedConversations = session.conversationSessions.map((c) =>
        c.attachedToAgentId === agentId
          ? { ...c, attachedToAgentId: null, updatedAt: new Date().toISOString() }
          : c
      );

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: session.agents.filter((a) => a.id !== agentId),
            activeAgentId: session.activeAgentId === agentId ? null : session.activeAgentId,
            conversationSessions: updatedConversations,
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
  // Conversation Session Actions
  // ========================================================================

  createConversationSession: (sessionId, options = {}) => {
    // Use crypto.randomUUID() to generate proper UUIDs that are compatible with the database
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Derive name from first message or use provided name or default.
    // NOTE: We intentionally do NOT seed the first message here.
    // Messages are added via optimistic updates + WebSocket events to avoid
    // the first user message appearing twice when the conversation is created.
    const name = options.firstMessage
      ? deriveSessionName(options.firstMessage)
      : options.name || 'New Session';

    const conversation: ConversationSession = {
      id,
      name,
      messages: [],
      attachedToAgentId: null, // Legacy field
      attachedAgentIds: [], // New field for many-to-many
      messageCount: 0,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: [...session.conversationSessions, conversation],
          },
        },
      };
    });

    return conversation;
  },

  updateConversationSession: (sessionId, conversationId, updates) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: session.conversationSessions.map((c) =>
              c.id === conversationId
                ? { ...c, ...updates, updatedAt: new Date().toISOString() }
                : c
            ),
          },
        },
      };
    }),

  deleteConversationSession: (sessionId, conversationId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      // Also clear the reference from any agent that had this conversation
      const updatedAgents = session.agents.map((a) =>
        a.conversationSessionId === conversationId ? { ...a, conversationSessionId: null } : a
      );

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: updatedAgents,
            conversationSessions: session.conversationSessions.filter(
              (c) => c.id !== conversationId
            ),
          },
        },
      };
    }),

  attachConversationToAgent: (sessionId, conversationId, agentId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      // Update conversation to include agent in attached list
      const updatedConversations = session.conversationSessions.map((c) => {
        if (c.id !== conversationId) return c;
        const attachedAgentIds = c.attachedAgentIds || [];
        if (!attachedAgentIds.includes(agentId)) {
          return {
            ...c,
            attachedToAgentId: c.attachedToAgentId || agentId, // Legacy field
            attachedAgentIds: [...attachedAgentIds, agentId],
            updatedAt: new Date().toISOString(),
          };
        }
        return c;
      });

      // Update agent to point to conversation
      const updatedAgents = session.agents.map((a) =>
        a.id === agentId ? { ...a, conversationSessionId: conversationId } : a
      );

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: updatedAgents,
            conversationSessions: updatedConversations,
          },
        },
      };
    }),

  detachConversationFromAgent: (sessionId, conversationId, agentId?: string) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      const conversation = session.conversationSessions.find((c) => c.id === conversationId);
      if (!conversation) return state;

      // Determine which agent to detach from
      const targetAgentId = agentId || conversation.attachedToAgentId;
      if (!targetAgentId) return state;

      // Remove agent from attached list
      const attachedAgentIds = (conversation.attachedAgentIds || []).filter(
        (id) => id !== targetAgentId
      );

      // Update conversation
      const updatedConversations = session.conversationSessions.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              attachedToAgentId: attachedAgentIds.length > 0 ? (attachedAgentIds[0] ?? null) : null, // Legacy field
              attachedAgentIds: attachedAgentIds,
              updatedAt: new Date().toISOString(),
            }
          : c
      );

      // Clear agent's conversation reference if this was its conversation
      const updatedAgents = session.agents.map((a) =>
        a.id === targetAgentId && a.conversationSessionId === conversationId
          ? { ...a, conversationSessionId: null }
          : a
      );

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            agents: updatedAgents,
            conversationSessions: updatedConversations,
          },
        },
      };
    }),

  addConversationMessage: (sessionId, conversationId, message) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: session.conversationSessions.map((c) => {
              if (c.id !== conversationId) return c;

              // Deduplication: check if message already exists by ID
              if (c.messages.some((m) => m.id === message.id)) {
                return c;
              }

              // Deduplication: for user messages with temp IDs
              if (message.role === 'user' && message.id.startsWith('temp-')) {
                const existingRealMessage = c.messages.find(
                  (m) =>
                    m.role === 'user' && m.content === message.content && !m.id.startsWith('temp-')
                );
                if (existingRealMessage) return c;
              }

              // Deduplication: replace temp with real for user messages
              if (message.role === 'user' && !message.id.startsWith('temp-')) {
                const existingTempMessage = c.messages.find(
                  (m) =>
                    m.role === 'user' && m.content === message.content && m.id.startsWith('temp-')
                );
                if (existingTempMessage) {
                  return {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === existingTempMessage.id ? { ...m, id: message.id } : m
                    ),
                  };
                }
              }

              // Deduplication: for assistant messages by content within time window
              if (message.role === 'assistant') {
                const now = message.timestamp?.getTime() ?? Date.now();
                const timeWindow = 10000;
                const existingByContent = c.messages.find((m) => {
                  if (m.role !== 'assistant' || m.content !== message.content) return false;
                  const msgTime = m.timestamp?.getTime() ?? 0;
                  return Math.abs(now - msgTime) < timeWindow;
                });
                if (existingByContent) {
                  if (existingByContent.id !== message.id) {
                    return {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === existingByContent.id ? { ...m, id: message.id } : m
                      ),
                    };
                  }
                  return c;
                }
              }

              // Add message and enforce limit
              const newMessages = [...c.messages, message];
              const limitedMessages =
                newMessages.length > MAX_MESSAGES_PER_CONVERSATION
                  ? newMessages.slice(-MAX_MESSAGES_PER_CONVERSATION)
                  : newMessages;

              // Update name from first message if still "New Session"
              const name =
                c.name === 'New Session' && limitedMessages.length === 1
                  ? deriveSessionName(message.content)
                  : c.name;

              return {
                ...c,
                name,
                messages: limitedMessages,
                messageCount: limitedMessages.length,
                lastMessageAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            }),
          },
        },
      };
    }),

  mergeConversationMessages: (sessionId, conversationId, newMessages) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: session.conversationSessions.map((c) => {
              if (c.id !== conversationId) return c;

              // Deduplicate within newMessages
              const seenInBatch = new Set<string>();
              const dedupedNewMessages = newMessages.filter((m) => {
                if (!m.id) return true;
                if (seenInBatch.has(m.id)) return false;
                seenInBatch.add(m.id);
                return true;
              });

              // Filter out existing messages
              const existingIds = new Set(c.messages.map((m) => m.id).filter(Boolean));
              const uniqueNewMessages = dedupedNewMessages.filter(
                (m) => !m.id || !existingIds.has(m.id)
              );

              if (uniqueNewMessages.length === 0) return c;

              // Merge and sort
              const merged = [...c.messages, ...uniqueNewMessages];
              merged.sort((x, y) => {
                const timeA = x.timestamp
                  ? new Date(x.timestamp).getTime()
                  : Number.MAX_SAFE_INTEGER;
                const timeB = y.timestamp
                  ? new Date(y.timestamp).getTime()
                  : Number.MAX_SAFE_INTEGER;
                return timeA - timeB;
              });

              // Final dedup pass
              const finalIds = new Set<string>();
              const deduped = merged.filter((m) => {
                if (!m.id) return true;
                if (finalIds.has(m.id)) return false;
                finalIds.add(m.id);
                return true;
              });

              // Enforce limit
              const limitedMessages =
                deduped.length > MAX_MESSAGES_PER_CONVERSATION
                  ? deduped.slice(-MAX_MESSAGES_PER_CONVERSATION)
                  : deduped;

              return {
                ...c,
                messages: limitedMessages,
                messageCount: limitedMessages.length,
                lastMessageAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
            }),
          },
        },
      };
    }),

  deleteConversationMessage: (sessionId, conversationId, messageId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: session.conversationSessions.map((c) => {
              if (c.id !== conversationId) return c;
              const filteredMessages = c.messages.filter((m) => m.id !== messageId);
              return {
                ...c,
                messages: filteredMessages,
                messageCount: filteredMessages.length,
                updatedAt: new Date().toISOString(),
              };
            }),
          },
        },
      };
    }),

  updateConversationMessageId: (sessionId, conversationId, oldId, newId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: session.conversationSessions.map((c) => {
              if (c.id !== conversationId) return c;
              return {
                ...c,
                messages: c.messages.map((m) => (m.id === oldId ? { ...m, id: newId } : m)),
              };
            }),
          },
        },
      };
    }),

  getConversationForAgent: (sessionId, agentId) => {
    const state = useSessionStore.getState();
    const session = state.sessions[sessionId];
    if (!session) return null;

    const agent = session.agents.find((a) => a.id === agentId);
    if (!agent?.conversationSessionId) return null;

    return session.conversationSessions.find((c) => c.id === agent.conversationSessionId) ?? null;
  },

  getAvailableConversations: (sessionId) => {
    const state = useSessionStore.getState();
    const session = state.sessions[sessionId];
    if (!session) return [];

    // Return conversations that are not attached to any agent
    return session.conversationSessions.filter((c) => c.attachedToAgentId === null);
  },

  handleConversationEvent: (sessionId, event, data) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      switch (event) {
        case 'conversation_created': {
          const convData = data.conversation as ConversationSession;
          // Don't add if already exists
          if (session.conversationSessions.some((c) => c.id === convData.id)) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                conversationSessions: [
                  ...session.conversationSessions,
                  { ...convData, messages: [] },
                ],
              },
            },
          };
        }

        case 'conversation_updated': {
          const convData = data.conversation as Partial<ConversationSession> & { id: string };
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                conversationSessions: session.conversationSessions.map((c) => {
                  if (c.id !== convData.id) return c;
                  const base = { ...c, ...convData };
                  return {
                    ...base,
                    attachedToAgentId: base.attachedToAgentId ?? c.attachedToAgentId ?? null,
                  };
                }),
              },
            },
          };
        }

        case 'conversation_deleted': {
          const convId = data.conversation_id as string;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                agents: session.agents.map((a) =>
                  a.conversationSessionId === convId ? { ...a, conversationSessionId: null } : a
                ),
                conversationSessions: session.conversationSessions.filter((c) => c.id !== convId),
              },
            },
          };
        }

        case 'conversation_attached': {
          const convId = data.conversation_id as string;
          const agentId = data.agent_id as string;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                agents: session.agents.map((a) =>
                  a.id === agentId ? { ...a, conversationSessionId: convId } : a
                ),
                conversationSessions: session.conversationSessions.map((c) => {
                  if (c.id !== convId) return c;
                  // Add agent to attached list if not already present
                  const attachedAgentIds = c.attachedAgentIds || [];
                  if (!attachedAgentIds.includes(agentId)) {
                    return {
                      ...c,
                      attachedToAgentId: c.attachedToAgentId || agentId, // Legacy field
                      attachedAgentIds: [...attachedAgentIds, agentId],
                    };
                  }
                  return c;
                }),
              },
            },
          };
        }

        case 'conversation_detached': {
          const convId = data.conversation_id as string;
          const prevAgentId = data.previous_agent_id as string | undefined;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                ...session,
                agents: prevAgentId
                  ? session.agents.map((a) =>
                      a.id === prevAgentId ? { ...a, conversationSessionId: null } : a
                    )
                  : session.agents,
                conversationSessions: session.conversationSessions.map((c) => {
                  if (c.id !== convId) return c;
                  // Remove agent from attached list
                  const attachedAgentIds = (c.attachedAgentIds || []).filter(
                    (id) => id !== prevAgentId
                  );
                  return {
                    ...c,
                    attachedToAgentId:
                      attachedAgentIds.length > 0 ? (attachedAgentIds[0] ?? null) : null, // Legacy
                    attachedAgentIds: attachedAgentIds,
                  };
                }),
              },
            },
          };
        }

        case 'conversation_message': {
          // This case is no longer used - WebSocket handlers now call addConversationMessage directly
          // Keeping for backward compatibility but it does nothing
          return state;
        }

        default:
          return state;
      }
    }),

  setConversationSessions: (sessionId, conversations) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            conversationSessions: conversations,
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

  openFilePreview: (sessionId, pathOrPreview, options) =>
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
              startLine: options?.startLine,
              endLine: options?.endLine,
            }
          : pathOrPreview;

      // If file already exists, update it with new line numbers and return
      const existingIdx = session.filePreviews.findIndex((p) => p.path === preview.path);
      if (existingIdx >= 0) {
        // Update existing preview with new line numbers
        const updatedPreviews = [...session.filePreviews];
        updatedPreviews[existingIdx] = {
          ...updatedPreviews[existingIdx]!,
          startLine: options?.startLine,
          endLine: options?.endLine,
        };
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              filePreviews: updatedPreviews,
            },
          },
        };
      }

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
  // Preview Grid Card Actions
  // ========================================================================

  createPreviewGridCard: (sessionId) => {
    const id = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            previewGridCardId: id,
            previewGridSpan: { colSpan: 2, rowSpan: 2 },
          },
        },
      };
    });
    return id;
  },

  removePreviewGridCard: (sessionId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            previewGridCardId: null,
            previewGridSpan: undefined,
          },
        },
      };
    }),

  updatePreviewGridSpan: (sessionId, gridSpan) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            previewGridSpan: gridSpan,
          },
        },
      };
    }),

  updatePreviewFreeformPosition: (sessionId, position) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const currentPosition = session.previewFreeformPosition ?? {
        x: 150,
        y: 150,
        width: 500,
        height: 400,
        zIndex: 1,
      };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            previewFreeformPosition: { ...currentPosition, ...position },
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

  setWorkspaceStatus: (sessionId, status) =>
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

  setWorkspaceError: (sessionId, error) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            workspaceError: error,
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
  // Fully delegated to streaming store
  // ========================================================================

  startStreamingMessage: (sessionId, agentId, messageId) => {
    useStreamingStore.getState().startStreamingMessage(sessionId, agentId, messageId);
  },

  appendStreamingToken: (messageId, token) => {
    useStreamingStore.getState().appendStreamingToken(messageId, token);
  },

  appendThinkingToken: (messageId, thinking) => {
    useStreamingStore.getState().appendThinkingToken(messageId, thinking);
  },

  finalizeStreamingMessage: (messageId, fullContent, toolCalls) => {
    // Get streaming data from streaming store before completing
    const streaming = useStreamingStore.getState().getStreamingMessage(messageId);

    // Complete in streaming store (removes from streaming messages)
    useStreamingStore.getState().completeStreaming(messageId, fullContent, toolCalls);

    // If no streaming data found, nothing to finalize
    if (!streaming) return;

    // Add the finalized message to the agent's conversation session
    set((state) => {
      const session = state.sessions[streaming.sessionId];
      if (!session) return state;

      // Find the agent and its attached conversation
      const agent = session.agents.find((a) => a.id === streaming.agentId);
      if (!agent?.conversationSessionId) return state;

      const conversationIndex = session.conversationSessions.findIndex(
        (c) => c.id === agent.conversationSessionId
      );
      if (conversationIndex === -1) return state;

      const conversation = session.conversationSessions[conversationIndex];
      if (!conversation) return state; // Guard for TypeScript

      // Deduplication: check if message already exists by ID
      if (conversation.messages.some((m) => m.id === messageId)) {
        return state;
      }

      const newMessage: AgentMessage = {
        id: messageId,
        role: 'assistant',
        content: fullContent,
        thinking: streaming.thinkingContent || undefined,
        timestamp: new Date(),
        toolCalls: toolCalls,
      };

      // Enforce message limit per conversation
      const newMessages = [...conversation.messages, newMessage];
      const limitedMessages =
        newMessages.length > MAX_MESSAGES_PER_CONVERSATION
          ? newMessages.slice(-MAX_MESSAGES_PER_CONVERSATION)
          : newMessages;

      const now = new Date().toISOString();
      const updatedConversation: ConversationSession = {
        ...conversation,
        messages: limitedMessages,
        messageCount: limitedMessages.length,
        lastMessageAt: now,
        updatedAt: now,
      };

      const updatedConversationSessions = [...session.conversationSessions];
      updatedConversationSessions[conversationIndex] = updatedConversation;

      return {
        sessions: {
          ...state.sessions,
          [streaming.sessionId]: {
            ...session,
            conversationSessions: updatedConversationSessions,
          },
        },
      };
    });
  },

  getStreamingMessage: (messageId) => useStreamingStore.getState().getStreamingMessage(messageId),
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
    // NOTE: Backend is always the source of truth for agents, conversations, and messages.
    // localStorage is only used for UI state (viewMode, positions, filePreviews).
    // When loading a session, we always fetch fresh data from the backend and replace
    // any localStorage data. WebSocket events keep sessions in sync across windows/tabs.
    sessions: Object.fromEntries(
      Object.entries(state.sessions).map(([id, session]) => [
        id,
        {
          ...session,
          // Agents no longer have messages - they reference conversation sessions
          // Backend data (id, name, role, model, status, conversationSessionId) always wins
          agents: session.agents,
          // Limit messages per conversation for persistence (for offline/quick load)
          // But backend fetch always replaces this with fresh data
          conversationSessions: (session.conversationSessions ?? []).map((conv) => ({
            ...conv,
            messages: conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION),
          })),
          // Limit file previews (don't persist content, just metadata)
          filePreviews: (session.filePreviews ?? []).slice(0, 20).map((fp) => ({
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
