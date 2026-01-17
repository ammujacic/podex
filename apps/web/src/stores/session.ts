import { create, type StateCreator } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { isCriticallyFull, isNearQuota, cleanupByPrefix } from '@/lib/storageQuota';
import type { ThinkingConfig } from '@podex/shared';

export interface AgentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface GridSpan {
  colSpan: number; // 1-3 columns
  rowSpan: number; // 1-2 rows
}

// Agent permission modes
export type AgentMode = 'plan' | 'ask' | 'auto' | 'sovereign';

export interface Agent {
  id: string;
  name: string;
  role:
    | 'architect'
    | 'coder'
    | 'reviewer'
    | 'tester'
    | 'agent_builder'
    | 'orchestrator'
    | 'chat'
    | 'security'
    | 'devops'
    | 'documentator'
    | 'custom';
  model: string;
  modelDisplayName?: string; // User-friendly model name from backend
  status: 'idle' | 'active' | 'error';
  color: string;
  messages: AgentMessage[];
  position?: AgentPosition;
  gridSpan?: GridSpan;
  templateId?: string; // Reference to custom agent template
  terminalSessionId?: string; // For terminal-integrated agents
  terminalAgentTypeId?: string; // The type ID of the terminal agent (for restarts)
  // Agent mode and command permissions
  mode: AgentMode;
  previousMode?: AgentMode; // For auto-revert tracking when mode is auto-switched
  commandAllowlist?: string[]; // Allowed commands for Auto mode (glob patterns)
  // Extended thinking configuration
  thinkingConfig?: ThinkingConfig;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Agent's thinking/reasoning process (collapsible)
  timestamp: Date;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

// Streaming message state for real-time token display
export interface StreamingMessage {
  messageId: string;
  agentId: string;
  sessionId: string;
  content: string; // Accumulated tokens
  thinkingContent: string; // Accumulated thinking tokens
  isStreaming: boolean;
  startedAt: Date;
}

export interface FilePreview {
  id: string;
  path: string;
  content: string;
  language: string;
  pinned: boolean;
  position: { x: number; y: number; width?: number; height?: number; zIndex?: number };
  gridSpan?: GridSpan;
  docked: boolean; // If true, shows in the main grid/freeform area. If false, floats as overlay.
}

export interface StandbySettings {
  timeoutMinutes: number | null; // null = Never
  source: 'session' | 'user_default';
}

export interface Session {
  id: string;
  name: string;
  workspaceId: string;
  branch: string;
  agents: Agent[];
  filePreviews: FilePreview[];
  activeAgentId: string | null;
  viewMode: 'grid' | 'focus' | 'freeform';
  // Workspace status tracking
  workspaceStatus: 'pending' | 'running' | 'standby' | 'stopped' | 'error';
  standbyAt: string | null;
  standbySettings: StandbySettings | null;
}

interface SessionState {
  sessions: Record<string, Session>;
  currentSessionId: string | null;
  recentFiles: string[]; // List of recently opened file paths
  streamingMessages: Record<string, StreamingMessage>; // Keyed by messageId

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
  setStandbySettings: (sessionId: string, settings: StandbySettings | null) => void;

  // Agent mode auto-switch actions
  handleAutoModeSwitch: (
    sessionId: string,
    agentId: string,
    newMode: AgentMode,
    previousMode: AgentMode | null
  ) => void;

  // Extended thinking config action
  updateAgentThinking: (sessionId: string, agentId: string, thinkingConfig: ThinkingConfig) => void;

  // Streaming message actions
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

// Helper to get file extension language
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };
  return languageMap[ext] || 'plaintext';
}

// Maximum number of messages to keep per agent to prevent localStorage overflow
const MAX_MESSAGES_PER_AGENT = 100;
// Maximum number of recent files to keep
const MAX_RECENT_FILES = 50;

const sessionStoreCreator: StateCreator<SessionState> = (set, get) => ({
  sessions: {},
  currentSessionId: null,
  recentFiles: [],
  streamingMessages: {},

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
              // check if a real message with same content already exists (race condition fix)
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
              // (streaming messages finalized and then agent_message arrives)
              if (message.role === 'assistant') {
                const existingByContent = a.messages.find(
                  (m) => m.role === 'assistant' && m.content === message.content
                );
                if (existingByContent) {
                  // Update the ID to the real one if different (for audio playback to work)
                  if (existingByContent.id !== message.id) {
                    return {
                      ...a,
                      messages: a.messages.map((m) =>
                        m.id === existingByContent.id ? { ...m, id: message.id } : m
                      ),
                    };
                  }
                  return a; // Same content already exists, don't add duplicate
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

  addRecentFile: (path) =>
    set((state) => ({
      recentFiles: [path, ...state.recentFiles.filter((p) => p !== path)].slice(0, 20),
    })),

  clearRecentFiles: () => set({ recentFiles: [] }),

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
            standbyAt: standbyAt ?? null,
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
          [sessionId]: { ...session, standbySettings: settings },
        },
      };
    }),

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
                    // Store previous mode for auto-revert, or clear it if this is a revert
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

  // Streaming message actions
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

  finalizeStreamingMessage: (messageId, fullContent, toolCalls) =>
    set((state) => {
      const streaming = state.streamingMessages[messageId];
      if (!streaming) return state;

      // Remove from streaming messages
      const { [messageId]: _removed, ...remainingStreaming } = state.streamingMessages;

      // Add as a completed message to the agent
      const session = state.sessions[streaming.sessionId];
      if (!session) {
        return { streamingMessages: remainingStreaming };
      }

      const newMessage: AgentMessage = {
        id: messageId,
        role: 'assistant',
        content: fullContent,
        thinking: streaming.thinkingContent || undefined, // Include thinking if present
        timestamp: new Date(),
        toolCalls: toolCalls, // Include tool calls from streaming
      };

      return {
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
      };
    }),

  getStreamingMessage: (messageId) => get().streamingMessages[messageId],
});

