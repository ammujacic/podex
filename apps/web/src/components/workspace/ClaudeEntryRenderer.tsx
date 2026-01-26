'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Terminal,
  FileCode,
  Zap,
  Brain,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
  Sparkles,
  FileText,
  Settings,
  Activity,
  Users,
  Search,
  Code,
  FileQuestion,
  GitBranch,
} from 'lucide-react';
import { cn, formatTimestamp } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ToolResultDisplay } from './ToolResultDisplay';
import type { AgentMessage, ToolCall } from '@/stores/sessionTypes';

interface ClaudeEntryRendererProps {
  message: AgentMessage;
  /** Show compact view for progress events */
  compact?: boolean;
  /** Callback when a file link is clicked (path, optional line range) */
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}

/**
 * Renders a Claude Code session entry with appropriate styling based on type.
 * Handles: user, assistant, progress, summary, tool_result, and other entry types.
 */
export function ClaudeEntryRenderer({
  message,
  compact = false,
  onFileClick,
}: ClaudeEntryRendererProps) {
  const [expanded, setExpanded] = useState(false);
  const entryType = message.type || message.role;

  // Skip rendering truly empty entries
  if (
    !message.content &&
    !message.toolCalls?.length &&
    !message.summary &&
    (!message.progressData || !message.progressData.content)
  ) {
    return null;
  }

  // Render based on entry type
  switch (entryType) {
    case 'user':
      return <UserMessage message={message} />;

    case 'assistant':
      return <AssistantMessage message={message} onFileClick={onFileClick} />;

    case 'progress':
      return (
        <ProgressEntry
          message={message}
          compact={compact}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      );

    case 'summary':
      return <SummaryEntry message={message} />;

    case 'tool_result':
      return <ToolResultEntry message={message} />;

    case 'config':
    case 'config_change':
    case 'system':
    case 'init':
      return <ConfigEntry message={message} />;

    default:
      // Render unknown types with a generic display
      return (
        <GenericEntry
          message={message}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      );
  }
}

/**
 * Strip system/internal tags from user message content.
 * These are injected by Claude Code for context but shouldn't be displayed.
 */
function stripSystemTags(content: string): string {
  // Remove XML-style system tags and their content
  const systemTags = [
    'ide_opened_file',
    'ide_selection',
    'system-reminder',
    'context',
    'file_context',
    'browser_context',
  ];

  let cleaned = content;
  for (const tag of systemTags) {
    // Remove opening and closing tags with content
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }

  // Clean up any resulting whitespace issues
  cleaned = cleaned.replace(/^\s+/, '').replace(/\s+$/, '');

  return cleaned;
}

