/**
 * Component for displaying tool execution results with nice formatting.
 * Handles all tool types with appropriate UI for each.
 */

import React from 'react';
import { cn, getFriendlyToolName } from '@/lib/utils';
import {
  File,
  FileText,
  Folder,
  FolderOpen,
  Search,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Terminal,
  Globe,
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Code,
  Play,
  Upload,
  Download,
  Rocket,
  ListTodo,
  Users,
  Brain,
  Sparkles,
} from 'lucide-react';
import { PlanResultDisplay } from './PlanResultDisplay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolResult = Record<string, any>;

interface ToolResultDisplayProps {
  toolName: string;
  result: unknown;
  onPlanApprove?: (planId: string) => Promise<void>;
  onPlanReject?: (planId: string) => Promise<void>;
}

export function ToolResultDisplay({
  toolName,
  result,
  onPlanApprove,
  onPlanReject,
}: ToolResultDisplayProps) {
  // Parse result if it's a string
  const parsedResult: ToolResult | null =
    typeof result === 'string' ? safeParseJSON(result) : (result as ToolResult);

  if (!parsedResult) {
    return <SimpleResult result={result} />;
  }

  // Route to specific display based on tool name
  switch (toolName) {
    // Orchestrator tools
    case 'create_execution_plan':
      return (
        <PlanResultDisplay
          result={
            parsedResult as {
              success: boolean;
              plan_id?: string;
              title?: string;
              description?: string;
              steps?: Array<{
                order: number;
                action_type: string;
                description: string;
                confidence: number;
              }>;
              confidence_score?: number;
              status?: string;
              auto_execute?: boolean;
              error?: string;
            }
          }
          onApprove={
            onPlanApprove ? () => onPlanApprove(parsedResult.plan_id as string) : undefined
          }
          onReject={onPlanReject ? () => onPlanReject(parsedResult.plan_id as string) : undefined}
        />
      );
    case 'create_custom_agent':
      return <CreateAgentResult result={parsedResult} />;
    case 'delegate_task':
      return <DelegateTaskResult result={parsedResult} />;
    case 'get_task_status':
      return <TaskStatusResult result={parsedResult} />;
    case 'wait_for_tasks':
      return <WaitForTasksResult result={parsedResult} />;
    case 'delegate_to_custom_agent':
      return <DelegateToAgentResult result={parsedResult} />;
    case 'synthesize_results':
      return <SynthesizeResultsResult result={parsedResult} />;

    // File tools
    case 'read_file':
      return <ReadFileResult result={parsedResult} />;
    case 'write_file':
      return <WriteFileResult result={parsedResult} />;
    case 'list_directory':
      return <ListDirectoryResult result={parsedResult} />;
    case 'search_code':
      return <SearchCodeResult result={parsedResult} />;

    // Git tools
    case 'git_status':
      return <GitStatusResult result={parsedResult} />;
    case 'git_commit':
      return <GitCommitResult result={parsedResult} />;
    case 'git_push':
      return <GitPushResult result={parsedResult} />;
    case 'git_diff':
      return <GitDiffResult result={parsedResult} />;
    case 'git_branch':
      return <GitBranchResult result={parsedResult} />;
    case 'git_log':
      return <GitLogResult result={parsedResult} />;
    case 'create_pr':
      return <CreatePRResult result={parsedResult} />;

    // Command tools
    case 'run_command':
    case 'run_terminal_command':
      return <RunCommandResult result={parsedResult} />;

    // Web tools
    case 'fetch_url':
      return <FetchUrlResult result={parsedResult} />;
    case 'search_web':
      return <SearchWebResult result={parsedResult} />;
    case 'screenshot_page':
      return <ScreenshotResult result={parsedResult} />;

    // Deploy tools
    case 'deploy_preview':
      return <DeployPreviewResult result={parsedResult} />;
    case 'get_preview_status':
      return <PreviewStatusResult result={parsedResult} />;
    case 'run_e2e_tests':
      return <E2ETestsResult result={parsedResult} />;

    // Memory tools
    case 'store_memory':
      return <StoreMemoryResult result={parsedResult} />;
    case 'recall_memory':
      return <RecallMemoryResult result={parsedResult} />;

    // Task tools
    case 'create_task':
      return <CreateTaskResult result={parsedResult} />;
    case 'get_session_task_stats':
      return <TaskStatsResult result={parsedResult} />;

    // Skill tools
    case 'execute_skill':
      return <ExecuteSkillResult result={parsedResult} />;
    case 'list_skills':
      return <ListSkillsResult result={parsedResult} />;

    // Default fallback
    default:
      return <GenericSuccessResult result={parsedResult} toolName={toolName} />;
  }
}

