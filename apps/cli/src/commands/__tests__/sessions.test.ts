/**
 * Tests for sessions commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSessionsCommands } from '../sessions';

// Mock auth service
const mockAuthService = {
  isAuthenticated: vi.fn(() => true),
};

// Mock session service
const mockSessionService = {
  listSessions: vi.fn(() =>
    Promise.resolve({
      sessions: [
        {
          id: 'session-1',
          name: 'Test Session',
          status: 'active',
          branch: 'main',
          agents: [{ id: 'agent-1', name: 'Agent 1', role: 'developer', status: 'idle' }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })
  ),
  getSession: vi.fn(() =>
    Promise.resolve({
      id: 'session-1',
      name: 'Test Session',
      status: 'active',
      branch: 'main',
      agents: [{ id: 'agent-1', name: 'Agent 1', role: 'developer', status: 'idle' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  ),
  deleteSession: vi.fn(() => Promise.resolve()),
};

vi.mock('../../services/auth-service', () => ({
  getAuthService: () => mockAuthService,
}));

vi.mock('../../services/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Sessions Commands', () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSessionsCommands(program);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.clearAllMocks();
    mockAuthService.isAuthenticated.mockReturnValue(true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('sessions command', () => {
    it('should register sessions command', () => {
      const sessionsCommand = program.commands.find((c) => c.name() === 'sessions');
      expect(sessionsCommand).toBeDefined();
    });

    it('should have list subcommand', () => {
      const sessionsCommand = program.commands.find((c) => c.name() === 'sessions');
      const listCommand = sessionsCommand?.commands.find((c) => c.name() === 'list');
      expect(listCommand).toBeDefined();
    });

    it('should have delete subcommand', () => {
      const sessionsCommand = program.commands.find((c) => c.name() === 'sessions');
      const deleteCommand = sessionsCommand?.commands.find((c) => c.name() === 'delete');
      expect(deleteCommand).toBeDefined();
    });

    it('should have info subcommand', () => {
      const sessionsCommand = program.commands.find((c) => c.name() === 'sessions');
      const infoCommand = sessionsCommand?.commands.find((c) => c.name() === 'info');
      expect(infoCommand).toBeDefined();
    });
  });

  describe('sessions list', () => {
    it('should list sessions', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'list']);

      expect(mockSessionService.listSessions).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show no sessions message when empty', async () => {
      mockSessionService.listSessions.mockResolvedValueOnce({ sessions: [], total: 0 });

      await program.parseAsync(['node', 'test', 'sessions', 'list']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No sessions found'));
    });

    it('should output JSON format', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'list', '--format', 'json']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('['));
    });

    it('should respect limit option', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'list', '--limit', '5']);

      expect(mockSessionService.listSessions).toHaveBeenCalledWith(5, 0);
    });
  });

  describe('sessions info', () => {
    it('should show session info', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'info', 'session-1']);

      expect(mockSessionService.getSession).toHaveBeenCalledWith('session-1');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Session Details'));
    });

    it('should show agents if present', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'info', 'session-1']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Agents'));
    });
  });

  describe('sessions delete', () => {
    it('should prompt for confirmation without force', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'delete', 'session-1']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Are you sure'));
      expect(mockSessionService.deleteSession).not.toHaveBeenCalled();
    });

    it('should delete with force flag', async () => {
      await program.parseAsync(['node', 'test', 'sessions', 'delete', 'session-1', '--force']);

      expect(mockSessionService.deleteSession).toHaveBeenCalledWith('session-1');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('deleted'));
    });
  });

  describe('authentication required', () => {
    it('should require auth for list', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);

      try {
        await program.parseAsync(['node', 'test', 'sessions', 'list']);
      } catch {
        // Expected exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    });

    it('should require auth for info', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);

      try {
        await program.parseAsync(['node', 'test', 'sessions', 'info', 'session-1']);
      } catch {
        // Expected exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    });

    it('should require auth for delete', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);

      try {
        await program.parseAsync(['node', 'test', 'sessions', 'delete', 'session-1', '--force']);
      } catch {
        // Expected exit
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    });
  });
});
