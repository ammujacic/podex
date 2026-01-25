'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TestTube,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';
import { api } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestCase {
  id: string;
  name: string;
  fullName: string;
  status: TestStatus;
  duration?: number;
  error?: {
    message: string;
    stack?: string;
    expected?: string;
    actual?: string;
  };
  file: string;
  line?: number;
}

export interface TestSuite {
  id: string;
  name: string;
  file: string;
  status: TestStatus;
  tests: TestCase[];
  suites: TestSuite[];
  duration?: number;
}

export interface TestRun {
  id: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'cancelled';
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration?: number;
}

// ============================================================================
// Store
// ============================================================================

interface TestStore {
  suites: TestSuite[];
  currentRun: TestRun | null;
  selectedTestId: string | null;
  watchMode: boolean;
  filter: 'all' | 'failed' | 'passed' | 'skipped';
  searchQuery: string;

  setSuites: (suites: TestSuite[]) => void;
  updateTest: (testId: string, updates: Partial<TestCase>) => void;
  updateSuite: (suiteId: string, updates: Partial<TestSuite>) => void;
  startRun: (totalTests: number) => void;
  endRun: (status: 'completed' | 'cancelled') => void;
  updateRunStats: (passed: number, failed: number, skipped: number) => void;
  setSelectedTest: (testId: string | null) => void;
  setWatchMode: (enabled: boolean) => void;
  setFilter: (filter: 'all' | 'failed' | 'passed' | 'skipped') => void;
  setSearchQuery: (query: string) => void;
}