// Helper to safely parse JSON
function safeParseJSON(str: unknown): ToolResult | null {
  if (typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Simple result for unparseable results
function SimpleResult({ result }: { result: unknown }) {
  const str = String(result);
  if (str.length > 200) {
    return (
      <details className="mt-1">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
          View result
        </summary>
        <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
          {str}
        </pre>
      </details>
    );
  }
  return <div className="mt-1 pl-4 text-text-muted text-xs truncate">{str}</div>;
}

// Generic success result for unknown tools
function GenericSuccessResult({ result, toolName }: { result: ToolResult; toolName: string }) {
  const success = result.success as boolean;
  const message = (result.message as string) || (result.error as string);
  const friendlyName = getFriendlyToolName(toolName);

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md text-xs',
        success
          ? 'bg-accent-success/10 border border-accent-success/20'
          : 'bg-accent-error/10 border border-accent-error/20'
      )}
    >
      <div className="flex items-center gap-2">
        {success ? (
          <CheckCircle2 className="h-4 w-4 text-accent-success" />
        ) : (
          <XCircle className="h-4 w-4 text-accent-error" />
        )}
        <span className="font-medium text-text-primary">{friendlyName}</span>
        <span className={cn('ml-auto', success ? 'text-accent-success' : 'text-accent-error')}>
          {success ? 'Success' : 'Failed'}
        </span>
      </div>
      {message && <div className="mt-1 text-text-muted truncate">{message}</div>}
    </div>
  );
}

// ============ ORCHESTRATOR TOOLS ============

