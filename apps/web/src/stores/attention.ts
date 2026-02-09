/**
 * Zustand store for agent attention notifications.
 *
 * Manages attention items that indicate when agents need user attention
 * (approval, completion, errors, waiting for input).
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { AgentAttentionType, AgentAttentionPriority } from '@/lib/socket';

export interface AgentAttention {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  type: AgentAttentionType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  priority: AgentAttentionPriority;
  read: boolean;
  dismissed: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

interface AttentionState {
  // Attention items by session
  attentionsBySession: Record<string, AgentAttention[]>;

  // Unread count per session (cached for performance)
  unreadCountBySession: Record<string, number>;

  // TTS announcement settings
  ttsEnabled: boolean;
  announcePriorities: AgentAttentionPriority[];

  // Panel visibility
  panelOpen: boolean;

  // Focus tracking for auto-read
  focusedAgentId: string | null;
  focusedSessionId: string | null;

  // Actions
  addAttention: (attention: AgentAttention) => void;
  markAsRead: (sessionId: string, attentionId: string) => void;
  markAllAsReadForSession: (sessionId: string) => void;
  markAllAsReadForAgent: (sessionId: string, agentId: string) => void;
  dismissAttention: (sessionId: string, attentionId: string) => void;
  dismissAllForAgent: (sessionId: string, agentId: string) => void;
  dismissAllForSession: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;

  // Focus tracking actions
  setFocusedAgent: (sessionId: string | null, agentId: string | null) => void;

  // Panel actions
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Settings
  setTTSEnabled: (enabled: boolean) => void;
  setAnnouncePriorities: (priorities: AgentAttentionPriority[]) => void;

  // Selectors (computed values)
  getAttentionsForSession: (sessionId: string) => AgentAttention[];
  getAttentionsForAgent: (sessionId: string, agentId: string) => AgentAttention[];
  getUnreadCount: (sessionId: string) => number;
  getUnreadCountForAgent: (sessionId: string, agentId: string) => number;
  hasAttentionForAgent: (sessionId: string, agentId: string) => boolean;
  hasUnreadForAgent: (sessionId: string, agentId: string) => boolean;
  getHighestPriorityAttention: (sessionId: string, agentId: string) => AgentAttention | null;
}

// Helper to calculate unread count
function calculateUnreadCount(attentions: AgentAttention[]): number {
  return attentions.filter((a) => !a.read && !a.dismissed).length;
}

// Priority order for sorting (lower = higher priority)
const PRIORITY_ORDER: Record<AgentAttentionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const useAttentionStore = create<AttentionState>()(
  devtools(
    persist(
      (set, get) => ({
        attentionsBySession: {},
        unreadCountBySession: {},
        ttsEnabled: true,
        announcePriorities: ['high', 'critical'],
        panelOpen: false,
        focusedAgentId: null,
        focusedSessionId: null,

        addAttention: (attention) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[attention.sessionId] || [];

            // Avoid duplicates
            if (sessionAttentions.some((a) => a.id === attention.id)) {
              return state;
            }

            const newAttentions = [attention, ...sessionAttentions];
            const unreadCount = calculateUnreadCount(newAttentions);

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [attention.sessionId]: newAttentions,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [attention.sessionId]: unreadCount,
              },
            };
          }),

        markAsRead: (sessionId, attentionId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) =>
              a.id === attentionId ? { ...a, read: true } : a
            );
            const unreadCount = calculateUnreadCount(updated);

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: unreadCount,
              },
            };
          }),

        markAllAsReadForSession: (sessionId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) => (!a.dismissed ? { ...a, read: true } : a));

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: 0,
              },
            };
          }),

        markAllAsReadForAgent: (sessionId, agentId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) =>
              a.agentId === agentId && !a.dismissed ? { ...a, read: true } : a
            );
            const unreadCount = calculateUnreadCount(updated);

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: unreadCount,
              },
            };
          }),

        dismissAttention: (sessionId, attentionId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) =>
              a.id === attentionId ? { ...a, dismissed: true } : a
            );
            const unreadCount = calculateUnreadCount(updated);

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: unreadCount,
              },
            };
          }),

        dismissAllForAgent: (sessionId, agentId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) =>
              a.agentId === agentId ? { ...a, dismissed: true } : a
            );
            const unreadCount = calculateUnreadCount(updated);

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: unreadCount,
              },
            };
          }),

        dismissAllForSession: (sessionId) =>
          set((state) => {
            const sessionAttentions = state.attentionsBySession[sessionId] || [];
            const updated = sessionAttentions.map((a) => ({ ...a, dismissed: true }));

            return {
              attentionsBySession: {
                ...state.attentionsBySession,
                [sessionId]: updated,
              },
              unreadCountBySession: {
                ...state.unreadCountBySession,
                [sessionId]: 0,
              },
            };
          }),

        clearSession: (sessionId) =>
          set((state) => {
            const { [sessionId]: _, ...restAttentions } = state.attentionsBySession;
            const { [sessionId]: __, ...restCounts } = state.unreadCountBySession;

            return {
              attentionsBySession: restAttentions,
              unreadCountBySession: restCounts,
            };
          }),

        setFocusedAgent: (sessionId, agentId) =>
          set({ focusedSessionId: sessionId, focusedAgentId: agentId }),

        openPanel: () => set({ panelOpen: true }),
        closePanel: () => set({ panelOpen: false }),
        togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

        setTTSEnabled: (enabled) => set({ ttsEnabled: enabled }),
        setAnnouncePriorities: (priorities) => set({ announcePriorities: priorities }),

        // Selectors
        getAttentionsForSession: (sessionId) => {
          const state = get();
          return (state.attentionsBySession[sessionId] || []).filter((a) => !a.dismissed);
        },

        getAttentionsForAgent: (sessionId, agentId) => {
          const state = get();
          return (state.attentionsBySession[sessionId] || []).filter(
            (a) => a.agentId === agentId && !a.dismissed
          );
        },

        getUnreadCount: (sessionId) => {
          const state = get();
          return state.unreadCountBySession[sessionId] || 0;
        },

        getUnreadCountForAgent: (sessionId, agentId) => {
          const state = get();
          const attentions = (state.attentionsBySession[sessionId] || []).filter(
            (a) => a.agentId === agentId && !a.read && !a.dismissed
          );
          return attentions.length;
        },

        hasAttentionForAgent: (sessionId, agentId) => {
          const attentions = get().getAttentionsForAgent(sessionId, agentId);
          return attentions.length > 0;
        },

        hasUnreadForAgent: (sessionId, agentId) => {
          return get().getUnreadCountForAgent(sessionId, agentId) > 0;
        },

        getHighestPriorityAttention: (sessionId, agentId) => {
          const attentions = get().getAttentionsForAgent(sessionId, agentId);
          if (attentions.length === 0) return null;

          const sorted = attentions.sort(
            (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
          );
          return sorted[0] ?? null;
        },
      }),
      {
        name: 'podex-attention',
        // Only persist settings, not runtime data
        partialize: (state) => ({
          ttsEnabled: state.ttsEnabled,
          announcePriorities: state.announcePriorities,
        }),
      }
    )
  )
);

// Convenience hooks
export const useAttentionPanel = () =>
  useAttentionStore((state) => ({
    isOpen: state.panelOpen,
    open: state.openPanel,
    close: state.closePanel,
    toggle: state.togglePanel,
  }));

export const useAttentionTTS = () =>
  useAttentionStore((state) => ({
    enabled: state.ttsEnabled,
    priorities: state.announcePriorities,
    setEnabled: state.setTTSEnabled,
    setPriorities: state.setAnnouncePriorities,
  }));
