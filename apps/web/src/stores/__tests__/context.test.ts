import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useContextStore } from '../context';
import type { ContextUsage, CompactionSettings, CompactionLog } from '../context';

// Mock the config store
vi.mock('../config', () => ({
  useConfigStore: {
    getState: () => ({
      getContextCompactionDefaults: () => ({
        autoCompactEnabled: true,
        autoCompactThresholdPercent: 80,
        customCompactionInstructions: null,
        preserveRecentMessages: 10,
      }),
      getContextUsageDefaults: () => ({
        tokensUsed: 0,
        tokensMax: 100000,
        percentage: 0,
      }),
    }),
  },
}));

describe('contextStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useContextStore.setState({
        agentUsage: {},
        sessionSettings: {},
        compactionHistory: {},
        compactingAgents: new Set(),
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty agent usage', () => {
      const { result } = renderHook(() => useContextStore());
      expect(result.current.agentUsage).toEqual({});
    });

    it('has empty session settings', () => {
      const { result } = renderHook(() => useContextStore());
      expect(result.current.sessionSettings).toEqual({});
    });

    it('has empty compaction history', () => {
      const { result } = renderHook(() => useContextStore());
      expect(result.current.compactionHistory).toEqual({});
    });

    it('has no compacting agents', () => {
      const { result } = renderHook(() => useContextStore());
      expect(result.current.compactingAgents.size).toBe(0);
    });
  });

  // ========================================================================
  // Context Management - Agent Usage
  // ========================================================================

  describe('Agent Usage Management', () => {
    describe('setAgentUsage', () => {
      it('sets agent usage with full data', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 50000,
          tokensMax: 100000,
          percentage: 50,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.agentUsage['agent-1']).toBeDefined();
        expect(result.current.agentUsage['agent-1'].tokensUsed).toBe(50000);
        expect(result.current.agentUsage['agent-1'].tokensMax).toBe(100000);
      });

      it('automatically calculates percentage when setting usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 75000,
          tokensMax: 100000,
          percentage: 0, // Should be recalculated
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.agentUsage['agent-1'].percentage).toBe(75);
      });

      it('can set usage for multiple agents', () => {
        const { result } = renderHook(() => useContextStore());
        const usage1: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(),
        };
        const usage2: ContextUsage = {
          tokensUsed: 60000,
          tokensMax: 100000,
          percentage: 60,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage1);
          result.current.setAgentUsage('agent-2', usage2);
        });

        expect(Object.keys(result.current.agentUsage)).toHaveLength(2);
        expect(result.current.agentUsage['agent-1'].tokensUsed).toBe(30000);
        expect(result.current.agentUsage['agent-2'].tokensUsed).toBe(60000);
      });

      it('replaces existing usage when setting again', () => {
        const { result } = renderHook(() => useContextStore());
        const initialUsage: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(),
        };
        const updatedUsage: ContextUsage = {
          tokensUsed: 80000,
          tokensMax: 100000,
          percentage: 80,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', initialUsage);
          result.current.setAgentUsage('agent-1', updatedUsage);
        });

        expect(result.current.agentUsage['agent-1'].tokensUsed).toBe(80000);
      });
    });

    describe('updateAgentUsage', () => {
      it('updates partial agent usage', () => {
        const { result } = renderHook(() => useContextStore());
        const initialUsage: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(Date.now() - 10000),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', initialUsage);
          result.current.updateAgentUsage('agent-1', { tokensUsed: 50000 });
        });

        expect(result.current.agentUsage['agent-1'].tokensUsed).toBe(50000);
        expect(result.current.agentUsage['agent-1'].tokensMax).toBe(100000);
      });

      it('recalculates percentage on update', () => {
        const { result } = renderHook(() => useContextStore());
        const initialUsage: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', initialUsage);
          result.current.updateAgentUsage('agent-1', { tokensUsed: 85000 });
        });

        expect(result.current.agentUsage['agent-1'].percentage).toBe(85);
      });

      it('updates lastUpdated timestamp', () => {
        const { result } = renderHook(() => useContextStore());
        const oldDate = new Date(Date.now() - 60000);
        const initialUsage: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: oldDate,
        };

        act(() => {
          result.current.setAgentUsage('agent-1', initialUsage);
          result.current.updateAgentUsage('agent-1', { tokensUsed: 35000 });
        });

        expect(result.current.agentUsage['agent-1'].lastUpdated.getTime()).toBeGreaterThan(
          oldDate.getTime()
        );
      });

      it('creates new usage with defaults if agent does not exist', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateAgentUsage('new-agent', { tokensUsed: 10000 });
        });

        expect(result.current.agentUsage['new-agent']).toBeDefined();
        expect(result.current.agentUsage['new-agent'].tokensUsed).toBe(10000);
        expect(result.current.agentUsage['new-agent'].tokensMax).toBe(100000);
      });

      it('can update tokensMax', () => {
        const { result } = renderHook(() => useContextStore());
        const initialUsage: ContextUsage = {
          tokensUsed: 50000,
          tokensMax: 100000,
          percentage: 50,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', initialUsage);
          result.current.updateAgentUsage('agent-1', { tokensMax: 200000 });
        });

        expect(result.current.agentUsage['agent-1'].tokensMax).toBe(200000);
        expect(result.current.agentUsage['agent-1'].percentage).toBe(25); // Recalculated
      });
    });

    describe('clearAgentUsage', () => {
      it('removes agent usage from store', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 50000,
          tokensMax: 100000,
          percentage: 50,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          result.current.clearAgentUsage('agent-1');
        });

        expect(result.current.agentUsage['agent-1']).toBeUndefined();
      });

      it('does not affect other agents', () => {
        const { result } = renderHook(() => useContextStore());
        const usage1: ContextUsage = {
          tokensUsed: 50000,
          tokensMax: 100000,
          percentage: 50,
          lastUpdated: new Date(),
        };
        const usage2: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage1);
          result.current.setAgentUsage('agent-2', usage2);
          result.current.clearAgentUsage('agent-1');
        });

        expect(result.current.agentUsage['agent-1']).toBeUndefined();
        expect(result.current.agentUsage['agent-2']).toBeDefined();
      });

      it('handles clearing non-existent agent gracefully', () => {
        const { result } = renderHook(() => useContextStore());

        expect(() => {
          act(() => {
            result.current.clearAgentUsage('non-existent-agent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Context Management - Session Settings
  // ========================================================================

  describe('Session Settings Management', () => {
    describe('getSessionSettings', () => {
      it('returns default settings for new session', () => {
        const { result } = renderHook(() => useContextStore());

        const settings = result.current.getSessionSettings('new-session');

        expect(settings).toBeDefined();
        expect(settings.autoCompactEnabled).toBe(true);
        expect(settings.autoCompactThresholdPercent).toBe(80);
        expect(settings.preserveRecentMessages).toBe(10);
      });

      it('returns existing settings for configured session', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('session-1', {
            autoCompactThresholdPercent: 90,
          });
        });

        const settings = result.current.getSessionSettings('session-1');
        expect(settings.autoCompactThresholdPercent).toBe(90);
      });
    });

    describe('updateSessionSettings', () => {
      it('updates session settings partially', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('session-1', {
            autoCompactThresholdPercent: 85,
          });
        });

        const settings = result.current.getSessionSettings('session-1');
        expect(settings.autoCompactThresholdPercent).toBe(85);
        expect(settings.autoCompactEnabled).toBe(true); // Default preserved
      });

      it('can update multiple fields', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('session-1', {
            autoCompactEnabled: false,
            autoCompactThresholdPercent: 95,
            customCompactionInstructions: 'Keep code examples',
          });
        });

        const settings = result.current.getSessionSettings('session-1');
        expect(settings.autoCompactEnabled).toBe(false);
        expect(settings.autoCompactThresholdPercent).toBe(95);
        expect(settings.customCompactionInstructions).toBe('Keep code examples');
      });

      it('can update preserveRecentMessages', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('session-1', {
            preserveRecentMessages: 20,
          });
        });

        const settings = result.current.getSessionSettings('session-1');
        expect(settings.preserveRecentMessages).toBe(20);
      });

      it('merges with defaults on first update', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('new-session', {
            autoCompactThresholdPercent: 70,
          });
        });

        const settings = result.current.getSessionSettings('new-session');
        expect(settings.autoCompactThresholdPercent).toBe(70);
        expect(settings.autoCompactEnabled).toBe(true); // From defaults
        expect(settings.preserveRecentMessages).toBe(10); // From defaults
      });

      it('can disable auto-compact', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.updateSessionSettings('session-1', {
            autoCompactEnabled: false,
          });
        });

        const settings = result.current.getSessionSettings('session-1');
        expect(settings.autoCompactEnabled).toBe(false);
      });
    });
  });

  // ========================================================================
  // Context Size - Compaction History
  // ========================================================================

  describe('Compaction History', () => {
    describe('getCompactionHistory', () => {
      it('returns empty array for session without history', () => {
        const { result } = renderHook(() => useContextStore());

        const history = result.current.getCompactionHistory('new-session');

        expect(history).toEqual([]);
      });

      it('returns existing history for session', () => {
        const { result } = renderHook(() => useContextStore());
        const log: CompactionLog = {
          id: 'log-1',
          agentId: 'agent-1',
          tokensBefore: 95000,
          tokensAfter: 50000,
          messagesRemoved: 20,
          messagesPreserved: 10,
          summaryText: 'Compacted old messages',
          triggerType: 'auto',
          createdAt: new Date(),
        };

        act(() => {
          result.current.addCompactionLog('session-1', log);
        });

        const history = result.current.getCompactionHistory('session-1');
        expect(history).toHaveLength(1);
        expect(history[0]).toEqual(log);
      });
    });

    describe('addCompactionLog', () => {
      it('adds compaction log to session history', () => {
        const { result } = renderHook(() => useContextStore());
        const log: CompactionLog = {
          id: 'log-1',
          agentId: 'agent-1',
          tokensBefore: 95000,
          tokensAfter: 50000,
          messagesRemoved: 20,
          messagesPreserved: 10,
          summaryText: 'Compacted old messages',
          triggerType: 'auto',
          createdAt: new Date(),
        };

        act(() => {
          result.current.addCompactionLog('session-1', log);
        });

        const history = result.current.getCompactionHistory('session-1');
        expect(history).toHaveLength(1);
        expect(history[0].id).toBe('log-1');
      });

      it('adds multiple logs chronologically', () => {
        const { result } = renderHook(() => useContextStore());
        const log1: CompactionLog = {
          id: 'log-1',
          agentId: 'agent-1',
          tokensBefore: 95000,
          tokensAfter: 50000,
          messagesRemoved: 20,
          messagesPreserved: 10,
          summaryText: 'First compaction',
          triggerType: 'auto',
          createdAt: new Date(Date.now() - 3600000),
        };
        const log2: CompactionLog = {
          id: 'log-2',
          agentId: 'agent-1',
          tokensBefore: 80000,
          tokensAfter: 40000,
          messagesRemoved: 15,
          messagesPreserved: 10,
          summaryText: 'Second compaction',
          triggerType: 'manual',
          createdAt: new Date(),
        };

        act(() => {
          result.current.addCompactionLog('session-1', log1);
          result.current.addCompactionLog('session-1', log2);
        });

        const history = result.current.getCompactionHistory('session-1');
        expect(history).toHaveLength(2);
        expect(history[0].id).toBe('log-1');
        expect(history[1].id).toBe('log-2');
      });

      it('tracks different trigger types', () => {
        const { result } = renderHook(() => useContextStore());
        const autoLog: CompactionLog = {
          id: 'log-1',
          agentId: 'agent-1',
          tokensBefore: 95000,
          tokensAfter: 50000,
          messagesRemoved: 20,
          messagesPreserved: 10,
          summaryText: null,
          triggerType: 'auto',
          createdAt: new Date(),
        };
        const manualLog: CompactionLog = {
          id: 'log-2',
          agentId: 'agent-1',
          tokensBefore: 90000,
          tokensAfter: 45000,
          messagesRemoved: 18,
          messagesPreserved: 10,
          summaryText: null,
          triggerType: 'manual',
          createdAt: new Date(),
        };
        const thresholdLog: CompactionLog = {
          id: 'log-3',
          agentId: 'agent-1',
          tokensBefore: 85000,
          tokensAfter: 42000,
          messagesRemoved: 16,
          messagesPreserved: 10,
          summaryText: null,
          triggerType: 'threshold',
          createdAt: new Date(),
        };

        act(() => {
          result.current.addCompactionLog('session-1', autoLog);
          result.current.addCompactionLog('session-1', manualLog);
          result.current.addCompactionLog('session-1', thresholdLog);
        });

        const history = result.current.getCompactionHistory('session-1');
        expect(history[0].triggerType).toBe('auto');
        expect(history[1].triggerType).toBe('manual');
        expect(history[2].triggerType).toBe('threshold');
      });

      it('limits history to 50 entries', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          for (let i = 0; i < 60; i++) {
            result.current.addCompactionLog('session-1', {
              id: `log-${i}`,
              agentId: 'agent-1',
              tokensBefore: 90000,
              tokensAfter: 45000,
              messagesRemoved: 15,
              messagesPreserved: 10,
              summaryText: null,
              triggerType: 'auto',
              createdAt: new Date(Date.now() + i * 1000),
            });
          }
        });

        const history = result.current.getCompactionHistory('session-1');
        expect(history).toHaveLength(50);
        expect(history[0].id).toBe('log-10'); // First 10 removed
        expect(history[49].id).toBe('log-59'); // Last entry
      });

      it('does not affect other sessions', () => {
        const { result } = renderHook(() => useContextStore());
        const log1: CompactionLog = {
          id: 'log-1',
          agentId: 'agent-1',
          tokensBefore: 95000,
          tokensAfter: 50000,
          messagesRemoved: 20,
          messagesPreserved: 10,
          summaryText: null,
          triggerType: 'auto',
          createdAt: new Date(),
        };

        act(() => {
          result.current.addCompactionLog('session-1', log1);
        });

        const history1 = result.current.getCompactionHistory('session-1');
        const history2 = result.current.getCompactionHistory('session-2');

        expect(history1).toHaveLength(1);
        expect(history2).toHaveLength(0);
      });
    });
  });

  // ========================================================================
  // Context Size - Compacting State
  // ========================================================================

  describe('Compacting State', () => {
    describe('setCompacting', () => {
      it('marks agent as compacting', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.setCompacting('agent-1', true);
        });

        expect(result.current.isCompacting('agent-1')).toBe(true);
      });

      it('clears compacting state', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.setCompacting('agent-1', true);
          result.current.setCompacting('agent-1', false);
        });

        expect(result.current.isCompacting('agent-1')).toBe(false);
      });

      it('tracks multiple compacting agents', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.setCompacting('agent-1', true);
          result.current.setCompacting('agent-2', true);
        });

        expect(result.current.isCompacting('agent-1')).toBe(true);
        expect(result.current.isCompacting('agent-2')).toBe(true);
        expect(result.current.compactingAgents.size).toBe(2);
      });

      it('removes individual agent from compacting', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.setCompacting('agent-1', true);
          result.current.setCompacting('agent-2', true);
          result.current.setCompacting('agent-1', false);
        });

        expect(result.current.isCompacting('agent-1')).toBe(false);
        expect(result.current.isCompacting('agent-2')).toBe(true);
      });
    });

    describe('isCompacting', () => {
      it('returns false for non-compacting agent', () => {
        const { result } = renderHook(() => useContextStore());

        expect(result.current.isCompacting('agent-1')).toBe(false);
      });

      it('returns true for compacting agent', () => {
        const { result } = renderHook(() => useContextStore());

        act(() => {
          result.current.setCompacting('agent-1', true);
        });

        expect(result.current.isCompacting('agent-1')).toBe(true);
      });
    });
  });

  // ========================================================================
  // Context Metadata - Usage Levels
  // ========================================================================

  describe('Usage Levels', () => {
    describe('getUsageLevel', () => {
      it('returns normal for agent without usage', () => {
        const { result } = renderHook(() => useContextStore());

        expect(result.current.getUsageLevel('agent-1')).toBe('normal');
      });

      it('returns normal for low usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 30000,
          tokensMax: 100000,
          percentage: 30,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('normal');
      });

      it('returns normal for 69% usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 69000,
          tokensMax: 100000,
          percentage: 69,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('normal');
      });

      it('returns warning for 70% usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 70000,
          tokensMax: 100000,
          percentage: 70,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('warning');
      });

      it('returns warning for 89% usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 89000,
          tokensMax: 100000,
          percentage: 89,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('warning');
      });

      it('returns critical for 90% usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 90000,
          tokensMax: 100000,
          percentage: 90,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('critical');
      });

      it('returns critical for 100% usage', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 100000,
          tokensMax: 100000,
          percentage: 100,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
        });

        expect(result.current.getUsageLevel('agent-1')).toBe('critical');
      });
    });
  });

  // ========================================================================
  // Context Metadata - Auto-Compact Decision
  // ========================================================================

  describe('Auto-Compact Decision', () => {
    describe('shouldAutoCompact', () => {
      it('returns false when agent has no usage', () => {
        const { result } = renderHook(() => useContextStore());

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(false);
      });

      it('returns false when auto-compact is disabled', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 85000,
          tokensMax: 100000,
          percentage: 85,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          result.current.updateSessionSettings('session-1', {
            autoCompactEnabled: false,
          });
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(false);
      });

      it('returns false when below threshold', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 75000,
          tokensMax: 100000,
          percentage: 75,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          // Default threshold is 80%
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(false);
      });

      it('returns true when at threshold', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 80000,
          tokensMax: 100000,
          percentage: 80,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          // Default threshold is 80%
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(true);
      });

      it('returns true when above threshold', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 95000,
          tokensMax: 100000,
          percentage: 95,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          // Default threshold is 80%
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(true);
      });

      it('respects custom threshold', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 85000,
          tokensMax: 100000,
          percentage: 85,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          result.current.updateSessionSettings('session-1', {
            autoCompactThresholdPercent: 90, // Raised threshold
          });
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(false);
      });

      it('returns true when above custom threshold', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 92000,
          tokensMax: 100000,
          percentage: 92,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          result.current.updateSessionSettings('session-1', {
            autoCompactThresholdPercent: 90,
          });
        });

        expect(result.current.shouldAutoCompact('agent-1', 'session-1')).toBe(true);
      });

      it('uses default settings for unconfigured session', () => {
        const { result } = renderHook(() => useContextStore());
        const usage: ContextUsage = {
          tokensUsed: 85000,
          tokensMax: 100000,
          percentage: 85,
          lastUpdated: new Date(),
        };

        act(() => {
          result.current.setAgentUsage('agent-1', usage);
          // No session settings configured - should use defaults (80%)
        });

        expect(result.current.shouldAutoCompact('agent-1', 'new-session')).toBe(true);
      });
    });
  });
});
