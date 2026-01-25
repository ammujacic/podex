import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useApprovalsStore, apiApprovalToStoreApproval } from '../approvals';
import type { ApprovalRequest } from '../approvals';
import type { PendingApproval } from '@/lib/api';

// Helper to create mock approval requests
const createMockApproval = (overrides?: Partial<ApprovalRequest>): ApprovalRequest => ({
  id: 'approval-1',
  agentId: 'agent-1',
  agentName: 'Architect',
  sessionId: 'session-1',
  actionType: 'file_write',
  actionDetails: {
    toolName: 'write_file',
    filePath: '/src/components/App.tsx',
    arguments: { content: 'console.log("test")' },
  },
  status: 'pending',
  expiresAt: new Date(Date.now() + 300000), // 5 minutes from now
  createdAt: new Date(),
  ...overrides,
});

const createMockCommandApproval = (overrides?: Partial<ApprovalRequest>): ApprovalRequest => ({
  id: 'approval-cmd-1',
  agentId: 'agent-1',
  agentName: 'Developer',
  sessionId: 'session-1',
  actionType: 'command_execute',
  actionDetails: {
    toolName: 'execute_command',
    command: 'npm install',
    arguments: { cwd: '/workspace' },
  },
  status: 'pending',
  expiresAt: new Date(Date.now() + 300000),
  createdAt: new Date(),
  ...overrides,
});

const createMockApiApproval = (overrides?: Partial<PendingApproval>): PendingApproval => ({
  id: 'approval-api-1',
  agent_id: 'agent-1',
  session_id: 'session-1',
  action_type: 'file_write',
  action_details: {
    tool_name: 'write_file',
    file_path: '/src/test.ts',
  },
  status: 'pending',
  expires_at: new Date(Date.now() + 300000).toISOString(),
  created_at: new Date().toISOString(),
  ...overrides,
});

