/**
 * Comprehensive tests for useSidebarBadges hook
 * Tests badge counting for agents, MCP, problems, and Sentry panels
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSidebarBadges } from '../useSidebarBadges';
import { DiagnosticSeverity } from '@/components/workspace/ProblemsPanel';

// Mock the stores
vi.mock('@/stores/session', () => ({
  useSessionStore: vi.fn(),
}));

vi.mock('@/stores/mcp', () => ({
  useMCPStore: vi.fn(),
}));

vi.mock('@/components/workspace/ProblemsPanel', () => ({
  useDiagnosticsStore: vi.fn(),
  DiagnosticSeverity: {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  },
}));

vi.mock('@/stores/sentry', () => ({
  useSentryStore: vi.fn(),
  selectUnresolvedCount: vi.fn(),
}));

import { useSessionStore } from '@/stores/session';
import { useMCPStore } from '@/stores/mcp';
import { useDiagnosticsStore } from '@/components/workspace/ProblemsPanel';
import { useSentryStore, selectUnresolvedCount } from '@/stores/sentry';

describe('useSidebarBadges', () => {
  const sessionId = 'test-session-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        sessions: {
          [sessionId]: {
            agents: [],
          },
        },
      })
    );

    vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        categories: [],
      })
    );

    vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        diagnostics: {},
      })
    );

    vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
      if (selector === selectUnresolvedCount) {
        return 0;
      }
      return selector({ issues: [] });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Agent Badge Tests
  // ========================================

  describe('Agent Badge', () => {
    it('should return undefined when no agents', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [],
            },
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.agents).toBeUndefined();
    });

    it('should return agent count when agents exist', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [
                { id: 'agent-1', name: 'Agent 1' },
                { id: 'agent-2', name: 'Agent 2' },
                { id: 'agent-3', name: 'Agent 3' },
              ],
            },
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.agents).toBe(3);
    });

    it('should return 1 for single agent', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [{ id: 'agent-1', name: 'Agent 1' }],
            },
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.agents).toBe(1);
    });

    it('should handle missing session', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {},
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.agents).toBeUndefined();
    });

    it('should handle missing agents array', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {},
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.agents).toBeUndefined();
    });
  });

  // ========================================
  // MCP Badge Tests
  // ========================================

  describe('MCP Badge', () => {
    it('should return undefined when no servers', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBeUndefined();
    });

    it('should count builtin servers', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [
                { id: 'server-1', is_builtin: true, is_enabled: false },
                { id: 'server-2', is_builtin: true, is_enabled: false },
              ],
            },
          ],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBe(2);
    });

    it('should count enabled non-builtin servers', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [
                { id: 'server-1', is_builtin: false, is_enabled: true },
                { id: 'server-2', is_builtin: false, is_enabled: true },
              ],
            },
          ],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBe(2);
    });

    it('should not count disabled non-builtin servers', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [
                { id: 'server-1', is_builtin: false, is_enabled: false },
                { id: 'server-2', is_builtin: false, is_enabled: false },
              ],
            },
          ],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBeUndefined();
    });

    it('should count mixed servers correctly', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [
                { id: 'server-1', is_builtin: true, is_enabled: false }, // counted
                { id: 'server-2', is_builtin: false, is_enabled: true }, // counted
                { id: 'server-3', is_builtin: false, is_enabled: false }, // not counted
                { id: 'server-4', is_builtin: true, is_enabled: true }, // counted
              ],
            },
          ],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBe(3);
    });

    it('should count servers across multiple categories', () => {
      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [{ id: 'server-1', is_builtin: true, is_enabled: false }],
            },
            {
              name: 'Category 2',
              servers: [{ id: 'server-2', is_builtin: false, is_enabled: true }],
            },
            {
              name: 'Category 3',
              servers: [{ id: 'server-3', is_builtin: true, is_enabled: true }],
            },
          ],
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.mcp).toBe(3);
    });
  });

  // ========================================
  // Problems Badge Tests
  // ========================================

  describe('Problems Badge', () => {
    it('should return undefined when no diagnostics', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {},
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBeUndefined();
    });

    it('should count errors', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [
              { severity: DiagnosticSeverity.Error, message: 'Error 1' },
              { severity: DiagnosticSeverity.Error, message: 'Error 2' },
            ],
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBe(2);
    });

    it('should count warnings', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [
              { severity: DiagnosticSeverity.Warning, message: 'Warning 1' },
              { severity: DiagnosticSeverity.Warning, message: 'Warning 2' },
              { severity: DiagnosticSeverity.Warning, message: 'Warning 3' },
            ],
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBe(3);
    });

    it('should count errors and warnings together', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [
              { severity: DiagnosticSeverity.Error, message: 'Error 1' },
              { severity: DiagnosticSeverity.Warning, message: 'Warning 1' },
            ],
            '/path/file2.ts': [
              { severity: DiagnosticSeverity.Error, message: 'Error 2' },
              { severity: DiagnosticSeverity.Warning, message: 'Warning 2' },
            ],
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBe(4);
    });

    it('should not count information or hint diagnostics', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [
              { severity: DiagnosticSeverity.Information, message: 'Info 1' },
              { severity: DiagnosticSeverity.Hint, message: 'Hint 1' },
              { severity: DiagnosticSeverity.Error, message: 'Error 1' },
            ],
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBe(1);
    });

    it('should count diagnostics across multiple files', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [{ severity: DiagnosticSeverity.Error, message: 'Error 1' }],
            '/path/file2.ts': [{ severity: DiagnosticSeverity.Error, message: 'Error 2' }],
            '/path/file3.ts': [{ severity: DiagnosticSeverity.Warning, message: 'Warning 1' }],
          },
        })
      );

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.problems).toBe(3);
    });
  });

  // ========================================
  // Sentry Badge Tests
  // ========================================

  describe('Sentry Badge', () => {
    it('should return undefined when no unresolved issues', () => {
      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 0;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.sentry).toBeUndefined();
    });

    it('should return count when unresolved issues exist', () => {
      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 5;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.sentry).toBe(5);
    });

    it('should return 1 for single unresolved issue', () => {
      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 1;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.sentry).toBe(1);
    });

    it('should handle large unresolved count', () => {
      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 999;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current.sentry).toBe(999);
    });
  });

  // ========================================
  // Combined Badge Tests
  // ========================================

  describe('Combined Badges', () => {
    it('should return all badges when all have values', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [{ id: 'agent-1' }, { id: 'agent-2' }],
            },
          },
        })
      );

      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [
            {
              name: 'Category 1',
              servers: [{ id: 'server-1', is_builtin: true, is_enabled: false }],
            },
          ],
        })
      );

      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': [{ severity: DiagnosticSeverity.Error, message: 'Error' }],
          },
        })
      );

      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 3;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current).toEqual({
        agents: 2,
        mcp: 1,
        problems: 1,
        sentry: 3,
      });
    });

    it('should return partial badges when some have no values', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [{ id: 'agent-1' }],
            },
          },
        })
      );

      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [],
        })
      );

      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {},
        })
      );

      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 0;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current).toEqual({
        agents: 1,
        mcp: undefined,
        problems: undefined,
        sentry: undefined,
      });
    });

    it('should return empty object when all values are zero', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [sessionId]: {
              agents: [],
            },
          },
        })
      );

      vi.mocked(useMCPStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          categories: [],
        })
      );

      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {},
        })
      );

      vi.mocked(useSentryStore).mockImplementation((selector: (state: unknown) => unknown) => {
        if (selector === selectUnresolvedCount) {
          return 0;
        }
        return selector({ issues: [] });
      });

      const { result } = renderHook(() => useSidebarBadges(sessionId));

      expect(result.current).toEqual({
        agents: undefined,
        mcp: undefined,
        problems: undefined,
        sentry: undefined,
      });
    });
  });

  // ========================================
  // Session ID Change Tests
  // ========================================

  describe('Session ID Changes', () => {
    it('should update badges when sessionId changes', () => {
      const session1 = 'session-1';
      const session2 = 'session-2';

      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {
            [session1]: {
              agents: [{ id: 'agent-1' }],
            },
            [session2]: {
              agents: [{ id: 'agent-1' }, { id: 'agent-2' }, { id: 'agent-3' }],
            },
          },
        })
      );

      const { result, rerender } = renderHook(({ id }) => useSidebarBadges(id), {
        initialProps: { id: session1 },
      });

      expect(result.current.agents).toBe(1);

      rerender({ id: session2 });

      expect(result.current.agents).toBe(3);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty sessionId', () => {
      vi.mocked(useSessionStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          sessions: {},
        })
      );

      const { result } = renderHook(() => useSidebarBadges(''));

      expect(result.current.agents).toBeUndefined();
    });

    it('should handle null values in diagnostics', () => {
      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({
          diagnostics: {
            '/path/file1.ts': null,
          },
        })
      );

      // This might throw or return undefined - test the actual behavior
      const { result } = renderHook(() => useSidebarBadges(sessionId));

      // Hook should handle gracefully
      expect(result.current.problems).toBeUndefined();
    });

    it('should memoize problems computation', () => {
      const diagnostics = {
        '/path/file1.ts': [{ severity: DiagnosticSeverity.Error, message: 'Error' }],
      };

      vi.mocked(useDiagnosticsStore).mockImplementation((selector: (state: unknown) => unknown) =>
        selector({ diagnostics })
      );

      const { result, rerender } = renderHook(() => useSidebarBadges(sessionId));

      const firstProblems = result.current.problems;

      rerender();

      // Same diagnostics should produce same result (memoized)
      expect(result.current.problems).toBe(firstProblems);
    });
  });
});
