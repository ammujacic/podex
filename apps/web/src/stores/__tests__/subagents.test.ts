import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSubagentsStore } from '../subagents';
import type { Subagent } from '../subagents';

// Mock subagent fixtures
const mockSubagent: Subagent = {
  id: 'subagent-1',
  parentAgentId: 'agent-1',
  sessionId: 'session-1',
  name: 'Research Assistant',
  type: 'research',
  task: 'Investigate authentication patterns',
  status: 'pending',
  background: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  completedAt: null,
  resultSummary: null,
  error: null,
  contextTokens: 1000,
};

const mockSubagent2: Subagent = {
  id: 'subagent-2',
  parentAgentId: 'agent-1',
  sessionId: 'session-1',
  name: 'Code Analyzer',
  type: 'analysis',
  task: 'Analyze code complexity',
  status: 'running',
  background: true,
  createdAt: new Date('2024-01-02T00:00:00Z'),
  completedAt: null,
  resultSummary: null,
  error: null,
  contextTokens: 2000,
};

describe('subagentsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useSubagentsStore.setState({
        subagentsByAgent: {},
        expandedSubagentId: null,
        loadingAgents: new Set(),
      });
    });
    vi.clearAllMocks();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty subagents by agent', () => {
      const { result } = renderHook(() => useSubagentsStore());
      expect(result.current.subagentsByAgent).toEqual({});
    });

    it('has no expanded subagent', () => {
      const { result } = renderHook(() => useSubagentsStore());
      expect(result.current.expandedSubagentId).toBeNull();
    });

    it('has empty loading agents set', () => {
      const { result } = renderHook(() => useSubagentsStore());
      expect(result.current.loadingAgents.size).toBe(0);
    });
  });

  // ========================================================================
  // Subagent Creation
  // ========================================================================

  describe('Subagent Creation', () => {
    it('adds subagent to agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(1);
      expect(subagents[0]).toEqual(mockSubagent);
    });

    it('adds multiple subagents to agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.addSubagent('agent-1', mockSubagent2);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(2);
    });

    it('adds new subagent to front of list', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.addSubagent('agent-1', mockSubagent2);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents[0].id).toBe(mockSubagent2.id);
      expect(subagents[1].id).toBe(mockSubagent.id);
    });

    it('creates subagent list for new agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
      });

      expect(result.current.subagentsByAgent['agent-1']).toBeDefined();
      expect(result.current.subagentsByAgent['agent-1']).toHaveLength(1);
    });

    it('subagents in different agents are independent', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagent3: Subagent = {
        ...mockSubagent,
        id: 'subagent-3',
        parentAgentId: 'agent-2',
      };

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.addSubagent('agent-2', subagent3);
      });

      expect(result.current.getSubagents('agent-1')).toHaveLength(1);
      expect(result.current.getSubagents('agent-2')).toHaveLength(1);
    });
  });

  // ========================================================================
  // Status Tracking
  // ========================================================================

  describe('Status Tracking', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSubagentsStore());
      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
      });
    });

    it('updates subagent status to running', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', { status: 'running' });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.status).toBe('running');
    });

    it('updates subagent status to completed', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const completedAt = new Date();

      act(() => {
        result.current.updateSubagent('subagent-1', {
          status: 'completed',
          completedAt,
          resultSummary: 'Task completed successfully',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.status).toBe('completed');
      expect(subagent?.completedAt).toEqual(completedAt);
      expect(subagent?.resultSummary).toBe('Task completed successfully');
    });

    it('updates subagent status to failed', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', {
          status: 'failed',
          error: 'Authentication failed',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.status).toBe('failed');
      expect(subagent?.error).toBe('Authentication failed');
    });

    it('updates subagent status to cancelled', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', { status: 'cancelled' });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.status).toBe('cancelled');
    });

    it('updates multiple properties at once', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', {
          status: 'running',
          contextTokens: 5000,
          name: 'Updated Research Assistant',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.status).toBe('running');
      expect(subagent?.contextTokens).toBe(5000);
      expect(subagent?.name).toBe('Updated Research Assistant');
    });

    it('does not affect other subagents when updating', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent2);
        result.current.updateSubagent('subagent-1', { status: 'completed' });
      });

      const subagent2 = result.current.getSubagent('subagent-2');
      expect(subagent2?.status).toBe('running');
    });

    it('handles updating non-existent subagent gracefully', () => {
      const { result } = renderHook(() => useSubagentsStore());

      expect(() => {
        act(() => {
          result.current.updateSubagent('non-existent', { status: 'completed' });
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Communication/Results
  // ========================================================================

  describe('Communication and Results', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSubagentsStore());
      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
      });
    });

    it('sets result summary', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', {
          resultSummary: 'Found 5 authentication patterns',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.resultSummary).toBe('Found 5 authentication patterns');
    });

    it('sets error message', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', {
          error: 'Network timeout',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.error).toBe('Network timeout');
    });

    it('updates context tokens usage', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', {
          contextTokens: 3500,
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.contextTokens).toBe(3500);
    });

    it('clears error when task succeeds', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.updateSubagent('subagent-1', { error: 'Some error' });
        result.current.updateSubagent('subagent-1', {
          status: 'completed',
          error: null,
          resultSummary: 'Success',
        });
      });

      const subagent = result.current.getSubagent('subagent-1');
      expect(subagent?.error).toBeNull();
      expect(subagent?.resultSummary).toBe('Success');
    });
  });

  // ========================================================================
  // Remove Subagent
  // ========================================================================

  describe('Remove Subagent', () => {
    it('removes subagent from agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.removeSubagent('agent-1', 'subagent-1');
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(0);
    });

    it('only removes specified subagent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.addSubagent('agent-1', mockSubagent2);
        result.current.removeSubagent('agent-1', 'subagent-1');
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(1);
      expect(subagents[0].id).toBe('subagent-2');
    });

    it('handles removing non-existent subagent gracefully', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
      });

      expect(() => {
        act(() => {
          result.current.removeSubagent('agent-1', 'non-existent');
        });
      }).not.toThrow();

      expect(result.current.getSubagents('agent-1')).toHaveLength(1);
    });
  });

  // ========================================================================
  // Set Subagents
  // ========================================================================

  describe('Set Subagents', () => {
    it('sets all subagents for agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setSubagents('agent-1', [mockSubagent, mockSubagent2]);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(2);
    });

    it('replaces existing subagents', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const newSubagent: Subagent = {
        ...mockSubagent,
        id: 'new-subagent',
      };

      act(() => {
        result.current.setSubagents('agent-1', [mockSubagent]);
        result.current.setSubagents('agent-1', [newSubagent]);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents).toHaveLength(1);
      expect(subagents[0].id).toBe('new-subagent');
    });

    it('sorts subagents by creation date (newest first)', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const older: Subagent = {
        ...mockSubagent,
        id: 'older',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      };
      const newer: Subagent = {
        ...mockSubagent,
        id: 'newer',
        createdAt: new Date('2024-01-03T00:00:00Z'),
      };

      act(() => {
        result.current.setSubagents('agent-1', [older, newer]);
      });

      const subagents = result.current.getSubagents('agent-1');
      expect(subagents[0].id).toBe('newer');
      expect(subagents[1].id).toBe('older');
    });
  });

  // ========================================================================
  // Expanded State
  // ========================================================================

  describe('Expanded State', () => {
    it('sets expanded subagent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setExpanded('subagent-1');
      });

      expect(result.current.expandedSubagentId).toBe('subagent-1');
    });

    it('switches expanded subagent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setExpanded('subagent-1');
        result.current.setExpanded('subagent-2');
      });

      expect(result.current.expandedSubagentId).toBe('subagent-2');
    });

    it('clears expanded state', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setExpanded('subagent-1');
        result.current.setExpanded(null);
      });

      expect(result.current.expandedSubagentId).toBeNull();
    });
  });

  // ========================================================================
  // Loading States
  // ========================================================================

  describe('Loading States', () => {
    it('sets loading state for agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setLoading('agent-1', true);
      });

      expect(result.current.loadingAgents.has('agent-1')).toBe(true);
    });

    it('clears loading state for agent', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setLoading('agent-1', true);
        result.current.setLoading('agent-1', false);
      });

      expect(result.current.loadingAgents.has('agent-1')).toBe(false);
    });

    it('manages loading states for multiple agents independently', () => {
      const { result } = renderHook(() => useSubagentsStore());

      act(() => {
        result.current.setLoading('agent-1', true);
        result.current.setLoading('agent-2', true);
        result.current.setLoading('agent-1', false);
      });

      expect(result.current.loadingAgents.has('agent-1')).toBe(false);
      expect(result.current.loadingAgents.has('agent-2')).toBe(true);
    });
  });

  // ========================================================================
  // Getters
  // ========================================================================

  describe('Getters', () => {
    beforeEach(() => {
      const { result } = renderHook(() => useSubagentsStore());
      act(() => {
        result.current.addSubagent('agent-1', mockSubagent);
        result.current.addSubagent('agent-1', mockSubagent2);
      });
    });

    it('gets all subagents for agent', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagents = result.current.getSubagents('agent-1');

      expect(subagents).toHaveLength(2);
    });

    it('returns empty array for agent with no subagents', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagents = result.current.getSubagents('agent-999');

      expect(subagents).toEqual([]);
    });

    it('gets active subagents only', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const completed: Subagent = {
        ...mockSubagent,
        id: 'completed',
        status: 'completed',
      };

      act(() => {
        result.current.addSubagent('agent-1', completed);
      });

      const activeSubagents = result.current.getActiveSubagents('agent-1');
      expect(activeSubagents).toHaveLength(2); // pending and running, not completed
      expect(activeSubagents.map((s) => s.status)).toContain('pending');
      expect(activeSubagents.map((s) => s.status)).toContain('running');
      expect(activeSubagents.map((s) => s.status)).not.toContain('completed');
    });

    it('gets specific subagent by id', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagent = result.current.getSubagent('subagent-1');

      expect(subagent).toBeDefined();
      expect(subagent?.id).toBe('subagent-1');
    });

    it('returns undefined for non-existent subagent', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagent = result.current.getSubagent('non-existent');

      expect(subagent).toBeUndefined();
    });

    it('finds subagent across all agents', () => {
      const { result } = renderHook(() => useSubagentsStore());
      const subagent3: Subagent = {
        ...mockSubagent,
        id: 'subagent-3',
        parentAgentId: 'agent-2',
      };

      act(() => {
        result.current.addSubagent('agent-2', subagent3);
      });

      const found = result.current.getSubagent('subagent-3');
      expect(found?.parentAgentId).toBe('agent-2');
    });
  });
});