describe('approvalsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useApprovalsStore.setState({
        pendingApprovals: {},
        activeApproval: null,
      });
    });

    // Reset timers
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty pending approvals', () => {
      const { result } = renderHook(() => useApprovalsStore());
      expect(result.current.pendingApprovals).toEqual({});
    });

    it('has no active approval', () => {
      const { result } = renderHook(() => useApprovalsStore());
      expect(result.current.activeApproval).toBeNull();
    });

    it('returns empty array for non-existent session approvals', () => {
      const { result } = renderHook(() => useApprovalsStore());
      expect(result.current.getSessionApprovals('non-existent')).toEqual([]);
    });

    it('returns zero count for non-existent session', () => {
      const { result } = renderHook(() => useApprovalsStore());
      expect(result.current.getApprovalCount('non-existent')).toBe(0);
    });
  });

  // ========================================================================
  // Approval Requests - Adding and Managing
  // ========================================================================

  describe('Approval Requests', () => {
    describe('addApproval', () => {
      it('adds approval request to session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals).toHaveLength(1);
        expect(sessionApprovals[0]).toEqual(approval);
      });

      it('adds file_write approval type', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ actionType: 'file_write' });

        act(() => {
          result.current.addApproval(approval);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].actionType).toBe('file_write');
        expect(sessionApprovals[0].actionDetails.filePath).toBeDefined();
      });

      it('adds command_execute approval type', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockCommandApproval();

        act(() => {
          result.current.addApproval(approval);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].actionType).toBe('command_execute');
        expect(sessionApprovals[0].actionDetails.command).toBe('npm install');
      });

      it('sets active approval to first pending approval', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
        });

        expect(result.current.activeApproval).toEqual(approval);
      });

      it('does not change active approval when adding second approval', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
        });

        expect(result.current.activeApproval).toEqual(approval1);
      });

      it('prevents duplicate approvals by ID', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.addApproval(approval);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals).toHaveLength(1);
      });

      it('can add multiple approvals to same session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });
        const approval3 = createMockCommandApproval({ id: 'approval-3' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.addApproval(approval3);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals).toHaveLength(3);
      });

      it('can add approvals to different sessions', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ sessionId: 'session-1' });
        const approval2 = createMockApproval({ id: 'approval-2', sessionId: 'session-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(1);
        expect(result.current.getSessionApprovals('session-2')).toHaveLength(1);
      });

      it('stores approval with expiration time', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const expiresAt = new Date(Date.now() + 600000); // 10 minutes
        const approval = createMockApproval({ expiresAt });

        act(() => {
          result.current.addApproval(approval);
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].expiresAt).toEqual(expiresAt);
      });
    });

    describe('getAgentApprovals', () => {
      it('returns approvals for specific agent', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ agentId: 'agent-1' });
        const approval2 = createMockApproval({ id: 'approval-2', agentId: 'agent-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
        });

        const agentApprovals = result.current.getAgentApprovals('session-1', 'agent-1');
        expect(agentApprovals).toHaveLength(1);
        expect(agentApprovals[0].agentId).toBe('agent-1');
      });

      it('returns empty array for agent with no approvals', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ agentId: 'agent-1' });

        act(() => {
          result.current.addApproval(approval);
        });

        const agentApprovals = result.current.getAgentApprovals('session-1', 'agent-2');
        expect(agentApprovals).toEqual([]);
      });
    });

    describe('getApprovalCount', () => {
      it('returns count of pending approvals only', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1', status: 'pending' });
        const approval2 = createMockApproval({ id: 'approval-2', status: 'pending' });
        const approval3 = createMockApproval({ id: 'approval-3', status: 'approved' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.addApproval(approval3);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(2);
      });

      it('returns zero when all approvals are non-pending', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ status: 'approved' });

        act(() => {
          result.current.addApproval(approval);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(0);
      });
    });

    describe('hasApprovals', () => {
      it('returns true when session has pending approvals', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ status: 'pending' });

        act(() => {
          result.current.addApproval(approval);
        });

        expect(result.current.hasApprovals('session-1')).toBe(true);
      });

      it('returns false when session has no pending approvals', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ status: 'approved' });

        act(() => {
          result.current.addApproval(approval);
        });

        expect(result.current.hasApprovals('session-1')).toBe(false);
      });

      it('returns false for non-existent session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        expect(result.current.hasApprovals('non-existent')).toBe(false);
      });
    });
  });

  // ========================================================================
  // Approval Actions - Approve, Reject, Remove
  // ========================================================================

  describe('Approval Actions', () => {
    describe('updateApprovalStatus', () => {
      it('updates approval status to approved', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'approved');
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].status).toBe('approved');
      });

      it('updates approval status to rejected', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'rejected');
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].status).toBe('rejected');
      });

      it('updates approval status to expired', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'expired');
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].status).toBe('expired');
      });

      it('removes approval after 500ms when status is not pending', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'approved');
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(0);
      });

      it('does not remove approval when status remains pending', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'pending');
        });

        act(() => {
          vi.advanceTimersByTime(500);
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(1);
      });

      it('handles updating non-existent approval gracefully', () => {
        const { result } = renderHook(() => useApprovalsStore());

        expect(() => {
          act(() => {
            result.current.updateApprovalStatus('session-1', 'non-existent', 'approved');
          });
        }).not.toThrow();
      });

      it('only updates specified approval', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.updateApprovalStatus('session-1', approval1.id, 'approved');
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals.find((a) => a.id === approval1.id)?.status).toBe('approved');
        expect(sessionApprovals.find((a) => a.id === approval2.id)?.status).toBe('pending');
      });
    });

    describe('removeApproval', () => {
      it('removes approval from session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.removeApproval('session-1', approval.id);
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(0);
      });

      it('clears active approval if removed approval was active', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.addApproval(approval);
          result.current.removeApproval('session-1', approval.id);
        });

        expect(result.current.activeApproval).toBeNull();
      });

      it('sets active approval to next pending when active is removed', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1', status: 'pending' });
        const approval2 = createMockApproval({ id: 'approval-2', status: 'pending' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.removeApproval('session-1', approval1.id);
        });

        expect(result.current.activeApproval?.id).toBe('approval-2');
      });

      it('skips non-pending approvals when selecting next active', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1', status: 'pending' });
        const approval2 = createMockApproval({ id: 'approval-2', status: 'approved' });
        const approval3 = createMockApproval({ id: 'approval-3', status: 'pending' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.addApproval(approval3);
          result.current.removeApproval('session-1', approval1.id);
        });

        expect(result.current.activeApproval?.id).toBe('approval-3');
      });

      it('keeps active approval unchanged when non-active is removed', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.removeApproval('session-1', approval2.id);
        });

        expect(result.current.activeApproval).toEqual(approval1);
      });

      it('handles removing non-existent approval gracefully', () => {
        const { result } = renderHook(() => useApprovalsStore());

        expect(() => {
          act(() => {
            result.current.removeApproval('session-1', 'non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('setActiveApproval', () => {
      it('sets active approval', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.setActiveApproval(approval);
        });

        expect(result.current.activeApproval).toEqual(approval);
      });

      it('can clear active approval', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval();

        act(() => {
          result.current.setActiveApproval(approval);
          result.current.setActiveApproval(null);
        });

        expect(result.current.activeApproval).toBeNull();
      });

      it('can switch between active approvals', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });

        act(() => {
          result.current.setActiveApproval(approval1);
        });
        expect(result.current.activeApproval).toEqual(approval1);

        act(() => {
          result.current.setActiveApproval(approval2);
        });
        expect(result.current.activeApproval).toEqual(approval2);
      });
    });
  });

  // ========================================================================
  // Clearing Approvals - Session and Agent
  // ========================================================================

  describe('Approval Workflow', () => {
    describe('clearSessionApprovals', () => {
      it('removes all approvals for session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1' });
        const approval2 = createMockApproval({ id: 'approval-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.clearSessionApprovals('session-1');
        });

        expect(result.current.getSessionApprovals('session-1')).toHaveLength(0);
        expect(result.current.pendingApprovals['session-1']).toBeUndefined();
      });

      it('clears active approval if it belongs to cleared session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ sessionId: 'session-1' });

        act(() => {
          result.current.addApproval(approval);
          result.current.clearSessionApprovals('session-1');
        });

        expect(result.current.activeApproval).toBeNull();
      });

      it('keeps active approval if it belongs to different session', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ sessionId: 'session-1' });
        const approval2 = createMockApproval({ id: 'approval-2', sessionId: 'session-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.setActiveApproval(approval2);
          result.current.clearSessionApprovals('session-1');
        });

        expect(result.current.activeApproval).toEqual(approval2);
      });

      it('does not affect other sessions', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ sessionId: 'session-1' });
        const approval2 = createMockApproval({ id: 'approval-2', sessionId: 'session-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.clearSessionApprovals('session-1');
        });

        expect(result.current.getSessionApprovals('session-2')).toHaveLength(1);
      });

      it('handles clearing non-existent session gracefully', () => {
        const { result } = renderHook(() => useApprovalsStore());

        expect(() => {
          act(() => {
            result.current.clearSessionApprovals('non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('clearAgentApprovals', () => {
      it('removes all approvals for specific agent', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ agentId: 'agent-1' });
        const approval2 = createMockApproval({ id: 'approval-2', agentId: 'agent-1' });
        const approval3 = createMockApproval({ id: 'approval-3', agentId: 'agent-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.addApproval(approval3);
          result.current.clearAgentApprovals('session-1', 'agent-1');
        });

        const agentApprovals = result.current.getAgentApprovals('session-1', 'agent-1');
        expect(agentApprovals).toHaveLength(0);
      });

      it('keeps approvals for other agents', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ agentId: 'agent-1' });
        const approval2 = createMockApproval({ id: 'approval-2', agentId: 'agent-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.clearAgentApprovals('session-1', 'agent-1');
        });

        const agent2Approvals = result.current.getAgentApprovals('session-1', 'agent-2');
        expect(agent2Approvals).toHaveLength(1);
      });

      it('clears active approval if it belongs to cleared agent', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval = createMockApproval({ agentId: 'agent-1' });

        act(() => {
          result.current.addApproval(approval);
          result.current.clearAgentApprovals('session-1', 'agent-1');
        });

        expect(result.current.activeApproval).toBeNull();
      });

      it('sets active approval to next pending from other agents', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'approval-1', agentId: 'agent-1' });
        const approval2 = createMockApproval({
          id: 'approval-2',
          agentId: 'agent-2',
          status: 'pending',
        });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.clearAgentApprovals('session-1', 'agent-1');
        });

        expect(result.current.activeApproval?.id).toBe('approval-2');
      });

      it('handles clearing approvals for non-existent agent gracefully', () => {
        const { result } = renderHook(() => useApprovalsStore());

        expect(() => {
          act(() => {
            result.current.clearAgentApprovals('session-1', 'non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('multi-step approval workflow', () => {
      it('handles sequential approval workflow', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'step-1' });
        const approval2 = createMockApproval({ id: 'step-2' });
        const approval3 = createMockApproval({ id: 'step-3' });

        // Add all approval steps
        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
          result.current.addApproval(approval3);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(3);
        expect(result.current.activeApproval?.id).toBe('step-1');

        // Approve first step
        act(() => {
          result.current.updateApprovalStatus('session-1', 'step-1', 'approved');
          vi.advanceTimersByTime(500);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(2);
        expect(result.current.activeApproval?.id).toBe('step-2');

        // Approve second step
        act(() => {
          result.current.updateApprovalStatus('session-1', 'step-2', 'approved');
          vi.advanceTimersByTime(500);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(1);
        expect(result.current.activeApproval?.id).toBe('step-3');
      });

      it('handles approval chain with rejection', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approval1 = createMockApproval({ id: 'step-1' });
        const approval2 = createMockApproval({ id: 'step-2' });

        act(() => {
          result.current.addApproval(approval1);
          result.current.addApproval(approval2);
        });

        // Reject first step
        act(() => {
          result.current.updateApprovalStatus('session-1', 'step-1', 'rejected');
          vi.advanceTimersByTime(500);
        });

        // Second approval should still be pending
        expect(result.current.getApprovalCount('session-1')).toBe(1);
        expect(result.current.activeApproval?.id).toBe('step-2');
      });

      it('handles bulk approval completion', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const approvals = Array.from({ length: 5 }, (_, i) =>
          createMockApproval({ id: `approval-${i}` })
        );

        act(() => {
          approvals.forEach((approval) => result.current.addApproval(approval));
        });

        expect(result.current.getApprovalCount('session-1')).toBe(5);

        // Approve all
        act(() => {
          approvals.forEach((approval) => {
            result.current.updateApprovalStatus('session-1', approval.id, 'approved');
          });
          vi.advanceTimersByTime(500);
        });

        expect(result.current.getApprovalCount('session-1')).toBe(0);
      });

      it('supports approval timeout/expiration workflow', () => {
        const { result } = renderHook(() => useApprovalsStore());
        const pastExpiration = new Date(Date.now() - 1000);
        const approval = createMockApproval({ expiresAt: pastExpiration });

        act(() => {
          result.current.addApproval(approval);
          result.current.updateApprovalStatus('session-1', approval.id, 'expired');
        });

        const sessionApprovals = result.current.getSessionApprovals('session-1');
        expect(sessionApprovals[0].status).toBe('expired');
        expect(sessionApprovals[0].expiresAt.getTime()).toBeLessThan(Date.now());
      });
    });
  });

  // ========================================================================
  // API Conversion Helper
  // ========================================================================

  describe('apiApprovalToStoreApproval', () => {
    it('converts API approval to store format', () => {
      const apiApproval = createMockApiApproval();
      const storeApproval = apiApprovalToStoreApproval(apiApproval, 'Test Agent');

      expect(storeApproval.id).toBe(apiApproval.id);
      expect(storeApproval.agentId).toBe(apiApproval.agent_id);
      expect(storeApproval.agentName).toBe('Test Agent');
      expect(storeApproval.sessionId).toBe(apiApproval.session_id);
      expect(storeApproval.actionType).toBe(apiApproval.action_type);
      expect(storeApproval.status).toBe(apiApproval.status);
    });

    it('converts action details correctly', () => {
      const apiApproval = createMockApiApproval({
        action_details: {
          tool_name: 'write_file',
          file_path: '/src/test.ts',
          arguments: { content: 'test' },
        },
      });
      const storeApproval = apiApprovalToStoreApproval(apiApproval, 'Agent');

      expect(storeApproval.actionDetails.toolName).toBe('write_file');
      expect(storeApproval.actionDetails.filePath).toBe('/src/test.ts');
      expect(storeApproval.actionDetails.arguments).toEqual({ content: 'test' });
    });

    it('converts command execution approval', () => {
      const apiApproval = createMockApiApproval({
        action_type: 'command_execute',
        action_details: {
          tool_name: 'execute_command',
          command: 'npm test',
          arguments: { cwd: '/workspace' },
        },
      });
      const storeApproval = apiApprovalToStoreApproval(apiApproval, 'Agent');

      expect(storeApproval.actionType).toBe('command_execute');
      expect(storeApproval.actionDetails.command).toBe('npm test');
    });

    it('converts ISO date strings to Date objects', () => {
      const now = new Date();
      const apiApproval = createMockApiApproval({
        expires_at: now.toISOString(),
        created_at: now.toISOString(),
      });
      const storeApproval = apiApprovalToStoreApproval(apiApproval, 'Agent');

      expect(storeApproval.expiresAt).toBeInstanceOf(Date);
      expect(storeApproval.createdAt).toBeInstanceOf(Date);
      expect(storeApproval.expiresAt.toISOString()).toBe(now.toISOString());
    });

    it('handles minimal action details', () => {
      const apiApproval = createMockApiApproval({
        action_details: {},
      });
      const storeApproval = apiApprovalToStoreApproval(apiApproval, 'Agent');

      expect(storeApproval.actionDetails).toBeDefined();
      expect(storeApproval.actionDetails.toolName).toBeUndefined();
      expect(storeApproval.actionDetails.filePath).toBeUndefined();
      expect(storeApproval.actionDetails.command).toBeUndefined();
    });
  });
});
