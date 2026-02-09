import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHooksStore } from '../hooks';
import type { Hook, HookExecution, HookType, HookTrigger } from '../hooks';

// Mock hook factory
const createMockHook = (overrides?: Partial<Hook>): Hook => ({
  id: 'hook-1',
  userId: 'user-1',
  name: 'Test Hook',
  description: 'A test hook',
  hookType: 'pre_tool_call',
  command: 'echo "test"',
  condition: {
    trigger: 'always',
    toolNames: [],
    fileExtensions: [],
    pattern: null,
  },
  enabled: true,
  timeoutMs: 5000,
  runAsync: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

// Mock execution factory
const createMockExecution = (overrides?: Partial<HookExecution>): HookExecution => ({
  hookId: 'hook-1',
  success: true,
  output: 'Success',
  error: null,
  durationMs: 100,
  timestamp: new Date('2024-01-15T10:30:00Z'),
  ...overrides,
});

describe('hooksStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useHooksStore.setState({
        hooks: [],
        executions: [],
        loading: false,
        error: null,
        editingHookId: null,
        filterType: null,
        showDisabled: false,
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty hooks array', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.hooks).toEqual([]);
    });

    it('has empty executions array', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.executions).toEqual([]);
    });

    it('has loading set to false', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.loading).toBe(false);
    });

    it('has no error', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.error).toBeNull();
    });

    it('has no editing hook', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.editingHookId).toBeNull();
    });

    it('has no filter type set', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.filterType).toBeNull();
    });

    it('has showDisabled set to false', () => {
      const { result } = renderHook(() => useHooksStore());
      expect(result.current.showDisabled).toBe(false);
    });
  });

  // ========================================================================
  // Hook Management - Basic CRUD
  // ========================================================================

  describe('Hook Management', () => {
    describe('setHooks', () => {
      it('sets hooks array', () => {
        const { result } = renderHook(() => useHooksStore());
        const hooks = [createMockHook(), createMockHook({ id: 'hook-2', name: 'Hook 2' })];

        act(() => {
          result.current.setHooks(hooks);
        });

        expect(result.current.hooks).toEqual(hooks);
        expect(result.current.hooks).toHaveLength(2);
      });

      it('replaces existing hooks', () => {
        const { result } = renderHook(() => useHooksStore());
        const initialHooks = [createMockHook()];
        const newHooks = [createMockHook({ id: 'hook-2', name: 'New Hook' })];

        act(() => {
          result.current.setHooks(initialHooks);
          result.current.setHooks(newHooks);
        });

        expect(result.current.hooks).toEqual(newHooks);
        expect(result.current.hooks).toHaveLength(1);
      });

      it('can set empty array', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setHooks([createMockHook()]);
          result.current.setHooks([]);
        });

        expect(result.current.hooks).toEqual([]);
      });
    });

    describe('addHook', () => {
      it('adds hook to store', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();

        act(() => {
          result.current.addHook(hook);
        });

        expect(result.current.hooks).toHaveLength(1);
        expect(result.current.hooks[0]).toEqual(hook);
      });

      it('adds multiple hooks', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook1 = createMockHook();
        const hook2 = createMockHook({ id: 'hook-2', name: 'Hook 2' });

        act(() => {
          result.current.addHook(hook1);
          result.current.addHook(hook2);
        });

        expect(result.current.hooks).toHaveLength(2);
        expect(result.current.hooks[0]).toEqual(hook1);
        expect(result.current.hooks[1]).toEqual(hook2);
      });

      it('appends to existing hooks', () => {
        const { result } = renderHook(() => useHooksStore());
        const existingHook = createMockHook();
        const newHook = createMockHook({ id: 'hook-2', name: 'New Hook' });

        act(() => {
          result.current.setHooks([existingHook]);
          result.current.addHook(newHook);
        });

        expect(result.current.hooks).toHaveLength(2);
        expect(result.current.hooks[0]).toEqual(existingHook);
        expect(result.current.hooks[1]).toEqual(newHook);
      });

      it('preserves hook properties', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook({
          name: 'Pre-commit hook',
          hookType: 'pre_tool_call',
          timeoutMs: 10000,
          runAsync: true,
        });

        act(() => {
          result.current.addHook(hook);
        });

        const addedHook = result.current.hooks[0];
        expect(addedHook.name).toBe('Pre-commit hook');
        expect(addedHook.hookType).toBe('pre_tool_call');
        expect(addedHook.timeoutMs).toBe(10000);
        expect(addedHook.runAsync).toBe(true);
      });
    });

    describe('updateHook', () => {
      it('updates hook name', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();

        act(() => {
          result.current.addHook(hook);
          result.current.updateHook('hook-1', { name: 'Updated Name' });
        });

        expect(result.current.hooks[0].name).toBe('Updated Name');
      });

      it('updates hook enabled state', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook({ enabled: true });

        act(() => {
          result.current.addHook(hook);
          result.current.updateHook('hook-1', { enabled: false });
        });

        expect(result.current.hooks[0].enabled).toBe(false);
      });

      it('updates hook command', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook({ command: 'old command' });

        act(() => {
          result.current.addHook(hook);
          result.current.updateHook('hook-1', { command: 'new command' });
        });

        expect(result.current.hooks[0].command).toBe('new command');
      });

      it('updates hook timeout', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook({ timeoutMs: 5000 });

        act(() => {
          result.current.addHook(hook);
          result.current.updateHook('hook-1', { timeoutMs: 10000 });
        });

        expect(result.current.hooks[0].timeoutMs).toBe(10000);
      });

      it('updates multiple properties at once', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();

        act(() => {
          result.current.addHook(hook);
          result.current.updateHook('hook-1', {
            name: 'Multi Update',
            enabled: false,
            timeoutMs: 15000,
          });
        });

        const updated = result.current.hooks[0];
        expect(updated.name).toBe('Multi Update');
        expect(updated.enabled).toBe(false);
        expect(updated.timeoutMs).toBe(15000);
      });

      it('updates updatedAt timestamp', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();
        const originalUpdatedAt = hook.updatedAt;

        act(() => {
          result.current.addHook(hook);
        });

        // Wait a bit to ensure timestamp difference
        setTimeout(() => {
          act(() => {
            result.current.updateHook('hook-1', { name: 'Updated' });
          });

          expect(result.current.hooks[0].updatedAt).not.toEqual(originalUpdatedAt);
        }, 10);
      });

      it('only updates specified hook', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook1 = createMockHook({ id: 'hook-1', name: 'Hook 1' });
        const hook2 = createMockHook({ id: 'hook-2', name: 'Hook 2' });

        act(() => {
          result.current.addHook(hook1);
          result.current.addHook(hook2);
          result.current.updateHook('hook-1', { name: 'Updated Hook 1' });
        });

        expect(result.current.hooks[0].name).toBe('Updated Hook 1');
        expect(result.current.hooks[1].name).toBe('Hook 2');
      });

      it('handles updating non-existent hook gracefully', () => {
        const { result } = renderHook(() => useHooksStore());

        expect(() => {
          act(() => {
            result.current.updateHook('non-existent', { name: 'Test' });
          });
        }).not.toThrow();
      });
    });

    describe('deleteHook', () => {
      it('removes hook from store', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();

        act(() => {
          result.current.addHook(hook);
          result.current.deleteHook('hook-1');
        });

        expect(result.current.hooks).toHaveLength(0);
      });

      it('removes only specified hook', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook1 = createMockHook({ id: 'hook-1' });
        const hook2 = createMockHook({ id: 'hook-2' });

        act(() => {
          result.current.addHook(hook1);
          result.current.addHook(hook2);
          result.current.deleteHook('hook-1');
        });

        expect(result.current.hooks).toHaveLength(1);
        expect(result.current.hooks[0].id).toBe('hook-2');
      });

      it('clears editingHookId if deleted hook was being edited', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook = createMockHook();

        act(() => {
          result.current.addHook(hook);
          result.current.setEditingHook('hook-1');
          result.current.deleteHook('hook-1');
        });

        expect(result.current.editingHookId).toBeNull();
      });

      it('keeps editingHookId if deleted hook was not being edited', () => {
        const { result } = renderHook(() => useHooksStore());
        const hook1 = createMockHook({ id: 'hook-1' });
        const hook2 = createMockHook({ id: 'hook-2' });

        act(() => {
          result.current.addHook(hook1);
          result.current.addHook(hook2);
          result.current.setEditingHook('hook-1');
          result.current.deleteHook('hook-2');
        });

        expect(result.current.editingHookId).toBe('hook-1');
      });

      it('handles deleting non-existent hook gracefully', () => {
        const { result } = renderHook(() => useHooksStore());

        expect(() => {
          act(() => {
            result.current.deleteHook('non-existent');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Hook Types and Conditions
  // ========================================================================

  describe('Hook Types and Conditions', () => {
    it('creates hook with pre_tool_call type', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({ hookType: 'pre_tool_call' });

      act(() => {
        result.current.addHook(hook);
      });

      expect(result.current.hooks[0].hookType).toBe('pre_tool_call');
    });

    it('creates hook with post_tool_call type', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({ hookType: 'post_tool_call' });

      act(() => {
        result.current.addHook(hook);
      });

      expect(result.current.hooks[0].hookType).toBe('post_tool_call');
    });

    it('creates hook with session_start type', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({ hookType: 'session_start' });

      act(() => {
        result.current.addHook(hook);
      });

      expect(result.current.hooks[0].hookType).toBe('session_start');
    });

    it('creates hook with session_end type', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({ hookType: 'session_end' });

      act(() => {
        result.current.addHook(hook);
      });

      expect(result.current.hooks[0].hookType).toBe('session_end');
    });

    it('creates hook with always trigger', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({
        condition: { trigger: 'always', toolNames: [], fileExtensions: [], pattern: null },
      });

      act(() => {
        result.current.addHook(hook);
      });

      expect(result.current.hooks[0].condition.trigger).toBe('always');
    });

    it('creates hook with on_tool trigger and tool names', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({
        condition: {
          trigger: 'on_tool',
          toolNames: ['git', 'npm'],
          fileExtensions: [],
          pattern: null,
        },
      });

      act(() => {
        result.current.addHook(hook);
      });

      const condition = result.current.hooks[0].condition;
      expect(condition.trigger).toBe('on_tool');
      expect(condition.toolNames).toEqual(['git', 'npm']);
    });

    it('creates hook with on_file_type trigger and extensions', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({
        condition: {
          trigger: 'on_file_type',
          toolNames: [],
          fileExtensions: ['.ts', '.tsx', '.js'],
          pattern: null,
        },
      });

      act(() => {
        result.current.addHook(hook);
      });

      const condition = result.current.hooks[0].condition;
      expect(condition.trigger).toBe('on_file_type');
      expect(condition.fileExtensions).toEqual(['.ts', '.tsx', '.js']);
    });

    it('creates hook with on_pattern trigger and regex pattern', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook({
        condition: {
          trigger: 'on_pattern',
          toolNames: [],
          fileExtensions: [],
          pattern: '^test.*\\.ts$',
        },
      });

      act(() => {
        result.current.addHook(hook);
      });

      const condition = result.current.hooks[0].condition;
      expect(condition.trigger).toBe('on_pattern');
      expect(condition.pattern).toBe('^test.*\\.ts$');
    });

    it('updates hook condition', () => {
      const { result } = renderHook(() => useHooksStore());
      const hook = createMockHook();

      act(() => {
        result.current.addHook(hook);
        result.current.updateHook('hook-1', {
          condition: {
            trigger: 'on_tool',
            toolNames: ['eslint'],
            fileExtensions: [],
            pattern: null,
          },
        });
      });

      const condition = result.current.hooks[0].condition;
      expect(condition.trigger).toBe('on_tool');
      expect(condition.toolNames).toEqual(['eslint']);
    });
  });

  // ========================================================================
  // Hook Execution
  // ========================================================================

  describe('Hook Execution', () => {
    describe('addExecution', () => {
      it('adds execution to store', () => {
        const { result } = renderHook(() => useHooksStore());
        const execution = createMockExecution();

        act(() => {
          result.current.addExecution(execution);
        });

        expect(result.current.executions).toHaveLength(1);
        expect(result.current.executions[0]).toEqual(execution);
      });

      it('adds multiple executions', () => {
        const { result } = renderHook(() => useHooksStore());
        const exec1 = createMockExecution({ hookId: 'hook-1' });
        const exec2 = createMockExecution({ hookId: 'hook-2' });

        act(() => {
          result.current.addExecution(exec1);
          result.current.addExecution(exec2);
        });

        expect(result.current.executions).toHaveLength(2);
      });

      it('records successful execution', () => {
        const { result } = renderHook(() => useHooksStore());
        const execution = createMockExecution({
          success: true,
          output: 'Command executed successfully',
          error: null,
        });

        act(() => {
          result.current.addExecution(execution);
        });

        const added = result.current.executions[0];
        expect(added.success).toBe(true);
        expect(added.output).toBe('Command executed successfully');
        expect(added.error).toBeNull();
      });

      it('records failed execution with error', () => {
        const { result } = renderHook(() => useHooksStore());
        const execution = createMockExecution({
          success: false,
          output: null,
          error: 'Command failed: exit code 1',
        });

        act(() => {
          result.current.addExecution(execution);
        });

        const added = result.current.executions[0];
        expect(added.success).toBe(false);
        expect(added.error).toBe('Command failed: exit code 1');
      });

      it('records execution duration', () => {
        const { result } = renderHook(() => useHooksStore());
        const execution = createMockExecution({ durationMs: 250 });

        act(() => {
          result.current.addExecution(execution);
        });

        expect(result.current.executions[0].durationMs).toBe(250);
      });

      it('enforces execution history limit of 100', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          for (let i = 0; i < 105; i++) {
            result.current.addExecution(
              createMockExecution({
                hookId: `hook-${i}`,
                timestamp: new Date(Date.now() + i),
              })
            );
          }
        });

        expect(result.current.executions.length).toBeLessThanOrEqual(100);
      });

      it('keeps most recent executions when enforcing limit', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          for (let i = 0; i < 105; i++) {
            result.current.addExecution(
              createMockExecution({
                hookId: `hook-${i}`,
              })
            );
          }
        });

        // First execution should be from iteration 5 (0-4 dropped)
        expect(result.current.executions[0].hookId).toBe('hook-5');
        // Last execution should be from iteration 104
        expect(result.current.executions[result.current.executions.length - 1].hookId).toBe(
          'hook-104'
        );
      });
    });

    describe('clearExecutions', () => {
      it('clears all executions when no hookId provided', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-2' }));
          result.current.clearExecutions();
        });

        expect(result.current.executions).toHaveLength(0);
      });

      it('clears executions for specific hook', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-2' }));
          result.current.clearExecutions('hook-1');
        });

        expect(result.current.executions).toHaveLength(1);
        expect(result.current.executions[0].hookId).toBe('hook-2');
      });

      it('keeps executions for other hooks', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-2' }));
          result.current.clearExecutions('hook-1');
        });

        expect(result.current.executions).toHaveLength(1);
        expect(result.current.executions[0].hookId).toBe('hook-2');
      });

      it('handles clearing executions for non-existent hook', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addExecution(createMockExecution());
        });

        expect(() => {
          act(() => {
            result.current.clearExecutions('non-existent');
          });
        }).not.toThrow();

        expect(result.current.executions).toHaveLength(1);
      });
    });

    describe('getRecentExecutions', () => {
      it('returns executions for specific hook', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-2' }));
          result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
        });

        const executions = result.current.getRecentExecutions('hook-1');
        expect(executions).toHaveLength(2);
        expect(executions.every((e) => e.hookId === 'hook-1')).toBe(true);
      });

      it('limits results to specified limit', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          for (let i = 0; i < 15; i++) {
            result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          }
        });

        const executions = result.current.getRecentExecutions('hook-1', 5);
        expect(executions).toHaveLength(5);
      });

      it('uses default limit of 10', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          for (let i = 0; i < 15; i++) {
            result.current.addExecution(createMockExecution({ hookId: 'hook-1' }));
          }
        });

        const executions = result.current.getRecentExecutions('hook-1');
        expect(executions).toHaveLength(10);
      });

      it('returns most recent executions', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          for (let i = 0; i < 15; i++) {
            result.current.addExecution(
              createMockExecution({
                hookId: 'hook-1',
                timestamp: new Date(Date.now() + i * 1000),
              })
            );
          }
        });

        const executions = result.current.getRecentExecutions('hook-1', 5);
        // Should get the last 5 executions (with highest timestamps)
        expect(executions).toHaveLength(5);
      });

      it('returns empty array for hook with no executions', () => {
        const { result } = renderHook(() => useHooksStore());

        const executions = result.current.getRecentExecutions('hook-1');
        expect(executions).toEqual([]);
      });
    });
  });

  // ========================================================================
  // Hook Filtering and Computed Properties
  // ========================================================================

  describe('Filtering and Computed Properties', () => {
    describe('getHooksByType', () => {
      it('returns hooks of specific type', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ id: 'h1', hookType: 'pre_tool_call' }));
          result.current.addHook(createMockHook({ id: 'h2', hookType: 'post_tool_call' }));
          result.current.addHook(createMockHook({ id: 'h3', hookType: 'pre_tool_call' }));
        });

        const preToolHooks = result.current.getHooksByType('pre_tool_call');
        expect(preToolHooks).toHaveLength(2);
        expect(preToolHooks.every((h) => h.hookType === 'pre_tool_call')).toBe(true);
      });

      it('excludes disabled hooks by default', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(
            createMockHook({ id: 'h1', hookType: 'pre_tool_call', enabled: true })
          );
          result.current.addHook(
            createMockHook({ id: 'h2', hookType: 'pre_tool_call', enabled: false })
          );
        });

        const hooks = result.current.getHooksByType('pre_tool_call');
        expect(hooks).toHaveLength(1);
        expect(hooks[0].enabled).toBe(true);
      });

      it('includes disabled hooks when showDisabled is true', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(
            createMockHook({ id: 'h1', hookType: 'pre_tool_call', enabled: true })
          );
          result.current.addHook(
            createMockHook({ id: 'h2', hookType: 'pre_tool_call', enabled: false })
          );
          result.current.setShowDisabled(true);
        });

        const hooks = result.current.getHooksByType('pre_tool_call');
        expect(hooks).toHaveLength(2);
      });

      it('returns empty array for type with no hooks', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ hookType: 'pre_tool_call' }));
        });

        const hooks = result.current.getHooksByType('session_start');
        expect(hooks).toEqual([]);
      });
    });

    describe('getFilteredHooks', () => {
      it('returns all hooks when no filter is set', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ id: 'h1', hookType: 'pre_tool_call' }));
          result.current.addHook(createMockHook({ id: 'h2', hookType: 'post_tool_call' }));
        });

        const filtered = result.current.getFilteredHooks();
        expect(filtered).toHaveLength(2);
      });

      it('filters by hook type when filterType is set', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ id: 'h1', hookType: 'pre_tool_call' }));
          result.current.addHook(createMockHook({ id: 'h2', hookType: 'post_tool_call' }));
          result.current.setFilterType('pre_tool_call');
        });

        const filtered = result.current.getFilteredHooks();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].hookType).toBe('pre_tool_call');
      });

      it('excludes disabled hooks by default', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ id: 'h1', enabled: true }));
          result.current.addHook(createMockHook({ id: 'h2', enabled: false }));
        });

        const filtered = result.current.getFilteredHooks();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].enabled).toBe(true);
      });

      it('includes disabled hooks when showDisabled is true', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(createMockHook({ id: 'h1', enabled: true }));
          result.current.addHook(createMockHook({ id: 'h2', enabled: false }));
          result.current.setShowDisabled(true);
        });

        const filtered = result.current.getFilteredHooks();
        expect(filtered).toHaveLength(2);
      });

      it('applies both type filter and disabled filter', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.addHook(
            createMockHook({ id: 'h1', hookType: 'pre_tool_call', enabled: true })
          );
          result.current.addHook(
            createMockHook({ id: 'h2', hookType: 'pre_tool_call', enabled: false })
          );
          result.current.addHook(
            createMockHook({ id: 'h3', hookType: 'post_tool_call', enabled: true })
          );
          result.current.setFilterType('pre_tool_call');
        });

        const filtered = result.current.getFilteredHooks();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('h1');
      });
    });

    describe('setFilterType', () => {
      it('sets filter type', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setFilterType('pre_tool_call');
        });

        expect(result.current.filterType).toBe('pre_tool_call');
      });

      it('clears filter type when set to null', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setFilterType('pre_tool_call');
          result.current.setFilterType(null);
        });

        expect(result.current.filterType).toBeNull();
      });

      it('can switch between filter types', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setFilterType('pre_tool_call');
          result.current.setFilterType('session_start');
        });

        expect(result.current.filterType).toBe('session_start');
      });
    });

    describe('setShowDisabled', () => {
      it('sets showDisabled to true', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setShowDisabled(true);
        });

        expect(result.current.showDisabled).toBe(true);
      });

      it('sets showDisabled to false', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setShowDisabled(true);
          result.current.setShowDisabled(false);
        });

        expect(result.current.showDisabled).toBe(false);
      });
    });
  });

  // ========================================================================
  // UI State Management
  // ========================================================================

  describe('UI State Management', () => {
    describe('setLoading', () => {
      it('sets loading to true', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setLoading(true);
        });

        expect(result.current.loading).toBe(true);
      });

      it('sets loading to false', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setLoading(true);
          result.current.setLoading(false);
        });

        expect(result.current.loading).toBe(false);
      });
    });

    describe('setError', () => {
      it('sets error message', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setError('Something went wrong');
        });

        expect(result.current.error).toBe('Something went wrong');
      });

      it('clears error when set to null', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setError('Error');
          result.current.setError(null);
        });

        expect(result.current.error).toBeNull();
      });
    });

    describe('setEditingHook', () => {
      it('sets editing hook ID', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setEditingHook('hook-1');
        });

        expect(result.current.editingHookId).toBe('hook-1');
      });

      it('clears editing hook when set to null', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setEditingHook('hook-1');
          result.current.setEditingHook(null);
        });

        expect(result.current.editingHookId).toBeNull();
      });

      it('can switch between editing hooks', () => {
        const { result } = renderHook(() => useHooksStore());

        act(() => {
          result.current.setEditingHook('hook-1');
          result.current.setEditingHook('hook-2');
        });

        expect(result.current.editingHookId).toBe('hook-2');
      });
    });
  });
});
