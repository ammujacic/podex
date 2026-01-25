import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorktreesStore } from '../worktrees';
import type { Worktree } from '../worktrees';

// Mock worktree fixtures
const mockWorktree: Worktree = {
  id: 'worktree-1',
  agentId: 'agent-1',
  sessionId: 'session-1',
  worktreePath: '/workspace/worktrees/agent-1',
  branchName: 'feature/agent-1',
  status: 'active',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  mergedAt: null,
};

const mockWorktree2: Worktree = {
  id: 'worktree-2',
  agentId: 'agent-2',
  sessionId: 'session-1',
  worktreePath: '/workspace/worktrees/agent-2',
  branchName: 'feature/agent-2',
  status: 'creating',
  createdAt: new Date('2024-01-02T00:00:00Z'),
  mergedAt: null,
};

describe('worktreesStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useWorktreesStore.setState({
        sessionWorktrees: {},
        selectedWorktreeId: null,
        operatingWorktreeId: null,
        loading: {},
      });
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty session worktrees', () => {
      const { result } = renderHook(() => useWorktreesStore());
      expect(result.current.sessionWorktrees).toEqual({});
    });

    it('has no selected worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());
      expect(result.current.selectedWorktreeId).toBeNull();
    });

    it('has no operating worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());
      expect(result.current.operatingWorktreeId).toBeNull();
    });

    it('has empty loading states', () => {
      const { result } = renderHook(() => useWorktreesStore());
      expect(result.current.loading).toEqual({});
    });
  });

  // ========================================================================
  // Worktree Management - Add
  // ========================================================================

  describe('Add Worktree', () => {
    it('adds worktree to session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]).toEqual(mockWorktree);
    });

    it('adds multiple worktrees to session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
        result.current.addWorktree('session-1', mockWorktree2);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(2);
    });

    it('sorts worktrees by creation date (newest first)', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const older: Worktree = {
        ...mockWorktree,
        id: 'older',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };
      const newer: Worktree = {
        ...mockWorktree,
        id: 'newer',
        createdAt: new Date('2024-01-03T00:00:00Z'),
      };

      act(() => {
        result.current.addWorktree('session-1', older);
        result.current.addWorktree('session-1', newer);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees[0].id).toBe('newer');
      expect(worktrees[1].id).toBe('older');
    });

    it('worktrees in different sessions are independent', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
        result.current.addWorktree('session-2', mockWorktree2);
      });

      expect(result.current.getWorktrees('session-1')).toHaveLength(1);
      expect(result.current.getWorktrees('session-2')).toHaveLength(1);
    });
  });

  // ========================================================================
  // Worktree Management - Remove
  // ========================================================================

  describe('Remove Worktree', () => {
    it('removes worktree from session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
        result.current.removeWorktree('session-1', mockWorktree.id);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(0);
    });

    it('only removes specified worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
        result.current.addWorktree('session-1', mockWorktree2);
        result.current.removeWorktree('session-1', mockWorktree.id);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].id).toBe(mockWorktree2.id);
    });

    it('handles removing non-existent worktree gracefully', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
      });

      expect(() => {
        act(() => {
          result.current.removeWorktree('session-1', 'non-existent');
        });
      }).not.toThrow();

      expect(result.current.getWorktrees('session-1')).toHaveLength(1);
    });

    it('handles removing from non-existent session gracefully', () => {
      const { result } = renderHook(() => useWorktreesStore());

      expect(() => {
        act(() => {
          result.current.removeWorktree('non-existent-session', 'worktree-1');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Worktree Management - Set/Update
  // ========================================================================

  describe('Set Worktrees', () => {
    it('sets all worktrees for session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setWorktrees('session-1', [mockWorktree, mockWorktree2]);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(2);
    });

    it('replaces existing worktrees', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const newWorktree: Worktree = {
        ...mockWorktree,
        id: 'new-worktree',
      };

      act(() => {
        result.current.setWorktrees('session-1', [mockWorktree]);
        result.current.setWorktrees('session-1', [newWorktree]);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0].id).toBe('new-worktree');
    });

    it('sorts worktrees when setting', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const older: Worktree = {
        ...mockWorktree,
        id: 'older',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };
      const newer: Worktree = {
        ...mockWorktree,
        id: 'newer',
        createdAt: new Date('2024-01-03T00:00:00Z'),
      };

      act(() => {
        result.current.setWorktrees('session-1', [older, newer]);
      });

      const worktrees = result.current.getWorktrees('session-1');
      expect(worktrees[0].id).toBe('newer');
    });
  });

  // ========================================================================
  // Status Tracking
  // ========================================================================

  describe('Status Tracking', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useWorktreesStore());
      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
      });
    });

    it('updates worktree status to merging', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'merging');
      });

      const worktree = result.current.getWorktree('session-1', mockWorktree.id);
      expect(worktree?.status).toBe('merging');
    });

    it('updates worktree status to merged', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'merged');
      });

      const worktree = result.current.getWorktree('session-1', mockWorktree.id);
      expect(worktree?.status).toBe('merged');
    });

    it('updates worktree status to conflict', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'conflict');
      });

      const worktree = result.current.getWorktree('session-1', mockWorktree.id);
      expect(worktree?.status).toBe('conflict');
    });

    it('updates worktree status to deleted', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'deleted');
      });

      const worktree = result.current.getWorktree('session-1', mockWorktree.id);
      expect(worktree?.status).toBe('deleted');
    });

    it('updates worktree status to failed', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'failed');
      });

      const worktree = result.current.getWorktree('session-1', mockWorktree.id);
      expect(worktree?.status).toBe('failed');
    });

    it('does not affect other worktrees when updating status', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.addWorktree('session-1', mockWorktree2);
        result.current.updateWorktreeStatus('session-1', mockWorktree.id, 'merged');
      });

      const worktree2 = result.current.getWorktree('session-1', mockWorktree2.id);
      expect(worktree2?.status).toBe('creating');
    });

    it('handles updating status of non-existent worktree gracefully', () => {
      const { result } = renderHook(() => useWorktreesStore());

      expect(() => {
        act(() => {
          result.current.updateWorktreeStatus('session-1', 'non-existent', 'merged');
        });
      }).not.toThrow();
    });

    it('handles updating status in non-existent session gracefully', () => {
      const { result } = renderHook(() => useWorktreesStore());

      expect(() => {
        act(() => {
          result.current.updateWorktreeStatus('non-existent', 'worktree-1', 'merged');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Selection
  // ========================================================================

  describe('Worktree Selection', () => {
    it('selects a worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.selectWorktree('worktree-1');
      });

      expect(result.current.selectedWorktreeId).toBe('worktree-1');
    });

    it('switches selected worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.selectWorktree('worktree-1');
        result.current.selectWorktree('worktree-2');
      });

      expect(result.current.selectedWorktreeId).toBe('worktree-2');
    });

    it('clears selection by setting to null', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.selectWorktree('worktree-1');
        result.current.selectWorktree(null);
      });

      expect(result.current.selectedWorktreeId).toBeNull();
    });
  });

  // ========================================================================
  // Operating State
  // ========================================================================

  describe('Operating State', () => {
    it('sets operating worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setOperating('worktree-1');
      });

      expect(result.current.operatingWorktreeId).toBe('worktree-1');
    });

    it('switches operating worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setOperating('worktree-1');
        result.current.setOperating('worktree-2');
      });

      expect(result.current.operatingWorktreeId).toBe('worktree-2');
    });

    it('clears operating state', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setOperating('worktree-1');
        result.current.setOperating(null);
      });

      expect(result.current.operatingWorktreeId).toBeNull();
    });
  });

  // ========================================================================
  // Loading States
  // ========================================================================

  describe('Loading States', () => {
    it('sets loading state for session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setLoading('session-1', true);
      });

      expect(result.current.loading['session-1']).toBe(true);
    });

    it('clears loading state for session', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setLoading('session-1', true);
        result.current.setLoading('session-1', false);
      });

      expect(result.current.loading['session-1']).toBe(false);
    });

    it('manages loading states for multiple sessions independently', () => {
      const { result } = renderHook(() => useWorktreesStore());

      act(() => {
        result.current.setLoading('session-1', true);
        result.current.setLoading('session-2', false);
      });

      expect(result.current.loading['session-1']).toBe(true);
      expect(result.current.loading['session-2']).toBe(false);
    });
  });

  // ========================================================================
  // Getters
  // ========================================================================

  describe('Getters', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useWorktreesStore());
      act(() => {
        result.current.addWorktree('session-1', mockWorktree);
        result.current.addWorktree('session-1', mockWorktree2);
      });
    });

    it('gets all worktrees for session', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktrees = result.current.getWorktrees('session-1');

      expect(worktrees).toHaveLength(2);
      expect(worktrees.map((w) => w.id)).toContain(mockWorktree.id);
      expect(worktrees.map((w) => w.id)).toContain(mockWorktree2.id);
    });

    it('returns empty array for non-existent session', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktrees = result.current.getWorktrees('non-existent');

      expect(worktrees).toEqual([]);
    });

    it('gets specific worktree by id', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktree = result.current.getWorktree('session-1', mockWorktree.id);

      expect(worktree).toBeDefined();
      expect(worktree?.id).toBe(mockWorktree.id);
    });

    it('returns undefined for non-existent worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktree = result.current.getWorktree('session-1', 'non-existent');

      expect(worktree).toBeUndefined();
    });

    it('gets worktree by agent id', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktree = result.current.getAgentWorktree('session-1', 'agent-1');

      expect(worktree).toBeDefined();
      expect(worktree?.agentId).toBe('agent-1');
    });

    it('returns undefined for agent with no worktree', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const worktree = result.current.getAgentWorktree('session-1', 'agent-999');

      expect(worktree).toBeUndefined();
    });

    it('returns first matching worktree for agent', () => {
      const { result } = renderHook(() => useWorktreesStore());
      const duplicate: Worktree = {
        ...mockWorktree,
        id: 'duplicate',
        createdAt: new Date('2024-01-03T00:00:00Z'),
      };

      act(() => {
        result.current.addWorktree('session-1', duplicate);
      });

      const worktree = result.current.getAgentWorktree('session-1', 'agent-1');
      expect(worktree?.id).toBe('duplicate'); // Newest one
    });
  });
});
