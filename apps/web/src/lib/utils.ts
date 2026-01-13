import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getLanguageFromPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    dockerfile: 'dockerfile',
  };
  return languageMap[extension ?? ''] ?? 'plaintext';
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Map of tool/function names to user-friendly display names.
 * Used to show cleaner messages in the UI when tools are being called.
 */
const toolFriendlyNames: Record<string, string> = {
  // File Tools
  read_file: 'Reading file',
  write_file: 'Writing file',
  list_directory: 'Listing directory',
  search_code: 'Searching code',

  // Orchestrator Tools
  create_execution_plan: 'Creating plan',
  delegate_task: 'Delegating task',
  create_custom_agent: 'Creating custom agent',
  delegate_to_custom_agent: 'Delegating to custom agent',
  get_task_status: 'Checking task status',
  wait_for_tasks: 'Waiting for tasks',
  get_all_pending_tasks: 'Getting pending tasks',
  synthesize_results: 'Synthesizing results',

  // Terminal/Command Tools
  run_terminal_command: 'Running command',
  run_command: 'Running command',

  // Git Tools
  git_status: 'Checking git status',
  git_commit: 'Committing changes',
  git_push: 'Pushing to remote',
  git_branch: 'Managing branches',
  git_diff: 'Viewing differences',
  git_log: 'Viewing commit history',
  create_pr: 'Creating pull request',

  // Deploy Tools
  deploy_preview: 'Deploying preview',
  get_preview_status: 'Checking preview status',
  stop_preview: 'Stopping preview',
  rollback_deploy: 'Rolling back deployment',
  get_preview_logs: 'Getting preview logs',
  run_e2e_tests: 'Running E2E tests',
  check_deployment_health: 'Checking deployment health',
  wait_for_deployment: 'Waiting for deployment',
  list_previews: 'Listing previews',

  // Memory Tools
  store_memory: 'Storing memory',
  recall_memory: 'Recalling memory',
  update_memory: 'Updating memory',
  delete_memory: 'Deleting memory',
  get_session_memories: 'Getting session memories',

  // Task Tools
  create_task: 'Creating task',
  get_pending_tasks: 'Getting pending tasks',
  get_task: 'Getting task',
  complete_task: 'Completing task',
  fail_task: 'Marking task as failed',
  cancel_task: 'Canceling task',
  clear_session_tasks: 'Clearing session tasks',
  get_session_task_stats: 'Getting task stats',

  // Vision Tools
  analyze_screenshot: 'Analyzing screenshot',
  design_to_code: 'Converting design to code',
  visual_diff: 'Comparing visuals',
  analyze_accessibility: 'Analyzing accessibility',
  extract_ui_elements: 'Extracting UI elements',

  // Agent Builder Tools
  create_agent_template: 'Creating agent template',
  list_available_tools: 'Listing available tools',
  preview_agent_template: 'Previewing agent template',

  // Skill Tools
  list_skills: 'Listing skills',
  get_skill: 'Getting skill',
  match_skills: 'Matching skills',
  execute_skill: 'Executing skill',
  create_skill: 'Creating skill',
  delete_skill: 'Deleting skill',
  get_skill_stats: 'Getting skill stats',
  recommend_skills: 'Recommending skills',

  // Web Tools
  fetch_url: 'Fetching URL',
  screenshot_page: 'Taking screenshot',
  search_web: 'Searching web',
  interact_with_page: 'Interacting with page',
  extract_page_data: 'Extracting page data',
};

/**
 * Get a user-friendly display name for a tool/function name.
 * Falls back to converting snake_case to Title Case if no mapping exists.
 */
export function getFriendlyToolName(toolName: string): string {
  // Check if we have a friendly name mapping
  if (toolFriendlyNames[toolName]) {
    return toolFriendlyNames[toolName];
  }

  // Fallback: Convert snake_case to Title Case
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatTimestamp(date: Date | string): string {
  // Handle string dates (from localStorage/API) and Date objects
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Check for invalid date
  if (isNaN(dateObj.getTime())) {
    return '--:--';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(dateObj);
}

/**
 * Clean streaming content by detecting and replacing tool call JSON patterns.
 * Some LLM providers (like Ollama) output tool calls as raw JSON text in the content.
 * This function detects that pattern and returns a user-friendly message instead.
 */
export function cleanStreamingContent(content: string): {
  displayContent: string;
  isToolCallJson: boolean;
  toolName?: string;
} {
  if (!content) {
    return { displayContent: '', isToolCallJson: false };
  }

  const trimmed = content.trim();

  // Check if content looks like a tool call JSON
  // Pattern: { "name": "tool_name", "arguments": { ... } }
  const toolCallPattern = /^\s*\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:/;
  const match = trimmed.match(toolCallPattern);

  if (match && match[1]) {
    const toolName = match[1];
    const friendlyName = getFriendlyToolName(toolName);
    // Return a friendly message instead of raw JSON
    return {
      displayContent: `${friendlyName}...`,
      isToolCallJson: true,
      toolName,
    };
  }

  // Check for partial JSON that's building up (starts with { and has "name")
  if (trimmed.startsWith('{') && trimmed.includes('"name"')) {
    // Try to extract tool name even from partial JSON
    const partialMatch = trimmed.match(/"name"\s*:\s*"([^"]+)"/);
    if (partialMatch && partialMatch[1]) {
      const toolName = partialMatch[1];
      const friendlyName = getFriendlyToolName(toolName);
      return {
        displayContent: `${friendlyName}...`,
        isToolCallJson: true,
        toolName,
      };
    }
    // Content looks like it's building a tool call JSON but name not complete yet
    return {
      displayContent: 'Preparing tool call...',
      isToolCallJson: true,
    };
  }

  // Not a tool call JSON, return as-is
  return { displayContent: content, isToolCallJson: false };
}

/**
 * Map of common API error messages to user-friendly descriptions.
 */
const errorMessageMap: Record<string, string> = {
  'Message not found': 'The message could not be found. It may have been deleted.',
  'Agent not found': 'The agent could not be found. It may have been removed.',
  'Session not found': 'The session could not be found. It may have expired.',
  Unauthorized: 'You are not authorized to perform this action. Please sign in again.',
  Forbidden: 'You do not have permission to perform this action.',
  'Rate limit exceeded': 'Too many requests. Please wait a moment and try again.',
  'Network error': 'Unable to connect to the server. Please check your internet connection.',
  'Internal server error': 'Something went wrong on our end. Please try again later.',
};

/**
 * Get a user-friendly error message with operation context.
 * @param operation - The name of the operation being performed (e.g., "Play Audio", "Send Message")
 * @param errorMessage - The raw error message from the API
 * @returns A user-friendly error message with context
 */
export function getFriendlyErrorMessage(operation: string, errorMessage: string): string {
  // Check for known error messages
  const friendlyMessage = errorMessageMap[errorMessage];

  if (friendlyMessage) {
    return `${operation} failed: ${friendlyMessage}`;
  }

  // Handle HTTP status errors
  if (errorMessage.startsWith('HTTP 404')) {
    return `${operation} failed: The requested resource was not found.`;
  }
  if (errorMessage.startsWith('HTTP 500')) {
    return `${operation} failed: Server error. Please try again later.`;
  }
  if (errorMessage.startsWith('HTTP 503')) {
    return `${operation} failed: Service temporarily unavailable.`;
  }

  // Default: include the original error with context
  return `${operation} failed: ${errorMessage}`;
}