function CreateAgentResult({ result }: { result: ToolResult }) {
  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">
          {(result.name as string) || 'Custom Agent'}
        </span>
        <span className="text-xs text-accent-success ml-auto">Created</span>
      </div>
      {result.agent_id && (
        <div className="mt-1 text-xs text-text-muted font-mono">
          ID: {result.agent_id as string}
        </div>
      )}
      {result.tools && Array.isArray(result.tools) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {(result.tools as string[]).map((tool) => (
            <span
              key={tool}
              className="px-1.5 py-0.5 rounded bg-elevated text-xs text-text-secondary"
            >
              {tool}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DelegateTaskResult({ result }: { result: ToolResult }) {
  return (
    <div className="mt-2 p-2 rounded-md bg-accent-primary/10 border border-accent-primary/20">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Task Delegated</span>
        <span className="text-xs text-accent-primary ml-auto">{result.agent_role as string}</span>
      </div>
      <div className="mt-1 text-xs text-text-muted font-mono">
        Task ID: {result.task_id as string}
      </div>
      {result.priority && (
        <span
          className={cn(
            'mt-1 inline-block px-1.5 py-0.5 rounded text-xs',
            result.priority === 'high' && 'bg-accent-error/20 text-accent-error',
            result.priority === 'medium' && 'bg-accent-warning/20 text-accent-warning',
            result.priority === 'low' && 'bg-accent-success/20 text-accent-success'
          )}
        >
          {result.priority as string} priority
        </span>
      )}
    </div>
  );
}

function TaskStatusResult({ result }: { result: ToolResult }) {
  const status = result.status as string;
  const statusColors: Record<string, string> = {
    completed: 'text-accent-success',
    running: 'text-accent-warning',
    pending: 'text-text-muted',
    failed: 'text-accent-error',
  };

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Task Status</span>
        <span
          className={cn('text-xs ml-auto capitalize', statusColors[status] || 'text-text-muted')}
        >
          {status}
        </span>
      </div>
      <div className="mt-1 text-xs text-text-muted">{result.description as string}</div>
      {result.agent_role && (
        <div className="mt-1 text-xs text-text-secondary">Agent: {result.agent_role as string}</div>
      )}
    </div>
  );
}

function WaitForTasksResult({ result }: { result: ToolResult }) {
  const completed = result.completed as number;
  const total = result.total as number;
  const timedOut = (result.timed_out as string[]) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Tasks Completed</span>
        <span
          className={cn(
            'text-xs ml-auto',
            completed === total ? 'text-accent-success' : 'text-accent-warning'
          )}
        >
          {completed}/{total}
        </span>
      </div>
      {timedOut.length > 0 && (
        <div className="mt-1 text-xs text-accent-warning">{timedOut.length} task(s) timed out</div>
      )}
    </div>
  );
}

function DelegateToAgentResult({ result }: { result: ToolResult }) {
  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Agent Response</span>
        {result.tokens_used && (
          <span className="text-xs text-text-muted ml-auto">
            {result.tokens_used as number} tokens
          </span>
        )}
      </div>
      {result.response && (
        <div className="mt-1 text-xs text-text-secondary line-clamp-3">
          {result.response as string}
        </div>
      )}
    </div>
  );
}

function SynthesizeResultsResult({ result }: { result: ToolResult }) {
  const taskCount = result.task_count as number;
  const results = (result.results as Array<Record<string, unknown>>) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Synthesized Results</span>
        <span className="text-xs text-text-muted ml-auto">{taskCount} tasks</span>
      </div>
      {results.length > 0 && (
        <div className="mt-1 space-y-1">
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className="text-xs text-text-secondary flex items-center gap-1">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  r.status === 'completed' ? 'bg-accent-success' : 'bg-accent-error'
                )}
              />
              <span className="truncate">
                {r.agent_role as string}: {r.description as string}
              </span>
            </div>
          ))}
          {results.length > 3 && (
            <div className="text-xs text-text-muted">+{results.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ FILE TOOLS ============

function ReadFileResult({ result }: { result: ToolResult }) {
  const path = result.path as string;
  const size = result.size as number;
  const content = result.content as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {path?.split('/').pop()}
        </span>
        {size && <span className="text-xs text-text-muted">{formatBytes(size)}</span>}
      </div>
      {path && <div className="mt-1 text-xs text-text-muted font-mono truncate">{path}</div>}
      {content && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View content
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-32 overflow-y-auto">
            {content.slice(0, 1000)}
            {content.length > 1000 ? '...' : ''}
          </pre>
        </details>
      )}
    </div>
  );
}

function WriteFileResult({ result }: { result: ToolResult }) {
  const path = result.path as string;
  const size = result.size as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {path?.split('/').pop()}
        </span>
        <span className="text-xs text-accent-success">Written</span>
      </div>
      {path && <div className="mt-1 text-xs text-text-muted font-mono truncate">{path}</div>}
      {size && <div className="mt-1 text-xs text-text-secondary">{formatBytes(size)}</div>}
    </div>
  );
}

