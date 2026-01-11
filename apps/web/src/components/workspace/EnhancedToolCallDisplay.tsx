'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Copy,
  Check,
  Terminal,
  Search,
  Edit,
  Eye,
} from 'lucide-react';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
  startTime?: number;
  endTime?: number;
}

interface EnhancedToolCallDisplayProps {
  toolCall: ToolCall;
  className?: string;
  defaultExpanded?: boolean;
  onRetry?: () => void;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  read_file: Eye,
  write_file: Edit,
  edit_file: Edit,
  search: Search,
  bash: Terminal,
  grep: Search,
  glob: Search,
  default: Wrench,
};

const TOOL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  read_file: { bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/30' },
  write_file: { bg: 'bg-green-500/10', text: 'text-green-500', border: 'border-green-500/30' },
  edit_file: { bg: 'bg-yellow-500/10', text: 'text-yellow-500', border: 'border-yellow-500/30' },
  bash: { bg: 'bg-purple-500/10', text: 'text-purple-500', border: 'border-purple-500/30' },
  search: { bg: 'bg-cyan-500/10', text: 'text-cyan-500', border: 'border-cyan-500/30' },
  default: {
    bg: 'bg-surface-secondary',
    text: 'text-text-secondary',
    border: 'border-border-subtle',
  },
};