// Debounced storage adapter to prevent excessive localStorage writes
// Uses requestIdleCallback when available for better performance
// Compatible with Zustand's persist middleware StorageValue format
type StorageValue<T> = { state: T; version?: number };
type PersistStorage<T> = {
  getItem: (name: string) => StorageValue<T> | null | Promise<StorageValue<T> | null>;
  setItem: (name: string, value: StorageValue<T>) => void | Promise<void>;
  removeItem: (name: string) => void | Promise<void>;
};

type PartializedSessionState = {
  currentSessionId: string | null;
  sessions: Record<string, Session>;
  recentFiles: string[];
};

const createDebouncedStorage = (
  debounceMs: number = 1000
): PersistStorage<PartializedSessionState> => {
  let pendingWrite: string | null = null;
  let writeTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastWriteTime = 0;

  const scheduleWrite = (key: string, value: string) => {
    pendingWrite = value;

    // Clear any existing timeout
    if (writeTimeout) {
      clearTimeout(writeTimeout);
    }

    // Calculate time since last write
    const timeSinceLastWrite = Date.now() - lastWriteTime;

    // If it's been long enough, write immediately using idle callback
    if (timeSinceLastWrite >= debounceMs) {
      const doWrite = () => {
        if (pendingWrite !== null) {
          // Check quota before writing
          if (isCriticallyFull()) {
            console.warn('localStorage critically full, attempting cleanup...');
            // Try to cleanup old session data to make room
            const cleaned = cleanupByPrefix('podex-sessions', 5);
            if (cleaned > 0) {
              console.info(`Cleaned up ${cleaned} old session entries`);
            }
          }

          try {
            localStorage.setItem(key, pendingWrite);
            lastWriteTime = Date.now();
          } catch (e) {
            console.warn('Failed to persist session state:', e);
            // If write failed due to quota, try cleanup and retry once
            if (e instanceof Error && e.name === 'QuotaExceededError') {
              cleanupByPrefix('podex-sessions', 3);
              try {
                localStorage.setItem(key, pendingWrite);
                lastWriteTime = Date.now();
              } catch {
                console.error('Failed to persist session state even after cleanup');
              }
            }
          }
          pendingWrite = null;
        }
      };

      // Use requestIdleCallback if available for non-blocking writes
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(doWrite, { timeout: 100 });
      } else {
        doWrite();
      }
    } else {
      // Otherwise, schedule a debounced write
      writeTimeout = setTimeout(() => {
        if (pendingWrite !== null) {
          // Check quota before writing
          if (isNearQuota(0.9)) {
            console.warn('localStorage near quota, cleaning up old sessions...');
            cleanupByPrefix('podex-sessions', 5);
          }

          try {
            localStorage.setItem(key, pendingWrite);
            lastWriteTime = Date.now();
          } catch (e) {
            console.warn('Failed to persist session state:', e);
          }
          pendingWrite = null;
        }
        writeTimeout = null;
      }, debounceMs - timeSinceLastWrite);
    }
  };

  return {
    getItem: (name: string): StorageValue<PartializedSessionState> | null => {
      try {
        const value = localStorage.getItem(name);
        if (!value) return null;
        return JSON.parse(value) as StorageValue<PartializedSessionState>;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: StorageValue<PartializedSessionState>): void => {
      try {
        scheduleWrite(name, JSON.stringify(value));
      } catch {
        // Ignore serialization errors
      }
    },
    removeItem: (name: string): void => {
      // Immediate removal
      if (writeTimeout) {
        clearTimeout(writeTimeout);
        writeTimeout = null;
      }
      pendingWrite = null;
      try {
        localStorage.removeItem(name);
      } catch {
        // Ignore removal errors
      }
    },
  };
};

const persistedSessionStore = persist(sessionStoreCreator, {
  name: 'podex-sessions',
  // Use debounced storage to prevent excessive writes during rapid updates
  storage: createDebouncedStorage(1000),
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

// Only enable devtools in development to prevent exposing message data in production
export const useSessionStore = create<SessionState>()(
  devtools(persistedSessionStore, {
    name: 'podex-sessions',
    enabled: process.env.NODE_ENV === 'development',
  })
);
