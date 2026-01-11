'use client';

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useSubagentsStore, type Subagent } from '@/stores/subagents';
import { getAgentSubagents, spawnSubagent, cancelSubagent, getSubagentSummary } from '@/lib/api';
import {
  Users,
  Plus,
  Loader2,
  CheckCircle,
  XCircle,
  Circle,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  Clock,
  Cpu,
} from 'lucide-react';

interface SubagentPanelProps {
  agentId: string;
  sessionId: string;
  className?: string;
}

const subagentTypes = [
  { value: 'researcher', label: 'Researcher', description: 'Find information and documentation' },
  { value: 'coder', label: 'Coder', description: 'Write and modify code' },
  { value: 'reviewer', label: 'Reviewer', description: 'Review code for issues' },
  { value: 'tester', label: 'Tester', description: 'Write tests and verify correctness' },
  { value: 'planner', label: 'Planner', description: 'Break down tasks and plan' },
];

/**
 * Panel for managing subagents with isolated contexts.
 */
export function SubagentPanel({ agentId, sessionId: _sessionId, className }: SubagentPanelProps) {
  const {
    setSubagents,
    addSubagent,
    updateSubagent,
    getSubagents,
    getActiveSubagents,
    loadingAgents,
    setLoading,
    expandedSubagentId,
    setExpanded,
  } = useSubagentsStore();

  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [newSubagent, setNewSubagent] = useState({
    type: 'researcher',
    task: '',
    background: false,
  });

  const subagents = getSubagents(agentId);
  const activeSubagents = getActiveSubagents(agentId);
  const isLoading = loadingAgents.has(agentId);

  const fetchSubagents = async () => {
    setLoading(agentId, true);
    try {
      const data = await getAgentSubagents(agentId);
      const transformed: Subagent[] = data.map((s) => ({
        id: s.id,
        parentAgentId: s.parent_agent_id,
        sessionId: s.session_id,
        name: s.name,
        type: s.type,
        task: s.task,
        status: s.status as Subagent['status'],
        background: s.background,
        createdAt: new Date(s.created_at),
        completedAt: s.completed_at ? new Date(s.completed_at) : null,
        resultSummary: s.result_summary,
        error: s.error,
        contextTokens: s.context_tokens,
      }));
      setSubagents(agentId, transformed);
    } catch (err) {
      console.error('Failed to fetch subagents:', err);
    } finally {
      setLoading(agentId, false);
    }
  };

  // Fetch subagents on mount
  useEffect(() => {
    fetchSubagents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const handleSpawn = async () => {
    if (!newSubagent.task.trim()) return;

    setSpawning(true);
    try {
      const data = await spawnSubagent(agentId, {
        subagent_type: newSubagent.type,
        task: newSubagent.task,
        background: newSubagent.background,
      });

      const transformed: Subagent = {
        id: data.id,
        parentAgentId: data.parent_agent_id,
        sessionId: data.session_id,
        name: data.name,
        type: data.type,
        task: data.task,
        status: data.status as Subagent['status'],
        background: data.background,
        createdAt: new Date(data.created_at),
        completedAt: data.completed_at ? new Date(data.completed_at) : null,
        resultSummary: data.result_summary,
        error: data.error,
        contextTokens: data.context_tokens,
      };

      addSubagent(agentId, transformed);
      setNewSubagent({ type: 'researcher', task: '', background: false });
      setShowSpawnForm(false);
    } catch (err) {
      console.error('Failed to spawn subagent:', err);
    } finally {
      setSpawning(false);
    }
  };

  const handleCancel = async (subagentId: string) => {
    try {
      await cancelSubagent(subagentId);
      updateSubagent(subagentId, { status: 'cancelled', completedAt: new Date() });
    } catch (err) {
      console.error('Failed to cancel subagent:', err);
    }
  };

  const handleCopySummary = async (subagentId: string) => {
    try {
      const data = await getSubagentSummary(subagentId);
      await navigator.clipboard.writeText(data.summary);
    } catch (err) {
      console.error('Failed to copy summary:', err);
    }
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const canSpawnMore = activeSubagents.length < 5;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-medium">Subagents</span>
          {activeSubagents.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-500">
              {activeSubagents.length} active
            </span>
          )}
        </div>
        {canSpawnMore && (
          <button
            onClick={() => setShowSpawnForm(!showSpawnForm)}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Spawn new subagent"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Spawn Form */}
      {showSpawnForm && (
        <div className="p-3 border-b border-border-subtle bg-surface-secondary space-y-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Type</label>
            <select
              value={newSubagent.type}
              onChange={(e) => setNewSubagent((s) => ({ ...s, type: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
            >
              {subagentTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-muted">
              {subagentTypes.find((t) => t.value === newSubagent.type)?.description}
            </p>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Task</label>
            <textarea
              value={newSubagent.task}
              onChange={(e) => setNewSubagent((s) => ({ ...s, task: e.target.value }))}
              placeholder="Describe what the subagent should do..."
              rows={2}
              className="w-full px-2 py-1.5 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={newSubagent.background}
              onChange={(e) => setNewSubagent((s) => ({ ...s, background: e.target.checked }))}
              className="rounded border-border-subtle"
            />
            <span>Run in background</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSpawnForm(false)}
              className="flex-1 px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleSpawn}
              disabled={!newSubagent.task.trim() || spawning}
              className="flex-1 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {spawning && <Loader2 className="w-3 h-3 animate-spin" />}
              Spawn
            </button>
          </div>
        </div>
      )}

      {/* Subagent List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : subagents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
            <Users className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No subagents yet</p>
            <p className="text-xs mt-1">Spawn a subagent to delegate tasks with isolated context</p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {subagents.map((sub) => (
              <SubagentItem
                key={sub.id}
                subagent={sub}
                isExpanded={expandedSubagentId === sub.id}
                onToggleExpand={() => setExpanded(expandedSubagentId === sub.id ? null : sub.id)}
                onCancel={() => handleCancel(sub.id)}
                onCopySummary={() => handleCopySummary(sub.id)}
                formatTime={formatTime}
              />
            ))}
          </div>
        )}
      </div>

      {/* Usage Note */}
      {!canSpawnMore && (
        <div className="px-3 py-2 text-xs text-yellow-500 bg-yellow-500/10 border-t border-border-subtle">
          Maximum 5 concurrent subagents reached
        </div>
      )}
    </div>
  );
}

interface SubagentItemProps {
  subagent: Subagent;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onCancel: () => void;
  onCopySummary: () => void;
  formatTime: (date: Date) => string;
}

function SubagentItem({
  subagent,
  isExpanded,
  onToggleExpand,
  onCancel,
  onCopySummary,
  formatTime,
}: SubagentItemProps) {
  const StatusIcon = {
    pending: Circle,
    running: Loader2,
    completed: CheckCircle,
    failed: XCircle,
    cancelled: XCircle,
  }[subagent.status];

  const statusColor = {
    pending: 'text-text-muted',
    running: 'text-yellow-500',
    completed: 'text-green-500',
    failed: 'text-red-500',
    cancelled: 'text-text-muted',
  }[subagent.status];

  return (
    <div className="group">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <StatusIcon
          className={cn(
            'w-4 h-4 flex-shrink-0',
            statusColor,
            subagent.status === 'running' && 'animate-spin'
          )}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{subagent.name}</p>
          <p className="text-xs text-text-muted truncate">{subagent.task}</p>
        </div>

        <div className="flex items-center gap-1">
          {subagent.background && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-text-muted">
              BG
            </span>
          )}
          {(subagent.status === 'pending' || subagent.status === 'running') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="p-1 rounded hover:bg-red-500/20 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 pl-9 space-y-2 bg-surface-secondary/50">
          {/* Status row */}
          <div className="flex items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTime(subagent.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {subagent.contextTokens.toLocaleString()} tokens
            </span>
          </div>

          {/* Summary or Error */}
          {subagent.resultSummary && (
            <div className="relative">
              <p className="text-xs text-text-secondary bg-surface-primary p-2 rounded border border-border-subtle">
                {subagent.resultSummary}
              </p>
              <button
                onClick={onCopySummary}
                className="absolute top-1 right-1 p-1 rounded hover:bg-surface-hover text-text-muted"
                title="Copy summary to clipboard"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {subagent.error && (
            <p className="text-xs text-red-500 bg-red-500/10 p-2 rounded">
              Error: {subagent.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
