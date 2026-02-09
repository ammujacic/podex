import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePendingChangesStore, apiChangeToStoreChange } from '../pendingChanges';
import type { PendingChange } from '../pendingChanges';

// Helper function to create mock pending change
const createMockChange = (overrides?: Partial<PendingChange>): PendingChange => ({
  id: 'change-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  agentName: 'Architect',
  filePath: '/src/components/App.tsx',
  originalContent: 'export default function App() {\n  return <div>Old</div>;\n}',
  proposedContent: 'export default function App() {\n  return <div>New</div>;\n}',
  description: 'Update App component',
  status: 'pending',
  createdAt: new Date('2024-01-15T10:00:00Z'),
  ...overrides,
});

describe('pendingChangesStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      usePendingChangesStore.setState({
        changes: {},
        activeReviewId: null,
        activeSessionId: null,
      });
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty changes object', () => {
      const { result } = renderHook(() => usePendingChangesStore());
      expect(result.current.changes).toEqual({});
    });

    it('has no active review', () => {
      const { result } = renderHook(() => usePendingChangesStore());
      expect(result.current.activeReviewId).toBeNull();
    });

    it('has no active session', () => {
      const { result } = renderHook(() => usePendingChangesStore());
      expect(result.current.activeSessionId).toBeNull();
    });

    it('getSessionChanges returns empty array for non-existent session', () => {
      const { result } = renderHook(() => usePendingChangesStore());
      expect(result.current.getSessionChanges('non-existent')).toEqual([]);
    });
  });

  // ========================================================================
  // Change Tracking
  // ========================================================================

  describe('Change Tracking', () => {
    describe('addChange', () => {
      it('adds change for file edit', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges).toHaveLength(1);
        expect(sessionChanges[0]).toEqual(change);
      });

      it('adds change for file creation', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange({
          id: 'change-2',
          originalContent: null,
          proposedContent: 'export default function NewComponent() {}',
          description: 'Create new component',
        });

        act(() => {
          result.current.addChange(change);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges[0].originalContent).toBeNull();
        expect(sessionChanges[0].proposedContent).toBeTruthy();
      });

      it('adds change for file deletion', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange({
          id: 'change-3',
          originalContent: 'content to delete',
          proposedContent: '',
          description: 'Delete obsolete file',
        });

        act(() => {
          result.current.addChange(change);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges[0].proposedContent).toBe('');
      });

      it('batches multiple changes for same session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2', filePath: '/src/utils/helpers.ts' });
        const change3 = createMockChange({ id: 'change-3', filePath: '/src/types.ts' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.addChange(change3);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges).toHaveLength(3);
      });

      it('deduplicates changes with same ID', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.addChange(change);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges).toHaveLength(1);
      });

      it('does not add duplicate change even with different content', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange();
        const change2 = createMockChange({
          proposedContent: 'different content',
        });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges).toHaveLength(1);
        expect(sessionChanges[0].proposedContent).toBe(change1.proposedContent);
      });

      it('auto-opens review for first change in session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
        });

        expect(result.current.activeReviewId).toBe(change.id);
        expect(result.current.activeSessionId).toBe(change.sessionId);
      });

      it('does not change active review when adding subsequent changes', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
        });

        expect(result.current.activeReviewId).toBe(change1.id);
      });

      it('tracks changes across multiple sessions', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ sessionId: 'session-1' });
        const change2 = createMockChange({ id: 'change-2', sessionId: 'session-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(1);
        expect(result.current.getSessionChanges('session-2')).toHaveLength(1);
      });

      it('maintains change order by creation time', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({
          id: 'change-1',
          createdAt: new Date('2024-01-15T10:00:00Z'),
        });
        const change2 = createMockChange({
          id: 'change-2',
          createdAt: new Date('2024-01-15T10:01:00Z'),
        });
        const change3 = createMockChange({
          id: 'change-3',
          createdAt: new Date('2024-01-15T10:02:00Z'),
        });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.addChange(change3);
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges[0].id).toBe('change-1');
        expect(sessionChanges[1].id).toBe('change-2');
        expect(sessionChanges[2].id).toBe('change-3');
      });
    });
  });

  // ========================================================================
  // Change Application
  // ========================================================================

  describe('Change Application', () => {
    describe('updateChangeStatus - Accept', () => {
      it('updates change status to accepted', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges[0].status).toBe('accepted');
      });

      it('moves to next pending change after accepting', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.activeReviewId).toBe('change-2');
      });

      it('clears active review when all changes are accepted', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.activeReviewId).toBeNull();
        expect(result.current.activeSessionId).toBeNull();
      });

      it('auto-removes accepted change after delay', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(2000);
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(0);
      });
    });

    describe('updateChangeStatus - Reject', () => {
      it('updates change status to rejected', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'rejected');
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges[0].status).toBe('rejected');
      });

      it('moves to next pending change after rejecting', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.updateChangeStatus('session-1', 'change-1', 'rejected');
        });

        expect(result.current.activeReviewId).toBe('change-2');
      });

      it('auto-removes rejected change after delay', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'rejected');
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(1);

        act(() => {
          vi.advanceTimersByTime(2000);
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(0);
      });
    });

    describe('updateChangeStatus - Batch operations', () => {
      it('handles multiple status updates in sequence', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });
        const change3 = createMockChange({ id: 'change-3' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.addChange(change3);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
          result.current.updateChangeStatus('session-1', 'change-2', 'rejected');
        });

        expect(result.current.activeReviewId).toBe('change-3');
      });

      it('does not affect other sessions when updating status', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ sessionId: 'session-1' });
        const change2 = createMockChange({ id: 'change-2', sessionId: 'session-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.getSessionChanges('session-2')).toHaveLength(1);
        expect(result.current.getSessionChanges('session-2')[0].status).toBe('pending');
      });
    });

    describe('updateChangeStatus - Error handling', () => {
      it('handles updating non-existent change gracefully', () => {
        const { result } = renderHook(() => usePendingChangesStore());

        expect(() => {
          act(() => {
            result.current.updateChangeStatus('session-1', 'non-existent', 'accepted');
          });
        }).not.toThrow();
      });

      it('handles updating change in non-existent session gracefully', () => {
        const { result } = renderHook(() => usePendingChangesStore());

        expect(() => {
          act(() => {
            result.current.updateChangeStatus('non-existent', 'change-1', 'accepted');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Change Management
  // ========================================================================

  describe('Change Management', () => {
    describe('removeChange', () => {
      it('removes specific change from session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.removeChange('session-1', 'change-1');
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(0);
      });

      it('only removes specified change, keeps others', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.removeChange('session-1', 'change-1');
        });

        const sessionChanges = result.current.getSessionChanges('session-1');
        expect(sessionChanges).toHaveLength(1);
        expect(sessionChanges[0].id).toBe('change-2');
      });

      it('moves to next pending change when removing active review', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.removeChange('session-1', 'change-1');
        });

        expect(result.current.activeReviewId).toBe('change-2');
      });

      it('clears active review when removing last change', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.removeChange('session-1', 'change-1');
        });

        expect(result.current.activeReviewId).toBeNull();
        expect(result.current.activeSessionId).toBeNull();
      });

      it('does not affect active review when removing non-active change', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.removeChange('session-1', 'change-2');
        });

        expect(result.current.activeReviewId).toBe('change-1');
      });

      it('handles removing non-existent change gracefully', () => {
        const { result } = renderHook(() => usePendingChangesStore());

        expect(() => {
          act(() => {
            result.current.removeChange('session-1', 'non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('clearSessionChanges', () => {
      it('clears all changes for session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.clearSessionChanges('session-1');
        });

        expect(result.current.getSessionChanges('session-1')).toHaveLength(0);
      });

      it('clears active review when clearing active session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.clearSessionChanges('session-1');
        });

        expect(result.current.activeReviewId).toBeNull();
        expect(result.current.activeSessionId).toBeNull();
      });

      it('does not affect active review when clearing different session', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ sessionId: 'session-1' });
        const change2 = createMockChange({ id: 'change-2', sessionId: 'session-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.clearSessionChanges('session-2');
        });

        expect(result.current.activeReviewId).toBe('change-1');
        expect(result.current.activeSessionId).toBe('session-1');
      });

      it('does not affect other sessions', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ sessionId: 'session-1' });
        const change2 = createMockChange({ id: 'change-2', sessionId: 'session-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.clearSessionChanges('session-1');
        });

        expect(result.current.getSessionChanges('session-2')).toHaveLength(1);
      });

      it('handles clearing non-existent session gracefully', () => {
        const { result } = renderHook(() => usePendingChangesStore());

        expect(() => {
          act(() => {
            result.current.clearSessionChanges('non-existent');
          });
        }).not.toThrow();
      });
    });

    describe('Change approval workflow', () => {
      describe('openReview', () => {
        it('opens review for specific change', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change = createMockChange();

          act(() => {
            result.current.addChange(change);
            result.current.closeReview();
            result.current.openReview('session-1', 'change-1');
          });

          expect(result.current.activeReviewId).toBe('change-1');
          expect(result.current.activeSessionId).toBe('session-1');
        });

        it('can switch between different changes', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change1 = createMockChange({ id: 'change-1' });
          const change2 = createMockChange({ id: 'change-2' });

          act(() => {
            result.current.addChange(change1);
            result.current.addChange(change2);
            result.current.openReview('session-1', 'change-2');
          });

          expect(result.current.activeReviewId).toBe('change-2');
        });

        it('can open review in different session', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change1 = createMockChange({ sessionId: 'session-1' });
          const change2 = createMockChange({ id: 'change-2', sessionId: 'session-2' });

          act(() => {
            result.current.addChange(change1);
            result.current.addChange(change2);
            result.current.openReview('session-2', 'change-2');
          });

          expect(result.current.activeReviewId).toBe('change-2');
          expect(result.current.activeSessionId).toBe('session-2');
        });
      });

      describe('closeReview', () => {
        it('closes active review', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change = createMockChange();

          act(() => {
            result.current.addChange(change);
            result.current.closeReview();
          });

          expect(result.current.activeReviewId).toBeNull();
          expect(result.current.activeSessionId).toBeNull();
        });

        it('does not affect pending changes when closing review', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change = createMockChange();

          act(() => {
            result.current.addChange(change);
            result.current.closeReview();
          });

          expect(result.current.getSessionChanges('session-1')).toHaveLength(1);
        });
      });

      describe('getActiveChange', () => {
        it('returns active change', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change = createMockChange();

          act(() => {
            result.current.addChange(change);
          });

          const activeChange = result.current.getActiveChange();
          expect(activeChange).toEqual(change);
        });

        it('returns null when no active review', () => {
          const { result } = renderHook(() => usePendingChangesStore());

          expect(result.current.getActiveChange()).toBeNull();
        });

        it('returns null when active review is closed', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change = createMockChange();

          act(() => {
            result.current.addChange(change);
            result.current.closeReview();
          });

          expect(result.current.getActiveChange()).toBeNull();
        });

        it('returns correct change when switching reviews', () => {
          const { result } = renderHook(() => usePendingChangesStore());
          const change1 = createMockChange({ id: 'change-1' });
          const change2 = createMockChange({ id: 'change-2' });

          act(() => {
            result.current.addChange(change1);
            result.current.addChange(change2);
            result.current.openReview('session-1', 'change-2');
          });

          const activeChange = result.current.getActiveChange();
          expect(activeChange?.id).toBe('change-2');
        });
      });
    });

    describe('Change conflict detection', () => {
      it('getPendingCount returns correct count', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
        });

        expect(result.current.getPendingCount('session-1')).toBe(2);
      });

      it('getPendingCount excludes accepted changes', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.getPendingCount('session-1')).toBe(1);
      });

      it('getPendingCount excludes rejected changes', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change1 = createMockChange({ id: 'change-1' });
        const change2 = createMockChange({ id: 'change-2' });

        act(() => {
          result.current.addChange(change1);
          result.current.addChange(change2);
          result.current.updateChangeStatus('session-1', 'change-1', 'rejected');
        });

        expect(result.current.getPendingCount('session-1')).toBe(1);
      });

      it('hasPendingChanges returns true when pending changes exist', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
        });

        expect(result.current.hasPendingChanges('session-1')).toBe(true);
      });

      it('hasPendingChanges returns false when no pending changes', () => {
        const { result } = renderHook(() => usePendingChangesStore());

        expect(result.current.hasPendingChanges('session-1')).toBe(false);
      });

      it('hasPendingChanges returns false when all changes resolved', () => {
        const { result } = renderHook(() => usePendingChangesStore());
        const change = createMockChange();

        act(() => {
          result.current.addChange(change);
          result.current.updateChangeStatus('session-1', 'change-1', 'accepted');
        });

        expect(result.current.hasPendingChanges('session-1')).toBe(false);
      });
    });
  });

  // ========================================================================
  // API Helper Function
  // ========================================================================

  describe('apiChangeToStoreChange', () => {
    it('converts API response to store format', () => {
      const apiChange = {
        id: 'change-1',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_name: 'Architect',
        file_path: '/src/App.tsx',
        original_content: 'old content',
        proposed_content: 'new content',
        description: 'Update file',
        status: 'pending',
        created_at: '2024-01-15T10:00:00Z',
      };

      const storeChange = apiChangeToStoreChange(apiChange);

      expect(storeChange).toEqual({
        id: 'change-1',
        sessionId: 'session-1',
        agentId: 'agent-1',
        agentName: 'Architect',
        filePath: '/src/App.tsx',
        originalContent: 'old content',
        proposedContent: 'new content',
        description: 'Update file',
        status: 'pending',
        createdAt: new Date('2024-01-15T10:00:00Z'),
      });
    });

    it('handles null values correctly', () => {
      const apiChange = {
        id: 'change-2',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_name: 'Developer',
        file_path: '/src/NewFile.tsx',
        original_content: null,
        proposed_content: 'export default function NewFile() {}',
        description: null,
        status: 'pending',
        created_at: '2024-01-15T11:00:00Z',
      };

      const storeChange = apiChangeToStoreChange(apiChange);

      expect(storeChange.originalContent).toBeNull();
      expect(storeChange.description).toBeNull();
    });

    it('converts date string to Date object', () => {
      const apiChange = {
        id: 'change-3',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_name: 'Architect',
        file_path: '/src/App.tsx',
        original_content: 'old',
        proposed_content: 'new',
        description: 'test',
        status: 'pending',
        created_at: '2024-01-15T10:00:00Z',
      };

      const storeChange = apiChangeToStoreChange(apiChange);

      expect(storeChange.createdAt).toBeInstanceOf(Date);
      expect(storeChange.createdAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });

    it('handles different status values', () => {
      const apiChangeAccepted = {
        id: 'change-4',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_name: 'Architect',
        file_path: '/src/App.tsx',
        original_content: 'old',
        proposed_content: 'new',
        description: 'test',
        status: 'accepted',
        created_at: '2024-01-15T10:00:00Z',
      };

      const storeChange = apiChangeToStoreChange(apiChangeAccepted);
      expect(storeChange.status).toBe('accepted');
    });
  });
});
