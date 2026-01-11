import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type HookType =
  | 'pre_tool_call'
  | 'post_tool_call'
  | 'pre_compact'
  | 'post_compact'
  | 'session_start'
  | 'session_end'
  | 'subagent_start'
  | 'subagent_stop'
  | 'message_received'
  | 'response_generated';

export type HookTrigger = 'always' | 'on_tool' | 'on_file_type' | 'on_pattern';

export interface HookCondition {
  trigger: HookTrigger;
  toolNames: string[];
  fileExtensions: string[];
  pattern: string | null;
}

export interface Hook {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  hookType: HookType;
  command: string;
  condition: HookCondition;
  enabled: boolean;
  timeoutMs: number;
  runAsync: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HookExecution {
  hookId: string;
  success: boolean;
  output: string | null;
  error: string | null;
  durationMs: number;
  timestamp: Date;
}

interface HooksState {
  hooks: Hook[];
  executions: HookExecution[];
  loading: boolean;
  error: string | null;
  editingHookId: string | null;
  filterType: HookType | null;
  showDisabled: boolean;

  // Actions
  setHooks: (hooks: Hook[]) => void;
  addHook: (hook: Hook) => void;
  updateHook: (hookId: string, updates: Partial<Hook>) => void;
  deleteHook: (hookId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setEditingHook: (hookId: string | null) => void;
  setFilterType: (type: HookType | null) => void;
  setShowDisabled: (show: boolean) => void;
  addExecution: (execution: HookExecution) => void;
  clearExecutions: (hookId?: string) => void;

  // Computed
  getHooksByType: (type: HookType) => Hook[];
  getFilteredHooks: () => Hook[];
  getRecentExecutions: (hookId: string, limit?: number) => HookExecution[];
}

export const useHooksStore = create<HooksState>()(
  devtools(
    (set, get) => ({
      hooks: [],
      executions: [],
      loading: false,
      error: null,
      editingHookId: null,
      filterType: null,
      showDisabled: false,

      setHooks: (hooks) => set({ hooks }),

      addHook: (hook) =>
        set((state) => ({
          hooks: [...state.hooks, hook],
        })),

      updateHook: (hookId, updates) =>
        set((state) => ({
          hooks: state.hooks.map((h) =>
            h.id === hookId ? { ...h, ...updates, updatedAt: new Date() } : h
          ),
        })),

      deleteHook: (hookId) =>
        set((state) => ({
          hooks: state.hooks.filter((h) => h.id !== hookId),
          editingHookId: state.editingHookId === hookId ? null : state.editingHookId,
        })),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error }),

      setEditingHook: (hookId) => set({ editingHookId: hookId }),

      setFilterType: (type) => set({ filterType: type }),

      setShowDisabled: (show) => set({ showDisabled: show }),

      addExecution: (execution) =>
        set((state) => ({
          executions: [...state.executions.slice(-99), execution],
        })),

      clearExecutions: (hookId) =>
        set((state) => ({
          executions: hookId ? state.executions.filter((e) => e.hookId !== hookId) : [],
        })),

      getHooksByType: (type) => {
        const { hooks, showDisabled } = get();
        return hooks.filter((h) => h.hookType === type && (showDisabled || h.enabled));
      },

      getFilteredHooks: () => {
        const { hooks, filterType, showDisabled } = get();
        let filtered = hooks;

        if (filterType) {
          filtered = filtered.filter((h) => h.hookType === filterType);
        }

        if (!showDisabled) {
          filtered = filtered.filter((h) => h.enabled);
        }

        return filtered;
      },

      getRecentExecutions: (hookId, limit = 10) => {
        const { executions } = get();
        return executions.filter((e) => e.hookId === hookId).slice(-limit);
      },
    }),
    { name: 'hooks-store' }
  )
);

// Hook type metadata for UI
export const HOOK_TYPE_INFO: Record<
  HookType,
  { label: string; description: string; icon: string }
> = {
  pre_tool_call: {
    label: 'Pre-Tool Call',
    description: 'Runs before a tool is executed',
    icon: 'Play',
  },
  post_tool_call: {
    label: 'Post-Tool Call',
    description: 'Runs after a tool is executed',
    icon: 'CheckCircle',
  },
  pre_compact: {
    label: 'Pre-Compact',
    description: 'Runs before context compaction',
    icon: 'Compress',
  },
  post_compact: {
    label: 'Post-Compact',
    description: 'Runs after context compaction',
    icon: 'Archive',
  },
  session_start: {
    label: 'Session Start',
    description: 'Runs when a new session starts',
    icon: 'LogIn',
  },
  session_end: {
    label: 'Session End',
    description: 'Runs when a session ends',
    icon: 'LogOut',
  },
  subagent_start: {
    label: 'Subagent Start',
    description: 'Runs when a subagent is spawned',
    icon: 'UserPlus',
  },
  subagent_stop: {
    label: 'Subagent Stop',
    description: 'Runs when a subagent completes',
    icon: 'UserMinus',
  },
  message_received: {
    label: 'Message Received',
    description: 'Runs when a user message is received',
    icon: 'MessageCircle',
  },
  response_generated: {
    label: 'Response Generated',
    description: 'Runs after agent generates a response',
    icon: 'MessageSquare',
  },
};

export const TRIGGER_TYPE_INFO: Record<HookTrigger, { label: string; description: string }> = {
  always: {
    label: 'Always',
    description: 'Run this hook every time',
  },
  on_tool: {
    label: 'Specific Tools',
    description: 'Only run for specific tool names',
  },
  on_file_type: {
    label: 'File Types',
    description: 'Only run for specific file extensions',
  },
  on_pattern: {
    label: 'Pattern Match',
    description: 'Run when a regex pattern matches',
  },
};

// Transform API response to store format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformHook(data: any): Hook {
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    description: data.description,
    hookType: data.hook_type as HookType,
    command: data.command,
    condition: {
      trigger: data.condition.trigger as HookTrigger,
      toolNames: data.condition.tool_names || [],
      fileExtensions: data.condition.file_extensions || [],
      pattern: data.condition.pattern,
    },
    enabled: data.enabled,
    timeoutMs: data.timeout_ms,
    runAsync: data.run_async,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

// Transform store format to API request
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toApiFormat(hook: Partial<Hook>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};

  if (hook.name !== undefined) result.name = hook.name;
  if (hook.description !== undefined) result.description = hook.description;
  if (hook.hookType !== undefined) result.hook_type = hook.hookType;
  if (hook.command !== undefined) result.command = hook.command;
  if (hook.enabled !== undefined) result.enabled = hook.enabled;
  if (hook.timeoutMs !== undefined) result.timeout_ms = hook.timeoutMs;
  if (hook.runAsync !== undefined) result.run_async = hook.runAsync;
  if (hook.condition !== undefined) {
    result.condition = {
      trigger: hook.condition.trigger,
      tool_names: hook.condition.toolNames,
      file_extensions: hook.condition.fileExtensions,
      pattern: hook.condition.pattern,
    };
  }

  return result;
}
