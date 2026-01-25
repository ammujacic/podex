/**
 * Comprehensive tests for useCliAgentCommands hook
 * Tests all CLI agent command handlers, capabilities, and edge cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useCliAgentCommands,
  useCliAgentAuth,
  useCliAgentInstall,
  getCliCapabilities,
  isCliFeatureSupported,
  getCliSupportedModels,
  normalizeCliModelId,
  isCliModeSupported,
  getCliAgentType,
  isCliAgentRole,
  type CliAgentType,
  type SlashCommand,
  CLI_CAPABILITIES,
} from '../useCliAgentCommands';
import type { PodexApiClient } from '@/lib/api-adapters';

// Mock the API client
vi.mock('@/lib/api', () => {
  const mockApi = {
    get: vi.fn(),
    post: vi.fn(),
  };
  return {
    api: mockApi as unknown as PodexApiClient,
  };
});

// Import mocked API after mocking
import { api } from '@/lib/api';

describe('useCliAgentCommands', () => {
  const mockGet = vi.mocked(api.get);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Basic functionality', () => {
    it('should return builtin commands for claude-code', async () => {
      mockGet.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.commands.length).toBeGreaterThan(0);
      expect(result.current.commands.some((cmd) => cmd.name === 'help')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'clear')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'compact')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'model')).toBe(true);
    });

    it('should return builtin commands for openai-codex', async () => {
      mockGet.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useCliAgentCommands('openai-codex'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.commands.length).toBeGreaterThan(0);
      expect(result.current.commands.some((cmd) => cmd.name === 'help')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'resume')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'diff')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'web')).toBe(true);
    });

    it('should return builtin commands for gemini-cli', async () => {
      mockGet.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useCliAgentCommands('gemini-cli'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.commands.length).toBeGreaterThan(0);
      expect(result.current.commands.some((cmd) => cmd.name === 'memory')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'sessions')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'tools')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'save')).toBe(true);
    });

    it('should fetch and merge custom commands', async () => {
      const customCommands: SlashCommand[] = [
        { name: 'custom1', description: 'Custom command 1', builtin: false },
        { name: 'custom2', description: 'Custom command 2', builtin: false },
      ];
      mockGet.mockResolvedValueOnce(customCommands);

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledWith('/api/v1/claude-code/commands');
      expect(result.current.commands.some((cmd) => cmd.name === 'custom1')).toBe(true);
      expect(result.current.commands.some((cmd) => cmd.name === 'custom2')).toBe(true);
    });

    it('should filter out duplicate custom commands', async () => {
      const customCommands: SlashCommand[] = [
        { name: 'help', description: 'Duplicate help', builtin: false },
        { name: 'custom1', description: 'Custom command', builtin: false },
      ];
      mockGet.mockResolvedValueOnce(customCommands);

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const helpCommands = result.current.commands.filter((cmd) => cmd.name === 'help');
      expect(helpCommands.length).toBe(1);
      expect(helpCommands[0].builtin).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.commands.length).toBeGreaterThan(0); // Still has builtin commands
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('should handle non-Error exceptions', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGet.mockRejectedValueOnce('String error');

      const { result } = renderHook(() => useCliAgentCommands('openai-codex'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to fetch commands');
      expect(result.current.commands.length).toBeGreaterThan(0);

      consoleWarnSpy.mockRestore();
    });

    it('should set loading state correctly', async () => {
      mockGet.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Refetch functionality', () => {
    it('should refetch commands when refetch is called', async () => {
      mockGet.mockResolvedValue([]);

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledTimes(1);

      await result.current.refetch();

      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should clear error on successful refetch', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockGet.mockRejectedValueOnce(new Error('Initial error'));

      const { result } = renderHook(() => useCliAgentCommands('claude-code'));

      await waitFor(() => {
        expect(result.current.error).toBe('Initial error');
      });

      mockGet.mockResolvedValueOnce([]);
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.error).toBe(null);
      });

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Agent type switching', () => {
    it('should update commands when agent type changes', async () => {
      mockGet.mockResolvedValue([]);

      const { result, rerender } = renderHook(({ agentType }) => useCliAgentCommands(agentType), {
        initialProps: { agentType: 'claude-code' as CliAgentType },
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialCommands = result.current.commands;

      rerender({ agentType: 'gemini-cli' as CliAgentType });

      await waitFor(() => {
        expect(result.current.commands).not.toEqual(initialCommands);
      });

      expect(result.current.commands.some((cmd) => cmd.name === 'memory')).toBe(true);
    });
  });
});

describe('useCliAgentAuth', () => {
  const mockGet = vi.mocked(api.get);
  const mockPost = vi.mocked(api.post);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication status checking', () => {
    it('should fetch auth status on mount', async () => {
      mockGet.mockResolvedValueOnce({
        authenticated: true,
        needs_auth: false,
        credentials_synced: true,
      });

      const { result } = renderHook(() => useCliAgentAuth('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledWith('/api/v1/claude-code/agents/agent-123/auth-status');
      expect(result.current.authStatus).toEqual({
        authenticated: true,
        needsAuth: false,
        credentialsSynced: true,
      });
    });

    it('should not fetch when agentId is undefined', async () => {
      const { result } = renderHook(() => useCliAgentAuth('claude-code', undefined));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).not.toHaveBeenCalled();
      expect(result.current.authStatus).toBe(null);
    });

    it('should handle unauthenticated state', async () => {
      mockGet.mockResolvedValueOnce({
        authenticated: false,
        needs_auth: true,
        credentials_synced: false,
      });

      const { result } = renderHook(() => useCliAgentAuth('openai-codex', 'agent-456'));

      await waitFor(() => {
        expect(result.current.authStatus?.authenticated).toBe(false);
      });

      expect(result.current.authStatus?.needsAuth).toBe(true);
      expect(result.current.authStatus?.credentialsSynced).toBe(false);
    });

    it('should handle auth check errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('Auth check failed'));

      const { result } = renderHook(() => useCliAgentAuth('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.error).toBe('Auth check failed');
      });

      expect(result.current.authStatus).toBe(null);
    });
  });

  describe('Reauthentication', () => {
    it('should reauthenticate and refresh status', async () => {
      mockGet
        .mockResolvedValueOnce({
          authenticated: false,
          needs_auth: true,
          credentials_synced: false,
        })
        .mockResolvedValueOnce({
          authenticated: true,
          needs_auth: false,
          credentials_synced: true,
        });
      mockPost.mockResolvedValueOnce({});

      const { result } = renderHook(() => useCliAgentAuth('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.authStatus?.authenticated).toBe(false);
      });

      await result.current.reauthenticate();

      await waitFor(() => {
        expect(result.current.authStatus?.authenticated).toBe(true);
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/claude-code/agents/agent-123/reauthenticate',
        {}
      );
    });

    it('should handle reauthentication errors', async () => {
      mockGet.mockResolvedValueOnce({
        authenticated: false,
        needs_auth: true,
        credentials_synced: false,
      });
      mockPost.mockRejectedValueOnce(new Error('Reauthentication failed'));

      const { result } = renderHook(() => useCliAgentAuth('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await result.current.reauthenticate();

      await waitFor(() => {
        expect(result.current.error).toBe('Reauthentication failed');
      });
    });

    it('should not reauthenticate when agentId is undefined', async () => {
      const { result } = renderHook(() => useCliAgentAuth('claude-code', undefined));

      await result.current.reauthenticate();

      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('checkAuth method', () => {
    it('should manually check auth status', async () => {
      mockGet.mockResolvedValue({
        authenticated: true,
        needs_auth: false,
        credentials_synced: true,
      });

      const { result } = renderHook(() => useCliAgentAuth('gemini-cli', 'agent-789'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledTimes(1);

      await result.current.checkAuth();

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });

  describe('Different agent types', () => {
    it('should use correct API prefix for openai-codex', async () => {
      mockGet.mockResolvedValueOnce({
        authenticated: true,
        needs_auth: false,
        credentials_synced: true,
      });

      renderHook(() => useCliAgentAuth('openai-codex', 'agent-codex'));

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/api/v1/openai-codex/agents/agent-codex/auth-status');
      });
    });

    it('should use correct API prefix for gemini-cli', async () => {
      mockGet.mockResolvedValueOnce({
        authenticated: true,
        needs_auth: false,
        credentials_synced: true,
      });

      renderHook(() => useCliAgentAuth('gemini-cli', 'agent-gemini'));

      await waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/api/v1/gemini-cli/agents/agent-gemini/auth-status');
      });
    });
  });
});

describe('useCliAgentInstall', () => {
  const mockGet = vi.mocked(api.get);
  const mockPost = vi.mocked(api.post);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Installation checking', () => {
    it('should check installation status on mount', async () => {
      mockGet.mockResolvedValueOnce({
        installed: true,
        version: '1.2.3',
      });

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledWith(
        '/api/v1/claude-code/agents/agent-123/check-installation'
      );
      expect(result.current.isInstalled).toBe(true);
      expect(result.current.version).toBe('1.2.3');
    });

    it('should handle not installed state', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
      });

      const { result } = renderHook(() => useCliAgentInstall('openai-codex', 'agent-456'));

      await waitFor(() => {
        expect(result.current.isInstalled).toBe(false);
      });

      expect(result.current.version).toBe(null);
    });

    it('should handle installation check errors', async () => {
      mockGet.mockRejectedValueOnce(new Error('Check failed'));

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.error).toBe('Check failed');
      });
    });

    it('should not check when agentId is undefined', async () => {
      const { result } = renderHook(() => useCliAgentInstall('claude-code', undefined));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).not.toHaveBeenCalled();
      expect(result.current.isInstalled).toBe(null);
    });

    it('should handle error in response', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
        error: 'Installation check error',
      });

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.error).toBe('Installation check error');
      });
    });
  });

  describe('Installation', () => {
    it('should install successfully', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
      });
      mockPost.mockResolvedValueOnce({
        success: true,
        version: '1.2.3',
      });

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let success: boolean = false;
      await act(async () => {
        success = await result.current.install();
      });

      expect(success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/claude-code/agents/agent-123/install', {});
      expect(result.current.isInstalled).toBe(true);
      expect(result.current.version).toBe('1.2.3');
    });

    it('should handle installation failure', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
      });
      mockPost.mockResolvedValueOnce({
        success: false,
        error: 'Installation failed',
      });

      const { result } = renderHook(() => useCliAgentInstall('openai-codex', 'agent-456'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.install();
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Installation failed');
    });

    it('should handle installation errors', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
      });
      mockPost.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      let success: boolean = true;
      await act(async () => {
        success = await result.current.install();
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Network error');
    });

    it('should not install when agentId is undefined', async () => {
      const { result } = renderHook(() => useCliAgentInstall('claude-code', undefined));

      const success = await result.current.install();

      expect(success).toBe(false);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('should handle installation without version', async () => {
      mockGet.mockResolvedValueOnce({
        installed: false,
        version: null,
      });
      mockPost.mockResolvedValueOnce({
        success: true,
      });

      const { result } = renderHook(() => useCliAgentInstall('gemini-cli', 'agent-789'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const success = await result.current.install();

      expect(success).toBe(true);
      expect(result.current.version).toBe(null);
    });
  });

  describe('checkInstallation method', () => {
    it('should manually check installation', async () => {
      mockGet.mockResolvedValue({
        installed: true,
        version: '1.0.0',
      });

      const { result } = renderHook(() => useCliAgentInstall('claude-code', 'agent-123'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGet).toHaveBeenCalledTimes(1);

      await result.current.checkInstallation();

      expect(mockGet).toHaveBeenCalledTimes(2);
    });
  });
});

describe('CLI Capabilities', () => {
  describe('getCliCapabilities', () => {
    it('should return capabilities for claude-code', () => {
      const caps = getCliCapabilities('claude-code');

      expect(caps.thinkingSupported).toBe(true);
      expect(caps.thinkingBudgetType).toBe('tokens');
      expect(caps.visionSupported).toBe(true);
      expect(caps.mcpSupported).toBe(true);
      expect(caps.compactSupported).toBe(true);
      expect(caps.supportedModes).toContain('plan');
      expect(caps.supportedModes).toContain('ask');
      expect(caps.supportedModes).toContain('auto');
    });

    it('should return capabilities for openai-codex', () => {
      const caps = getCliCapabilities('openai-codex');

      expect(caps.thinkingSupported).toBe(true);
      expect(caps.thinkingBudgetType).toBe('effort');
      expect(caps.visionSupported).toBe(true);
      expect(caps.mcpSupported).toBe(false);
      expect(caps.compactSupported).toBe(true);
      expect(caps.supportedModes).toContain('sovereign');
    });

    it('should return capabilities for gemini-cli', () => {
      const caps = getCliCapabilities('gemini-cli');

      expect(caps.thinkingSupported).toBe(false);
      expect(caps.thinkingBudgetType).toBe('none');
      expect(caps.visionSupported).toBe(true);
      expect(caps.mcpSupported).toBe(false);
      expect(caps.compactSupported).toBe(false);
      expect(caps.limitations.length).toBeGreaterThan(0);
    });
  });

  describe('isCliFeatureSupported', () => {
    it('should check boolean features', () => {
      expect(isCliFeatureSupported('claude-code', 'thinkingSupported')).toBe(true);
      expect(isCliFeatureSupported('gemini-cli', 'thinkingSupported')).toBe(false);
      expect(isCliFeatureSupported('claude-code', 'mcpSupported')).toBe(true);
      expect(isCliFeatureSupported('openai-codex', 'mcpSupported')).toBe(false);
    });

    it('should check array features', () => {
      expect(isCliFeatureSupported('claude-code', 'supportedModes')).toBe(true);
      expect(isCliFeatureSupported('claude-code', 'supportedModels')).toBe(true);
    });

    it('should check thinkingBudgetType', () => {
      expect(isCliFeatureSupported('claude-code', 'thinkingBudgetType')).toBe(true);
      expect(isCliFeatureSupported('openai-codex', 'thinkingBudgetType')).toBe(true);
      expect(isCliFeatureSupported('gemini-cli', 'thinkingBudgetType')).toBe(false);
    });
  });

  describe('getCliSupportedModels', () => {
    it('should return models for claude-code', () => {
      const models = getCliSupportedModels('claude-code');

      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'sonnet')).toBe(true);
      expect(models.some((m) => m.id === 'opus')).toBe(true);
      expect(models.some((m) => m.id === 'haiku')).toBe(true);
    });

    it('should return models for openai-codex', () => {
      const models = getCliSupportedModels('openai-codex');

      expect(models.some((m) => m.id === 'gpt-5')).toBe(true);
      expect(models.some((m) => m.id === 'o3')).toBe(true);
      expect(models.some((m) => m.id === 'o4-mini')).toBe(true);
    });

    it('should return models for gemini-cli', () => {
      const models = getCliSupportedModels('gemini-cli');

      expect(models.some((m) => m.id === 'gemini-2.5-pro')).toBe(true);
      expect(models.some((m) => m.id === 'gemini-2.5-flash')).toBe(true);
      expect(models.some((m) => m.id === 'gemini-2.0-flash')).toBe(true);
    });

    it('should have default models marked', () => {
      const claudeModels = getCliSupportedModels('claude-code');
      const defaultModel = claudeModels.find((m) => m.default);
      expect(defaultModel?.id).toBe('sonnet');

      const openaiModels = getCliSupportedModels('openai-codex');
      const openaiDefault = openaiModels.find((m) => m.default);
      expect(openaiDefault?.id).toBe('gpt-5');

      const geminiModels = getCliSupportedModels('gemini-cli');
      const geminiDefault = geminiModels.find((m) => m.default);
      expect(geminiDefault?.id).toBe('gemini-2.5-pro');
    });
  });

  describe('normalizeCliModelId', () => {
    describe('Claude Code normalization', () => {
      it('should normalize exact matches', () => {
        expect(normalizeCliModelId('sonnet', 'claude-code')).toBe('sonnet');
        expect(normalizeCliModelId('opus', 'claude-code')).toBe('opus');
        expect(normalizeCliModelId('haiku', 'claude-code')).toBe('haiku');
      });

      it('should normalize full model IDs to short names', () => {
        expect(normalizeCliModelId('claude-sonnet-4-5-20250929', 'claude-code')).toBe('sonnet');
        expect(normalizeCliModelId('claude-opus-4-5-20251101', 'claude-code')).toBe('opus');
        expect(normalizeCliModelId('claude-haiku-3-7-20250101', 'claude-code')).toBe('haiku');
      });

      it('should handle case insensitivity', () => {
        expect(normalizeCliModelId('CLAUDE-SONNET-4-5', 'claude-code')).toBe('sonnet');
        expect(normalizeCliModelId('Claude-Opus-Latest', 'claude-code')).toBe('opus');
      });

      it('should return default for unknown models', () => {
        expect(normalizeCliModelId('unknown-model', 'claude-code')).toBe('sonnet');
      });
    });

    describe('OpenAI Codex normalization', () => {
      it('should normalize OpenAI model IDs', () => {
        expect(normalizeCliModelId('gpt-5', 'openai-codex')).toBe('gpt-5');
        expect(normalizeCliModelId('o3', 'openai-codex')).toBe('o3');
        expect(normalizeCliModelId('o4-mini', 'openai-codex')).toBe('o4-mini');
        expect(normalizeCliModelId('gpt-4.1', 'openai-codex')).toBe('gpt-4.1');
      });

      it('should handle OpenAI full model IDs', () => {
        expect(normalizeCliModelId('gpt-5-turbo-2025', 'openai-codex')).toBe('gpt-5');
        expect(normalizeCliModelId('o3-preview', 'openai-codex')).toBe('o3');
        expect(normalizeCliModelId('gpt-4-1-preview', 'openai-codex')).toBe('gpt-4.1');
      });

      it('should return default for unknown OpenAI models', () => {
        expect(normalizeCliModelId('unknown', 'openai-codex')).toBe('gpt-5');
      });
    });

    describe('Gemini CLI normalization', () => {
      it('should normalize Gemini model IDs', () => {
        expect(normalizeCliModelId('gemini-2.5-pro', 'gemini-cli')).toBe('gemini-2.5-pro');
        expect(normalizeCliModelId('gemini-2.5-flash', 'gemini-cli')).toBe('gemini-2.5-flash');
        expect(normalizeCliModelId('gemini-2.0-flash', 'gemini-cli')).toBe('gemini-2.0-flash');
      });

      it('should handle Gemini version variations', () => {
        expect(normalizeCliModelId('gemini-2-5-pro-latest', 'gemini-cli')).toBe('gemini-2.5-pro');
        expect(normalizeCliModelId('gemini-2-5-flash', 'gemini-cli')).toBe('gemini-2.5-flash');
        expect(normalizeCliModelId('gemini-2-0-flash', 'gemini-cli')).toBe('gemini-2.0-flash');
      });

      it('should return default for unknown Gemini models', () => {
        expect(normalizeCliModelId('unknown', 'gemini-cli')).toBe('gemini-2.5-pro');
      });
    });
  });

  describe('isCliModeSupported', () => {
    it('should check plan mode support', () => {
      expect(isCliModeSupported('claude-code', 'plan')).toBe(true);
      expect(isCliModeSupported('openai-codex', 'plan')).toBe(false);
      expect(isCliModeSupported('gemini-cli', 'plan')).toBe(false);
    });

    it('should check ask mode support', () => {
      expect(isCliModeSupported('claude-code', 'ask')).toBe(true);
      expect(isCliModeSupported('openai-codex', 'ask')).toBe(true);
      expect(isCliModeSupported('gemini-cli', 'ask')).toBe(true);
    });

    it('should check auto mode support', () => {
      expect(isCliModeSupported('claude-code', 'auto')).toBe(true);
      expect(isCliModeSupported('openai-codex', 'auto')).toBe(true);
      expect(isCliModeSupported('gemini-cli', 'auto')).toBe(true);
    });

    it('should check sovereign mode support', () => {
      expect(isCliModeSupported('claude-code', 'sovereign')).toBe(false);
      expect(isCliModeSupported('openai-codex', 'sovereign')).toBe(true);
      expect(isCliModeSupported('gemini-cli', 'sovereign')).toBe(true);
    });
  });
});

describe('Helper functions', () => {
  describe('getCliAgentType', () => {
    it('should return correct agent type for valid roles', () => {
      expect(getCliAgentType('claude-code')).toBe('claude-code');
      expect(getCliAgentType('openai-codex')).toBe('openai-codex');
      expect(getCliAgentType('gemini-cli')).toBe('gemini-cli');
    });

    it('should return null for invalid roles', () => {
      expect(getCliAgentType('architect')).toBe(null);
      expect(getCliAgentType('developer')).toBe(null);
      expect(getCliAgentType('unknown')).toBe(null);
      expect(getCliAgentType('')).toBe(null);
    });
  });

  describe('isCliAgentRole', () => {
    it('should return true for CLI agent roles', () => {
      expect(isCliAgentRole('claude-code')).toBe(true);
      expect(isCliAgentRole('openai-codex')).toBe(true);
      expect(isCliAgentRole('gemini-cli')).toBe(true);
    });

    it('should return false for non-CLI roles', () => {
      expect(isCliAgentRole('architect')).toBe(false);
      expect(isCliAgentRole('developer')).toBe(false);
      expect(isCliAgentRole('unknown')).toBe(false);
      expect(isCliAgentRole('')).toBe(false);
    });
  });
});

describe('CLI_CAPABILITIES constant', () => {
  it('should have all required agent types', () => {
    expect(CLI_CAPABILITIES['claude-code']).toBeDefined();
    expect(CLI_CAPABILITIES['openai-codex']).toBeDefined();
    expect(CLI_CAPABILITIES['gemini-cli']).toBeDefined();
  });

  it('should have all required capability fields', () => {
    const requiredFields = [
      'thinkingSupported',
      'thinkingBudgetType',
      'thinkingDescription',
      'supportedModes',
      'supportedModels',
      'visionSupported',
      'attachmentsSupported',
      'mcpSupported',
      'compactSupported',
      'limitations',
    ];

    Object.values(CLI_CAPABILITIES).forEach((caps) => {
      requiredFields.forEach((field) => {
        expect(caps).toHaveProperty(field);
      });
    });
  });

  it('should have at least one supported model per agent', () => {
    Object.values(CLI_CAPABILITIES).forEach((caps) => {
      expect(caps.supportedModels.length).toBeGreaterThan(0);
    });
  });

  it('should have at least one default model per agent', () => {
    Object.values(CLI_CAPABILITIES).forEach((caps) => {
      const hasDefault = caps.supportedModels.some((m) => m.default);
      expect(hasDefault).toBe(true);
    });
  });

  it('should have valid model capabilities', () => {
    Object.values(CLI_CAPABILITIES).forEach((caps) => {
      caps.supportedModels.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(typeof model.id).toBe('string');
        expect(typeof model.name).toBe('string');
      });
    });
  });
});
