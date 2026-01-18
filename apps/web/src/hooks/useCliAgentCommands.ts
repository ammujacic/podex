'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

/**
 * Slash command definition from CLI agent APIs.
 */
export interface SlashCommand {
  name: string;
  description: string;
  builtin: boolean;
}

/**
 * CLI agent type identifiers.
 */
export type CliAgentType = 'claude-code' | 'openai-codex' | 'gemini-cli';

/**
 * CLI agent feature capabilities.
 * Defines which features are supported by each CLI agent.
 */
export interface CliCapabilities {
  /** Whether extended thinking/reasoning is supported */
  thinkingSupported: boolean;
  /** How thinking budget is configured (token count, effort level, or not supported) */
  thinkingBudgetType: 'tokens' | 'effort' | 'none';
  /** Description of thinking support for UI */
  thinkingDescription: string;
  /** Supported modes */
  supportedModes: ('plan' | 'ask' | 'auto' | 'sovereign')[];
  /** Supported models with display names */
  supportedModels: { id: string; name: string; default?: boolean }[];
  /** Whether vision/images are supported */
  visionSupported: boolean;
  /** Whether file attachments are supported */
  attachmentsSupported: boolean;
  /** Whether MCP (Model Context Protocol) is supported */
  mcpSupported: boolean;
  /** Whether context compaction is supported */
  compactSupported: boolean;
  /** Description of any limitations */
  limitations: string[];
}

/**
 * CLI agent capabilities configuration.
 */
