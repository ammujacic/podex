/**
 * Tests for run command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerRunCommand } from '../run';

// Mock the auth service
const mockAuthService = {
  isAuthenticated: vi.fn(() => true),
  getCredentials: vi.fn(() => ({
    email: 'test@example.com',
    userId: 'user-123',
    accessToken: 'token',
    expiresAt: Date.now() + 3600000,
  })),
};

vi.mock('../../services/auth-service', () => ({
  getAuthService: () => mockAuthService,
}));

// Mock ink render
const mockWaitUntilExit = vi.fn(() => Promise.resolve());
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: mockWaitUntilExit,
    unmount: vi.fn(),
    rerender: vi.fn(),
    cleanup: vi.fn(),
    clear: vi.fn(),
  })),
}));

// Mock the App component
vi.mock('../../app/App', () => ({
  App: vi.fn(() => null),
}));

describe('Run Command', () => {
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride(); // Prevent process.exit
    registerRunCommand(program);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('command registration', () => {
    it('should register run command', () => {
      const runCommand = program.commands.find((c) => c.name() === 'run');
      expect(runCommand).toBeDefined();
    });

    it('should have correct description', () => {
      const runCommand = program.commands.find((c) => c.name() === 'run');
      expect(runCommand?.description()).toBe('Run a one-shot task');
    });

    it('should have session option', () => {
      const runCommand = program.commands.find((c) => c.name() === 'run');
      const sessionOption = runCommand?.options.find((o) => o.long === '--session');
      expect(sessionOption).toBeDefined();
    });

    it('should have local option', () => {
      const runCommand = program.commands.find((c) => c.name() === 'run');
      const localOption = runCommand?.options.find((o) => o.long === '--local');
      expect(localOption).toBeDefined();
    });

    it('should have exit option', () => {
      const runCommand = program.commands.find((c) => c.name() === 'run');
      const exitOption = runCommand?.options.find((o) => o.long === '--exit');
      expect(exitOption).toBeDefined();
    });
  });

  describe('run execution', () => {
    it('should require authentication', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(false);

      try {
        await program.parseAsync(['node', 'test', 'run', 'test task']);
      } catch {
        // Expected to throw due to process.exit mock
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Not authenticated'));
    });

    it('should log task when authenticated', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);

      await program.parseAsync(['node', 'test', 'run', 'my test task']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Running task: my test task')
      );
    });

    it('should render App in run mode', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);
      const { render } = await import('ink');

      await program.parseAsync(['node', 'test', 'run', 'build project']);

      expect(render).toHaveBeenCalled();
    });

    it('should wait for app exit', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);

      await program.parseAsync(['node', 'test', 'run', 'test task']);

      expect(mockWaitUntilExit).toHaveBeenCalled();
    });

    it('should pass session option to App', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);
      const { render } = await import('ink');

      await program.parseAsync(['node', 'test', 'run', 'task', '--session', 'sess-123']);

      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            sessionId: 'sess-123',
          }),
        })
      );
    });

    it('should pass local option to App', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);
      const { render } = await import('ink');

      await program.parseAsync(['node', 'test', 'run', 'task', '--local']);

      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            local: true,
          }),
        })
      );
    });

    it('should pass exit option to App', async () => {
      mockAuthService.isAuthenticated.mockReturnValue(true);
      const { render } = await import('ink');

      await program.parseAsync(['node', 'test', 'run', 'task', '--exit']);

      expect(render).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            exitOnComplete: true,
          }),
        })
      );
    });
  });
});
