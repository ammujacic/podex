'use client';

import { useCallback, useRef, useState, useMemo, memo } from 'react';
import {
  Terminal,
  Network,
  Code2,
  X,
  Trash2,
  Filter,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Info,
  FileCode,
  CornerDownRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useDevToolsStore,
  type DevToolsPanel as PanelType,
  type ConsoleEntry,
  type NetworkRequest,
  type DOMNode,
  type ConsoleFilter,
  type EvalResult,
} from '@/stores/devtools';

interface DevToolsPanelProps {
  /** Callback to request a DOM snapshot from the iframe */
  onRequestDOMSnapshot: () => void;
  /** Callback to request HTML content from the iframe */
  onRequestHTML: () => void;
  /** Callback to evaluate JavaScript code in the iframe */
  onEvalCode: (code: string) => string;
}

/**
 * DevTools panel component providing Console, Network, and Elements inspection.
 * Designed to be rendered below the preview iframe.
 */
export function DevToolsPanel({
  onRequestDOMSnapshot,
  onRequestHTML,
  onEvalCode,
}: DevToolsPanelProps) {
  const activePanel = useDevToolsStore((s) => s.activePanel);
  const setActivePanel = useDevToolsStore((s) => s.setActivePanel);
  const panelHeight = useDevToolsStore((s) => s.panelHeight);
  const setPanelHeight = useDevToolsStore((s) => s.setPanelHeight);
  const closeDevTools = useDevToolsStore((s) => s.closeDevTools);
  const errors = useDevToolsStore((s) => s.errors);

  const resizeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Handle resize
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startHeight = panelHeight;

      const handleMouseMove = (e: MouseEvent) => {
        const delta = startY - e.clientY;
        setPanelHeight(startHeight + delta);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelHeight, setPanelHeight]
  );

  const tabs: { id: PanelType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'console', label: 'Console', icon: <Terminal className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
    { id: 'elements', label: 'Elements', icon: <Code2 className="w-4 h-4" /> },
  ];

  // Add error count badge to console tab
  const errorCount = errors.length;

  return (
    <div
      className="border-t border-border-default bg-surface flex flex-col"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleResizeStart}
        className={cn(
          'h-1 cursor-ns-resize hover:bg-accent-primary/20 transition-colors shrink-0',
          isResizing && 'bg-accent-primary/30'
        )}
      />

      {/* Tab bar */}
      <div className="flex items-center border-b border-border-subtle px-2 bg-elevated shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActivePanel(tab.id);
              if (tab.id === 'elements') {
                onRequestDOMSnapshot();
              }
            }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors relative',
              activePanel === tab.id
                ? 'text-accent-primary border-b-2 border-accent-primary'
                : 'text-text-secondary hover:text-text-primary'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'console' && errorCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-accent-error/20 text-accent-error rounded-full">
                {errorCount}
              </span>
            )}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={closeDevTools}
          className="p-1.5 text-text-muted hover:text-text-primary rounded hover:bg-overlay"
          title="Close DevTools"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activePanel === 'console' && <ConsolePanel onEvalCode={onEvalCode} />}
        {activePanel === 'network' && <NetworkPanel />}
        {activePanel === 'elements' && (
          <ElementsPanel onRefresh={onRequestDOMSnapshot} onRequestHTML={onRequestHTML} />
        )}
      </div>
    </div>
  );
}

// ==================== CONSOLE PANEL ====================

interface ConsolePanelProps {
  onEvalCode: (code: string) => string;
}

