/**
 * Component for displaying tool execution results with nice formatting.
 * Routes to specialized display components based on tool type.
 */

import React from 'react';
import { PlanResultDisplay } from './PlanResultDisplay';
import {
  safeParseJSON,
  SimpleResult,
  GenericSuccessResult,
  // Orchestrator
  CreateAgentResult,
  DelegateTaskResult,
  TaskStatusResult,
  WaitForTasksResult,
  DelegateToAgentResult,
  SynthesizeResultsResult,
  // Files
  ReadFileResult,
  WriteFileResult,
  ListDirectoryResult,
  SearchCodeResult,
  // Git
  GitStatusResult,
  GitCommitResult,
  GitPushResult,
  GitDiffResult,
  GitBranchResult,
  GitLogResult,
  CreatePRResult,
  // Command
  RunCommandResult,
  // Web
  FetchUrlResult,
  SearchWebResult,
  ScreenshotResult,
  // Deploy
  DeployPreviewResult,
  PreviewStatusResult,
  E2ETestsResult,
  // Memory
  StoreMemoryResult,
  RecallMemoryResult,
  // Tasks
  CreateTaskResult,
  TaskStatsResult,
  TodoWriteResult,
  // Skills
  ExecuteSkillResult,
  ListSkillsResult,
  type ToolResult,
} from './results';

interface ToolResultDisplayProps {
  toolName: string;
  result: unknown;
  onPlanApprove?: (planId: string) => Promise<void>;
  onPlanReject?: (planId: string) => Promise<void>;
}

/**
 * Main router component for tool results.
 * Parses result and routes to appropriate display component.
 */
export const ToolResultDisplay = React.memo<ToolResultDisplayProps>(function ToolResultDisplay({
  toolName,
  result,
  onPlanApprove,
  onPlanReject,
}) {
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
    case 'Read': // Claude Code Read tool
      return <ReadFileResult result={parsedResult} />;
    case 'write_file':
    case 'Write': // Claude Code Write tool
      return <WriteFileResult result={parsedResult} />;
    case 'list_directory':
    case 'Glob': // Claude Code Glob tool
      return <ListDirectoryResult result={parsedResult} />;
    case 'search_code':
    case 'grep':
    case 'glob_files':
    case 'Grep': // Claude Code Grep tool
      return <SearchCodeResult result={parsedResult} />;
    case 'Edit': // Claude Code Edit tool
      return <WriteFileResult result={parsedResult} />;

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
    case 'Bash': // Claude Code Bash tool
      return <RunCommandResult result={parsedResult} />;

    // Web tools
    case 'fetch_url':
    case 'WebFetch': // Claude Code WebFetch tool
      return <FetchUrlResult result={parsedResult} />;
    case 'search_web':
    case 'WebSearch': // Claude Code WebSearch tool
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
    case 'TodoWrite': // Claude Code TodoWrite tool
      return <TodoWriteResult result={parsedResult} />;

    // Skill tools
    case 'execute_skill':
      return <ExecuteSkillResult result={parsedResult} />;
    case 'list_skills':
      return <ListSkillsResult result={parsedResult} />;

    // Default fallback
    default:
      return <GenericSuccessResult result={parsedResult} toolName={toolName} />;
  }
});
