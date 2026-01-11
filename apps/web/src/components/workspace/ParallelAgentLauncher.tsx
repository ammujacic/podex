'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Users,
  Plus,
  Minus,
  Play,
  Loader2,
  GitBranch,
  AlertTriangle,
  Cpu,
  Clock,
  ChevronDown,
} from 'lucide-react';

interface ParallelAgentConfig {
  count: number;
  useWorktrees: boolean;
  taskDistribution: 'split' | 'duplicate' | 'custom';
  mergeStrategy: 'first_wins' | 'last_wins' | 'union' | 'llm_assisted' | 'manual';
  maxConcurrent: number;
}

interface ParallelAgentLauncherProps {
  sessionId: string;
  className?: string;
  onLaunch?: (config: ParallelAgentConfig, tasks: string[]) => void;
  maxAgents?: number;
  isLaunching?: boolean;
}

const MERGE_STRATEGIES = [
  { value: 'union', label: 'Union Merge', description: 'Combine non-conflicting changes' },
  { value: 'llm_assisted', label: 'LLM-Assisted', description: 'Use AI to resolve conflicts' },
  { value: 'first_wins', label: 'First Wins', description: "Keep first agent's changes" },
  { value: 'last_wins', label: 'Last Wins', description: "Keep last agent's changes" },
  { value: 'manual', label: 'Manual', description: 'Review all conflicts manually' },
];

export function ParallelAgentLauncher({
  sessionId: _sessionId,
  className,
  onLaunch,
  maxAgents = 8,
  isLaunching = false,
}: ParallelAgentLauncherProps) {
  const [config, setConfig] = useState<ParallelAgentConfig>({
    count: 2,
    useWorktrees: true,
    taskDistribution: 'split',
    mergeStrategy: 'union',
    maxConcurrent: 4,
  });

  const [tasks, setTasks] = useState<string[]>(['', '']);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const updateCount = (delta: number) => {
    const newCount = Math.max(2, Math.min(maxAgents, config.count + delta));
    setConfig({ ...config, count: newCount });

    // Adjust task list
    if (newCount > tasks.length) {
      setTasks([...tasks, ...Array(newCount - tasks.length).fill('')]);
    } else {
      setTasks(tasks.slice(0, newCount));
    }
  };

  const updateTask = (index: number, value: string) => {
    const newTasks = [...tasks];
    newTasks[index] = value;
    setTasks(newTasks);
  };

  const handleLaunch = () => {
    const validTasks = tasks.filter((t) => t.trim());
    if (validTasks.length === 0) return;
    onLaunch?.(config, validTasks);
  };

  const canLaunch = tasks.some((t) => t.trim()) && !isLaunching;

  return (
    <div className={cn('rounded-lg border border-border-subtle bg-surface-primary', className)}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
        <Users className="w-5 h-5 text-accent-primary" />
        <div>
          <h3 className="font-semibold">Parallel Agent Execution</h3>
          <p className="text-xs text-text-muted">
            Launch multiple agents to work on tasks simultaneously
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Agent Count Selector */}
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Number of Agents</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateCount(-1)}
              disabled={config.count <= 2}
              className="p-1.5 rounded border border-border-subtle hover:bg-surface-hover disabled:opacity-50"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-8 text-center font-semibold">{config.count}</span>
            <button
              onClick={() => updateCount(1)}
              disabled={config.count >= maxAgents}
              className="p-1.5 rounded border border-border-subtle hover:bg-surface-hover disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Task Distribution */}
        <div>
          <label className="text-sm font-medium mb-2 block">Task Distribution</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'split', label: 'Split', desc: 'Divide task among agents' },
              { value: 'duplicate', label: 'Duplicate', desc: 'All work on same task' },
              { value: 'custom', label: 'Custom', desc: 'Assign individual tasks' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setConfig({
                    ...config,
                    taskDistribution: option.value as ParallelAgentConfig['taskDistribution'],
                  })
                }
                className={cn(
                  'p-2 rounded border text-left transition-colors',
                  config.taskDistribution === option.value
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-border-subtle hover:border-border-primary'
                )}
              >
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-xs text-text-muted">{option.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Task Inputs */}
        <div>
          <label className="text-sm font-medium mb-2 block">
            {config.taskDistribution === 'custom' ? 'Agent Tasks' : 'Task Description'}
          </label>

          {config.taskDistribution === 'custom' ? (
            <div className="space-y-2">
              {tasks.map((task, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-surface-secondary text-xs flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={task}
                    onChange={(e) => updateTask(i, e.target.value)}
                    placeholder={`Task for Agent ${i + 1}...`}
                    className="flex-1 px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                  />
                </div>
              ))}
            </div>
          ) : (
            <textarea
              value={tasks[0]}
              onChange={(e) => setTasks([e.target.value])}
              placeholder={
                config.taskDistribution === 'split'
                  ? 'Describe the overall task to split among agents...'
                  : 'Describe the task all agents will work on...'
              }
              rows={3}
              className="w-full px-3 py-2 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary resize-none"
            />
          )}
        </div>

        {/* Git Worktrees Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-500" />
            <div>
              <p className="text-sm font-medium">Use Git Worktrees</p>
              <p className="text-xs text-text-muted">Isolate each agent in a separate branch</p>
            </div>
          </div>
          <button
            onClick={() => setConfig({ ...config, useWorktrees: !config.useWorktrees })}
            className={cn(
              'relative w-11 h-6 rounded-full transition-colors',
              config.useWorktrees ? 'bg-accent-primary' : 'bg-surface-secondary'
            )}
          >
            <span
              className={cn(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                config.useWorktrees ? 'left-6' : 'left-1'
              )}
            />
          </button>
        </div>

        {/* Advanced Options */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary"
          >
            <ChevronDown
              className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-180')}
            />
            Advanced Options
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 pl-6 border-l-2 border-border-subtle">
              {/* Merge Strategy */}
              <div>
                <label className="text-sm font-medium mb-2 block">Merge Strategy</label>
                <div className="relative">
                  <select
                    value={config.mergeStrategy}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        mergeStrategy: e.target.value as ParallelAgentConfig['mergeStrategy'],
                      })
                    }
                    className="w-full appearance-none px-3 py-2 pr-8 text-sm rounded border border-border-subtle bg-surface-primary focus:outline-none focus:border-accent-primary"
                  >
                    {MERGE_STRATEGIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label} - {s.description}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                </div>
              </div>

              {/* Max Concurrent */}
              <div>
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  Max Concurrent Agents
                </label>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={config.maxConcurrent}
                  onChange={(e) =>
                    setConfig({ ...config, maxConcurrent: parseInt(e.target.value) })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-text-muted mt-1">
                  <span>1</span>
                  <span>{config.maxConcurrent} selected</span>
                  <span>8</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Warning for high concurrency */}
        {config.count > 4 && !config.useWorktrees && (
          <div className="flex items-start gap-2 p-3 rounded bg-yellow-500/10 text-yellow-500 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>
              Running many agents without worktree isolation may cause conflicts. Consider enabling
              Git Worktrees.
            </p>
          </div>
        )}

        {/* Info about estimated time */}
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Clock className="w-3 h-3" />
          <span>Estimated completion will depend on task complexity and model selection</span>
        </div>

        {/* Launch Button */}
        <button
          onClick={handleLaunch}
          disabled={!canLaunch}
          className="w-full py-2.5 rounded bg-accent-primary text-white font-medium hover:bg-accent-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLaunching ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Launching Agents...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Launch {config.count} Parallel Agents
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ParallelAgentLauncher;