function ConsolePanel({ onEvalCode }: ConsolePanelProps) {
  const entries = useDevToolsStore((s) => s.consoleEntries);
  const evalResults = useDevToolsStore((s) => s.evalResults);
  const pendingEvalId = useDevToolsStore((s) => s.pendingEvalId);
  const filter = useDevToolsStore((s) => s.consoleFilter);
  const setFilter = useDevToolsStore((s) => s.setConsoleFilter);
  const clearConsole = useDevToolsStore((s) => s.clearConsole);
  const clearEvalResults = useDevToolsStore((s) => s.clearEvalResults);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredEntries = useMemo(() => {
    if (filter === 'all') return entries;
    return entries.filter((e) => e.level === filter);
  }, [entries, filter]);

  const levelIcons: Record<string, React.ReactNode> = {
    log: null,
    info: <Info className="w-3 h-3 text-accent-info" />,
    warn: <AlertTriangle className="w-3 h-3 text-accent-warning" />,
    error: <AlertCircle className="w-3 h-3 text-accent-error" />,
    debug: null,
  };

  const levelColors: Record<string, string> = {
    log: 'text-text-primary',
    info: 'text-accent-info',
    warn: 'text-accent-warning bg-accent-warning/5',
    error: 'text-accent-error bg-accent-error/5',
    debug: 'text-text-muted',
  };

  // Handle code execution
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!inputValue.trim()) return;
      onEvalCode(inputValue.trim());
      setInputValue('');
    },
    [inputValue, onEvalCode]
  );

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      // Could implement command history here
    }
  }, []);

  // Clear both console and eval results
  const handleClearAll = useCallback(() => {
    clearConsole();
    clearEvalResults();
  }, [clearConsole, clearEvalResults]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle shrink-0">
        <button
          onClick={handleClearAll}
          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-overlay"
          title="Clear console"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="h-4 w-px bg-border-subtle" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ConsoleFilter)}
          className="bg-void border border-border-default rounded px-2 py-0.5 text-xs text-text-primary"
        >
          <option value="all">All levels</option>
          <option value="log">Log</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
          <option value="debug">Debug</option>
        </select>
        <span className="text-xs text-text-muted ml-auto">
          {filteredEntries.length} {filteredEntries.length === 1 ? 'message' : 'messages'}
          {evalResults.length > 0 && ` + ${evalResults.length} eval`}
        </span>
      </div>

      {/* Entries */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {filteredEntries.length === 0 && evalResults.length === 0 ? (
          <div className="p-4 text-center text-text-muted">No console messages</div>
        ) : (
          <>
            {filteredEntries.map((entry) => (
              <ConsoleEntryRow
                key={entry.id}
                entry={entry}
                icon={levelIcons[entry.level]}
                levelColor={levelColors[entry.level] || 'text-text-primary'}
              />
            ))}
            {evalResults.map((result) => (
              <EvalResultRow key={result.id} result={result} />
            ))}
          </>
        )}
      </div>

      {/* REPL Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-2 py-1.5 border-t border-border-subtle bg-void shrink-0"
      >
        <span className="text-accent-primary font-mono text-xs">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Evaluate JavaScript..."
          className="flex-1 bg-transparent text-xs font-mono text-text-primary outline-none placeholder:text-text-muted"
          disabled={!!pendingEvalId}
        />
        {pendingEvalId && (
          <span className="text-xs text-text-muted animate-pulse">Evaluating...</span>
        )}
      </form>
    </div>
  );
}

function ConsoleEntryRow({
  entry,
  icon,
  levelColor,
}: {
  entry: ConsoleEntry;
  icon: React.ReactNode;
  levelColor: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExpandable = entry.args.some((arg) => arg.value.includes('\n') || arg.value.length > 100);

  return (
    <div
      className={cn(
        'px-2 py-1 border-b border-border-subtle hover:bg-overlay/50 cursor-pointer',
        levelColor
      )}
      onClick={() => isExpandable && setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <span className="text-text-muted shrink-0 w-20">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        <div className={cn('flex-1 break-all', !expanded && 'line-clamp-2')}>
          {entry.args.map((arg, i) => (
            <span key={i} className="mr-2">
              {expanded ? (
                <pre className="whitespace-pre-wrap">{arg.value}</pre>
              ) : (
                arg.value.split('\n')[0]
              )}
            </span>
          ))}
        </div>
        {isExpandable && (
          <span className="text-text-muted shrink-0">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </div>
    </div>
  );
}

function EvalResultRow({ result }: { result: EvalResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!result.error;
  const content = result.error || result.result;
  const isExpandable = content.includes('\n') || content.length > 100;

  return (
    <div className="border-b border-border-subtle">
      {/* Input line */}
      <div className="px-2 py-1 bg-void/50 flex items-start gap-2">
        <span className="text-accent-primary shrink-0">&gt;</span>
        <span className="text-text-muted shrink-0 w-20">
          {new Date(result.timestamp).toLocaleTimeString()}
        </span>
        <code className="flex-1 text-text-primary break-all">{result.code}</code>
      </div>
      {/* Output line */}
      <div
        className={cn(
          'px-2 py-1 hover:bg-overlay/50 cursor-pointer flex items-start gap-2',
          hasError ? 'text-accent-error bg-accent-error/5' : 'text-accent-success'
        )}
        onClick={() => isExpandable && setExpanded(!expanded)}
      >
        <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0 text-text-muted" />
        <span className="shrink-0 w-20" />
        <div className={cn('flex-1 break-all', !expanded && 'line-clamp-2')}>
          {expanded ? <pre className="whitespace-pre-wrap">{content}</pre> : content.split('\n')[0]}
        </div>
        {isExpandable && (
          <span className="text-text-muted shrink-0">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
        )}
      </div>
    </div>
  );
}