export function EnhancedToolCallDisplay({
  toolCall,
  className,
  defaultExpanded = false,
  onRetry,
}: EnhancedToolCallDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [copiedArgs, setCopiedArgs] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const Icon = TOOL_ICONS[toolCall.name] ?? TOOL_ICONS.default ?? Wrench;
  const colors = TOOL_COLORS[toolCall.name] ??
    TOOL_COLORS.default ?? {
      bg: 'bg-surface-secondary',
      text: 'text-text-secondary',
      border: 'border-border-subtle',
    };

  const duration =
    toolCall.endTime && toolCall.startTime ? toolCall.endTime - toolCall.startTime : null;

  const copyToClipboard = async (content: string, setCopied: (v: boolean) => void) => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusIcons = {
    pending: () => <Clock className="w-4 h-4 text-text-muted" />,
    running: () => <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />,
    success: () => <CheckCircle className="w-4 h-4 text-green-500" />,
    error: () => <XCircle className="w-4 h-4 text-red-500" />,
  };
  const StatusIcon = statusIcons[toolCall.status] ?? statusIcons.pending;

  return (
    <div className={cn('rounded-lg border overflow-hidden', colors.border, colors.bg, className)}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <Icon className={cn('w-4 h-4', colors.text)} />

        <span className={cn('text-sm font-medium font-mono', colors.text)}>{toolCall.name}</span>

        <StatusIcon />

        <div className="flex-1" />

        {duration && (
          <span className="text-xs text-text-muted">
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}

        {/* Quick preview of main argument */}
        {!isExpanded && (
          <span className="text-xs text-text-muted truncate max-w-[200px]">
            {getQuickPreview(toolCall.arguments)}
          </span>
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-border-subtle">
          {/* Arguments */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                Arguments
              </span>
              <button
                onClick={() =>
                  copyToClipboard(JSON.stringify(toolCall.arguments, null, 2), setCopiedArgs)
                }
                className="p-1 rounded hover:bg-surface-hover text-text-muted"
                title="Copy arguments"
              >
                {copiedArgs ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
            <SyntaxHighlightedJSON data={toolCall.arguments} />
          </div>

          {/* Result */}
          {(toolCall.result !== undefined || toolCall.error) && (
            <div className="p-3 border-t border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  {toolCall.error ? 'Error' : 'Result'}
                </span>
                <div className="flex items-center gap-1">
                  {toolCall.result !== undefined && toolCall.result !== null && (
                    <button
                      onClick={() => setShowResult(!showResult)}
                      className="px-2 py-0.5 text-xs rounded hover:bg-surface-hover text-text-muted"
                    >
                      {showResult ? 'Collapse' : 'Expand'}
                    </button>
                  )}
                  {(toolCall.result !== undefined || toolCall.error) && (
                    <button
                      onClick={() =>
                        copyToClipboard(
                          toolCall.error || JSON.stringify(toolCall.result, null, 2),
                          setCopiedResult
                        )
                      }
                      className="p-1 rounded hover:bg-surface-hover text-text-muted"
                      title="Copy result"
                    >
                      {copiedResult ? (
                        <Check className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {toolCall.error ? (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/30">
                  <pre className="text-xs text-red-500 whitespace-pre-wrap font-mono">
                    {toolCall.error}
                  </pre>
                  {onRetry && (
                    <button onClick={onRetry} className="mt-2 text-xs text-red-500 hover:underline">
                      Retry
                    </button>
                  )}
                </div>
              ) : toolCall.result ? (
                <div className={cn(!showResult && 'max-h-32 overflow-hidden relative')}>
                  {typeof toolCall.result === 'string' ? (
                    <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono">
                      {toolCall.result}
                    </pre>
                  ) : (
                    <SyntaxHighlightedJSON data={toolCall.result} />
                  )}
                  {!showResult && (
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-secondary to-transparent" />
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SyntaxHighlightedJSONProps {
  data: unknown;
  level?: number;
}

function SyntaxHighlightedJSON({ data, level = 0 }: SyntaxHighlightedJSONProps) {
  const indent = '  '.repeat(level);

  if (data === null) {
    return <span className="text-orange-400">null</span>;
  }

  if (typeof data === 'boolean') {
    return <span className="text-orange-400">{data.toString()}</span>;
  }

  if (typeof data === 'number') {
    return <span className="text-blue-400">{data}</span>;
  }

  if (typeof data === 'string') {
    // Check if it looks like a file path
    if (data.includes('/') && !data.includes(' ')) {
      return (
        <span className="text-green-400">
          "<span className="text-green-300">{data}</span>"
        </span>
      );
    }
    // Check if it's a long string (code)
    if (data.length > 100) {
      return (
        <span className="text-amber-300">
          "<span className="text-amber-200 whitespace-pre-wrap break-all">{data}</span>"
        </span>
      );
    }
    return <span className="text-amber-300">"{data}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-text-muted">[]</span>;
    }
    return (
      <span>
        <span className="text-text-muted">[</span>
        {data.map((item, i) => (
          <span key={i}>
            {'\n' + indent + '  '}
            <SyntaxHighlightedJSON data={item} level={level + 1} />
            {i < data.length - 1 && <span className="text-text-muted">,</span>}
          </span>
        ))}
        {'\n' + indent}
        <span className="text-text-muted">]</span>
      </span>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-text-muted">{'{}'}</span>;
    }
    return (
      <span>
        <span className="text-text-muted">{'{'}</span>
        {entries.map(([key, value], i) => (
          <span key={key}>
            {'\n' + indent + '  '}
            <span className="text-purple-400">"{key}"</span>
            <span className="text-text-muted">: </span>
            <SyntaxHighlightedJSON data={value} level={level + 1} />
            {i < entries.length - 1 && <span className="text-text-muted">,</span>}
          </span>
        ))}
        {'\n' + indent}
        <span className="text-text-muted">{'}'}</span>
      </span>
    );
  }

  return <span className="text-text-muted">{String(data)}</span>;
}

function getQuickPreview(args: Record<string, unknown>): string {
  // Common argument names to preview
  const previewKeys = ['path', 'file_path', 'command', 'pattern', 'query', 'content'];

  for (const key of previewKeys) {
    if (key in args && typeof args[key] === 'string') {
      const value = args[key] as string;
      return value.length > 30 ? value.slice(0, 30) + '...' : value;
    }
  }

  // Fall back to first string argument
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 30 ? value.slice(0, 30) + '...' : value;
    }
  }

  return '';
}

export default EnhancedToolCallDisplay;
