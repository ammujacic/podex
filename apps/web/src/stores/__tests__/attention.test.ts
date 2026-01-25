import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAttentionStore, type AgentAttention } from '../attention';
import type { AgentAttentionType, AgentAttentionPriority } from '@/lib/socket';

// Helper to create mock attention items
const createMockAttention = (overrides?: Partial<AgentAttention>): AgentAttention => ({
  id: 'attention-1',
  agentId: 'agent-1',
  agentName: 'Code Analyzer',
  sessionId: 'session-1',
  type: 'approval_required' as AgentAttentionType,
  title: 'Approval Required',
  message: 'Please review and approve changes',
  priority: 'high' as AgentAttentionPriority,
  read: false,
  dismissed: false,
  createdAt: new Date(),
  ...overrides,
});

describe('attentionStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useAttentionStore.setState({
        attentionsBySession: {},
        unreadCountBySession: {},
        ttsEnabled: true,
        announcePriorities: ['high', 'critical'],
        panelOpen: false,
        focusedAgentId: null,
        focusedSessionId: null,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty attentions by session', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.attentionsBySession).toEqual({});
    });

    it('has empty unread count by session', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.unreadCountBySession).toEqual({});
    });

    it('has TTS enabled by default', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.ttsEnabled).toBe(true);
    });

    it('has default announce priorities for high and critical', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.announcePriorities).toEqual(['high', 'critical']);
    });

    it('has panel closed by default', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.panelOpen).toBe(false);
    });

    it('has no focused agent or session', () => {
      const { result } = renderHook(() => useAttentionStore());
      expect(result.current.focusedAgentId).toBeNull();
      expect(result.current.focusedSessionId).toBeNull();
    });
  });

  // ========================================================================
  // Add Attention
  // ========================================================================

  describe('Add Attention', () => {
    it('adds attention to session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
      });

      expect(result.current.attentionsBySession['session-1']).toHaveLength(1);
      expect(result.current.attentionsBySession['session-1'][0]).toEqual(attention);
    });

    it('adds attention to front of list', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
      });

      const attentions = result.current.attentionsBySession['session-1'];
      expect(attentions[0].id).toBe('attn-2');
      expect(attentions[1].id).toBe('attn-1');
    });

    it('updates unread count when adding attention', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
      });

      expect(result.current.unreadCountBySession['session-1']).toBe(1);
    });

    it('prevents duplicate attentions by ID', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
        result.current.addAttention(attention);
      });

      expect(result.current.attentionsBySession['session-1']).toHaveLength(1);
    });

    it('can add multiple attentions to same session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });
      const attention3 = createMockAttention({ id: 'attn-3' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.addAttention(attention3);
      });

      expect(result.current.attentionsBySession['session-1']).toHaveLength(3);
      expect(result.current.unreadCountBySession['session-1']).toBe(3);
    });

    it('can add attentions to different sessions', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ sessionId: 'session-1' });
      const attention2 = createMockAttention({ id: 'attn-2', sessionId: 'session-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
      });

      expect(result.current.attentionsBySession['session-1']).toHaveLength(1);
      expect(result.current.attentionsBySession['session-2']).toHaveLength(1);
    });

    it('does not count dismissed attentions in unread count', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', dismissed: false });
      const attention2 = createMockAttention({ id: 'attn-2', dismissed: true });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
      });

      expect(result.current.unreadCountBySession['session-1']).toBe(1);
    });

    it('does not count read attentions in unread count', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', read: false });
      const attention2 = createMockAttention({ id: 'attn-2', read: true });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
      });

      expect(result.current.unreadCountBySession['session-1']).toBe(1);
    });
  });

  // ========================================================================
  // Mark As Read
  // ========================================================================

  describe('Mark As Read', () => {
    it('marks single attention as read', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
        result.current.markAsRead('session-1', 'attention-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      expect(attentions[0].read).toBe(true);
    });

    it('updates unread count when marking as read', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.markAsRead('session-1', 'attn-1');
      });

      expect(result.current.unreadCountBySession['session-1']).toBe(1);
    });

    it('handles marking non-existent attention gracefully', () => {
      const { result } = renderHook(() => useAttentionStore());

      expect(() => {
        act(() => {
          result.current.markAsRead('session-1', 'non-existent');
        });
      }).not.toThrow();
    });

    it('only marks specified attention as read', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.markAsRead('session-1', 'attn-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      const attn1 = attentions.find((a) => a.id === 'attn-1');
      const attn2 = attentions.find((a) => a.id === 'attn-2');
      expect(attn1?.read).toBe(true);
      expect(attn2?.read).toBe(false);
    });

    it('marks all attentions as read for session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });
      const attention3 = createMockAttention({ id: 'attn-3' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.addAttention(attention3);
        result.current.markAllAsReadForSession('session-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      expect(attentions.every((a) => a.read)).toBe(true);
      expect(result.current.unreadCountBySession['session-1']).toBe(0);
    });

    it('does not mark dismissed attentions when marking all as read for session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', dismissed: false });
      const attention2 = createMockAttention({ id: 'attn-2', dismissed: true });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.markAllAsReadForSession('session-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      const attn1 = attentions.find((a) => a.id === 'attn-1');
      const attn2 = attentions.find((a) => a.id === 'attn-2');
      expect(attn1?.read).toBe(true);
      expect(attn2?.read).toBe(false);
    });

    it('marks all attentions as read for specific agent', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', agentId: 'agent-1' });
      const attention2 = createMockAttention({ id: 'attn-2', agentId: 'agent-1' });
      const attention3 = createMockAttention({ id: 'attn-3', agentId: 'agent-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.addAttention(attention3);
        result.current.markAllAsReadForAgent('session-1', 'agent-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      const agent1Attentions = attentions.filter((a) => a.agentId === 'agent-1');
      const agent2Attentions = attentions.filter((a) => a.agentId === 'agent-2');
      expect(agent1Attentions.every((a) => a.read)).toBe(true);
      expect(agent2Attentions.every((a) => a.read)).toBe(false);
    });

    it('does not mark dismissed attentions when marking all as read for agent', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({
        id: 'attn-1',
        agentId: 'agent-1',
        dismissed: false,
      });
      const attention2 = createMockAttention({ id: 'attn-2', agentId: 'agent-1', dismissed: true });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.markAllAsReadForAgent('session-1', 'agent-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      const attn1 = attentions.find((a) => a.id === 'attn-1');
      const attn2 = attentions.find((a) => a.id === 'attn-2');
      expect(attn1?.read).toBe(true);
      expect(attn2?.read).toBe(false);
    });
  });

  // ========================================================================
  // Dismiss Attention
  // ========================================================================

  describe('Dismiss Attention', () => {
    it('dismisses single attention', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
        result.current.dismissAttention('session-1', 'attention-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      expect(attentions[0].dismissed).toBe(true);
    });

    it('updates unread count when dismissing attention', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.dismissAttention('session-1', 'attn-1');
      });

      expect(result.current.unreadCountBySession['session-1']).toBe(1);
    });

    it('dismisses all attentions for specific agent', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', agentId: 'agent-1' });
      const attention2 = createMockAttention({ id: 'attn-2', agentId: 'agent-1' });
      const attention3 = createMockAttention({ id: 'attn-3', agentId: 'agent-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.addAttention(attention3);
        result.current.dismissAllForAgent('session-1', 'agent-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      const agent1Attentions = attentions.filter((a) => a.agentId === 'agent-1');
      const agent2Attentions = attentions.filter((a) => a.agentId === 'agent-2');
      expect(agent1Attentions.every((a) => a.dismissed)).toBe(true);
      expect(agent2Attentions.every((a) => a.dismissed)).toBe(false);
    });

    it('dismisses all attentions for session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1' });
      const attention2 = createMockAttention({ id: 'attn-2' });
      const attention3 = createMockAttention({ id: 'attn-3' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.addAttention(attention3);
        result.current.dismissAllForSession('session-1');
      });

      const attentions = result.current.attentionsBySession['session-1'];
      expect(attentions.every((a) => a.dismissed)).toBe(true);
      expect(result.current.unreadCountBySession['session-1']).toBe(0);
    });

    it('handles dismissing non-existent attention gracefully', () => {
      const { result } = renderHook(() => useAttentionStore());

      expect(() => {
        act(() => {
          result.current.dismissAttention('session-1', 'non-existent');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Clear Session
  // ========================================================================

  describe('Clear Session', () => {
    it('clears all attentions for session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention1 = createMockAttention({ id: 'attn-1', sessionId: 'session-1' });
      const attention2 = createMockAttention({ id: 'attn-2', sessionId: 'session-2' });

      act(() => {
        result.current.addAttention(attention1);
        result.current.addAttention(attention2);
        result.current.clearSession('session-1');
      });

      expect(result.current.attentionsBySession['session-1']).toBeUndefined();
      expect(result.current.attentionsBySession['session-2']).toBeDefined();
    });

    it('clears unread count for session', () => {
      const { result } = renderHook(() => useAttentionStore());
      const attention = createMockAttention();

      act(() => {
        result.current.addAttention(attention);
        result.current.clearSession('session-1');
      });

      expect(result.current.unreadCountBySession['session-1']).toBeUndefined();
    });

    it('handles clearing non-existent session gracefully', () => {
      const { result } = renderHook(() => useAttentionStore());

      expect(() => {
        act(() => {
          result.current.clearSession('non-existent');
        });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // Focus Tracking
  // ========================================================================

  describe('Focus Tracking', () => {
    it('sets focused agent and session', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setFocusedAgent('session-1', 'agent-1');
      });

      expect(result.current.focusedSessionId).toBe('session-1');
      expect(result.current.focusedAgentId).toBe('agent-1');
    });

    it('can clear focused agent and session', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setFocusedAgent('session-1', 'agent-1');
        result.current.setFocusedAgent(null, null);
      });

      expect(result.current.focusedSessionId).toBeNull();
      expect(result.current.focusedAgentId).toBeNull();
    });

    it('can switch focused agent', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setFocusedAgent('session-1', 'agent-1');
        result.current.setFocusedAgent('session-1', 'agent-2');
      });

      expect(result.current.focusedSessionId).toBe('session-1');
      expect(result.current.focusedAgentId).toBe('agent-2');
    });

    it('can switch focused session', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setFocusedAgent('session-1', 'agent-1');
        result.current.setFocusedAgent('session-2', 'agent-3');
      });

      expect(result.current.focusedSessionId).toBe('session-2');
      expect(result.current.focusedAgentId).toBe('agent-3');
    });
  });

  // ========================================================================
  // Panel Actions
  // ========================================================================

  describe('Panel Actions', () => {
    it('opens panel', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.openPanel();
      });

      expect(result.current.panelOpen).toBe(true);
    });

    it('closes panel', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.openPanel();
        result.current.closePanel();
      });

      expect(result.current.panelOpen).toBe(false);
    });

    it('toggles panel open', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.togglePanel();
      });

      expect(result.current.panelOpen).toBe(true);
    });

    it('toggles panel closed', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.openPanel();
        result.current.togglePanel();
      });

      expect(result.current.panelOpen).toBe(false);
    });
  });

  // ========================================================================
  // Settings
  // ========================================================================

  describe('Settings', () => {
    it('sets TTS enabled', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setTTSEnabled(false);
      });

      expect(result.current.ttsEnabled).toBe(false);
    });

    it('sets TTS disabled', () => {
      const { result } = renderHook(() => useAttentionStore());

      act(() => {
        result.current.setTTSEnabled(false);
        result.current.setTTSEnabled(true);
      });

      expect(result.current.ttsEnabled).toBe(true);
    });

    it('sets announce priorities', () => {
      const { result } = renderHook(() => useAttentionStore());
      const priorities: AgentAttentionPriority[] = ['critical', 'high', 'medium'];

      act(() => {
        result.current.setAnnouncePriorities(priorities);
      });

      expect(result.current.announcePriorities).toEqual(priorities);
    });

    it('can set single priority', () => {
      const { result } = renderHook(() => useAttentionStore());
      const priorities: AgentAttentionPriority[] = ['critical'];

      act(() => {
        result.current.setAnnouncePriorities(priorities);
      });

      expect(result.current.announcePriorities).toEqual(['critical']);
    });

    it('can set all priorities', () => {
      const { result } = renderHook(() => useAttentionStore());
      const priorities: AgentAttentionPriority[] = ['critical', 'high', 'medium', 'low'];

      act(() => {
        result.current.setAnnouncePriorities(priorities);
      });

      expect(result.current.announcePriorities).toEqual(priorities);
    });
  });

  // ========================================================================
  // Selectors
  // ========================================================================

  describe('Selectors', () => {
    describe('getAttentionsForSession', () => {
      it('returns all non-dismissed attentions for session', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({ id: 'attn-1', dismissed: false });
        const attention2 = createMockAttention({ id: 'attn-2', dismissed: true });
        const attention3 = createMockAttention({ id: 'attn-3', dismissed: false });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
          result.current.addAttention(attention3);
        });

        const attentions = result.current.getAttentionsForSession('session-1');
        expect(attentions).toHaveLength(2);
        expect(attentions.find((a) => a.id === 'attn-2')).toBeUndefined();
      });

      it('returns empty array for session with no attentions', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attentions = result.current.getAttentionsForSession('non-existent');
        expect(attentions).toEqual([]);
      });
    });

    describe('getAttentionsForAgent', () => {
      it('returns all non-dismissed attentions for specific agent', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({ id: 'attn-1', agentId: 'agent-1' });
        const attention2 = createMockAttention({ id: 'attn-2', agentId: 'agent-2' });
        const attention3 = createMockAttention({
          id: 'attn-3',
          agentId: 'agent-1',
          dismissed: true,
        });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
          result.current.addAttention(attention3);
        });

        const attentions = result.current.getAttentionsForAgent('session-1', 'agent-1');
        expect(attentions).toHaveLength(1);
        expect(attentions[0].id).toBe('attn-1');
      });

      it('returns empty array for agent with no attentions', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attentions = result.current.getAttentionsForAgent('session-1', 'non-existent');
        expect(attentions).toEqual([]);
      });
    });

    describe('getUnreadCount', () => {
      it('returns unread count for session', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({ id: 'attn-1', read: false });
        const attention2 = createMockAttention({ id: 'attn-2', read: true });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
        });

        expect(result.current.getUnreadCount('session-1')).toBe(1);
      });

      it('returns 0 for session with no attentions', () => {
        const { result } = renderHook(() => useAttentionStore());
        expect(result.current.getUnreadCount('non-existent')).toBe(0);
      });
    });

    describe('getUnreadCountForAgent', () => {
      it('returns unread count for specific agent', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({ id: 'attn-1', agentId: 'agent-1', read: false });
        const attention2 = createMockAttention({ id: 'attn-2', agentId: 'agent-1', read: true });
        const attention3 = createMockAttention({ id: 'attn-3', agentId: 'agent-2', read: false });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
          result.current.addAttention(attention3);
        });

        expect(result.current.getUnreadCountForAgent('session-1', 'agent-1')).toBe(1);
      });

      it('excludes dismissed attentions from unread count', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({
          id: 'attn-1',
          agentId: 'agent-1',
          read: false,
          dismissed: false,
        });
        const attention2 = createMockAttention({
          id: 'attn-2',
          agentId: 'agent-1',
          read: false,
          dismissed: true,
        });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
        });

        expect(result.current.getUnreadCountForAgent('session-1', 'agent-1')).toBe(1);
      });

      it('returns 0 for agent with no unread attentions', () => {
        const { result } = renderHook(() => useAttentionStore());
        expect(result.current.getUnreadCountForAgent('session-1', 'non-existent')).toBe(0);
      });
    });

    describe('hasAttentionForAgent', () => {
      it('returns true when agent has attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention = createMockAttention({ agentId: 'agent-1' });

        act(() => {
          result.current.addAttention(attention);
        });

        expect(result.current.hasAttentionForAgent('session-1', 'agent-1')).toBe(true);
      });

      it('returns false when agent has no attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        expect(result.current.hasAttentionForAgent('session-1', 'agent-1')).toBe(false);
      });

      it('returns false when agent only has dismissed attentions', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention = createMockAttention({ agentId: 'agent-1', dismissed: true });

        act(() => {
          result.current.addAttention(attention);
        });

        expect(result.current.hasAttentionForAgent('session-1', 'agent-1')).toBe(false);
      });
    });

    describe('hasUnreadForAgent', () => {
      it('returns true when agent has unread attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention = createMockAttention({ agentId: 'agent-1', read: false });

        act(() => {
          result.current.addAttention(attention);
        });

        expect(result.current.hasUnreadForAgent('session-1', 'agent-1')).toBe(true);
      });

      it('returns false when agent has no unread attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention = createMockAttention({ agentId: 'agent-1', read: true });

        act(() => {
          result.current.addAttention(attention);
        });

        expect(result.current.hasUnreadForAgent('session-1', 'agent-1')).toBe(false);
      });

      it('returns false when agent has no attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        expect(result.current.hasUnreadForAgent('session-1', 'agent-1')).toBe(false);
      });
    });

    describe('getHighestPriorityAttention', () => {
      it('returns highest priority attention for agent', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({
          id: 'attn-1',
          agentId: 'agent-1',
          priority: 'low',
        });
        const attention2 = createMockAttention({
          id: 'attn-2',
          agentId: 'agent-1',
          priority: 'critical',
        });
        const attention3 = createMockAttention({
          id: 'attn-3',
          agentId: 'agent-1',
          priority: 'medium',
        });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
          result.current.addAttention(attention3);
        });

        const highest = result.current.getHighestPriorityAttention('session-1', 'agent-1');
        expect(highest?.id).toBe('attn-2');
        expect(highest?.priority).toBe('critical');
      });

      it('returns high priority over medium and low', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({
          id: 'attn-1',
          agentId: 'agent-1',
          priority: 'low',
        });
        const attention2 = createMockAttention({
          id: 'attn-2',
          agentId: 'agent-1',
          priority: 'high',
        });
        const attention3 = createMockAttention({
          id: 'attn-3',
          agentId: 'agent-1',
          priority: 'medium',
        });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
          result.current.addAttention(attention3);
        });

        const highest = result.current.getHighestPriorityAttention('session-1', 'agent-1');
        expect(highest?.id).toBe('attn-2');
      });

      it('returns null when agent has no attention', () => {
        const { result } = renderHook(() => useAttentionStore());
        const highest = result.current.getHighestPriorityAttention('session-1', 'agent-1');
        expect(highest).toBeNull();
      });

      it('ignores dismissed attentions when finding highest priority', () => {
        const { result } = renderHook(() => useAttentionStore());
        const attention1 = createMockAttention({
          id: 'attn-1',
          agentId: 'agent-1',
          priority: 'critical',
          dismissed: true,
        });
        const attention2 = createMockAttention({
          id: 'attn-2',
          agentId: 'agent-1',
          priority: 'high',
        });

        act(() => {
          result.current.addAttention(attention1);
          result.current.addAttention(attention2);
        });

        const highest = result.current.getHighestPriorityAttention('session-1', 'agent-1');
        expect(highest?.id).toBe('attn-2');
        expect(highest?.priority).toBe('high');
      });
    });
  });
});
