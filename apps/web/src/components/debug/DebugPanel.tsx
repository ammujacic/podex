'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Bug,
  Play,
  Pause,
  Square,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRight,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Circle,
  Terminal,
  Variable,
  Layers,
  AlertCircle,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useDebugStore,
  DAPClient,
  type StackFrame,
  type Scope,
  type Variable as VariableType,
  type BreakpointConfig,
  type DebugState,
} from '@/lib/debug/DAPClient';

// Alias debug step icons (lucide-react doesn't have debug-specific icons)
const StepInto = ArrowDownToLine;
const StepOut = ArrowUpFromLine;
const StepOver = ArrowRight;

// ============================================================================
// Debug Controls
// ============================================================================

interface DebugControlsProps {
  state: DebugState;
  currentThreadId: number | null;
  onContinue: () => void;
  onPause: () => void;
  onStepOver: () => void;
  onStepInto: () => void;
  onStepOut: () => void;
  onRestart: () => void;
  onStop: () => void;
}

function DebugControls({
  state,
  currentThreadId,
  onContinue,
  onPause,
  onStepOver,
  onStepInto,
  onStepOut,
  onRestart,
  onStop,
}: DebugControlsProps) {
  const isStopped = state === 'stopped';
  const isRunning = state === 'running';
  const canStep = isStopped && currentThreadId !== null;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-elevated border-b border-border-subtle">
      {isRunning ? (
        <button
          onClick={onPause}
          className="p-1.5 rounded hover:bg-overlay text-yellow-400"
          title="Pause (F6)"
        >
          <Pause className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={onContinue}
          disabled={!isStopped}
          className="p-1.5 rounded hover:bg-overlay text-green-400 disabled:opacity-50 disabled:text-text-muted"
          title="Continue (F5)"
        >
          <Play className="h-4 w-4" />
        </button>
      )}

      <button
        onClick={onStepOver}
        disabled={!canStep}
        className="p-1.5 rounded hover:bg-overlay text-text-secondary disabled:opacity-50 disabled:text-text-muted"
        title="Step Over (F10)"
      >
        <StepOver className="h-4 w-4" />
      </button>

      <button
        onClick={onStepInto}
        disabled={!canStep}
        className="p-1.5 rounded hover:bg-overlay text-text-secondary disabled:opacity-50 disabled:text-text-muted"
        title="Step Into (F11)"
      >
        <StepInto className="h-4 w-4" />
      </button>

      <button
        onClick={onStepOut}
        disabled={!canStep}
        className="p-1.5 rounded hover:bg-overlay text-text-secondary disabled:opacity-50 disabled:text-text-muted"
        title="Step Out (Shift+F11)"
      >
        <StepOut className="h-4 w-4" />
      </button>

      <div className="w-px h-4 bg-border-subtle mx-1" />

      <button
        onClick={onRestart}
        disabled={state === 'disconnected'}
        className="p-1.5 rounded hover:bg-overlay text-text-secondary disabled:opacity-50 disabled:text-text-muted"
        title="Restart (Ctrl+Shift+F5)"
      >
        <RotateCcw className="h-4 w-4" />
      </button>

      <button
        onClick={onStop}
        disabled={state === 'disconnected' || state === 'terminated'}
        className="p-1.5 rounded hover:bg-overlay text-red-400 disabled:opacity-50 disabled:text-text-muted"
        title="Stop (Shift+F5)"
      >
        <Square className="h-4 w-4" />
      </button>
    </div>
  );
}

// ============================================================================
// Call Stack Panel
// ============================================================================

interface CallStackPanelProps {
  frames: StackFrame[];
  currentFrameId: number | null;
  onSelectFrame: (frameId: number) => void;
}

