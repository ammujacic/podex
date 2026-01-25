import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useCostStore,
  formatCost,
  formatTokens,
  getAlertColor,
  getAlertIcon,
  transformCostBreakdown,
  transformBudget,
  transformAlert,
  type CostBreakdown,
  type Budget,
  type BudgetAlert,
  type BudgetStatus,
  type UsageEntry,
  type DailyUsage,
} from '../cost';

// Mock fixtures
const mockCostBreakdown: CostBreakdown = {
  totalCost: 15.5,
  inputCost: 10.0,
  outputCost: 5.0,
  cachedInputCost: 0.5,
  totalTokens: 500000,
  inputTokens: 300000,
  outputTokens: 200000,
  cachedInputTokens: 50000,
  callCount: 25,
  byModel: {
    'claude-opus-4-5': {
      inputTokens: 150000,
      outputTokens: 100000,
      cost: 8.0,
    },
    'claude-sonnet-4-5': {
      inputTokens: 150000,
      outputTokens: 100000,
      cost: 7.5,
    },
  },
  byAgent: {
    'agent-1': {
      tokens: 250000,
      cost: 8.0,
    },
    'agent-2': {
      tokens: 250000,
      cost: 7.5,
    },
  },
};

const mockBudget: Budget = {
  id: 'budget-1',
  userId: 'user-1',
  sessionId: null,
  amount: 100.0,
  period: 'monthly',
  warningThreshold: 0.8,
  hardLimit: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  expiresAt: null,
};

const mockSessionBudget: Budget = {
  id: 'budget-2',
  userId: 'user-1',
  sessionId: 'session-1',
  amount: 25.0,
  period: 'session',
  warningThreshold: 0.8,
  hardLimit: true,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  expiresAt: null,
};

const mockBudgetStatus: BudgetStatus = {
  budget: mockBudget,
  spent: 40.0,
  remaining: 60.0,
  percentageUsed: 40,
  periodStart: new Date('2024-01-01T00:00:00Z'),
};

const mockWarningAlert: BudgetAlert = {
  id: 'alert-1',
  alertType: 'threshold_warning',
  severity: 'warning',
  message: 'You have reached 80% of your monthly budget',
  currentSpent: 80.0,
  budgetAmount: 100.0,
  percentageUsed: 80,
  createdAt: new Date('2024-01-20T12:00:00Z'),
  acknowledged: false,
};

const mockCriticalAlert: BudgetAlert = {
  id: 'alert-2',
  alertType: 'budget_exceeded',
  severity: 'critical',
  message: 'Budget exceeded - session paused',
  currentSpent: 105.0,
  budgetAmount: 100.0,
  percentageUsed: 105,
  createdAt: new Date('2024-01-20T14:00:00Z'),
  acknowledged: false,
};

const mockUsageEntry: UsageEntry = {
  callId: 'call-1',
  model: 'claude-opus-4-5',
  inputTokens: 10000,
  outputTokens: 5000,
  cachedInputTokens: 1000,
  cost: 0.5,
  timestamp: new Date('2024-01-15T10:30:00Z'),
  agentId: 'agent-1',
};

const mockDailyUsage: DailyUsage = {
  date: '2024-01-15',
  totalCost: 5.5,
  totalTokens: 150000,
  callCount: 15,
};

