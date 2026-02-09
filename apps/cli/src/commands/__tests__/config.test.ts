/**
 * Tests for config commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use a real temp directory for these tests
const TEST_DIR = path.join(os.tmpdir(), 'podex-config-cmd-test');
const PODEX_DIR = path.join(TEST_DIR, '.podex');

// Mock os.homedir before importing
vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

// Capture console output
let consoleOutput: string[] = [];
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation((...args) => {
  consoleOutput.push(args.join(' '));
});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
  consoleOutput.push(args.join(' '));
});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

describe('Config Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(PODEX_DIR, { recursive: true });
  });

  afterEach(() => {
    vi.resetModules();
    try {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('config get', () => {
    it('should show all config values', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'get']);

      expect(consoleOutput.some((line) => line.includes('Current Configuration'))).toBe(true);
      expect(consoleOutput.some((line) => line.includes('apiUrl'))).toBe(true);
    });

    it('should get a specific config value', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'get', 'debug']);

      expect(consoleOutput.some((line) => line.includes('false'))).toBe(true);
    });

    it('should error on unknown config key', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'config', 'get', 'unknownKey'])
      ).rejects.toThrow('process.exit(1)');

      expect(consoleOutput.some((line) => line.includes('Unknown configuration key'))).toBe(true);
    });
  });

  describe('config set', () => {
    it('should set apiUrl', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'set', 'apiUrl', 'https://new.api.com']);

      expect(consoleOutput.some((line) => line.includes('Set apiUrl'))).toBe(true);
    });

    it('should set debug to true', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'set', 'debug', 'true']);

      expect(consoleOutput.some((line) => line.includes('Set debug'))).toBe(true);
    });

    it('should set defaultLocal', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'set', 'defaultLocal', 'true']);

      expect(consoleOutput.some((line) => line.includes('Set defaultLocal'))).toBe(true);
    });

    it('should set autoApprove as comma-separated list', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync([
        'node',
        'test',
        'config',
        'set',
        'autoApprove',
        'read_file,write_file',
      ]);

      expect(consoleOutput.some((line) => line.includes('Set autoApprove'))).toBe(true);
    });

    it('should set maxMessageHistory', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'set', 'maxMessageHistory', '100']);

      expect(consoleOutput.some((line) => line.includes('Set maxMessageHistory'))).toBe(true);
    });

    it('should error on invalid maxMessageHistory', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'config', 'set', 'maxMessageHistory', 'invalid'])
      ).rejects.toThrow('process.exit(1)');
    });

    it('should error on unknown config key', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'config', 'set', 'unknownKey', 'value'])
      ).rejects.toThrow('process.exit(1)');
    });

    it('should error on invalid URL for apiUrl', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await expect(
        program.parseAsync(['node', 'test', 'config', 'set', 'apiUrl', 'not-a-url'])
      ).rejects.toThrow('process.exit(1)');
    });
  });

  describe('config reset', () => {
    it('should reset config to defaults', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'reset']);

      expect(consoleOutput.some((line) => line.includes('reset to defaults'))).toBe(true);
    });
  });

  describe('config path', () => {
    it('should show config file path', async () => {
      const { registerConfigCommands } = await import('../config');
      const program = new Command();
      registerConfigCommands(program);

      await program.parseAsync(['node', 'test', 'config', 'path']);

      expect(consoleOutput.some((line) => line.includes('.podex/config.json'))).toBe(true);
    });
  });
});