export const useTestStore = create<TestStore>((set) => ({
  suites: [],
  currentRun: null,
  selectedTestId: null,
  watchMode: false,
  filter: 'all',
  searchQuery: '',

  setSuites: (suites) => set({ suites }),

  updateTest: (testId, updates) =>
    set((state) => ({
      suites: updateTestInSuites(state.suites, testId, updates),
    })),

  updateSuite: (suiteId, updates) =>
    set((state) => ({
      suites: state.suites.map((s) => (s.id === suiteId ? { ...s, ...updates } : s)),
    })),

  startRun: (totalTests) =>
    set({
      currentRun: {
        id: `run-${Date.now()}`,
        startTime: new Date(),
        status: 'running',
        totalTests,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
      },
    }),

  endRun: (status) =>
    set((state) => ({
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            status,
            endTime: new Date(),
            duration: Date.now() - state.currentRun.startTime.getTime(),
          }
        : null,
    })),

  updateRunStats: (passed, failed, skipped) =>
    set((state) => ({
      currentRun: state.currentRun
        ? {
            ...state.currentRun,
            passedTests: passed,
            failedTests: failed,
            skippedTests: skipped,
          }
        : null,
    })),

  setSelectedTest: (testId) => set({ selectedTestId: testId }),
  setWatchMode: (enabled) => set({ watchMode: enabled }),
  setFilter: (filter) => set({ filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));

// Helper to update test in nested suites
function updateTestInSuites(
  suites: TestSuite[],
  testId: string,
  updates: Partial<TestCase>
): TestSuite[] {
  return suites.map((suite) => ({
    ...suite,
    tests: suite.tests.map((t) => (t.id === testId ? { ...t, ...updates } : t)),
    suites: updateTestInSuites(suite.suites, testId, updates),
  }));
}

// ============================================================================
// Status Icon
// ============================================================================

function StatusIcon({ status, size = 'sm' }: { status: TestStatus; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  switch (status) {
    case 'passed':
      return <CheckCircle2 className={cn(sizeClass, 'text-green-400')} />;
    case 'failed':
      return <XCircle className={cn(sizeClass, 'text-red-400')} />;
    case 'running':
      return <Loader2 className={cn(sizeClass, 'text-yellow-400 animate-spin')} />;
    case 'skipped':
      return <AlertCircle className={cn(sizeClass, 'text-gray-400')} />;
    default:
      return <Clock className={cn(sizeClass, 'text-text-muted')} />;
  }
}

// ============================================================================
// Test Item
// ============================================================================

interface TestItemProps {
  test: TestCase;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
  depth: number;
}

function TestItem({ test, selected, onSelect, onRun, depth }: TestItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-overlay group',
        selected && 'bg-accent-primary/10'
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      onClick={onSelect}
    >
      <StatusIcon status={test.status} />
      <span className="flex-1 text-sm text-text-secondary truncate">{test.name}</span>
      {test.duration !== undefined && (
        <span className="text-xs text-text-muted">{test.duration}ms</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRun();
        }}
        className="p-1 rounded hover:bg-elevated opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary"
        title="Run test"
      >
        <Play className="h-3 w-3" />
      </button>
    </div>
  );
}

// ============================================================================
// Suite Item
// ============================================================================

interface SuiteItemProps {
  suite: TestSuite;
  selectedTestId: string | null;
  onSelectTest: (testId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onRunTest: (testId: string) => void;
  depth: number;
  expandedSuites: Set<string>;
  onToggleSuite: (suiteId: string) => void;
}

function SuiteItem({
  suite,
  selectedTestId,
  onSelectTest,
  onRunSuite,
  onRunTest,
  depth,
  expandedSuites,
  onToggleSuite,
}: SuiteItemProps) {
  const isExpanded = expandedSuites.has(suite.id);
  const stats = useMemo(() => {
    const countTests = (s: TestSuite): { passed: number; failed: number; total: number } => {
      let passed = 0;
      let failed = 0;
      let total = 0;

      for (const test of s.tests) {
        total++;
        if (test.status === 'passed') passed++;
        if (test.status === 'failed') failed++;
      }

      for (const child of s.suites) {
        const childStats = countTests(child);
        passed += childStats.passed;
        failed += childStats.failed;
        total += childStats.total;
      }

      return { passed, failed, total };
    };
    return countTests(suite);
  }, [suite]);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-overlay group"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onToggleSuite(suite.id)}
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}
        <StatusIcon status={suite.status} />
        <span className="flex-1 text-sm font-medium text-text-primary truncate">{suite.name}</span>
        <span className="text-xs text-text-muted">
          {stats.passed > 0 && <span className="text-green-400">{stats.passed}</span>}
          {stats.passed > 0 && stats.failed > 0 && ' / '}
          {stats.failed > 0 && <span className="text-red-400">{stats.failed}</span>}
          {(stats.passed > 0 || stats.failed > 0) && ` / ${stats.total}`}
          {stats.passed === 0 && stats.failed === 0 && stats.total}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRunSuite(suite.id);
          }}
          className="p-1 rounded hover:bg-elevated opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary"
          title="Run suite"
        >
          <Play className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <>
          {suite.tests.map((test) => (
            <TestItem
              key={test.id}
              test={test}
              selected={selectedTestId === test.id}
              onSelect={() => onSelectTest(test.id)}
              onRun={() => onRunTest(test.id)}
              depth={depth + 1}
            />
          ))}
          {suite.suites.map((child) => (
            <SuiteItem
              key={child.id}
              suite={child}
              selectedTestId={selectedTestId}
              onSelectTest={onSelectTest}
              onRunSuite={onRunSuite}
              onRunTest={onRunTest}
              depth={depth + 1}
              expandedSuites={expandedSuites}
              onToggleSuite={onToggleSuite}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Test Details Panel
// ============================================================================

interface TestDetailsPanelProps {
  test: TestCase | null;
  onGoToFile: (file: string, line?: number) => void;
}

function TestDetailsPanel({ test, onGoToFile }: TestDetailsPanelProps) {
  if (!test) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted">
        <TestTube className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Select a test to see details</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-1">
          <StatusIcon status={test.status} size="md" />
          <span className="font-medium text-text-primary">{test.name}</span>
        </div>
        <button
          onClick={() => onGoToFile(test.file, test.line)}
          className="text-xs text-accent-primary hover:underline"
        >
          {test.file}
          {test.line && `:${test.line}`}
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border-subtle bg-elevated text-sm">
        <div>
          <span className="text-text-muted">Status: </span>
          <span
            className={cn(
              test.status === 'passed' && 'text-green-400',
              test.status === 'failed' && 'text-red-400',
              test.status === 'running' && 'text-yellow-400',
              test.status === 'skipped' && 'text-gray-400',
              test.status === 'pending' && 'text-text-muted'
            )}
          >
            {test.status}
          </span>
        </div>
        {test.duration !== undefined && (
          <div>
            <span className="text-text-muted">Duration: </span>
            <span className="text-text-secondary">{test.duration}ms</span>
          </div>
        )}
      </div>

      {/* Error details */}
      {test.error && (
        <div className="flex-1 overflow-auto p-4">
          <div className="mb-4">
            <h4 className="text-sm font-medium text-red-400 mb-2">Error</h4>
            <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              {test.error.message}
            </pre>
          </div>

          {test.error.expected && test.error.actual && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text-secondary mb-2">Diff</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                  <div className="text-xs font-medium text-green-400 mb-1">Expected</div>
                  <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap">
                    {test.error.expected}
                  </pre>
                </div>
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <div className="text-xs font-medium text-red-400 mb-1">Actual</div>
                  <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap">
                    {test.error.actual}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {test.error.stack && (
            <div>
              <h4 className="text-sm font-medium text-text-secondary mb-2">Stack Trace</h4>
              <pre className="text-xs text-text-muted whitespace-pre-wrap font-mono p-3 rounded-lg bg-overlay">
                {test.error.stack}
              </pre>
            </div>
          )}
        </div>
      )}

      {!test.error && test.status === 'passed' && (
        <div className="flex-1 flex items-center justify-center text-green-400">
          <CheckCircle2 className="h-12 w-12" />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Test Explorer
// ============================================================================

interface TestExplorerProps {
  sessionId: string;
  onGoToFile?: (file: string, line?: number) => void;
  className?: string;
}

export function TestExplorer({ sessionId, onGoToFile, className }: TestExplorerProps) {
  const {
    suites,
    currentRun,
    selectedTestId,
    watchMode,
    setSuites,
    setSelectedTest,
    setWatchMode,
    startRun,
    endRun,
  } = useTestStore();

  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);

  // Load test suites
  useEffect(() => {
    async function loadTestSuites() {
      try {
        const data = await api.get<TestSuite[]>(`/api/sessions/${sessionId}/tests`);
        setSuites(data);
        setExpandedSuites(new Set(data.map((s) => s.id)));
      } catch {
        // Tests may not be available, set empty array
        setSuites([]);
      }
    }

    loadTestSuites();
  }, [sessionId, setSuites]);

  // Get selected test
  const selectedTest = useMemo(() => {
    const findTest = (suites: TestSuite[]): TestCase | null => {
      for (const suite of suites) {
        const test = suite.tests.find((t) => t.id === selectedTestId);
        if (test) return test;
        const nested = findTest(suite.suites);
        if (nested) return nested;
      }
      return null;
    };
    return findTest(suites);
  }, [suites, selectedTestId]);

  // Calculate stats
  const stats = useMemo(() => {
    const countAll = (
      suites: TestSuite[]
    ): { total: number; passed: number; failed: number; skipped: number } => {
      let total = 0;
      let passed = 0;
      let failed = 0;
      let skipped = 0;

      for (const suite of suites) {
        for (const test of suite.tests) {
          total++;
          if (test.status === 'passed') passed++;
          if (test.status === 'failed') failed++;
          if (test.status === 'skipped') skipped++;
        }
        const nested = countAll(suite.suites);
        total += nested.total;
        passed += nested.passed;
        failed += nested.failed;
        skipped += nested.skipped;
      }

      return { total, passed, failed, skipped };
    };
    return countAll(suites);
  }, [suites]);

  // Handlers
  const toggleSuite = useCallback((suiteId: string) => {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(suiteId)) {
        next.delete(suiteId);
      } else {
        next.add(suiteId);
      }
      return next;
    });
  }, []);

  const handleRunAll = useCallback(async () => {
    startRun(stats.total);
    try {
      await api.post(`/api/sessions/${sessionId}/tests/run-all`, {});
      endRun('completed');
    } catch {
      endRun('cancelled');
    }
  }, [startRun, endRun, stats.total, sessionId]);

  const handleRunSuite = useCallback(
    async (suiteId: string) => {
      try {
        await api.post(`/api/sessions/${sessionId}/tests/run-suite`, { suiteId });
      } catch {
        // Test run may fail if test framework is not configured
      }
    },
    [sessionId]
  );

  const handleRunTest = useCallback(
    async (testId: string) => {
      try {
        await api.post(`/api/sessions/${sessionId}/tests/run-test`, { testId });
      } catch {
        // Test run may fail if test framework is not configured
      }
    },
    [sessionId]
  );

  const handleGoToFile = useCallback(
    (file: string, line?: number) => {
      onGoToFile?.(file, line);
    },
    [onGoToFile]
  );

  const isRunning = currentRun?.status === 'running';

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <TestTube className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Tests</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRunAll}
            disabled={isRunning}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-sm',
              isRunning
                ? 'bg-red-500/20 text-red-400'
                : 'bg-green-500/20 hover:bg-green-500/30 text-green-400'
            )}
          >
            {isRunning ? (
              <>
                <Square className="h-3 w-3" />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                Run All
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-subtle bg-elevated text-xs">
        <span className="text-text-muted">{stats.total} tests</span>
        {stats.passed > 0 && <span className="text-green-400">{stats.passed} passed</span>}
        {stats.failed > 0 && <span className="text-red-400">{stats.failed} failed</span>}
        {stats.skipped > 0 && <span className="text-gray-400">{stats.skipped} skipped</span>}
        <div className="flex-1" />
        <button
          onClick={() => setWatchMode(!watchMode)}
          className={cn(
            'flex items-center gap-1 px-1.5 py-0.5 rounded',
            watchMode
              ? 'bg-accent-primary/20 text-accent-primary'
              : 'bg-overlay text-text-muted hover:text-text-secondary'
          )}
        >
          <Eye className="h-3 w-3" />
          Watch
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Test tree */}
        <div className="flex-1 overflow-y-auto border-r border-border-subtle">
          {suites.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted">
              <TestTube className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No tests found</p>
            </div>
          ) : (
            suites.map((suite) => (
              <SuiteItem
                key={suite.id}
                suite={suite}
                selectedTestId={selectedTestId}
                onSelectTest={(id) => {
                  setSelectedTest(id);
                  setShowDetails(true);
                }}
                onRunSuite={handleRunSuite}
                onRunTest={handleRunTest}
                depth={0}
                expandedSuites={expandedSuites}
                onToggleSuite={toggleSuite}
              />
            ))
          )}
        </div>

        {/* Details panel */}
        {showDetails && (
          <div className="w-80 flex-shrink-0">
            <TestDetailsPanel test={selectedTest} onGoToFile={handleGoToFile} />
          </div>
        )}
      </div>
    </div>
  );
}
