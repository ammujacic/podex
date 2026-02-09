import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { type PendingApproval } from '@/lib/api';

export interface ApprovalRequest {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  actionType: 'file_write' | 'command_execute';
  actionDetails: {
    toolName?: string;
    filePath?: string;
    command?: string;
    arguments?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: Date;
  createdAt: Date;
}

interface ApprovalsState {
  // Pending approvals per session (sessionId -> approvals)
  pendingApprovals: Record<string, ApprovalRequest[]>;

  // Currently active approval dialog
  activeApproval: ApprovalRequest | null;

  // Actions
  addApproval: (approval: ApprovalRequest) => void;
  removeApproval: (sessionId: string, approvalId: string) => void;
  clearSessionApprovals: (sessionId: string) => void;
  clearAgentApprovals: (sessionId: string, agentId: string) => void;
  setActiveApproval: (approval: ApprovalRequest | null) => void;
  updateApprovalStatus: (
    sessionId: string,
    approvalId: string,
    status: ApprovalRequest['status']
  ) => void;

  // Selectors
  getSessionApprovals: (sessionId: string) => ApprovalRequest[];
  getAgentApprovals: (sessionId: string, agentId: string) => ApprovalRequest[];
  getApprovalCount: (sessionId: string) => number;
  hasApprovals: (sessionId: string) => boolean;
}

export const useApprovalsStore = create<ApprovalsState>()(
  devtools(
    (set, get) => ({
      pendingApprovals: {},
      activeApproval: null,

      addApproval: (approval) =>
        set((state) => {
          const sessionApprovals = state.pendingApprovals[approval.sessionId] || [];
          // Avoid duplicates
          if (sessionApprovals.some((a) => a.id === approval.id)) {
            return state;
          }
          return {
            pendingApprovals: {
              ...state.pendingApprovals,
              [approval.sessionId]: [...sessionApprovals, approval],
            },
            // Auto-show approval dialog for the first pending approval
            activeApproval: state.activeApproval ?? approval,
          };
        }),

      removeApproval: (sessionId, approvalId) =>
        set((state) => {
          const sessionApprovals = state.pendingApprovals[sessionId] || [];
          const updatedApprovals = sessionApprovals.filter((a) => a.id !== approvalId);

          // If we removed the active approval, show the next one
          let newActiveApproval = state.activeApproval;
          if (state.activeApproval?.id === approvalId) {
            newActiveApproval = updatedApprovals.find((a) => a.status === 'pending') ?? null;
          }

          return {
            pendingApprovals: {
              ...state.pendingApprovals,
              [sessionId]: updatedApprovals,
            },
            activeApproval: newActiveApproval,
          };
        }),

      clearSessionApprovals: (sessionId) =>
        set((state) => {
          const { [sessionId]: _removed, ...remaining } = state.pendingApprovals;
          return {
            pendingApprovals: remaining,
            activeApproval:
              state.activeApproval?.sessionId === sessionId ? null : state.activeApproval,
          };
        }),

      clearAgentApprovals: (sessionId, agentId) =>
        set((state) => {
          const sessionApprovals = state.pendingApprovals[sessionId] || [];
          const updatedApprovals = sessionApprovals.filter((a) => a.agentId !== agentId);

          let newActiveApproval = state.activeApproval;
          if (state.activeApproval?.agentId === agentId) {
            newActiveApproval = updatedApprovals.find((a) => a.status === 'pending') ?? null;
          }

          return {
            pendingApprovals: {
              ...state.pendingApprovals,
              [sessionId]: updatedApprovals,
            },
            activeApproval: newActiveApproval,
          };
        }),

      setActiveApproval: (approval) => set({ activeApproval: approval }),

      updateApprovalStatus: (sessionId, approvalId, status) => {
        // Track timeout for cleanup
        const timeoutId =
          status !== 'pending'
            ? window.setTimeout(() => {
                // Check if store still has this approval before removing
                const currentState = get();
                const approvals = currentState.pendingApprovals[sessionId] || [];
                if (approvals.some((a) => a.id === approvalId)) {
                  currentState.removeApproval(sessionId, approvalId);
                }
              }, 500)
            : undefined;

        set((state) => {
          const sessionApprovals = state.pendingApprovals[sessionId] || [];
          const updatedApprovals = sessionApprovals.map((a) =>
            a.id === approvalId ? { ...a, status } : a
          );

          return {
            pendingApprovals: {
              ...state.pendingApprovals,
              [sessionId]: updatedApprovals,
            },
          };
        });

        // Return cleanup function (though not typically used in Zustand)
        return () => {
          if (timeoutId) window.clearTimeout(timeoutId);
        };
      },

      getSessionApprovals: (sessionId) => {
        const state = get();
        return state.pendingApprovals[sessionId] || [];
      },

      getAgentApprovals: (sessionId, agentId) => {
        const state = get();
        const sessionApprovals = state.pendingApprovals[sessionId] || [];
        return sessionApprovals.filter((a) => a.agentId === agentId);
      },

      getApprovalCount: (sessionId) => {
        const state = get();
        const sessionApprovals = state.pendingApprovals[sessionId] || [];
        return sessionApprovals.filter((a) => a.status === 'pending').length;
      },

      hasApprovals: (sessionId) => {
        return get().getApprovalCount(sessionId) > 0;
      },
    }),
    { name: 'approvals' }
  )
);

// Helper function to convert API response to store format
export function apiApprovalToStoreApproval(
  apiApproval: PendingApproval,
  agentName: string
): ApprovalRequest {
  return {
    id: apiApproval.id,
    agentId: apiApproval.agent_id,
    agentName,
    sessionId: apiApproval.session_id,
    actionType: apiApproval.action_type,
    actionDetails: {
      toolName: apiApproval.action_details.tool_name,
      filePath: apiApproval.action_details.file_path,
      command: apiApproval.action_details.command,
      arguments: apiApproval.action_details.arguments,
    },
    status: apiApproval.status,
    expiresAt: new Date(apiApproval.expires_at),
    createdAt: new Date(apiApproval.created_at),
  };
}
