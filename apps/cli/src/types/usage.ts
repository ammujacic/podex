/**
 * Usage and transparency types for CLI.
 */

/**
 * Token usage statistics for the current session/agent.
 */
export interface UsageStats {
  /** Total input tokens used */
  inputTokens: number;
  /** Total output tokens used */
  outputTokens: number;
  /** Tokens read from cache */
  cacheReadTokens: number;
  /** Tokens written to cache */
  cacheCreationTokens: number;
}

/**
 * Context window usage for an agent.
 */
export interface ContextUsage {
  /** Tokens currently used in context */
  tokensUsed: number;
  /** Maximum tokens allowed in context */
  tokensMax: number;
  /** Percentage of context used (0-100) */
  percentage: number;
}

/**
 * Session-level usage tracking.
 */
export interface SessionUsage {
  /** Cumulative token usage */
  tokens: UsageStats;
  /** Estimated cost in credits */
  creditsUsed: number;
  /** Remaining credits (if known) */
  creditsRemaining?: number;
}

/**
 * Agent-level configuration and usage.
 */
export interface AgentUsageInfo {
  /** Agent ID */
  agentId: string;
  /** Current model being used */
  model: string;
  /** Display name for the model */
  modelDisplayName?: string;
  /** Current agent mode */
  mode: 'plan' | 'ask' | 'auto' | 'sovereign';
  /** Context window usage */
  context: ContextUsage;
  /** Whether extended thinking is enabled */
  thinkingEnabled: boolean;
  /** Thinking budget in tokens */
  thinkingBudget?: number;
}

/**
 * Format token count for display (e.g., 12450 -> "12.4k")
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return tokens.toString();
  }
  if (tokens < 10000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  if (tokens < 1000000) {
    return `${Math.round(tokens / 1000)}k`;
  }
  return `${(tokens / 1000000).toFixed(1)}M`;
}

/**
 * Format credits for display.
 */
export function formatCredits(credits: number): string {
  if (credits < 1000) {
    return credits.toFixed(2);
  }
  return credits.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Get context percentage color based on usage.
 */
export function getContextColor(percentage: number): 'success' | 'warning' | 'error' {
  if (percentage < 50) return 'success';
  if (percentage < 80) return 'warning';
  return 'error';
}