/** User message bubble */
function UserMessage({ message }: { message: AgentMessage }) {
  const displayContent = stripSystemTags(message.content);

  // Don't render if only system tags (no actual user content)
  if (!displayContent.trim()) {
    return null;
  }

  return (
    <div className="flex justify-end">
      <div className="rounded-lg px-3 py-2 text-sm max-w-[85%] bg-accent-primary text-text-inverse">
        <p className="whitespace-pre-wrap">{displayContent}</p>
        <div className="mt-1 text-xs text-text-inverse/60">
          {formatTimestamp(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

/** Assistant message bubble with tool calls and usage stats */
function AssistantMessage({
  message,
  onFileClick,
}: {
  message: AgentMessage;
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}) {
  const [showUsage, setShowUsage] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  return (
    <div className="space-y-2">
      {/* Extended thinking (collapsible) */}
      {message.thinking && (
        <div className="rounded border border-purple-500/20 bg-purple-500/5 overflow-hidden">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-purple-300 hover:bg-purple-500/10 transition-colors"
          >
            {showThinking ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Brain className="h-3.5 w-3.5" />
            <span className="font-medium">Thinking</span>
            <span className="text-purple-400/60 ml-auto">
              {message.thinking.length.toLocaleString()} chars
            </span>
          </button>
          {showThinking && (
            <div className="px-2.5 py-2 border-t border-purple-500/20 text-xs text-purple-200/80">
              <pre className="whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
                {message.thinking}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Main message */}
      {message.content && (
        <div className="rounded-lg px-3 py-2 text-sm max-w-[85%] bg-elevated text-text-primary">
          <MarkdownRenderer content={message.content} onFileClick={onFileClick} />
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>{formatTimestamp(message.timestamp)}</span>
            <div className="flex items-center gap-2">
              {message.model && (
                <span className="text-text-muted/70">{message.model.split('/').pop()}</span>
              )}
              {message.usage && (
                <button
                  onClick={() => setShowUsage(!showUsage)}
                  className="hover:text-text-secondary transition-colors"
                >
                  <Activity className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          {/* Usage stats tooltip */}
          {showUsage && message.usage && (
            <div className="mt-2 p-2 rounded bg-surface text-xs text-text-muted border border-border-subtle">
              <div className="grid grid-cols-2 gap-1">
                {message.usage.input_tokens !== undefined && (
                  <span>Input: {message.usage.input_tokens.toLocaleString()}</span>
                )}
                {message.usage.output_tokens !== undefined && (
                  <span>Output: {message.usage.output_tokens.toLocaleString()}</span>
                )}
                {message.usage.cache_read_input_tokens !== undefined && (
                  <span>Cache read: {message.usage.cache_read_input_tokens.toLocaleString()}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="space-y-1.5 ml-2">
          {message.toolCalls.map((tool) => (
            <ToolCallDisplay key={tool.id} tool={tool} onFileClick={onFileClick} />
          ))}
        </div>
      )}

      {/* Tool results */}
      {message.toolResults && message.toolResults.length > 0 && (
        <div className="space-y-1.5 ml-2">
          {message.toolResults.map((result, i) => (
            <div
              key={result.tool_use_id || i}
              className={cn(
                'p-2 rounded text-xs border',
                result.is_error
                  ? 'bg-accent-error/10 border-accent-error/20 text-accent-error'
                  : 'bg-green-500/10 border-green-500/20 text-green-400'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {result.is_error ? (
                  <AlertCircle className="h-3 w-3" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )}
                <span className="font-medium">Tool Result</span>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[10px] max-h-[100px] overflow-y-auto">
                {typeof result.content === 'string'
                  ? result.content
                  : JSON.stringify(result.content, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Get file extension language for syntax highlighting */
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };
  return languageMap[ext] || 'plaintext';
}

/** Extract file info from tool args */
function extractFileInfo(
  toolName: string,
  args: Record<string, unknown>
): {
  filePath?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  command?: string;
  pattern?: string;
} {
  const normalizedName = toolName.toLowerCase();

  if (normalizedName.includes('edit')) {
    return {
      filePath: (args.file_path || args.path) as string,
      oldString: args.old_string as string,
      newString: args.new_string as string,
    };
  }

  if (normalizedName.includes('write')) {
    return {
      filePath: (args.file_path || args.path) as string,
      content: args.content as string,
    };
  }

  if (normalizedName.includes('read')) {
    return {
      filePath: (args.file_path || args.path) as string,
    };
  }

  if (normalizedName.includes('bash') || normalizedName === 'terminal') {
    return {
      command: args.command as string,
    };
  }

  if (
    normalizedName.includes('grep') ||
    normalizedName.includes('glob') ||
    normalizedName.includes('search')
  ) {
    return {
      pattern: (args.pattern || args.query) as string,
      filePath: args.path as string,
    };
  }

  return {};
}

/** Tool call display with proper file content rendering */
function ToolCallDisplay({
  tool,
  onFileClick,
}: {
  tool: ToolCall;
  onFileClick?: (path: string, startLine?: number, endLine?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(tool.name);
  const fileInfo = extractFileInfo(tool.name, tool.args);
  const language = fileInfo.filePath ? getLanguageFromPath(fileInfo.filePath) : 'plaintext';

  // Get a smart summary for the collapsed state
  const getSummary = () => {
    if (fileInfo.filePath) {
      const fileName = fileInfo.filePath.split('/').pop();
      if (fileInfo.oldString && fileInfo.newString) {
        return `${fileName} (edit)`;
      }
      if (fileInfo.content) {
        return `${fileName} (write ${fileInfo.content.split('\n').length} lines)`;
      }
      return fileName;
    }
    if (fileInfo.command) {
      return fileInfo.command.length > 40
        ? fileInfo.command.slice(0, 40) + '...'
        : fileInfo.command;
    }
    if (fileInfo.pattern) {
      return `"${fileInfo.pattern}"`;
    }
    return '';
  };

  // Tool color based on type
  const getToolColor = () => {
    const name = tool.name.toLowerCase();
    if (name.includes('edit')) return 'text-yellow-400';
    if (name.includes('write')) return 'text-green-400';
    if (name.includes('read')) return 'text-blue-400';
    if (name.includes('bash') || name === 'terminal') return 'text-purple-400';
    if (name.includes('grep') || name.includes('glob') || name.includes('search'))
      return 'text-cyan-400';
    return 'text-accent-primary';
  };

  // Language badge colors (text and background) based on tool type
  const getLanguageBadgeColors = () => {
    const name = tool.name.toLowerCase();
    if (name.includes('edit')) return 'text-yellow-300 bg-yellow-500/20';
    if (name.includes('write')) return 'text-green-300 bg-green-500/20';
    if (name.includes('read')) return 'text-blue-300 bg-blue-500/20';
    if (name.includes('bash') || name === 'terminal') return 'text-purple-300 bg-purple-500/20';
    if (name.includes('grep') || name.includes('glob') || name.includes('search'))
      return 'text-cyan-300 bg-cyan-500/20';
    return 'text-text-primary bg-surface-secondary';
  };

  return (
    <div className="rounded border border-border-default bg-elevated overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-primary hover:bg-overlay transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
        )}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', getToolColor())} />
        <span className="font-mono font-medium">{tool.name}</span>
        {!expanded && getSummary() && (
          <span className="text-text-secondary truncate flex-1 text-left ml-1">{getSummary()}</span>
        )}
        <span
          className={cn(
            'ml-auto h-2 w-2 rounded-full shrink-0',
            tool.status === 'completed' && 'bg-green-400',
            tool.status === 'running' && 'bg-yellow-400 animate-pulse',
            tool.status === 'pending' && 'bg-text-muted',
            tool.status === 'error' && 'bg-accent-error'
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border-default bg-surface">
          {/* File path header - clickable to open in editor */}
          {fileInfo.filePath && (
            <div className="px-2.5 py-2 bg-elevated border-b border-border-default flex items-center gap-2">
              <FileCode className={cn('h-4 w-4', getToolColor())} />
              {onFileClick ? (
                <button
                  onClick={() => onFileClick(fileInfo.filePath!)}
                  className="text-xs font-mono text-accent-primary hover:text-accent-primary/80 hover:underline truncate flex-1 text-left cursor-pointer bg-transparent border-none p-0"
                  title={`Open ${fileInfo.filePath}`}
                >
                  {fileInfo.filePath}
                </button>
              ) : (
                <span className="text-xs font-mono text-text-primary truncate flex-1">
                  {fileInfo.filePath}
                </span>
              )}
              <span
                className={cn(
                  'text-[10px] font-semibold px-2 py-0.5 rounded',
                  getLanguageBadgeColors()
                )}
              >
                {language}
              </span>
            </div>
          )}

          {/* Edit: Show diff view */}
          {fileInfo.oldString && fileInfo.newString && (
            <div className="p-2 space-y-2">
              <div>
                <div className="text-[10px] text-red-400 font-medium mb-1 flex items-center gap-1">
                  <span className="text-red-400">−</span> Old
                </div>
                <pre className="text-[11px] font-mono text-red-300/80 bg-red-500/10 rounded p-2 whitespace-pre-wrap max-h-[100px] overflow-y-auto border border-red-500/20">
                  {fileInfo.oldString}
                </pre>
              </div>
              <div>
                <div className="text-[10px] text-green-400 font-medium mb-1 flex items-center gap-1">
                  <span className="text-green-400">+</span> New
                </div>
                <pre className="text-[11px] font-mono text-green-300/80 bg-green-500/10 rounded p-2 whitespace-pre-wrap max-h-[100px] overflow-y-auto border border-green-500/20">
                  {fileInfo.newString}
                </pre>
              </div>
            </div>
          )}

          {/* Write: Show content */}
          {typeof fileInfo.content === 'string' && !fileInfo.oldString && (
            <div className="p-2">
              <pre className="text-[11px] font-mono text-text-secondary bg-elevated/50 rounded p-2 whitespace-pre-wrap max-h-[200px] overflow-y-auto border border-border-subtle">
                {fileInfo.content}
              </pre>
            </div>
          )}

          {/* Bash: Show command */}
          {fileInfo.command && (
            <div className="p-2">
              <pre className="text-[11px] font-mono text-purple-300 bg-purple-500/10 rounded p-2 whitespace-pre-wrap border border-purple-500/20">
                $ {fileInfo.command}
              </pre>
            </div>
          )}

          {/* Search: Show pattern */}
          {fileInfo.pattern && !fileInfo.command && (
            <div className="p-2">
              <div className="text-[10px] text-text-muted mb-1">Pattern:</div>
              <pre className="text-[11px] font-mono text-cyan-300 bg-cyan-500/10 rounded p-2 border border-cyan-500/20">
                {fileInfo.pattern}
              </pre>
            </div>
          )}

          {/* TodoWrite: Render args as todo list */}
          {tool.name === 'TodoWrite' && Array.isArray(tool.args?.todos) && (
            <div className="p-2">
              <ToolResultDisplay toolName="TodoWrite" result={tool.args} />
            </div>
          )}

          {/* Task: Render subagent launch nicely */}
          {tool.name === 'Task' && <TaskToolDisplay tool={tool} />}

          {/* Fallback: Show raw args for other tools */}
          {!fileInfo.filePath &&
            !fileInfo.command &&
            !fileInfo.pattern &&
            tool.name !== 'TodoWrite' &&
            tool.name !== 'Task' && (
              <div className="p-2">
                <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap max-h-[150px] overflow-y-auto">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              </div>
            )}

          {/* Result - use ToolResultDisplay for nice formatting */}
          {tool.result && (
            <div className="px-2 py-1.5 border-t border-border-subtle">
              <ToolResultDisplay toolName={tool.name} result={tool.result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Progress entry (thinking, hooks, streaming, etc.) */
function ProgressEntry({
  message,
  compact,
  expanded,
  onToggle,
}: {
  message: AgentMessage;
  compact: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const progressType = message.progressType || message.progressData?.type;
  const Icon = getProgressIcon(progressType);
  const label = getProgressLabel(progressType);
  const content = message.progressData?.content || message.progressData?.thinking || '';

  // Don't render empty progress events
  if (!content && !message.progressData?.hookName) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-secondary py-1">
        <Icon className="h-3.5 w-3.5 animate-pulse" />
        <span className="font-medium">{label}</span>
        {message.progressData?.hookName && (
          <span className="font-mono text-text-muted">{message.progressData.hookName}</span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded border border-border-default bg-elevated">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{label}</span>
        {message.progressData?.hookName && (
          <span className="ml-1 font-mono text-text-muted truncate">
            {message.progressData.hookName}
          </span>
        )}
        <span className="ml-auto text-text-muted">{formatTimestamp(message.timestamp)}</span>
      </button>
      {expanded && content && (
        <div className="px-2.5 py-2 border-t border-border-default text-xs text-text-primary">
          <pre className="whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Summary entry */
function SummaryEntry({ message }: { message: AgentMessage }) {
  return (
    <div className="rounded border border-accent-primary/20 bg-accent-primary/5 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-accent-primary mb-1">
        <Sparkles className="h-3 w-3" />
        <span className="font-medium">Summary</span>
      </div>
      <p className="text-sm text-text-secondary">{message.summary || message.content}</p>
    </div>
  );
}

/** Config/mode change entry */
function ConfigEntry({ message }: { message: AgentMessage }) {
  const entryType = message.type || 'config';
  const mode = (message.mode || message.configData?.mode) as string | undefined;
  const model = (message.model || message.configData?.model) as string | undefined;

  // Check if this is a CLI command (like /compact)
  const isCliCommand = message.role === 'user' && message.content?.startsWith('/');
  if (isCliCommand) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2">
        <Terminal className="h-3 w-3 text-purple-400" />
        <span className="text-xs font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">
          {message.content}
        </span>
        <span className="text-[10px] text-text-muted">{formatTimestamp(message.timestamp)}</span>
      </div>
    );
  }

  // Get display info based on mode
  const getModeDisplay = (m: string | undefined) => {
    switch (m) {
      case 'plan':
        return { label: 'Plan Mode', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
      case 'auto':
      case 'acceptEdits':
        return { label: 'Auto Mode', color: 'text-green-400 bg-green-500/10 border-green-500/20' };
      case 'sovereign':
        return { label: 'Sovereign Mode', color: 'text-red-400 bg-red-500/10 border-red-500/20' };
      case 'ask':
        return {
          label: 'Ask Mode',
          color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
        };
      default:
        return m
          ? { label: m, color: 'text-text-secondary bg-surface-secondary border-border-subtle' }
          : null;
    }
  };

  const modeDisplay = getModeDisplay(mode as string | undefined);

  // Don't render if no useful info
  if (!modeDisplay && !model) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 py-1 px-2">
      <Settings className="h-3 w-3 text-text-muted" />
      <span className="text-[10px] text-text-muted uppercase tracking-wider">
        {entryType === 'init' ? 'Session Started' : 'Config'}
      </span>
      {modeDisplay && (
        <span
          className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', modeDisplay.color)}
        >
          {modeDisplay.label}
        </span>
      )}
      {model && (
        <span className="text-[10px] text-text-muted font-mono">
          {String(model).split('/').pop()}
        </span>
      )}
    </div>
  );
}

/** Tool result as standalone entry */
function ToolResultEntry({ message }: { message: AgentMessage }) {
  const isError = message.rawData?.is_error || message.rawData?.isError;

  return (
    <div
      className={cn(
        'rounded border px-2 py-1.5 text-xs',
        isError
          ? 'border-accent-error/20 bg-accent-error/5 text-accent-error'
          : 'border-green-500/20 bg-green-500/5 text-green-400'
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {isError ? <AlertCircle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
        <span className="font-medium">Tool Result</span>
      </div>
      <pre className="whitespace-pre-wrap font-mono text-[10px] max-h-[100px] overflow-y-auto">
        {message.content || JSON.stringify(message.rawData?.content, null, 2)}
      </pre>
    </div>
  );
}

/** Generic entry for unknown types */
function GenericEntry({
  message,
  expanded,
  onToggle,
}: {
  message: AgentMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const entryType = message.type || 'unknown';

  return (
    <div className="rounded border border-border-default bg-elevated">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Settings className="h-3.5 w-3.5" />
        <span className="font-mono font-medium">{entryType}</span>
        <span className="ml-auto text-text-muted">{formatTimestamp(message.timestamp)}</span>
      </button>
      {expanded && message.rawData && (
        <div className="px-2.5 py-2 border-t border-border-default">
          <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap max-h-[150px] overflow-y-auto">
            {JSON.stringify(message.rawData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Task tool display - shows subagent launch nicely */
function TaskToolDisplay({ tool }: { tool: ToolCall }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const args = tool.args as {
    description?: string;
    prompt?: string;
    subagent_type?: string;
    model?: string;
    run_in_background?: boolean;
  };

  // Get agent type icon and color
  const getAgentTypeInfo = (type?: string) => {
    const normalizedType = type?.toLowerCase() || '';
    if (normalizedType.includes('explore')) {
      return { icon: Search, color: 'text-cyan-400', bg: 'bg-cyan-500/10', label: 'Explore' };
    }
    if (normalizedType.includes('plan')) {
      return { icon: GitBranch, color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Plan' };
    }
    if (normalizedType.includes('bash')) {
      return { icon: Terminal, color: 'text-green-400', bg: 'bg-green-500/10', label: 'Bash' };
    }
    if (normalizedType.includes('code')) {
      return { icon: Code, color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Code' };
    }
    return { icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10', label: type || 'Agent' };
  };

  const agentInfo = getAgentTypeInfo(args.subagent_type);
  const AgentIcon = agentInfo.icon;

  return (
    <div className="p-3 space-y-3">
      {/* Agent type badge and description */}
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-lg', agentInfo.bg)}>
          <AgentIcon className={cn('h-5 w-5', agentInfo.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded',
                agentInfo.bg,
                agentInfo.color
              )}
            >
              {agentInfo.label}
            </span>
            {args.run_in_background && (
              <span className="text-[10px] text-text-muted bg-surface-secondary px-1.5 py-0.5 rounded">
                Background
              </span>
            )}
            {args.model && (
              <span className="text-[10px] text-text-muted font-mono">{args.model}</span>
            )}
          </div>
          {args.description && (
            <p className="text-sm text-text-primary font-medium">{args.description}</p>
          )}
        </div>
      </div>

      {/* Prompt (collapsible) */}
      {args.prompt && (
        <div className="border border-border-subtle rounded-lg overflow-hidden">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-overlay transition-colors"
          >
            {showPrompt ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <FileQuestion className="h-3.5 w-3.5" />
            <span className="font-medium">Prompt</span>
            <span className="ml-auto text-text-muted">
              {args.prompt.length.toLocaleString()} chars
            </span>
          </button>
          {showPrompt && (
            <div className="px-3 py-2 border-t border-border-subtle bg-surface">
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {args.prompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center gap-2 text-xs">
        {tool.status === 'running' && (
          <>
            <Loader2 className="h-3.5 w-3.5 text-yellow-400 animate-spin" />
            <span className="text-yellow-400">Agent working...</span>
          </>
        )}
        {tool.status === 'completed' && (
          <>
            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
            <span className="text-green-400">Completed</span>
          </>
        )}
        {tool.status === 'error' && (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
            <span className="text-red-400">Failed</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Get icon for tool based on name */
function getToolIcon(toolName: string) {
  if (toolName.includes('Bash') || toolName.includes('Terminal')) return Terminal;
  if (toolName.includes('Read') || toolName.includes('Write') || toolName.includes('Edit'))
    return FileCode;
  if (toolName.includes('Search') || toolName.includes('Grep') || toolName.includes('Glob'))
    return FileText;
  return Zap;
}

/** Get icon for progress type */
function getProgressIcon(progressType?: string) {
  switch (progressType) {
    case 'thinking':
      return Brain;
    case 'hook_progress':
      return Settings;
    case 'api_request':
      return Clock;
    case 'streaming':
      return Loader2;
    case 'tool_use':
      return Terminal;
    default:
      return Lightbulb;
  }
}

/** Get label for progress type */
function getProgressLabel(progressType?: string): string {
  switch (progressType) {
    case 'thinking':
      return 'Thinking';
    case 'hook_progress':
      return 'Hook';
    case 'api_request':
      return 'API Request';
    case 'streaming':
      return 'Streaming';
    case 'tool_use':
      return 'Tool Use';
    default:
      return 'Progress';
  }
}

export default ClaudeEntryRenderer;
