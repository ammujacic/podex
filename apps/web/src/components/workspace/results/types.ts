/**
 * Shared types for tool result displays.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolResult = Record<string, any>;

export interface ToolResultDisplayProps {
  toolName: string;
  result: unknown;
  onPlanApprove?: (planId: string) => Promise<void>;
  onPlanReject?: (planId: string) => Promise<void>;
}

export interface ResultComponentProps {
  result: ToolResult;
}