// ==================== NETWORK PANEL ====================

function NetworkPanel() {
  const requests = useDevToolsStore((s) => s.networkRequests);
  const selectedId = useDevToolsStore((s) => s.selectedRequestId);
  const setSelected = useDevToolsStore((s) => s.setSelectedRequest);
  const clearRequests = useDevToolsStore((s) => s.clearNetworkRequests);
  const filter = useDevToolsStore((s) => s.networkFilter);
  const setFilter = useDevToolsStore((s) => s.setNetworkFilter);

  const filteredRequests = useMemo(() => {
    if (!filter) return requests;
    const filterLower = filter.toLowerCase();
    return requests.filter((r) => r.url.toLowerCase().includes(filterLower));
  }, [requests, filter]);

  const selectedRequest = requests.find((r) => r.id === selectedId);

  const getStatusColor = (status?: number) => {
    if (!status) return 'text-text-muted';
    if (status >= 200 && status < 300) return 'text-accent-success';
    if (status >= 300 && status < 400) return 'text-accent-info';
    if (status >= 400 && status < 500) return 'text-accent-warning';
    return 'text-accent-error';
  };

  const getStatusBg = (status?: number) => {
    if (!status) return '';
    if (status >= 400) return 'bg-accent-error/5';
    return '';
  };

  return (
    <div className="flex h-full">
      {/* Request list */}
      <div
        className={cn(
          'flex flex-col border-r border-border-subtle',
          selectedId ? 'w-1/2' : 'w-full'
        )}
      >
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle shrink-0">
          <button
            onClick={clearRequests}
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-overlay"
            title="Clear requests"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className="h-4 w-px bg-border-subtle" />
          <div className="flex items-center gap-1 flex-1">
            <Filter className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter URLs..."
              className="bg-transparent text-xs outline-none flex-1 text-text-primary placeholder:text-text-muted"
            />
          </div>
          <span className="text-xs text-text-muted">{filteredRequests.length} requests</span>
        </div>

        {/* Request list */}
        <div className="flex-1 overflow-auto text-xs">
          {filteredRequests.length === 0 ? (
            <div className="p-4 text-center text-text-muted">No network requests</div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-elevated">
                <tr className="text-left text-text-muted border-b border-border-subtle">
                  <th className="px-2 py-1 font-medium w-16">Status</th>
                  <th className="px-2 py-1 font-medium w-16">Method</th>
                  <th className="px-2 py-1 font-medium">URL</th>
                  <th className="px-2 py-1 font-medium w-16 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((req) => (
                  <tr
                    key={req.id}
                    onClick={() => setSelected(req.id)}
                    className={cn(
                      'cursor-pointer hover:bg-overlay border-b border-border-subtle',
                      selectedId === req.id && 'bg-accent-primary/10',
                      getStatusBg(req.status)
                    )}
                  >
                    <td className={cn('px-2 py-1 font-mono', getStatusColor(req.status))}>
                      {req.error ? 'ERR' : req.status || '...'}
                    </td>
                    <td className="px-2 py-1 text-text-secondary font-mono">{req.method}</td>
                    <td className="px-2 py-1 truncate max-w-[300px]" title={req.url}>
                      {extractPathFromUrl(req.url)}
                    </td>
                    <td className="px-2 py-1 text-text-muted text-right">
                      {req.duration ? `${Math.round(req.duration)}ms` : '...'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Request details */}
      {selectedRequest && (
        <div className="flex-1 overflow-auto">
          <RequestDetails request={selectedRequest} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}

function extractPathFromUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function RequestDetails({ request, onClose }: { request: NetworkRequest; onClose: () => void }) {
  const [tab, setTab] = useState<'headers' | 'response'>('headers');

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center border-b border-border-subtle px-2 py-1 bg-elevated shrink-0">
        <button
          onClick={() => setTab('headers')}
          className={cn(
            'px-2 py-1 rounded',
            tab === 'headers'
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          Headers
        </button>
        <button
          onClick={() => setTab('response')}
          className={cn(
            'px-2 py-1 rounded',
            tab === 'response'
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          Response
        </button>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-overlay"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 font-mono">
        {tab === 'headers' && (
          <div className="space-y-3">
            <div>
              <div className="text-text-muted mb-1 font-semibold">General</div>
              <div className="bg-void p-2 rounded space-y-1">
                <div>
                  <span className="text-text-muted">Request URL: </span>
                  <span className="break-all">{request.url}</span>
                </div>
                <div>
                  <span className="text-text-muted">Request Method: </span>
                  <span>{request.method}</span>
                </div>
                <div>
                  <span className="text-text-muted">Status Code: </span>
                  <span className={request.error ? 'text-accent-error' : ''}>
                    {request.error || `${request.status} ${request.statusText || ''}`}
                  </span>
                </div>
                {request.duration && (
                  <div>
                    <span className="text-text-muted">Duration: </span>
                    <span>{Math.round(request.duration)}ms</span>
                  </div>
                )}
              </div>
            </div>

            {request.headers && Object.keys(request.headers).length > 0 && (
              <div>
                <div className="text-text-muted mb-1 font-semibold">Request Headers</div>
                <div className="bg-void p-2 rounded space-y-1">
                  {Object.entries(request.headers).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-text-muted">{key}: </span>
                      <span className="break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {request.responseHeaders && Object.keys(request.responseHeaders).length > 0 && (
              <div>
                <div className="text-text-muted mb-1 font-semibold">Response Headers</div>
                <div className="bg-void p-2 rounded space-y-1">
                  {Object.entries(request.responseHeaders).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-text-muted">{key}: </span>
                      <span className="break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {request.body && (
              <div>
                <div className="text-text-muted mb-1 font-semibold">Request Body</div>
                <pre className="bg-void p-2 rounded whitespace-pre-wrap break-all">
                  {request.body}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === 'response' && (
          <div>
            {request.error ? (
              <div className="text-accent-error bg-accent-error/10 p-2 rounded">
                {request.error}
              </div>
            ) : request.responseBody ? (
              <pre className="bg-void p-2 rounded whitespace-pre-wrap break-all max-h-[400px] overflow-auto">
                {formatResponseBody(
                  request.responseBody,
                  request.responseHeaders?.['content-type']
                )}
              </pre>
            ) : (
              <div className="text-text-muted text-center py-4">No response body</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatResponseBody(body: string, contentType?: string): string {
  if (contentType?.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

// ==================== ELEMENTS PANEL ====================

interface ElementsPanelProps {
  onRefresh: () => void;
  onRequestHTML: () => void;
}

function ElementsPanel({ onRefresh, onRequestHTML }: ElementsPanelProps) {
  const snapshot = useDevToolsStore((s) => s.domSnapshot);
  const htmlSnapshot = useDevToolsStore((s) => s.htmlSnapshot);
  const selectedPath = useDevToolsStore((s) => s.selectedElementPath);
  const setSelectedPath = useDevToolsStore((s) => s.setSelectedElementPath);
  const [showHtml, setShowHtml] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border-subtle shrink-0">
        <button
          onClick={() => {
            onRefresh();
            setShowHtml(false);
          }}
          className={cn(
            'flex items-center gap-1 text-xs hover:text-text-primary px-2 py-0.5 rounded',
            !showHtml ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted'
          )}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          DOM Tree
        </button>
        <button
          onClick={() => {
            onRequestHTML();
            setShowHtml(true);
          }}
          className={cn(
            'flex items-center gap-1 text-xs hover:text-text-primary px-2 py-0.5 rounded',
            showHtml ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted'
          )}
        >
          <FileCode className="w-3.5 h-3.5" />
          HTML Source
        </button>
        {htmlSnapshot && showHtml && (
          <span className="text-xs text-text-muted ml-auto">
            Captured: {new Date(htmlSnapshot.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2 font-mono text-xs">
        {showHtml ? (
          htmlSnapshot ? (
            <pre className="whitespace-pre-wrap text-text-secondary">{htmlSnapshot.html}</pre>
          ) : (
            <div className="text-center text-text-muted p-4">
              Click "HTML Source" to capture page HTML
            </div>
          )
        ) : snapshot ? (
          <DOMTreeNode
            node={snapshot}
            path={[]}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        ) : (
          <div className="text-center text-text-muted p-4">
            Click "DOM Tree" to inspect elements
          </div>
        )}
      </div>
    </div>
  );
}

const DOMTreeNode = memo(function DOMTreeNode({
  node,
  path,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: DOMNode;
  path: number[];
  selectedPath: number[];
  onSelect: (path: number[]) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const isSelected = JSON.stringify(path) === JSON.stringify(selectedPath);

  // Memoize inline styles to prevent recreation on every render
  const nodeStyle = useMemo(() => ({ marginLeft: depth * 16 }), [depth]);
  const closingTagStyle = useMemo(() => ({ marginLeft: (depth + 1) * 16 }), [depth]);

  // Text node
  if (node.text) {
    return (
      <div style={nodeStyle} className="text-text-secondary py-0.5">
        "{node.text}"
      </div>
    );
  }

  const hasChildren = node.children && node.children.length > 0;

  return (
    <div style={nodeStyle}>
      <div
        onClick={() => onSelect(path)}
        className={cn(
          'flex items-center gap-1 hover:bg-overlay cursor-pointer rounded px-1 py-0.5',
          isSelected && 'bg-accent-primary/20'
        )}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 hover:bg-overlay rounded"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-text-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="text-accent-primary">&lt;{node.tagName}</span>
        {node.id && <span className="text-accent-warning"> id="{node.id}"</span>}
        {node.className && <span className="text-accent-info"> class="{node.className}"</span>}
        {node.attributes &&
          Object.entries(node.attributes)
            .slice(0, 3)
            .map(([key, value]) => (
              <span key={key} className="text-text-secondary">
                {' '}
                {key}="{value.length > 30 ? value.slice(0, 30) + '...' : value}"
              </span>
            ))}
        <span className="text-accent-primary">&gt;</span>
        {!hasChildren && <span className="text-accent-primary">&lt;/{node.tagName}&gt;</span>}
      </div>

      {expanded && hasChildren && (
        <>
          {node.children!.map((child, i) => (
            <DOMTreeNode
              key={i}
              node={child}
              path={[...path, i]}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
          <div style={closingTagStyle} className="text-accent-primary py-0.5">
            &lt;/{node.tagName}&gt;
          </div>
        </>
      )}
    </div>
  );
});

export default DevToolsPanel;