export const CLI_CAPABILITIES: Record<CliAgentType, CliCapabilities> = {
  'claude-code': {
    thinkingSupported: true,
    thinkingBudgetType: 'tokens',
    thinkingDescription: 'Extended thinking with configurable token budget (1K-32K tokens)',
    supportedModes: ['plan', 'ask', 'auto'],
    supportedModels: [
      { id: 'sonnet', name: 'Claude Sonnet 4', default: true },
      { id: 'opus', name: 'Claude Opus 4' },
      { id: 'haiku', name: 'Claude Haiku 3.5' },
    ],
    visionSupported: true,
    attachmentsSupported: true,
    mcpSupported: true,
    compactSupported: true,
    limitations: [],
  },
  'openai-codex': {
    thinkingSupported: true,
    thinkingBudgetType: 'effort',
    thinkingDescription:
      'Extended reasoning with effort levels (low/medium/high) for o3/o4-mini models',
    supportedModes: ['ask', 'auto', 'sovereign'],
    supportedModels: [
      { id: 'gpt-5', name: 'GPT-5', default: true },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
    visionSupported: true,
    attachmentsSupported: true,
    mcpSupported: false,
    compactSupported: true,
    limitations: ['MCP not supported'],
  },
  'gemini-cli': {
    thinkingSupported: false,
    thinkingBudgetType: 'none',
    thinkingDescription: 'Extended thinking is not directly configurable in Gemini CLI',
    supportedModes: ['ask', 'auto', 'sovereign'],
    supportedModels: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', default: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    ],
    visionSupported: true,
    attachmentsSupported: true,
    mcpSupported: false,
    compactSupported: false,
    limitations: [
      'Extended thinking not configurable',
      'MCP not supported',
      'Context compaction managed internally',
    ],
  },
};

/**
 * Get capabilities for a CLI agent type.
 */
export function getCliCapabilities(agentType: CliAgentType): CliCapabilities {
  return CLI_CAPABILITIES[agentType];
}

/**
 * Check if a specific feature is supported by a CLI agent.
 */
export function isCliFeatureSupported(
  agentType: CliAgentType,
  feature: keyof CliCapabilities
): boolean {
  const caps = CLI_CAPABILITIES[agentType];
  const value = caps[feature];
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0;
  return value !== 'none';
}

/**
 * Get supported models for a CLI agent.
 */
export function getCliSupportedModels(
  agentType: CliAgentType
): { id: string; name: string; default?: boolean }[] {
  return CLI_CAPABILITIES[agentType].supportedModels;
}

/**
 * Check if a mode is supported by a CLI agent.
 */
export function isCliModeSupported(
  agentType: CliAgentType,
  mode: 'plan' | 'ask' | 'auto' | 'sovereign'
): boolean {
  return CLI_CAPABILITIES[agentType].supportedModes.includes(mode);
}

/**
 * Built-in commands for each CLI agent type.
 */
const BUILTIN_COMMANDS: Record<CliAgentType, SlashCommand[]> = {
  'claude-code': [
    { name: 'help', description: 'Show all available commands', builtin: true },
    { name: 'clear', description: 'Clear conversation history', builtin: true },
    { name: 'compact', description: 'Compact context to reduce tokens', builtin: true },
    { name: 'config', description: 'View/modify configuration', builtin: true },
    { name: 'model', description: 'Switch model (e.g., /model opus)', builtin: true },
    { name: 'status', description: 'Show current status', builtin: true },
    { name: 'rewind', description: 'Rewind to previous state', builtin: true },
    { name: 'vim', description: 'Toggle Vim keybindings', builtin: true },
    { name: 'bug', description: 'Report a bug', builtin: true },
    { name: 'login', description: 'Authenticate with Anthropic', builtin: true },
    { name: 'logout', description: 'Clear authentication', builtin: true },
    { name: 'doctor', description: 'Run diagnostics', builtin: true },
  ],
  'openai-codex': [
    { name: 'help', description: 'Show all available commands', builtin: true },
    { name: 'clear', description: 'Clear conversation history', builtin: true },
    { name: 'compact', description: 'Compact context to reduce tokens', builtin: true },
    { name: 'config', description: 'View/modify configuration', builtin: true },
    { name: 'model', description: 'Switch model (e.g., /model gpt-5)', builtin: true },
    { name: 'status', description: 'Show current status', builtin: true },
    { name: 'resume', description: 'Resume a previous session', builtin: true },
    { name: 'diff', description: 'Show file changes', builtin: true },
    { name: 'web', description: 'Enable/disable web search', builtin: true },
  ],
  'gemini-cli': [
    { name: 'help', description: 'Show all available commands', builtin: true },
    { name: 'clear', description: 'Clear conversation history', builtin: true },
    { name: 'memory', description: "Manage AI's instructional context (GEMINI.md)", builtin: true },
    { name: 'resume', description: 'Open session browser to resume a session', builtin: true },
    { name: 'sessions', description: 'List available sessions', builtin: true },
    { name: 'status', description: 'Show current session status', builtin: true },
    { name: 'tools', description: 'List available tools/extensions', builtin: true },
    { name: 'model', description: 'Switch model', builtin: true },
    { name: 'web', description: 'Toggle web search capability', builtin: true },
    { name: 'save', description: 'Save current session', builtin: true },
  ],
};

/**
 * API route prefixes for each CLI agent type.
 */
const API_PREFIXES: Record<CliAgentType, string> = {
  'claude-code': '/claude-code',
  'openai-codex': '/openai-codex',
  'gemini-cli': '/gemini-cli',
};

interface UseCliAgentCommandsReturn {
  commands: SlashCommand[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage CLI agent slash commands.
 * Returns both built-in commands and any custom commands from the API.
 */
export function useCliAgentCommands(agentType: CliAgentType): UseCliAgentCommandsReturn {
  const [customCommands, setCustomCommands] = useState<SlashCommand[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const builtinCommands = BUILTIN_COMMANDS[agentType] || [];
  const apiPrefix = API_PREFIXES[agentType];

  const fetchCommands = useCallback(async () => {
    if (!apiPrefix) return;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch custom commands from API
      const response = await api.get<SlashCommand[]>(`${apiPrefix}/commands`);

      // Filter out any commands that are already in builtin list
      const builtinNames = new Set(builtinCommands.map((c) => c.name));
      const custom = response.filter((cmd) => !builtinNames.has(cmd.name));

      setCustomCommands(custom);
    } catch (err) {
      // API errors are not critical - we still have builtin commands
      console.warn(`Failed to fetch custom ${agentType} commands:`, err);
      setError(err instanceof Error ? err.message : 'Failed to fetch commands');
    } finally {
      setIsLoading(false);
    }
  }, [apiPrefix, builtinCommands, agentType]);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  // Combine builtin and custom commands
  const commands = [...builtinCommands, ...customCommands];

  return {
    commands,
    isLoading,
    error,
    refetch: fetchCommands,
  };
}

/**
 * Authentication status for CLI agents.
 */
export interface AuthStatus {
  authenticated: boolean;
  needsAuth: boolean;
  credentialsSynced: boolean;
}

interface UseCliAgentAuthReturn {
  authStatus: AuthStatus | null;
  isLoading: boolean;
  error: string | null;
  checkAuth: () => Promise<void>;
  reauthenticate: () => Promise<void>;
}

/**
 * Hook to manage CLI agent authentication for a specific agent.
 */
export function useCliAgentAuth(
  agentType: CliAgentType,
  agentId: string | undefined
): UseCliAgentAuthReturn {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiPrefix = API_PREFIXES[agentType];

  const checkAuth = useCallback(async () => {
    if (!agentId || !apiPrefix) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{
        authenticated: boolean;
        needs_auth: boolean;
        credentials_synced: boolean;
      }>(`${apiPrefix}/agents/${agentId}/auth-status`);

      setAuthStatus({
        authenticated: response.authenticated,
        needsAuth: response.needs_auth,
        credentialsSynced: response.credentials_synced,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check auth status');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, apiPrefix]);

  const reauthenticate = useCallback(async () => {
    if (!agentId || !apiPrefix) return;

    try {
      setIsLoading(true);
      setError(null);

      await api.post(`${apiPrefix}/agents/${agentId}/reauthenticate`, {});

      // Re-check auth status
      await checkAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reauthenticate');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, apiPrefix, checkAuth]);

  useEffect(() => {
    if (agentId) {
      checkAuth();
    }
  }, [agentId, checkAuth]);

  return {
    authStatus,
    isLoading,
    error,
    checkAuth,
    reauthenticate,
  };
}

/**
 * Hook to manage CLI agent installation for a specific agent.
 */
interface UseCliAgentInstallReturn {
  isInstalled: boolean | null;
  version: string | null;
  isLoading: boolean;
  error: string | null;
  checkInstallation: () => Promise<void>;
  install: () => Promise<boolean>;
}

export function useCliAgentInstall(
  agentType: CliAgentType,
  agentId: string | undefined
): UseCliAgentInstallReturn {
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiPrefix = API_PREFIXES[agentType];

  const checkInstallation = useCallback(async () => {
    if (!agentId || !apiPrefix) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{
        installed: boolean;
        version: string | null;
        error?: string;
      }>(`${apiPrefix}/agents/${agentId}/check-installation`);

      setIsInstalled(response.installed);
      setVersion(response.version);

      if (response.error) {
        setError(response.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check installation');
    } finally {
      setIsLoading(false);
    }
  }, [agentId, apiPrefix]);

  const install = useCallback(async (): Promise<boolean> => {
    if (!agentId || !apiPrefix) return false;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.post<{
        success: boolean;
        version?: string;
        error?: string;
      }>(`${apiPrefix}/agents/${agentId}/install`, {});

      if (response.success) {
        setIsInstalled(true);
        setVersion(response.version || null);
        return true;
      } else {
        setError(response.error || 'Installation failed');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to install ${agentType}`);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [agentId, apiPrefix, agentType]);

  useEffect(() => {
    if (agentId) {
      checkInstallation();
    }
  }, [agentId, checkInstallation]);

  return {
    isInstalled,
    version,
    isLoading,
    error,
    checkInstallation,
    install,
  };
}

/**
 * Helper to determine CLI agent type from agent role.
 */
export function getCliAgentType(role: string): CliAgentType | null {
  if (role === 'claude-code') return 'claude-code';
  if (role === 'openai-codex') return 'openai-codex';
  if (role === 'gemini-cli') return 'gemini-cli';
  return null;
}

/**
 * Check if an agent role is a CLI agent type.
 */
export function isCliAgentRole(role: string): boolean {
  return getCliAgentType(role) !== null;
}