function CallStackPanel({ frames, currentFrameId, onSelectFrame }: CallStackPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-text-secondary hover:bg-overlay"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Layers className="h-4 w-4" />
        Call Stack
        <span className="ml-auto text-xs text-text-muted">{frames.length}</span>
      </button>

      {!collapsed && (
        <div className="max-h-48 overflow-y-auto">
          {frames.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted italic">No call stack</div>
          ) : (
            frames.map((frame, index) => (
              <button
                key={frame.id}
                onClick={() => onSelectFrame(frame.id)}
                className={cn(
                  'flex items-start gap-2 w-full px-3 py-1.5 text-left text-xs hover:bg-overlay',
                  currentFrameId === frame.id && 'bg-accent-primary/10'
                )}
              >
                <span className="text-text-muted w-4 text-right">{index}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-text-primary truncate">{frame.name}</div>
                  {frame.source?.path && (
                    <div className="text-text-muted truncate">
                      {frame.source.path.split('/').pop()}:{frame.line}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Variables Panel
// ============================================================================

interface VariableItemProps {
  variable: VariableType;
  depth: number;
  onExpand?: (reference: number) => void;
  expandedRefs: Set<number>;
  childVariables: Map<number, VariableType[]>;
}

function VariableItem({
  variable,
  depth,
  onExpand,
  expandedRefs,
  childVariables,
}: VariableItemProps) {
  const hasChildren = variable.variablesReference > 0;
  const isExpanded = expandedRefs.has(variable.variablesReference);
  const children = childVariables.get(variable.variablesReference) || [];

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-0.5 text-xs hover:bg-overlay cursor-pointer',
          hasChildren && 'cursor-pointer'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => hasChildren && onExpand?.(variable.variablesReference)}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted" />
          )
        ) : (
          <span className="w-3" />
        )}
        <span className="text-text-secondary">{variable.name}</span>
        <span className="text-text-muted">:</span>
        <span
          className={cn(
            'font-mono truncate',
            variable.type === 'string' && 'text-green-400',
            variable.type === 'number' && 'text-blue-400',
            variable.type === 'boolean' && 'text-yellow-400',
            !['string', 'number', 'boolean'].includes(variable.type || '') && 'text-text-primary'
          )}
        >
          {variable.value}
        </span>
        {variable.type && <span className="text-text-muted text-[10px] ml-1">{variable.type}</span>}
      </div>

      {isExpanded &&
        children.map((child) => (
          <VariableItem
            key={child.name}
            variable={child}
            depth={depth + 1}
            onExpand={onExpand}
            expandedRefs={expandedRefs}
            childVariables={childVariables}
          />
        ))}
    </div>
  );
}

interface VariablesPanelProps {
  scopes: Scope[];
  variables: Map<number, VariableType[]>;
  onLoadVariables: (reference: number) => void;
}

function VariablesPanel({ scopes, variables, onLoadVariables }: VariablesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedScopes, setExpandedScopes] = useState<Set<number>>(new Set());
  const [expandedRefs, setExpandedRefs] = useState<Set<number>>(new Set());

  const toggleScope = (reference: number) => {
    setExpandedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(reference)) {
        next.delete(reference);
      } else {
        next.add(reference);
        onLoadVariables(reference);
      }
      return next;
    });
  };

  const toggleVariable = (reference: number) => {
    setExpandedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(reference)) {
        next.delete(reference);
      } else {
        next.add(reference);
        onLoadVariables(reference);
      }
      return next;
    });
  };

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-text-secondary hover:bg-overlay"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Variable className="h-4 w-4" />
        Variables
      </button>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto">
          {scopes.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted italic">No variables</div>
          ) : (
            scopes.map((scope) => (
              <div key={scope.variablesReference}>
                <button
                  onClick={() => toggleScope(scope.variablesReference)}
                  className="flex items-center gap-1 w-full px-2 py-1 text-xs font-medium text-text-muted hover:bg-overlay"
                >
                  {expandedScopes.has(scope.variablesReference) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {scope.name}
                </button>

                {expandedScopes.has(scope.variablesReference) &&
                  (variables.get(scope.variablesReference) || []).map((v) => (
                    <VariableItem
                      key={v.name}
                      variable={v}
                      depth={1}
                      onExpand={toggleVariable}
                      expandedRefs={expandedRefs}
                      childVariables={variables}
                    />
                  ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Breakpoints Panel
// ============================================================================

interface BreakpointsPanelProps {
  breakpoints: BreakpointConfig[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onGoTo: (filePath: string, line: number) => void;
}

function BreakpointsPanel({ breakpoints, onToggle, onRemove, onGoTo }: BreakpointsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-text-secondary hover:bg-overlay"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Circle className="h-4 w-4 text-red-400" />
        Breakpoints
        <span className="ml-auto text-xs text-text-muted">{breakpoints.length}</span>
      </button>

      {!collapsed && (
        <div className="max-h-48 overflow-y-auto">
          {breakpoints.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted italic">No breakpoints</div>
          ) : (
            breakpoints.map((bp) => (
              <div
                key={bp.id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-overlay group"
              >
                <input
                  type="checkbox"
                  checked={bp.enabled}
                  onChange={() => onToggle(bp.id)}
                  className="w-3 h-3 rounded border-border-default text-red-500"
                />
                <button
                  onClick={() => onGoTo(bp.filePath, bp.line)}
                  className="flex-1 text-left text-text-secondary hover:text-text-primary"
                >
                  <span className="font-mono">{bp.filePath.split('/').pop()}</span>
                  <span className="text-text-muted">:{bp.line}</span>
                </button>
                {!bp.verified && (
                  <span title="Unverified">
                    <AlertCircle className="h-3 w-3 text-yellow-400" />
                  </span>
                )}
                <button
                  onClick={() => onRemove(bp.id)}
                  className="p-0.5 rounded hover:bg-elevated text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Debug Console
// ============================================================================

interface DebugConsoleProps {
  output: { type: 'stdout' | 'stderr' | 'console'; text: string; timestamp: Date }[];
  onEvaluate: (expression: string) => void;
  onClear: () => void;
}

function DebugConsole({ output, onEvaluate, onClear }: DebugConsoleProps) {
  const [input, setInput] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onEvaluate(input.trim());
      setInput('');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <Terminal className="h-4 w-4" />
          Debug Console
        </button>
        <button
          onClick={onClear}
          className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          title="Clear console"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
            {output.map((entry, i) => (
              <div
                key={i}
                className={cn(
                  'py-0.5',
                  entry.type === 'stderr' && 'text-red-400',
                  entry.type === 'stdout' && 'text-text-secondary',
                  entry.type === 'console' && 'text-accent-primary'
                )}
              >
                {entry.text}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-border-subtle p-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Evaluate expression..."
              className="w-full px-2 py-1 rounded bg-elevated border border-border-subtle text-text-primary text-xs font-mono placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </form>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Main Debug Panel
// ============================================================================

interface DebugPanelProps {
  sessionId: string;
  onGoToLocation?: (filePath: string, line: number) => void;
  className?: string;
}

export function DebugPanel({ sessionId, onGoToLocation, className }: DebugPanelProps) {
  const [client, setClient] = useState<DAPClient | null>(null);

  const {
    activeSessionId,
    consoleOutput,
    getActiveSession,
    toggleBreakpoint,
    removeBreakpoint,
    clearConsole,
  } = useDebugStore();

  const session = getActiveSession();

  // Initialize debug client
  useEffect(() => {
    const dapClient = new DAPClient(sessionId);
    setClient(dapClient);
    return () => {
      dapClient.disconnect();
    };
  }, [sessionId]);

  // Handlers
  const handleContinue = useCallback(() => {
    if (client && session?.currentThreadId) {
      client.continue(session.currentThreadId);
    }
  }, [client, session?.currentThreadId]);

  const handlePause = useCallback(() => {
    if (client && session?.currentThreadId) {
      client.pause(session.currentThreadId);
    }
  }, [client, session?.currentThreadId]);

  const handleStepOver = useCallback(() => {
    if (client && session?.currentThreadId) {
      client.next(session.currentThreadId);
    }
  }, [client, session?.currentThreadId]);

  const handleStepInto = useCallback(() => {
    if (client && session?.currentThreadId) {
      client.stepIn(session.currentThreadId);
    }
  }, [client, session?.currentThreadId]);

  const handleStepOut = useCallback(() => {
    if (client && session?.currentThreadId) {
      client.stepOut(session.currentThreadId);
    }
  }, [client, session?.currentThreadId]);

  const handleRestart = useCallback(() => {
    client?.restart();
  }, [client]);

  const handleStop = useCallback(() => {
    client?.terminate();
  }, [client]);

  const handleSelectFrame = useCallback(
    async (frameId: number) => {
      if (!client || !activeSessionId) return;
      useDebugStore.getState().setCurrentFrame(activeSessionId, frameId);
      await client.scopes(frameId);
    },
    [client, activeSessionId]
  );

  const handleLoadVariables = useCallback(
    async (reference: number) => {
      if (client) {
        await client.variables(reference);
      }
    },
    [client]
  );

  const handleEvaluate = useCallback(
    async (expression: string) => {
      if (client && session?.currentFrameId) {
        try {
          const result = await client.evaluate(expression, session.currentFrameId, 'repl');
          useDebugStore.getState().addConsoleOutput('console', `> ${expression}\n${result.result}`);
        } catch (error) {
          useDebugStore.getState().addConsoleOutput('stderr', `Error: ${error}`);
        }
      }
    },
    [client, session?.currentFrameId]
  );

  const handleGoToBreakpoint = useCallback(
    (filePath: string, line: number) => {
      onGoToLocation?.(filePath, line);
    },
    [onGoToLocation]
  );

  if (!session) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full', className)}>
        <Bug className="h-12 w-12 text-text-muted mb-4" />
        <h3 className="text-lg font-semibold text-text-primary mb-2">No Debug Session</h3>
        <p className="text-sm text-text-muted text-center max-w-xs">
          Start a debug session to see variables, call stack, and breakpoints.
        </p>
        <button className="mt-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void text-sm font-medium">
          <Play className="h-4 w-4" />
          Start Debugging
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <Bug className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">{session.name}</span>
        <span
          className={cn(
            'px-1.5 py-0.5 rounded text-xs',
            session.state === 'running' && 'bg-green-500/20 text-green-400',
            session.state === 'stopped' && 'bg-yellow-500/20 text-yellow-400',
            session.state === 'terminated' && 'bg-red-500/20 text-red-400',
            session.state === 'disconnected' && 'bg-gray-500/20 text-gray-400'
          )}
        >
          {session.state}
        </span>
        {session.stoppedReason && (
          <span className="text-xs text-text-muted">({session.stoppedReason})</span>
        )}
      </div>

      {/* Controls */}
      <DebugControls
        state={session.state}
        currentThreadId={session.currentThreadId}
        onContinue={handleContinue}
        onPause={handlePause}
        onStepOver={handleStepOver}
        onStepInto={handleStepInto}
        onStepOut={handleStepOut}
        onRestart={handleRestart}
        onStop={handleStop}
      />

      {/* Panels */}
      <div className="flex-1 overflow-y-auto">
        <CallStackPanel
          frames={session.stackFrames}
          currentFrameId={session.currentFrameId}
          onSelectFrame={handleSelectFrame}
        />

        <VariablesPanel
          scopes={session.scopes}
          variables={session.variables}
          onLoadVariables={handleLoadVariables}
        />

        <BreakpointsPanel
          breakpoints={session.breakpoints}
          onToggle={toggleBreakpoint}
          onRemove={removeBreakpoint}
          onGoTo={handleGoToBreakpoint}
        />
      </div>

      {/* Console */}
      <DebugConsole output={consoleOutput} onEvaluate={handleEvaluate} onClear={clearConsole} />
    </div>
  );
}
