'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useHooksStore,
  type Hook,
  type HookType,
  HOOK_TYPE_INFO,
  transformHook,
} from '@/stores/hooks';
import { getHooks, createHook, deleteHook, updateHook, testHook } from '@/lib/api';
import { HookEditor } from './HookEditor';
import {
  Webhook,
  Plus,
  Loader2,
  Search,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  Edit,
  CheckCircle,
  XCircle,
  Clock,
  Terminal,
  ChevronDown,
} from 'lucide-react';

interface HooksSettingsProps {
  className?: string;
}

export function HooksSettings({ className }: HooksSettingsProps) {
  const {
    hooks,
    setHooks,
    addHook,
    updateHook: updateHookState,
    deleteHook: deleteHookState,
    loading,
    setLoading,
    setError,
    editingHookId,
    setEditingHook,
    filterType,
    setFilterType,
    showDisabled,
    setShowDisabled,
    getFilteredHooks,
  } = useHooksStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [testingHookId, setTestingHookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    hookId: string;
    success: boolean;
    output?: string;
    error?: string;
  } | null>(null);

  const fetchHooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHooks();
      setHooks(data.map(transformHook));
    } catch (err) {
      setError('Failed to load hooks');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setHooks, setError]);

  // Fetch hooks on mount
  useEffect(() => {
    fetchHooks();
  }, [fetchHooks]);

  const handleCreateHook = async (hookData: Partial<Hook>) => {
    try {
      const data = await createHook(hookData);
      addHook(transformHook(data));
      setShowEditor(false);
    } catch (err) {
      console.error('Failed to create hook:', err);
      throw err;
    }
  };

  const handleUpdateHook = async (hookId: string, updates: Partial<Hook>) => {
    try {
      const data = await updateHook(hookId, updates);
      updateHookState(hookId, transformHook(data));
      setEditingHook(null);
    } catch (err) {
      console.error('Failed to update hook:', err);
      throw err;
    }
  };

  const handleDeleteHook = async (hookId: string) => {
    if (!confirm('Are you sure you want to delete this hook?')) return;

    try {
      await deleteHook(hookId);
      deleteHookState(hookId);
    } catch (err) {
      console.error('Failed to delete hook:', err);
    }
  };

  const handleToggleHook = async (hook: Hook) => {
    try {
      await updateHook(hook.id, { enabled: !hook.enabled });
      updateHookState(hook.id, { enabled: !hook.enabled });
    } catch (err) {
      console.error('Failed to toggle hook:', err);
    }
  };

  const handleTestHook = async (hookId: string) => {
    setTestingHookId(hookId);
    setTestResult(null);

    try {
      const result = await testHook(hookId);
      setTestResult({
        hookId,
        success: result.success,
        output: result.output ?? undefined,
        error: result.error ?? undefined,
      });
    } catch {
      setTestResult({
        hookId,
        success: false,
        error: 'Failed to run test',
      });
    } finally {
      setTestingHookId(null);
    }
  };

  const filteredHooks = getFilteredHooks().filter((h) =>
    searchQuery
      ? h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.command.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const hookTypes = Object.keys(HOOK_TYPE_INFO) as HookType[];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Webhook className="w-5 h-5 text-accent-primary" />
          <h2 className="text-lg font-semibold">Hooks</h2>
          <span className="px-2 py-0.5 text-xs rounded-full bg-surface-secondary text-text-muted">
            {hooks.length}
          </span>
        </div>
        <button
          onClick={() => setShowEditor(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90"
        >
          <Plus className="w-4 h-4" />
          New Hook
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 p-4 border-b border-border-subtle">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search hooks..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="relative">
          <select
            value={filterType || ''}
            onChange={(e) => setFilterType((e.target.value || null) as HookType | null)}
            className="appearance-none pl-3 pr-8 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="">All Types</option>
            {hookTypes.map((type) => (
              <option key={type} value={type}>
                {HOOK_TYPE_INFO[type].label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => setShowDisabled(e.target.checked)}
            className="rounded border-border-subtle"
          />
          Show disabled
        </label>
      </div>

      {/* Hooks List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filteredHooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted">
            <Webhook className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-base font-medium">No hooks found</p>
            <p className="text-sm mt-1">
              {hooks.length === 0
                ? 'Create your first hook to automate tasks'
                : 'Try adjusting your filters'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {filteredHooks.map((hook) => (
              <HookItem
                key={hook.id}
                hook={hook}
                isEditing={editingHookId === hook.id}
                isTesting={testingHookId === hook.id}
                testResult={testResult?.hookId === hook.id ? testResult : null}
                onEdit={() => setEditingHook(hook.id)}
                onToggle={() => handleToggleHook(hook)}
                onDelete={() => handleDeleteHook(hook.id)}
                onTest={() => handleTestHook(hook.id)}
                onSave={(updates) => handleUpdateHook(hook.id, updates)}
                onCancel={() => setEditingHook(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* New Hook Editor Modal */}
      {showEditor && <HookEditor onSave={handleCreateHook} onCancel={() => setShowEditor(false)} />}
    </div>
  );
}

interface HookItemProps {
  hook: Hook;
  isEditing: boolean;
  isTesting: boolean;
  testResult: { success: boolean; output?: string; error?: string } | null;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => void;
  onSave: (updates: Partial<Hook>) => Promise<void>;
  onCancel: () => void;
}

function HookItem({
  hook,
  isEditing,
  isTesting,
  testResult,
  onEdit,
  onToggle,
  onDelete,
  onTest,
  onSave,
  onCancel,
}: HookItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showTestOutput, setShowTestOutput] = useState(false);

  const typeInfo = HOOK_TYPE_INFO[hook.hookType];

  if (isEditing) {
    return (
      <div className="p-4">
        <HookEditor hook={hook} onSave={onSave} onCancel={onCancel} inline />
      </div>
    );
  }

  return (
    <div className="group p-4 hover:bg-surface-hover transition-colors">
      <div className="flex items-start gap-3">
        {/* Enable/Disable Toggle */}
        <button
          onClick={onToggle}
          className={cn(
            'mt-0.5 p-1 rounded transition-colors',
            hook.enabled
              ? 'text-green-500 hover:bg-green-500/20'
              : 'text-text-muted hover:bg-surface-secondary'
          )}
          title={hook.enabled ? 'Disable hook' : 'Enable hook'}
        >
          {hook.enabled ? <CheckCircle className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
        </button>

        {/* Hook Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{hook.name}</h3>
            <span className="px-2 py-0.5 text-xs rounded bg-surface-secondary text-text-muted">
              {typeInfo.label}
            </span>
            {hook.runAsync && (
              <span className="px-2 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-500">
                Async
              </span>
            )}
          </div>

          {hook.description && (
            <p className="mt-1 text-sm text-text-muted truncate">{hook.description}</p>
          )}

          <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              <code className="max-w-[200px] truncate">{hook.command}</code>
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {hook.timeoutMs / 1000}s timeout
            </span>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={cn(
                'mt-3 p-2 rounded text-sm',
                testResult.success
                  ? 'bg-green-500/10 border border-green-500/20'
                  : 'bg-red-500/10 border border-red-500/20'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  {testResult.success ? 'Test passed' : 'Test failed'}
                </span>
                {(testResult.output || testResult.error) && (
                  <button
                    onClick={() => setShowTestOutput(!showTestOutput)}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    {showTestOutput ? 'Hide output' : 'Show output'}
                  </button>
                )}
              </div>
              {showTestOutput && (testResult.output || testResult.error) && (
                <pre className="mt-2 p-2 bg-black/20 rounded text-xs overflow-x-auto">
                  {testResult.output || testResult.error}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onTest}
            disabled={isTesting}
            className="p-2 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary disabled:opacity-50"
            title="Test hook"
          >
            {isTesting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>

          <button
            onClick={onEdit}
            className="p-2 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary"
            title="Edit hook"
          >
            <Edit className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded hover:bg-surface-secondary text-text-muted hover:text-text-primary"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-36 bg-surface-primary border border-border-subtle rounded-lg shadow-lg z-20 py-1">
                  <button
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                    className="w-full px-3 py-2 text-sm text-left text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HooksSettings;
