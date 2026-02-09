/**
 * Message types for the webview.
 */

/**
 * Chat message.
 */
export interface ChatMessage {
  id: string;
  session_id: string;
  agent_id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agent_name?: string;
  agent_color?: string;
}

/**
 * Streaming token.
 */
export interface StreamToken {
  session_id: string;
  agent_id: string;
  message_id: string;
  token: string;
  done: boolean;
}

/**
 * Agent status.
 */
export interface AgentStatus {
  agent_id: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';
  current_task?: string;
}

/**
 * Approval request.
 */
export interface ApprovalRequest {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  description: string;
  is_native?: boolean;
}

/**
 * Tool execution.
 */
export interface ToolExecution {
  session_id: string;
  agent_id: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  error?: string;
}