describe('costStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useCostStore.setState({
        sessionCosts: {},
        currentSessionId: null,
        budgets: [],
        budgetStatuses: [],
        alerts: [],
        unreadAlertCount: 0,
        usageHistory: [],
        dailyUsage: [],
        showBudgetDialog: false,
        showAlertDialog: false,
        selectedAlert: null,
        loading: false,
        error: null,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty session costs', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.sessionCosts).toEqual({});
    });

    it('has no current session', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.currentSessionId).toBeNull();
    });

    it('has empty budgets', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.budgets).toEqual([]);
    });

    it('has no alerts', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.alerts).toEqual([]);
      expect(result.current.unreadAlertCount).toBe(0);
    });

    it('has empty usage history', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.usageHistory).toEqual([]);
      expect(result.current.dailyUsage).toEqual([]);
    });

    it('has all dialogs closed', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.showBudgetDialog).toBe(false);
      expect(result.current.showAlertDialog).toBe(false);
      expect(result.current.selectedAlert).toBeNull();
    });

    it('has no loading or error state', () => {
      const { result } = renderHook(() => useCostStore());
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  // ========================================================================
  // Session Cost Management
  // ========================================================================

  describe('Session Cost Management', () => {
    describe('setSessionCost', () => {
      it('sets cost for a session', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
        });

        expect(result.current.sessionCosts['session-1']).toEqual(mockCostBreakdown);
      });

      it('can set costs for multiple sessions', () => {
        const { result } = renderHook(() => useCostStore());
        const cost2: CostBreakdown = { ...mockCostBreakdown, totalCost: 25.0 };

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
          result.current.setSessionCost('session-2', cost2);
        });

        expect(Object.keys(result.current.sessionCosts)).toHaveLength(2);
        expect(result.current.sessionCosts['session-1'].totalCost).toBe(15.5);
        expect(result.current.sessionCosts['session-2'].totalCost).toBe(25.0);
      });

      it('overwrites existing session cost', () => {
        const { result } = renderHook(() => useCostStore());
        const newCost: CostBreakdown = { ...mockCostBreakdown, totalCost: 30.0 };

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
          result.current.setSessionCost('session-1', newCost);
        });

        expect(result.current.sessionCosts['session-1'].totalCost).toBe(30.0);
      });
    });

    describe('updateSessionCost', () => {
      it('updates session cost with partial data', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
          result.current.updateSessionCost('session-1', { totalCost: 20.0 });
        });

        expect(result.current.sessionCosts['session-1'].totalCost).toBe(20.0);
        expect(result.current.sessionCosts['session-1'].inputCost).toBe(10.0);
      });

      it('creates empty cost breakdown if session does not exist', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.updateSessionCost('session-1', { totalCost: 5.0 });
        });

        expect(result.current.sessionCosts['session-1'].totalCost).toBe(5.0);
        expect(result.current.sessionCosts['session-1'].inputTokens).toBe(0);
      });

      it('can update multiple fields at once', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
          result.current.updateSessionCost('session-1', {
            totalCost: 25.0,
            callCount: 50,
            totalTokens: 1000000,
          });
        });

        expect(result.current.sessionCosts['session-1'].totalCost).toBe(25.0);
        expect(result.current.sessionCosts['session-1'].callCount).toBe(50);
        expect(result.current.sessionCosts['session-1'].totalTokens).toBe(1000000);
      });
    });

    describe('setCurrentSession', () => {
      it('sets current session ID', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setCurrentSession('session-1');
        });

        expect(result.current.currentSessionId).toBe('session-1');
      });

      it('can switch between sessions', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setCurrentSession('session-1');
          result.current.setCurrentSession('session-2');
        });

        expect(result.current.currentSessionId).toBe('session-2');
      });

      it('can clear current session', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setCurrentSession('session-1');
          result.current.setCurrentSession(null);
        });

        expect(result.current.currentSessionId).toBeNull();
      });
    });

    describe('getCurrentCost', () => {
      it('returns null when no current session', () => {
        const { result } = renderHook(() => useCostStore());

        const cost = result.current.getCurrentCost();
        expect(cost).toBeNull();
      });

      it('returns null when current session has no cost', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setCurrentSession('session-1');
        });

        const cost = result.current.getCurrentCost();
        expect(cost).toBeNull();
      });

      it('returns cost for current session', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSessionCost('session-1', mockCostBreakdown);
          result.current.setCurrentSession('session-1');
        });

        const cost = result.current.getCurrentCost();
        expect(cost).toEqual(mockCostBreakdown);
      });
    });
  });

  // ========================================================================
  // Budget Management
  // ========================================================================

  describe('Budget Management', () => {
    describe('setBudgets', () => {
      it('sets all budgets', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setBudgets([mockBudget, mockSessionBudget]);
        });

        expect(result.current.budgets).toHaveLength(2);
      });

      it('replaces existing budgets', () => {
        const { result } = renderHook(() => useCostStore());
        const newBudget: Budget = { ...mockBudget, id: 'budget-3' };

        act(() => {
          result.current.setBudgets([mockBudget]);
          result.current.setBudgets([newBudget]);
        });

        expect(result.current.budgets).toHaveLength(1);
        expect(result.current.budgets[0].id).toBe('budget-3');
      });
    });

    describe('addBudget', () => {
      it('adds a budget to the list', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.addBudget(mockBudget);
        });

        expect(result.current.budgets).toHaveLength(1);
        expect(result.current.budgets[0]).toEqual(mockBudget);
      });

      it('can add multiple budgets', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.addBudget(mockBudget);
          result.current.addBudget(mockSessionBudget);
        });

        expect(result.current.budgets).toHaveLength(2);
      });
    });

    describe('removeBudget', () => {
      it('removes budget by ID', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setBudgets([mockBudget, mockSessionBudget]);
          result.current.removeBudget('budget-1');
        });

        expect(result.current.budgets).toHaveLength(1);
        expect(result.current.budgets[0].id).toBe('budget-2');
      });

      it('handles removing non-existent budget gracefully', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setBudgets([mockBudget]);
        });

        expect(() => {
          act(() => {
            result.current.removeBudget('non-existent');
          });
        }).not.toThrow();

        expect(result.current.budgets).toHaveLength(1);
      });
    });

    describe('setBudgetStatuses', () => {
      it('sets budget statuses', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setBudgetStatuses([mockBudgetStatus]);
        });

        expect(result.current.budgetStatuses).toHaveLength(1);
        expect(result.current.budgetStatuses[0]).toEqual(mockBudgetStatus);
      });

      it('replaces existing statuses', () => {
        const { result } = renderHook(() => useCostStore());
        const newStatus: BudgetStatus = {
          ...mockBudgetStatus,
          spent: 50.0,
          remaining: 50.0,
        };

        act(() => {
          result.current.setBudgetStatuses([mockBudgetStatus]);
          result.current.setBudgetStatuses([newStatus]);
        });

        expect(result.current.budgetStatuses).toHaveLength(1);
        expect(result.current.budgetStatuses[0].spent).toBe(50.0);
      });
    });

    describe('getActiveBudgetStatus', () => {
      it('returns null when no current session', () => {
        const { result } = renderHook(() => useCostStore());

        const status = result.current.getActiveBudgetStatus();
        expect(status).toBeNull();
      });

      it('prioritizes session-specific budget', () => {
        const { result } = renderHook(() => useCostStore());
        const sessionStatus: BudgetStatus = {
          ...mockBudgetStatus,
          budget: mockSessionBudget,
        };
        const globalStatus: BudgetStatus = mockBudgetStatus;

        act(() => {
          result.current.setCurrentSession('session-1');
          result.current.setBudgetStatuses([globalStatus, sessionStatus]);
        });

        const status = result.current.getActiveBudgetStatus();
        expect(status?.budget.sessionId).toBe('session-1');
      });

      it('falls back to user-level budget when no session budget', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setCurrentSession('session-1');
          result.current.setBudgetStatuses([mockBudgetStatus]);
        });

        const status = result.current.getActiveBudgetStatus();
        expect(status?.budget.sessionId).toBeNull();
      });
    });
  });

  // ========================================================================
  // Alert Management
  // ========================================================================

  describe('Alert Management', () => {
    describe('setAlerts', () => {
      it('sets all alerts', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert, mockCriticalAlert]);
        });

        expect(result.current.alerts).toHaveLength(2);
      });

      it('calculates unread count correctly', () => {
        const { result } = renderHook(() => useCostStore());
        const acknowledgedAlert: BudgetAlert = { ...mockWarningAlert, acknowledged: true };

        act(() => {
          result.current.setAlerts([mockWarningAlert, mockCriticalAlert, acknowledgedAlert]);
        });

        expect(result.current.unreadAlertCount).toBe(2);
      });

      it('updates unread count when all alerts are acknowledged', () => {
        const { result } = renderHook(() => useCostStore());
        const alert1: BudgetAlert = { ...mockWarningAlert, acknowledged: true };
        const alert2: BudgetAlert = { ...mockCriticalAlert, acknowledged: true };

        act(() => {
          result.current.setAlerts([alert1, alert2]);
        });

        expect(result.current.unreadAlertCount).toBe(0);
      });
    });

    describe('addAlert', () => {
      it('adds alert to the list', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.addAlert(mockWarningAlert);
        });

        expect(result.current.alerts).toHaveLength(1);
        expect(result.current.alerts[0]).toEqual(mockWarningAlert);
      });

      it('adds new alerts to the front', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.addAlert(mockWarningAlert);
          result.current.addAlert(mockCriticalAlert);
        });

        expect(result.current.alerts[0].id).toBe('alert-2');
        expect(result.current.alerts[1].id).toBe('alert-1');
      });

      it('increments unread count for unacknowledged alerts', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.addAlert(mockWarningAlert);
          result.current.addAlert(mockCriticalAlert);
        });

        expect(result.current.unreadAlertCount).toBe(2);
      });

      it('does not increment unread count for acknowledged alerts', () => {
        const { result } = renderHook(() => useCostStore());
        const acknowledgedAlert: BudgetAlert = { ...mockWarningAlert, acknowledged: true };

        act(() => {
          result.current.addAlert(acknowledgedAlert);
        });

        expect(result.current.unreadAlertCount).toBe(0);
      });
    });

    describe('acknowledgeAlert', () => {
      it('marks alert as acknowledged', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert]);
          result.current.acknowledgeAlert('alert-1');
        });

        expect(result.current.alerts[0].acknowledged).toBe(true);
      });

      it('decrements unread count', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert, mockCriticalAlert]);
          result.current.acknowledgeAlert('alert-1');
        });

        expect(result.current.unreadAlertCount).toBe(1);
      });

      it('does not go below zero unread count', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert]);
          result.current.acknowledgeAlert('alert-1');
          result.current.acknowledgeAlert('alert-1'); // Acknowledge again
        });

        expect(result.current.unreadAlertCount).toBe(0);
      });

      it('only acknowledges specified alert', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert, mockCriticalAlert]);
          result.current.acknowledgeAlert('alert-1');
        });

        // Note: mockWarningAlert has id 'alert-1' and mockCriticalAlert has id 'alert-2'
        // The test sets them in order [alert-1, alert-2], so:
        expect(result.current.alerts[0].acknowledged).toBe(true); // alert-1 was acknowledged
        expect(result.current.alerts[1].acknowledged).toBe(false); // alert-2 was not
      });

      it('handles acknowledging non-existent alert gracefully', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setAlerts([mockWarningAlert]);
        });

        expect(() => {
          act(() => {
            result.current.acknowledgeAlert('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Usage Tracking
  // ========================================================================

  describe('Usage Tracking', () => {
    describe('setUsageHistory', () => {
      it('sets usage history', () => {
        const { result } = renderHook(() => useCostStore());
        const entries: UsageEntry[] = [mockUsageEntry];

        act(() => {
          result.current.setUsageHistory(entries);
        });

        expect(result.current.usageHistory).toEqual(entries);
      });

      it('replaces existing usage history', () => {
        const { result } = renderHook(() => useCostStore());
        const entry2: UsageEntry = { ...mockUsageEntry, callId: 'call-2' };

        act(() => {
          result.current.setUsageHistory([mockUsageEntry]);
          result.current.setUsageHistory([entry2]);
        });

        expect(result.current.usageHistory).toHaveLength(1);
        expect(result.current.usageHistory[0].callId).toBe('call-2');
      });
    });

    describe('setDailyUsage', () => {
      it('sets daily usage', () => {
        const { result } = renderHook(() => useCostStore());
        const daily: DailyUsage[] = [mockDailyUsage];

        act(() => {
          result.current.setDailyUsage(daily);
        });

        expect(result.current.dailyUsage).toEqual(daily);
      });

      it('can set multiple days', () => {
        const { result } = renderHook(() => useCostStore());
        const daily1: DailyUsage = mockDailyUsage;
        const daily2: DailyUsage = {
          date: '2024-01-16',
          totalCost: 8.0,
          totalTokens: 200000,
          callCount: 20,
        };

        act(() => {
          result.current.setDailyUsage([daily1, daily2]);
        });

        expect(result.current.dailyUsage).toHaveLength(2);
      });
    });
  });

  // ========================================================================
  // UI State Management
  // ========================================================================

  describe('UI State Management', () => {
    describe('setShowBudgetDialog', () => {
      it('opens budget dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setShowBudgetDialog(true);
        });

        expect(result.current.showBudgetDialog).toBe(true);
      });

      it('closes budget dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setShowBudgetDialog(true);
          result.current.setShowBudgetDialog(false);
        });

        expect(result.current.showBudgetDialog).toBe(false);
      });
    });

    describe('setShowAlertDialog', () => {
      it('opens alert dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setShowAlertDialog(true);
        });

        expect(result.current.showAlertDialog).toBe(true);
      });

      it('closes alert dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setShowAlertDialog(true);
          result.current.setShowAlertDialog(false);
        });

        expect(result.current.showAlertDialog).toBe(false);
      });
    });

    describe('setSelectedAlert', () => {
      it('sets selected alert and opens dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSelectedAlert(mockWarningAlert);
        });

        expect(result.current.selectedAlert).toEqual(mockWarningAlert);
        expect(result.current.showAlertDialog).toBe(true);
      });

      it('clears selected alert and closes dialog', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setSelectedAlert(mockWarningAlert);
          result.current.setSelectedAlert(null);
        });

        expect(result.current.selectedAlert).toBeNull();
        expect(result.current.showAlertDialog).toBe(false);
      });
    });

    describe('setLoading', () => {
      it('sets loading state', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setLoading(true);
        });

        expect(result.current.loading).toBe(true);
      });

      it('clears loading state', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setLoading(true);
          result.current.setLoading(false);
        });

        expect(result.current.loading).toBe(false);
      });
    });

    describe('setError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setError('Something went wrong');
        });

        expect(result.current.error).toBe('Something went wrong');
      });

      it('clears error message', () => {
        const { result } = renderHook(() => useCostStore());

        act(() => {
          result.current.setError('Error');
          result.current.setError(null);
        });

        expect(result.current.error).toBeNull();
      });
    });
  });

  // ========================================================================
  // Utility Functions
  // ========================================================================

  describe('Utility Functions', () => {
    describe('formatCost', () => {
      it('formats zero cost', () => {
        expect(formatCost(0)).toBe('$0.00');
      });

      it('formats small costs with high precision', () => {
        expect(formatCost(0.001)).toBe('$0.0');
        expect(formatCost(0.005)).toBe('$0.0');
      });

      it('formats regular costs with 2 decimals', () => {
        expect(formatCost(1.5)).toBe('$1.50');
        expect(formatCost(15.99)).toBe('$15.99');
        expect(formatCost(100)).toBe('$100.00');
      });

      it('handles null and undefined', () => {
        expect(formatCost(null)).toBe('$0.00');
        expect(formatCost(undefined)).toBe('$0.00');
      });

      it('rounds to 2 decimals', () => {
        expect(formatCost(1.234)).toBe('$1.23');
        expect(formatCost(1.999)).toBe('$2.00');
      });
    });

    describe('formatTokens', () => {
      it('formats zero tokens', () => {
        expect(formatTokens(0)).toBe('0');
      });

      it('formats small token counts as-is', () => {
        expect(formatTokens(50)).toBe('50');
        expect(formatTokens(999)).toBe('999');
      });

      it('formats thousands with K suffix', () => {
        expect(formatTokens(1000)).toBe('1.0K');
        expect(formatTokens(5500)).toBe('5.5K');
        expect(formatTokens(999999)).toBe('1000.0K');
      });

      it('formats millions with M suffix', () => {
        expect(formatTokens(1000000)).toBe('1.0M');
        expect(formatTokens(2500000)).toBe('2.5M');
        expect(formatTokens(10000000)).toBe('10.0M');
      });

      it('handles null and undefined', () => {
        expect(formatTokens(null)).toBe('0');
        expect(formatTokens(undefined)).toBe('0');
      });
    });

    describe('getAlertColor', () => {
      it('returns red for critical alerts', () => {
        expect(getAlertColor(mockCriticalAlert)).toBe('text-red-500');
      });

      it('returns yellow for warning alerts', () => {
        expect(getAlertColor(mockWarningAlert)).toBe('text-yellow-500');
      });

      it('returns blue for info alerts', () => {
        const infoAlert: BudgetAlert = { ...mockWarningAlert, severity: 'info' };
        expect(getAlertColor(infoAlert)).toBe('text-blue-500');
      });
    });

    describe('getAlertIcon', () => {
      it('returns AlertOctagon for budget exceeded', () => {
        expect(getAlertIcon(mockCriticalAlert)).toBe('AlertOctagon');
      });

      it('returns AlertTriangle for threshold warning', () => {
        expect(getAlertIcon(mockWarningAlert)).toBe('AlertTriangle');
      });

      it('returns TrendingUp for unusual spike', () => {
        const spikeAlert: BudgetAlert = {
          ...mockWarningAlert,
          alertType: 'unusual_spike',
        };
        expect(getAlertIcon(spikeAlert)).toBe('TrendingUp');
      });

      it('returns Bell for other alert types', () => {
        const dailyAlert: BudgetAlert = {
          ...mockWarningAlert,
          alertType: 'daily_limit',
        };
        expect(getAlertIcon(dailyAlert)).toBe('Bell');
      });
    });
  });

  // ========================================================================
  // Transform Functions
  // ========================================================================

  describe('Transform Functions', () => {
    describe('transformCostBreakdown', () => {
      it('transforms snake_case API response', () => {
        const apiData = {
          total_cost: 15.5,
          input_cost: 10.0,
          output_cost: 5.0,
          cached_input_cost: 0.5,
          total_tokens: 500000,
          input_tokens: 300000,
          output_tokens: 200000,
          cached_input_tokens: 50000,
          call_count: 25,
          by_model: {},
          by_agent: {},
        };

        const result = transformCostBreakdown(apiData);

        expect(result.totalCost).toBe(15.5);
        expect(result.inputTokens).toBe(300000);
        expect(result.callCount).toBe(25);
      });

      it('transforms camelCase API response', () => {
        const apiData = {
          totalCost: 15.5,
          inputCost: 10.0,
          outputCost: 5.0,
          cachedInputCost: 0.5,
          totalTokens: 500000,
          inputTokens: 300000,
          outputTokens: 200000,
          cachedInputTokens: 50000,
          callCount: 25,
          byModel: {},
          byAgent: {},
        };

        const result = transformCostBreakdown(apiData);

        expect(result.totalCost).toBe(15.5);
        expect(result.inputTokens).toBe(300000);
        expect(result.callCount).toBe(25);
      });

      it('uses default values for missing fields', () => {
        const apiData = {};

        const result = transformCostBreakdown(apiData);

        expect(result.totalCost).toBe(0);
        expect(result.inputTokens).toBe(0);
        expect(result.callCount).toBe(0);
        expect(result.byModel).toEqual({});
      });
    });

    describe('transformBudget', () => {
      it('transforms snake_case API response', () => {
        const apiData = {
          id: 'budget-1',
          user_id: 'user-1',
          session_id: null,
          amount: 100.0,
          period: 'monthly',
          warning_threshold: 0.8,
          hard_limit: false,
          created_at: '2024-01-01T00:00:00Z',
          expires_at: null,
        };

        const result = transformBudget(apiData);

        expect(result.userId).toBe('user-1');
        expect(result.warningThreshold).toBe(0.8);
        expect(result.hardLimit).toBe(false);
        expect(result.createdAt).toBeInstanceOf(Date);
      });

      it('transforms camelCase API response', () => {
        const apiData = {
          id: 'budget-1',
          userId: 'user-1',
          sessionId: null,
          amount: 100.0,
          period: 'monthly',
          warningThreshold: 0.8,
          hardLimit: false,
          createdAt: '2024-01-01T00:00:00Z',
          expiresAt: null,
        };

        const result = transformBudget(apiData);

        expect(result.userId).toBe('user-1');
        expect(result.warningThreshold).toBe(0.8);
        expect(result.hardLimit).toBe(false);
      });

      it('uses default warning threshold if not provided', () => {
        const apiData = {
          id: 'budget-1',
          user_id: 'user-1',
          amount: 100.0,
          period: 'monthly',
          created_at: '2024-01-01T00:00:00Z',
        };

        const result = transformBudget(apiData);

        expect(result.warningThreshold).toBe(0.8);
        expect(result.hardLimit).toBe(false);
      });

      it('handles expires_at date', () => {
        const apiData = {
          id: 'budget-1',
          user_id: 'user-1',
          amount: 100.0,
          period: 'session',
          created_at: '2024-01-01T00:00:00Z',
          expires_at: '2024-02-01T00:00:00Z',
        };

        const result = transformBudget(apiData);

        expect(result.expiresAt).toBeInstanceOf(Date);
        expect(result.expiresAt?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
      });
    });

    describe('transformAlert', () => {
      it('transforms snake_case API response', () => {
        const apiData = {
          id: 'alert-1',
          alert_type: 'threshold_warning',
          severity: 'warning',
          message: 'Budget warning',
          current_spent: 80.0,
          budget_amount: 100.0,
          percentage_used: 80,
          created_at: '2024-01-20T12:00:00Z',
          acknowledged: false,
        };

        const result = transformAlert(apiData);

        expect(result.alertType).toBe('threshold_warning');
        expect(result.currentSpent).toBe(80.0);
        expect(result.budgetAmount).toBe(100.0);
        expect(result.percentageUsed).toBe(80);
        expect(result.createdAt).toBeInstanceOf(Date);
      });

      it('transforms camelCase API response', () => {
        const apiData = {
          id: 'alert-1',
          alertType: 'threshold_warning',
          severity: 'warning',
          message: 'Budget warning',
          currentSpent: 80.0,
          budgetAmount: 100.0,
          percentageUsed: 80,
          createdAt: '2024-01-20T12:00:00Z',
          acknowledged: false,
        };

        const result = transformAlert(apiData);

        expect(result.alertType).toBe('threshold_warning');
        expect(result.currentSpent).toBe(80.0);
        expect(result.budgetAmount).toBe(100.0);
      });

      it('defaults acknowledged to false if not provided', () => {
        const apiData = {
          id: 'alert-1',
          alert_type: 'threshold_warning',
          severity: 'warning',
          message: 'Budget warning',
          current_spent: 80.0,
          budget_amount: 100.0,
          percentage_used: 80,
          created_at: '2024-01-20T12:00:00Z',
        };

        const result = transformAlert(apiData);

        expect(result.acknowledged).toBe(false);
      });
    });
  });
});