function ListDirectoryResult({ result }: { result: ToolResult }) {
  const path = result.path as string;
  const entries = (result.entries as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-accent-warning" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">{path}</span>
        <span className="text-xs text-text-muted">{count} items</span>
      </div>
      {entries.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
          {entries.slice(0, 10).map((entry, i) => (
            <div key={i} className="flex items-center gap-1 text-xs">
              {entry.type === 'directory' ? (
                <Folder className="h-3 w-3 text-accent-warning" />
              ) : (
                <File className="h-3 w-3 text-text-muted" />
              )}
              <span className="text-text-secondary truncate">{entry.name as string}</span>
            </div>
          ))}
          {entries.length > 10 && (
            <div className="text-xs text-text-muted">+{entries.length - 10} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchCodeResult({ result }: { result: ToolResult }) {
  const query = result.query as string;
  const results = (result.results as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Search: "{query}"</span>
        <span className="text-xs text-text-muted ml-auto">{count} results</span>
      </div>
      {results.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {results.slice(0, 5).map((r, i) => (
            <div key={i} className="text-xs">
              <span className="text-accent-primary font-mono">
                {r.file as string}:{r.line as number}
              </span>
              <div className="text-text-muted truncate pl-2">{r.content as string}</div>
            </div>
          ))}
          {results.length > 5 && (
            <div className="text-xs text-text-muted">+{results.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ GIT TOOLS ============

function GitStatusResult({ result }: { result: ToolResult }) {
  const branch = result.branch as string;
  const changes = (result.changes as Array<Record<string, unknown>>) || [];
  const hasChanges = result.has_changes as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">{branch}</span>
        <span
          className={cn(
            'text-xs ml-auto',
            hasChanges ? 'text-accent-warning' : 'text-accent-success'
          )}
        >
          {hasChanges ? `${changes.length} changes` : 'Clean'}
        </span>
      </div>
      {changes.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
          {changes.slice(0, 5).map((change, i) => (
            <div key={i} className="flex items-center gap-1 text-xs font-mono">
              <span
                className={cn(
                  'w-4',
                  change.status === 'M' && 'text-accent-warning',
                  change.status === 'A' && 'text-accent-success',
                  change.status === 'D' && 'text-accent-error',
                  change.status === '?' && 'text-text-muted'
                )}
              >
                {change.status as string}
              </span>
              <span className="text-text-secondary truncate">{change.file as string}</span>
            </div>
          ))}
          {changes.length > 5 && (
            <div className="text-xs text-text-muted">+{changes.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function GitCommitResult({ result }: { result: ToolResult }) {
  const hash = result.commit_hash as string;
  const message = result.message as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <GitCommit className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Committed</span>
        <span className="text-xs text-accent-success font-mono ml-auto">{hash?.slice(0, 7)}</span>
      </div>
      {message && <div className="mt-1 text-xs text-text-secondary truncate">{message}</div>}
    </div>
  );
}

function GitPushResult({ result }: { result: ToolResult }) {
  const remote = result.remote as string;
  const branch = result.branch as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Pushed</span>
        <span className="text-xs text-accent-success ml-auto">
          {remote}/{branch}
        </span>
      </div>
    </div>
  );
}

function GitDiffResult({ result }: { result: ToolResult }) {
  const diff = result.diff as string;
  const hasChanges = result.has_changes as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Code className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Diff</span>
        <span
          className={cn(
            'text-xs ml-auto',
            hasChanges ? 'text-accent-warning' : 'text-accent-success'
          )}
        >
          {hasChanges ? 'Changes found' : 'No changes'}
        </span>
      </div>
      {diff && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View diff
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-40 overflow-y-auto font-mono">
            {diff.slice(0, 2000)}
            {diff.length > 2000 ? '...' : ''}
          </pre>
        </details>
      )}
    </div>
  );
}

function GitBranchResult({ result }: { result: ToolResult }) {
  const action = result.action as string;
  const branch = result.branch as string;
  const current = result.current as string;
  const branches = (result.branches as string[]) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">
          {action === 'list' ? 'Branches' : `Branch ${action}d`}
        </span>
        {branch && <span className="text-xs text-accent-primary ml-auto">{branch}</span>}
      </div>
      {action === 'list' && branches.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {branches.slice(0, 5).map((b, i) => (
            <div key={i} className="text-xs text-text-secondary flex items-center gap-1">
              {b === current && <span className="text-accent-success">*</span>}
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GitLogResult({ result }: { result: ToolResult }) {
  const commits = (result.commits as Array<Record<string, unknown>>) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitCommit className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Commit History</span>
        <span className="text-xs text-text-muted ml-auto">{commits.length} commits</span>
      </div>
      {commits.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {commits.slice(0, 5).map((commit, i) => (
            <div key={i} className="text-xs flex items-start gap-2">
              <span className="text-accent-primary font-mono shrink-0">
                {(commit.hash as string)?.slice(0, 7)}
              </span>
              <span className="text-text-secondary truncate">{commit.message as string}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePRResult({ result }: { result: ToolResult }) {
  const title = result.title as string;
  const url = result.url as string;
  const draft = result.draft as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">{title}</span>
        {draft && <span className="text-xs text-text-muted">Draft</span>}
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-accent-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          View PR
        </a>
      )}
    </div>
  );
}

// ============ COMMAND TOOLS ============

function RunCommandResult({ result }: { result: ToolResult }) {
  const command = result.command as string;
  const exitCode = result.exit_code as number;
  const stdout = result.stdout as string;
  const stderr = result.stderr as string;
  const success = exitCode === 0;

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md',
        success
          ? 'bg-elevated border border-border-subtle'
          : 'bg-accent-error/10 border border-accent-error/20'
      )}
    >
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-text-secondary" />
        <code className="text-xs text-text-primary font-mono truncate flex-1">{command}</code>
        <span className={cn('text-xs', success ? 'text-accent-success' : 'text-accent-error')}>
          Exit {exitCode}
        </span>
      </div>
      {(stdout || stderr) && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View output
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-32 overflow-y-auto font-mono">
            {stdout || stderr}
          </pre>
        </details>
      )}
    </div>
  );
}

// ============ WEB TOOLS ============

function FetchUrlResult({ result }: { result: ToolResult }) {
  const url = result.url as string;
  const title = result.title as string;
  const statusCode = result.status_code as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {title || 'Fetched URL'}
        </span>
        <span
          className={cn(
            'text-xs',
            statusCode === 200 ? 'text-accent-success' : 'text-accent-warning'
          )}
        >
          {statusCode}
        </span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-text-muted hover:text-accent-primary truncate block"
        >
          {url}
        </a>
      )}
    </div>
  );
}

function SearchWebResult({ result }: { result: ToolResult }) {
  const query = result.query as string;
  const results = (result.results as Array<Record<string, unknown>>) || [];
  const numResults = result.num_results as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Search: "{query}"</span>
        <span className="text-xs text-text-muted ml-auto">{numResults} results</span>
      </div>
      {results.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {results.slice(0, 3).map((r, i) => (
            <div key={i} className="text-xs">
              <a
                href={r.url as string}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary hover:underline font-medium"
              >
                {r.title as string}
              </a>
              <div className="text-text-muted truncate">{r.snippet as string}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScreenshotResult({ result }: { result: ToolResult }) {
  const url = result.url as string;
  const title = result.title as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Screenshot captured</span>
      </div>
      {title && <div className="mt-1 text-xs text-text-secondary">{title}</div>}
      {url && <div className="mt-1 text-xs text-text-muted truncate">{url}</div>}
    </div>
  );
}

// ============ DEPLOY TOOLS ============

function DeployPreviewResult({ result }: { result: ToolResult }) {
  const url = result.url as string;
  const status = result.status as string;
  const previewId = result.preview_id as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Rocket className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Preview Deployed</span>
        <span className="text-xs text-accent-success ml-auto capitalize">{status}</span>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-accent-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          {url}
        </a>
      )}
      {previewId && <div className="mt-1 text-xs text-text-muted font-mono">ID: {previewId}</div>}
    </div>
  );
}

function PreviewStatusResult({ result }: { result: ToolResult }) {
  const preview = result.preview as Record<string, unknown>;
  const status = preview?.status as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Rocket className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Preview Status</span>
        <span
          className={cn(
            'text-xs ml-auto capitalize',
            status === 'running' && 'text-accent-success',
            status === 'stopped' && 'text-text-muted',
            status === 'error' && 'text-accent-error'
          )}
        >
          {status}
        </span>
      </div>
    </div>
  );
}

function E2ETestsResult({ result }: { result: ToolResult }) {
  const summary = result.summary as Record<string, unknown>;
  const allPassed = result.all_passed as boolean;

  return (
    <div
      className={cn(
        'mt-2 p-2 rounded-md',
        allPassed
          ? 'bg-accent-success/10 border border-accent-success/20'
          : 'bg-accent-error/10 border border-accent-error/20'
      )}
    >
      <div className="flex items-center gap-2">
        <Play className={cn('h-4 w-4', allPassed ? 'text-accent-success' : 'text-accent-error')} />
        <span className="text-sm font-medium text-text-primary">E2E Tests</span>
        <span
          className={cn('text-xs ml-auto', allPassed ? 'text-accent-success' : 'text-accent-error')}
        >
          {allPassed ? 'All Passed' : 'Failed'}
        </span>
      </div>
      {summary && (
        <div className="mt-1 flex gap-3 text-xs">
          <span className="text-accent-success">{summary.passed as number} passed</span>
          <span className="text-accent-error">{summary.failed as number} failed</span>
          <span className="text-text-muted">{summary.skipped as number} skipped</span>
        </div>
      )}
    </div>
  );
}

// ============ MEMORY TOOLS ============

function StoreMemoryResult({ result }: { result: ToolResult }) {
  const memoryType = result.memory_type as string;
  const memoryId = result.memory_id as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Memory Stored</span>
        <span className="text-xs text-accent-primary ml-auto capitalize">{memoryType}</span>
      </div>
      {memoryId && <div className="mt-1 text-xs text-text-muted font-mono">ID: {memoryId}</div>}
    </div>
  );
}

function RecallMemoryResult({ result }: { result: ToolResult }) {
  const query = result.query as string;
  const memories = (result.memories as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Recalled: "{query}"</span>
        <span className="text-xs text-text-muted ml-auto">{count} found</span>
      </div>
      {memories.length > 0 && (
        <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
          {memories.slice(0, 3).map((m, i) => (
            <div key={i} className="text-xs text-text-secondary truncate">
              <span className="text-accent-primary">[{m.type as string}]</span>{' '}
              {m.content as string}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ TASK TOOLS ============

function CreateTaskResult({ result }: { result: ToolResult }) {
  const taskId = result.task_id as string;
  const agentRole = result.agent_role as string;
  const priority = result.priority as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-primary/10 border border-accent-primary/20">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Task Created</span>
        <span className="text-xs text-accent-primary ml-auto">{agentRole}</span>
      </div>
      <div className="mt-1 text-xs text-text-muted font-mono">ID: {taskId}</div>
      {priority && (
        <span
          className={cn(
            'mt-1 inline-block px-1.5 py-0.5 rounded text-xs',
            priority === 'high' && 'bg-accent-error/20 text-accent-error',
            priority === 'medium' && 'bg-accent-warning/20 text-accent-warning',
            priority === 'low' && 'bg-accent-success/20 text-accent-success'
          )}
        >
          {priority} priority
        </span>
      )}
    </div>
  );
}

function TaskStatsResult({ result }: { result: ToolResult }) {
  const pending = result.pending as number;
  const active = result.active as number;
  const completed = result.completed as number;
  const failed = result.failed as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Task Stats</span>
      </div>
      <div className="mt-1 flex gap-3 text-xs">
        <span className="text-text-muted">{pending} pending</span>
        <span className="text-accent-warning">{active} active</span>
        <span className="text-accent-success">{completed} done</span>
        <span className="text-accent-error">{failed} failed</span>
      </div>
    </div>
  );
}

// ============ SKILL TOOLS ============

function ExecuteSkillResult({ result }: { result: ToolResult }) {
  const execution = result.execution as Record<string, unknown>;
  const skillName = execution?.skill_name as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Skill Executed</span>
        <span className="text-xs text-accent-primary ml-auto">{skillName}</span>
      </div>
    </div>
  );
}

function ListSkillsResult({ result }: { result: ToolResult }) {
  const skills = (result.skills as Array<Record<string, unknown>>) || [];
  const count = result.count as number;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Available Skills</span>
        <span className="text-xs text-text-muted ml-auto">{count} skills</span>
      </div>
      {skills.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {skills.slice(0, 5).map((skill, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded bg-elevated text-xs text-text-secondary">
              {skill.name as string}
            </span>
          ))}
          {skills.length > 5 && (
            <span className="text-xs text-text-muted">+{skills.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============ HELPERS ============

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
