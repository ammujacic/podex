'use client';

import { useState, useCallback } from 'react';
import {
  Eye,
  HelpCircle,
  Loader2,
  Plus,
  Shield,
  ShieldCheck,
  ShieldOff,
  Zap,
  X,
} from 'lucide-react';
import { type AgentMode } from '@/stores/session';
import { cn } from '@/lib/utils';
import { updateAgentMode } from '@/lib/api';

interface AgentModeSelectorProps {
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  agentId: string;
  agentName: string;
  currentMode: AgentMode;
  currentAllowlist?: string[];
  onModeUpdate?: (mode: AgentMode, allowlist?: string[]) => void;
}

interface ModeOption {
  value: AgentMode;
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  permissions: {
    fileRead: boolean;
    fileWrite: boolean | 'approval';
    commands: boolean | 'approval' | 'allowlist';
  };
}

const modeOptions: ModeOption[] = [
  {
    value: 'plan',
    label: 'Plan',
    description:
      'Read-only analysis mode. Can explore and understand code but cannot make changes.',
    icon: Eye,
    color: 'text-blue-400',
    permissions: {
      fileRead: true,
      fileWrite: false,
      commands: false,
    },
  },
  {
    value: 'ask',
    label: 'Ask',
    description: 'Requires approval for every file edit and command execution.',
    icon: HelpCircle,
    color: 'text-yellow-400',
    permissions: {
      fileRead: true,
      fileWrite: 'approval',
      commands: 'approval',
    },
  },
  {
    value: 'auto',
    label: 'Auto',
    description: 'Auto-edits files. Commands in allowlist run automatically, others need approval.',
    icon: Zap,
    color: 'text-green-400',
    permissions: {
      fileRead: true,
      fileWrite: true,
      commands: 'allowlist',
    },
  },
  {
    value: 'sovereign',
    label: 'Sovereign',
    description: 'Full autonomy. Can edit any file and run any command without approval.',
    icon: ShieldOff,
    color: 'text-red-400',
    permissions: {
      fileRead: true,
      fileWrite: true,
      commands: true,
    },
  },
];

function PermissionBadge({ allowed }: { allowed: boolean | 'approval' | 'allowlist' }) {
  if (allowed === true) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-400">
        <ShieldCheck className="h-3 w-3" />
        Auto
      </span>
    );
  }
  if (allowed === 'approval') {
    return (
      <span className="flex items-center gap-1 text-xs text-yellow-400">
        <Shield className="h-3 w-3" />
        Approval
      </span>
    );
  }
  if (allowed === 'allowlist') {
    return (
      <span className="flex items-center gap-1 text-xs text-blue-400">
        <Shield className="h-3 w-3" />
        Allowlist
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-text-muted">
      <ShieldOff className="h-3 w-3" />
      Disabled
    </span>
  );
}

