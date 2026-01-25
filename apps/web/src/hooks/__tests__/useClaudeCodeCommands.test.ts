/**
 * Comprehensive tests for useClaudeCodeCommands, useClaudeCodeAuth, and useClaudeCodeInstall hooks
 * Tests the wrapper hooks around useCliAgentCommands
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useClaudeCodeCommands,
  useClaudeCodeAuth,
  useClaudeCodeInstall,
} from '../useClaudeCodeCommands';
import * as cliAgentCommandsModule from '../useCliAgentCommands';

// Mock the useCliAgentCommands module
vi.mock('../useCliAgentCommands', () => ({
  useCliAgentCommands: vi.fn(),
  useCliAgentAuth: vi.fn(),
  useCliAgentInstall: vi.fn(),
}));

describe('useClaudeCodeCommands', () => {
  const mockCommands = [
    { name: 'help', description: 'Show all available commands', builtin: true },
    { name: 'clear', description: 'Clear conversation history', builtin: true },
    { name: 'custom', description: 'Custom command', builtin: false },
  ];

  const mockRefetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
      commands: mockCommands,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should call useCliAgentCommands with claude-code', () => {
      renderHook(() => useClaudeCodeCommands());

      expect(cliAgentCommandsModule.useCliAgentCommands).toHaveBeenCalledWith('claude-code');
    });

    it('should return commands from useCliAgentCommands', () => {
      const { result } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.commands).toEqual(mockCommands);
    });

    it('should return loading state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
        commands: [],
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { result } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.isLoading).toBe(true);
    });

    it('should return error state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
        commands: [],
        isLoading: false,
        error: 'Failed to fetch commands',
        refetch: mockRefetch,
      });

      const { result } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.error).toBe('Failed to fetch commands');
    });

    it('should return refetch function', () => {
      const { result } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.refetch).toBe(mockRefetch);
    });
  });

  // ========================================
  // Refetch Tests
  // ========================================

  describe('Refetch', () => {
    it('should call refetch when invoked', async () => {
      const { result } = renderHook(() => useClaudeCodeCommands());

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // State Updates Tests
  // ========================================

  describe('State Updates', () => {
    it('should update when useCliAgentCommands updates', () => {
      const { result, rerender } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.commands).toHaveLength(3);

      // Update mock
      vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
        commands: [...mockCommands, { name: 'new', description: 'New command', builtin: false }],
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      rerender();

      expect(result.current.commands).toHaveLength(4);
    });

    it('should handle transition from loading to loaded', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
        commands: [],
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });

      const { result, rerender } = renderHook(() => useClaudeCodeCommands());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.commands).toHaveLength(0);

      // Update mock to loaded state
      vi.mocked(cliAgentCommandsModule.useCliAgentCommands).mockReturnValue({
        commands: mockCommands,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      rerender();

      expect(result.current.isLoading).toBe(false);
      expect(result.current.commands).toHaveLength(3);
    });
  });
});

// ========================================
// useClaudeCodeAuth Tests
// ========================================

describe('useClaudeCodeAuth', () => {
  const mockAuthStatus = {
    authenticated: true,
    needsAuth: false,
    credentialsSynced: true,
  };

  const mockCheckAuth = vi.fn();
  const mockReauthenticate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
      authStatus: mockAuthStatus,
      isLoading: false,
      error: null,
      checkAuth: mockCheckAuth,
      reauthenticate: mockReauthenticate,
    });
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should call useCliAgentAuth with claude-code and agentId', () => {
      renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(cliAgentCommandsModule.useCliAgentAuth).toHaveBeenCalledWith(
        'claude-code',
        'agent-123'
      );
    });

    it('should return auth status', () => {
      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.authStatus).toEqual(mockAuthStatus);
    });

    it('should return loading state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: null,
        isLoading: true,
        error: null,
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.isLoading).toBe(true);
    });

    it('should return error state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: null,
        isLoading: false,
        error: 'Auth check failed',
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.error).toBe('Auth check failed');
    });

    it('should handle undefined agentId', () => {
      renderHook(() => useClaudeCodeAuth(undefined));

      expect(cliAgentCommandsModule.useCliAgentAuth).toHaveBeenCalledWith('claude-code', undefined);
    });
  });

  // ========================================
  // Auth Operations Tests
  // ========================================

  describe('Auth Operations', () => {
    it('should call checkAuth when invoked', async () => {
      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      await act(async () => {
        await result.current.checkAuth();
      });

      expect(mockCheckAuth).toHaveBeenCalledTimes(1);
    });

    it('should call reauthenticate when invoked', async () => {
      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      await act(async () => {
        await result.current.reauthenticate();
      });

      expect(mockReauthenticate).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // Auth Status States Tests
  // ========================================

  describe('Auth Status States', () => {
    it('should handle authenticated state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: {
          authenticated: true,
          needsAuth: false,
          credentialsSynced: true,
        },
        isLoading: false,
        error: null,
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.authStatus?.authenticated).toBe(true);
      expect(result.current.authStatus?.needsAuth).toBe(false);
    });

    it('should handle needs auth state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: {
          authenticated: false,
          needsAuth: true,
          credentialsSynced: false,
        },
        isLoading: false,
        error: null,
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.authStatus?.authenticated).toBe(false);
      expect(result.current.authStatus?.needsAuth).toBe(true);
    });

    it('should handle credentials not synced', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: {
          authenticated: true,
          needsAuth: false,
          credentialsSynced: false,
        },
        isLoading: false,
        error: null,
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.authStatus?.credentialsSynced).toBe(false);
    });

    it('should handle null auth status', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentAuth).mockReturnValue({
        authStatus: null,
        isLoading: false,
        error: null,
        checkAuth: mockCheckAuth,
        reauthenticate: mockReauthenticate,
      });

      const { result } = renderHook(() => useClaudeCodeAuth('agent-123'));

      expect(result.current.authStatus).toBeNull();
    });
  });
});

// ========================================
// useClaudeCodeInstall Tests
// ========================================

describe('useClaudeCodeInstall', () => {
  const mockCheckInstallation = vi.fn();
  const mockInstall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
      isInstalled: true,
      version: '1.0.0',
      isLoading: false,
      error: null,
      checkInstallation: mockCheckInstallation,
      install: mockInstall,
    });
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should call useCliAgentInstall with claude-code and agentId', () => {
      renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(cliAgentCommandsModule.useCliAgentInstall).toHaveBeenCalledWith(
        'claude-code',
        'agent-123'
      );
    });

    it('should return installation status', () => {
      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isInstalled).toBe(true);
      expect(result.current.version).toBe('1.0.0');
    });

    it('should return loading state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: null,
        version: null,
        isLoading: true,
        error: null,
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isLoading).toBe(true);
    });

    it('should return error state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: null,
        version: null,
        isLoading: false,
        error: 'Installation check failed',
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.error).toBe('Installation check failed');
    });

    it('should handle undefined agentId', () => {
      renderHook(() => useClaudeCodeInstall(undefined));

      expect(cliAgentCommandsModule.useCliAgentInstall).toHaveBeenCalledWith(
        'claude-code',
        undefined
      );
    });
  });

  // ========================================
  // Install Operations Tests
  // ========================================

  describe('Install Operations', () => {
    it('should call checkInstallation when invoked', async () => {
      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      await act(async () => {
        await result.current.checkInstallation();
      });

      expect(mockCheckInstallation).toHaveBeenCalledTimes(1);
    });

    it('should call install when invoked', async () => {
      mockInstall.mockResolvedValue(true);

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      await act(async () => {
        await result.current.install();
      });

      expect(mockInstall).toHaveBeenCalledTimes(1);
    });

    it('should return install result', async () => {
      mockInstall.mockResolvedValue(true);

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      let installResult: boolean = false;
      await act(async () => {
        installResult = await result.current.install();
      });

      expect(installResult).toBe(true);
    });

    it('should handle install failure', async () => {
      mockInstall.mockResolvedValue(false);

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      let installResult: boolean = true;
      await act(async () => {
        installResult = await result.current.install();
      });

      expect(installResult).toBe(false);
    });
  });

  // ========================================
  // Installation States Tests
  // ========================================

  describe('Installation States', () => {
    it('should handle installed state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: true,
        version: '2.0.0',
        isLoading: false,
        error: null,
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isInstalled).toBe(true);
      expect(result.current.version).toBe('2.0.0');
    });

    it('should handle not installed state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: false,
        version: null,
        isLoading: false,
        error: null,
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isInstalled).toBe(false);
      expect(result.current.version).toBeNull();
    });

    it('should handle unknown installation state', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: null,
        version: null,
        isLoading: false,
        error: null,
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isInstalled).toBeNull();
    });

    it('should handle installation with error', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: true,
        version: '1.0.0',
        isLoading: false,
        error: 'Version outdated',
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.isInstalled).toBe(true);
      expect(result.current.error).toBe('Version outdated');
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle agentId change', () => {
      const { rerender } = renderHook(({ agentId }) => useClaudeCodeInstall(agentId), {
        initialProps: { agentId: 'agent-123' },
      });

      expect(cliAgentCommandsModule.useCliAgentInstall).toHaveBeenCalledWith(
        'claude-code',
        'agent-123'
      );

      rerender({ agentId: 'agent-456' });

      expect(cliAgentCommandsModule.useCliAgentInstall).toHaveBeenCalledWith(
        'claude-code',
        'agent-456'
      );
    });

    it('should handle empty version string', () => {
      vi.mocked(cliAgentCommandsModule.useCliAgentInstall).mockReturnValue({
        isInstalled: true,
        version: '',
        isLoading: false,
        error: null,
        checkInstallation: mockCheckInstallation,
        install: mockInstall,
      });

      const { result } = renderHook(() => useClaudeCodeInstall('agent-123'));

      expect(result.current.version).toBe('');
    });
  });
});
