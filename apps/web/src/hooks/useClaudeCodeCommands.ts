'use client';

/**
 * Claude Code specific hooks.
 *
 * These are convenience wrappers around the generic CLI agent hooks.
 * For new code, prefer using useCliAgentCommands, useCliAgentAuth, etc.
 * directly from useCliAgentCommands.ts.
 */

import {
  useCliAgentCommands,
  useCliAgentAuth,
  useCliAgentInstall,
  type SlashCommand,
  type AuthStatus,
} from './useCliAgentCommands';

// Re-export types for backward compatibility
export type { SlashCommand, AuthStatus };

interface UseClaudeCodeCommandsReturn {
  commands: SlashCommand[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage Claude Code slash commands.
 * Returns both built-in commands and any custom commands from the API.
 *
 * @deprecated Use useCliAgentCommands('claude-code') instead
 */
export function useClaudeCodeCommands(): UseClaudeCodeCommandsReturn {
  return useCliAgentCommands('claude-code');
}

interface UseClaudeCodeAuthReturn {
  authStatus: AuthStatus | null;
  isLoading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  reauthenticate: () => Promise<void>;
}

/**
 * Hook to manage Claude Code authentication for a specific agent.
 *
 * @deprecated Use useCliAgentAuth('claude-code', agentId) instead
 */
export function useClaudeCodeAuth(agentId: string | undefined): UseClaudeCodeAuthReturn {
  return useCliAgentAuth('claude-code', agentId);
}

interface UseClaudeCodeInstallReturn {
  isInstalled: boolean | null;
  version: string | null;
  isLoading: boolean;
  error: string | null;
  checkInstallation: () => Promise<void>;
  install: () => Promise<boolean>;
}

/**
 * Hook to manage Claude Code CLI installation for a specific agent.
 *
 * @deprecated Use useCliAgentInstall('claude-code', agentId) instead
 */
export function useClaudeCodeInstall(agentId: string | undefined): UseClaudeCodeInstallReturn {
  return useCliAgentInstall('claude-code', agentId);
}
