'use client';

import React, { useState } from 'react';
import {
  type Hook,
  type HookType,
  type HookTrigger,
  HOOK_TYPE_INFO,
  TRIGGER_TYPE_INFO,
} from '@/stores/hooks';
import { X, Save, Info, Terminal, Clock, Zap, AlertCircle, ChevronDown } from 'lucide-react';

interface HookEditorProps {
  hook?: Hook;
  onSave: (data: Partial<Hook>) => Promise<void>;
  onCancel: () => void;
  inline?: boolean;
}

export function HookEditor({ hook, onSave, onCancel, inline = false }: HookEditorProps) {
  const [name, setName] = useState(hook?.name || '');
  const [description, setDescription] = useState(hook?.description || '');
  const [hookType, setHookType] = useState<HookType>(hook?.hookType || 'post_tool_call');
  const [command, setCommand] = useState(hook?.command || '');
  const [trigger, setTrigger] = useState<HookTrigger>(hook?.condition.trigger || 'always');
  const [toolNames, setToolNames] = useState(hook?.condition.toolNames.join(', ') || '');
  const [fileExtensions, setFileExtensions] = useState(
    hook?.condition.fileExtensions.join(', ') || ''
  );
  const [pattern, setPattern] = useState(hook?.condition.pattern || '');
  const [timeoutMs, setTimeoutMs] = useState(hook?.timeoutMs || 30000);
  const [runAsync, setRunAsync] = useState(hook?.runAsync || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!command.trim()) {
      setError('Command is required');
      return;
    }

    setSaving(true);
    try {
      const hookData: Partial<Hook> = {
        name: name.trim(),
        description: description.trim() || null,
        hookType,
        command: command.trim(),
        condition: {
          trigger,
          toolNames:
            trigger === 'on_tool'
              ? toolNames
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)
              : [],
          fileExtensions:
            trigger === 'on_file_type'
              ? fileExtensions
                  .split(',')
                  .map((e) => e.trim())
                  .filter(Boolean)
              : [],
          pattern: trigger === 'on_pattern' ? pattern : null,
        },
        timeoutMs,
        runAsync,
      };

      await onSave(hookData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save hook');
    } finally {
      setSaving(false);
    }
  };

  const hookTypes = Object.keys(HOOK_TYPE_INFO) as HookType[];
  const triggerTypes = Object.keys(TRIGGER_TYPE_INFO) as HookTrigger[];

  const content = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 text-sm text-red-500 bg-red-500/10 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* Name */}
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Auto Format Python"
          className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this hook do?"
          className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Hook Type */}
      <div>
        <label className="block text-sm font-medium mb-1">Hook Type</label>
        <div className="relative">
          <select
            value={hookType}
            onChange={(e) => setHookType(e.target.value as HookType)}
            className="w-full appearance-none px-3 py-2 pr-8 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          >
            {hookTypes.map((type) => (
              <option key={type} value={type}>
                {HOOK_TYPE_INFO[type].label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
        <p className="mt-1 text-xs text-text-muted">{HOOK_TYPE_INFO[hookType].description}</p>
      </div>

      {/* Command */}
      <div>
        <label className="block text-sm font-medium mb-1">
          <span className="flex items-center gap-1">
            <Terminal className="w-4 h-4" />
            Command
          </span>
        </label>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g., black $PODEX_FILE_PATH"
          rows={2}
          className="w-full px-3 py-2 text-sm font-mono rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary resize-none"
        />
        <div className="mt-1 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Info className="w-3 h-3" />
            Available env vars: PODEX_HOOK_TYPE, PODEX_SESSION_ID, PODEX_AGENT_ID, PODEX_TOOL_NAME,
            PODEX_FILE_PATH
          </span>
        </div>
      </div>

      {/* Trigger Condition */}
      <div>
        <label className="block text-sm font-medium mb-1">Trigger Condition</label>
        <div className="relative">
          <select
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as HookTrigger)}
            className="w-full appearance-none px-3 py-2 pr-8 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          >
            {triggerTypes.map((type) => (
              <option key={type} value={type}>
                {TRIGGER_TYPE_INFO[type].label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
        </div>
      </div>

      {/* Conditional Fields */}
      {trigger === 'on_tool' && (
        <div>
          <label className="block text-sm font-medium mb-1">Tool Names</label>
          <input
            type="text"
            value={toolNames}
            onChange={(e) => setToolNames(e.target.value)}
            placeholder="e.g., write_file, edit_file"
            className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          />
          <p className="mt-1 text-xs text-text-muted">Comma-separated list of tool names</p>
        </div>
      )}

      {trigger === 'on_file_type' && (
        <div>
          <label className="block text-sm font-medium mb-1">File Extensions</label>
          <input
            type="text"
            value={fileExtensions}
            onChange={(e) => setFileExtensions(e.target.value)}
            placeholder="e.g., py, js, ts"
            className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          />
          <p className="mt-1 text-xs text-text-muted">
            Comma-separated list of extensions (without dots)
          </p>
        </div>
      )}

      {trigger === 'on_pattern' && (
        <div>
          <label className="block text-sm font-medium mb-1">Regex Pattern</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="e.g., .*\\.py$"
            className="w-full px-3 py-2 text-sm font-mono rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
          />
          <p className="mt-1 text-xs text-text-muted">
            Regular expression to match against tool name or file path
          </p>
        </div>
      )}

      {/* Advanced Options */}
      <div className="pt-2 border-t border-border-subtle">
        <p className="text-sm font-medium mb-3">Advanced Options</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-text-muted mb-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Timeout (seconds)
              </span>
            </label>
            <input
              type="number"
              value={timeoutMs / 1000}
              onChange={(e) => setTimeoutMs(Number(e.target.value) * 1000)}
              min={1}
              max={300}
              className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runAsync}
                onChange={(e) => setRunAsync(e.target.checked)}
                className="rounded border-border-subtle"
              />
              <span className="flex items-center gap-1 text-sm">
                <Zap className="w-3 h-3" />
                Run asynchronously
              </span>
            </label>
          </div>
        </div>

        {runAsync && (
          <p className="mt-2 text-xs text-yellow-500">
            Async hooks run in the background and don't block the agent.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded border border-border-subtle hover:bg-surface-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
        >
          {saving ? (
            <>Saving...</>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {hook ? 'Save Changes' : 'Create Hook'}
            </>
          )}
        </button>
      </div>
    </form>
  );

  if (inline) {
    return (
      <div className="p-4 bg-surface-secondary rounded-lg border border-border-subtle">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-surface-primary rounded-lg shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h3 className="text-lg font-semibold">{hook ? 'Edit Hook' : 'Create New Hook'}</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-surface-hover text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">{content}</div>
      </div>
    </div>
  );
}

export default HookEditor;