export function AgentModeSelector({
  onOpenChange,
  sessionId,
  agentId,
  agentName,
  currentMode,
  currentAllowlist = [],
  onModeUpdate,
}: AgentModeSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<AgentMode>(currentMode);
  const [allowlist, setAllowlist] = useState<string[]>(currentAllowlist);
  const [newCommand, setNewCommand] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAddCommand = useCallback(() => {
    const cmd = newCommand.trim();
    if (cmd && !allowlist.includes(cmd)) {
      setAllowlist((prev) => [...prev, cmd]);
      setNewCommand('');
    }
  }, [newCommand, allowlist]);

  const handleRemoveCommand = useCallback((cmd: string) => {
    setAllowlist((prev) => prev.filter((c) => c !== cmd));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCommand();
    }
  };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateAgentMode(
        sessionId,
        agentId,
        selectedMode,
        selectedMode === 'auto' ? allowlist : undefined
      );
      onModeUpdate?.(selectedMode, selectedMode === 'auto' ? allowlist : undefined);
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update agent mode:', error);
    } finally {
      setIsSaving(false);
    }
  }, [sessionId, agentId, selectedMode, allowlist, onModeUpdate, onOpenChange]);

  const hasChanges =
    selectedMode !== currentMode ||
    (selectedMode === 'auto' && JSON.stringify(allowlist) !== JSON.stringify(currentAllowlist));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-border-default bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10">
              <Shield className="h-5 w-5 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Agent Mode Settings</h2>
              <p className="text-sm text-text-muted">
                Configure permissions for {agentName}. This controls what actions the agent can
                perform automatically.
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-2 text-text-muted hover:bg-overlay hover:text-text-primary cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-6 pt-4 pb-2">
          {/* Mode Selection */}
          <div className="space-y-3">
            <div className="grid gap-3">
              {modeOptions.map((mode) => {
                const Icon = mode.icon;
                const isSelected = selectedMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    onClick={() => setSelectedMode(mode.value)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors cursor-pointer',
                      isSelected
                        ? 'border-accent-primary bg-accent-primary/10'
                        : 'border-border-default hover:border-border-focus hover:bg-elevated'
                    )}
                  >
                    <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', mode.color)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">{mode.label}</span>
                        {isSelected && (
                          <span className="rounded-full bg-accent-primary px-2 py-0.5 text-[10px] font-medium text-text-inverse">
                            Selected
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-muted leading-relaxed">
                        {mode.description}
                      </p>
                      <div className="mt-2.5 flex gap-6">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-muted">Files:</span>
                          <PermissionBadge allowed={mode.permissions.fileWrite} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-text-muted">Commands:</span>
                          <PermissionBadge allowed={mode.permissions.commands} />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Command Allowlist (only for Auto mode) */}
          {selectedMode === 'auto' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-text-primary">Command Allowlist</label>
                <p className="text-xs text-text-muted leading-relaxed">
                  Commands matching these patterns will run automatically. Use glob patterns (e.g.,
                  npm *, git status).
                </p>
              </div>

              {/* Add command input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g., npm test, git status, ls *"
                  className="flex-1 rounded-md border border-border-default bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
                />
                <button
                  onClick={handleAddCommand}
                  disabled={!newCommand.trim()}
                  className={cn(
                    'rounded-md px-3 py-2 transition-colors',
                    newCommand.trim()
                      ? 'bg-accent-primary text-text-inverse hover:bg-opacity-90 cursor-pointer'
                      : 'bg-elevated text-text-muted cursor-not-allowed'
                  )}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              {/* Allowlist items */}
              {allowlist.length > 0 ? (
                <div className="rounded-lg border border-border-default divide-y divide-border-subtle">
                  {allowlist.map((cmd, index) => (
                    <div key={index} className="flex items-center justify-between px-3 py-2.5">
                      <code className="text-sm text-text-secondary font-mono">{cmd}</code>
                      <button
                        onClick={() => handleRemoveCommand(cmd)}
                        className="rounded p-1 text-text-muted hover:bg-overlay hover:text-red-400 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border-default p-4 text-center">
                  <p className="text-sm text-text-muted">
                    No commands in allowlist. All commands will require approval.
                  </p>
                </div>
              )}

              {/* Common command suggestions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-text-muted">Quick add:</span>
                {['npm *', 'yarn *', 'pnpm *', 'git status', 'git diff', 'ls *', 'cat *'].map(
                  (cmd) => (
                    <button
                      key={cmd}
                      onClick={() =>
                        !allowlist.includes(cmd) && setAllowlist((prev) => [...prev, cmd])
                      }
                      disabled={allowlist.includes(cmd)}
                      className={cn(
                        'rounded px-2 py-1 text-xs font-mono transition-colors',
                        allowlist.includes(cmd)
                          ? 'bg-elevated text-text-muted cursor-not-allowed'
                          : 'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary cursor-pointer'
                      )}
                    >
                      {cmd}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Sovereign warning */}
          {selectedMode === 'sovereign' && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <div className="flex items-start gap-3">
                <ShieldOff className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-400">Full Autonomy Mode</p>
                  <p className="mt-1.5 text-xs text-text-muted leading-relaxed">
                    The agent will be able to execute any command and modify any file without asking
                    for permission. Only use this mode if you fully trust the agent&apos;s actions.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4 shrink-0">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-overlay hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              hasChanges && !isSaving
                ? 'bg-accent-primary text-text-inverse hover:bg-accent-primary/90 cursor-pointer'
                : 'bg-elevated text-text-muted cursor-not-allowed'
            )}
          >
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
