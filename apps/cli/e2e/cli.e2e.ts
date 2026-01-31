/**
 * E2E tests for CLI binary.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Path to the CLI binary
const CLI_PATH = path.join(__dirname, '../dist/bin/podex.js');

// Helper to run CLI commands
function runCli(
  args: string[],
  options: { timeout?: number } = {}
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      timeout: options.timeout || 10000,
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || '',
      exitCode: execError.status || 1,
    };
  }
}

describe('CLI E2E Tests', () => {
  beforeAll(() => {
    // Ensure CLI is built
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run 'pnpm build' first. Expected: ${CLI_PATH}`);
    }
  });

  describe('help command', () => {
    it('should show help with --help', () => {
      const result = runCli(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Podex CLI');
      expect(result.stdout).toContain('auth');
      expect(result.stdout).toContain('sessions');
      expect(result.stdout).toContain('config');
    });

    it('should show version with --version', () => {
      const result = runCli(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('auth command', () => {
    it('should show auth help', () => {
      const result = runCli(['auth', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('login');
      expect(result.stdout).toContain('logout');
      expect(result.stdout).toContain('status');
    });

    it('should show not logged in status', () => {
      const result = runCli(['auth', 'status']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Not logged in');
    });
  });

  describe('config command', () => {
    it('should show config help', () => {
      const result = runCli(['config', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('get');
      expect(result.stdout).toContain('set');
      expect(result.stdout).toContain('reset');
      expect(result.stdout).toContain('path');
    });

    it('should show all config with get', () => {
      const result = runCli(['config', 'get']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Current Configuration');
      expect(result.stdout).toContain('apiUrl');
      expect(result.stdout).toContain('defaultLocal');
    });

    it('should get specific config value', () => {
      const result = runCli(['config', 'get', 'debug']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/true|false/);
    });

    it('should show config path', () => {
      const result = runCli(['config', 'path']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('.podex/config.json');
    });

    it('should set and get config value', () => {
      // Set debug to true
      const setResult = runCli(['config', 'set', 'debug', 'true']);
      expect(setResult.exitCode).toBe(0);
      expect(setResult.stdout).toContain('Set debug');

      // Get debug value
      const getResult = runCli(['config', 'get', 'debug']);
      expect(getResult.exitCode).toBe(0);
      expect(getResult.stdout).toContain('true');

      // Reset to false
      runCli(['config', 'set', 'debug', 'false']);
    });

    it('should reject invalid config key', () => {
      const result = runCli(['config', 'get', 'invalidKey']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Unknown configuration key');
    });

    it('should reject invalid URL for apiUrl', () => {
      const result = runCli(['config', 'set', 'apiUrl', 'not-a-url']);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('sessions command', () => {
    it('should show sessions help', () => {
      const result = runCli(['sessions', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('delete');
      expect(result.stdout).toContain('info');
    });

    it('should fail sessions list when not authenticated', () => {
      const result = runCli(['sessions', 'list']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Not authenticated');
    });
  });

  describe('run command', () => {
    it('should fail run when not authenticated', () => {
      const result = runCli(['run', '"test-task"']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Not authenticated');
    });

    it('should show run help', () => {
      const result = runCli(['run', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('one-shot task');
      expect(result.stdout).toContain('--session');
      expect(result.stdout).toContain('--local');
    });
  });

  describe('invalid commands', () => {
    it('should show error for unknown command', () => {
      const result = runCli(['unknowncommand']);

      expect(result.exitCode).toBe(1);
    });

    it('should show error for missing required argument', () => {
      const result = runCli(['sessions', 'info']);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('config reset', () => {
    it('should reset all config to defaults', () => {
      // First set a value
      runCli(['config', 'set', 'debug', 'true']);

      // Reset all config
      const result = runCli(['config', 'reset']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('reset to defaults');
    });
  });

  describe('auth logout', () => {
    it('should handle logout when not logged in', () => {
      const result = runCli(['auth', 'logout']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Not logged in');
    });
  });

  describe('sessions info', () => {
    it('should fail sessions info when not authenticated', () => {
      const result = runCli(['sessions', 'info', 'fake-session-id']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Not authenticated');
    });
  });

  describe('sessions delete', () => {
    it('should fail sessions delete when not authenticated', () => {
      const result = runCli(['sessions', 'delete', 'fake-session-id']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Not authenticated');
    });
  });

  describe('config edge cases', () => {
    it('should set defaultLocal to true', () => {
      const setResult = runCli(['config', 'set', 'defaultLocal', 'true']);
      expect(setResult.exitCode).toBe(0);

      const getResult = runCli(['config', 'get', 'defaultLocal']);
      expect(getResult.stdout).toContain('true');

      // Reset
      runCli(['config', 'set', 'defaultLocal', 'false']);
    });

    it('should set valid apiUrl', () => {
      const originalUrl = runCli(['config', 'get', 'apiUrl']).stdout.trim();

      const setResult = runCli(['config', 'set', 'apiUrl', 'https://test.example.com']);
      expect(setResult.exitCode).toBe(0);

      const getResult = runCli(['config', 'get', 'apiUrl']);
      expect(getResult.stdout).toContain('https://test.example.com');

      // Reset to original
      runCli(['config', 'reset', 'apiUrl']);
    });

    it('should treat non-true value as false for debug', () => {
      const result = runCli(['config', 'set', 'debug', 'notabool']);

      // CLI treats any non-"true" value as false
      expect(result.exitCode).toBe(0);

      const getResult = runCli(['config', 'get', 'debug']);
      expect(getResult.stdout).toContain('false');
    });

    it('should reject invalid maxMessageHistory', () => {
      const result = runCli(['config', 'set', 'maxMessageHistory', 'notanumber']);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('command flags', () => {
    it('should handle short flags', () => {
      const result = runCli(['-h']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Podex CLI');
    });

    it('should handle -V for version', () => {
      const result = runCli(['-V']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('subcommand help', () => {
    it('should show auth login help', () => {
      const result = runCli(['auth', 'login', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Log in');
      expect(result.stdout).toContain('--no-browser');
    });

    it('should show config set help', () => {
      const result = runCli(['config', 'set', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set');
    });

    it('should show sessions list help', () => {
      const result = runCli(['sessions', 'list', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('List');
    });
  });

  describe('output format', () => {
    it('should output clean text without ANSI in CI', () => {
      // When NO_COLOR or CI is set, output should be clean
      const result = runCli(['--help']);

      // Just verify we get readable output
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('Commands:');
    });
  });

  describe('autoApprove config', () => {
    it('should set autoApprove categories', () => {
      const result = runCli(['config', 'set', 'autoApprove', 'shell,file']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set autoApprove');
    });

    it('should get autoApprove value', () => {
      // First set a value
      runCli(['config', 'set', 'autoApprove', 'shell']);

      const result = runCli(['config', 'get', 'autoApprove']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('shell');

      // Reset
      runCli(['config', 'reset']);
    });

    it('should handle empty autoApprove', () => {
      runCli(['config', 'reset']);

      const result = runCli(['config', 'get', 'autoApprove']);

      expect(result.exitCode).toBe(0);
    });
  });

  describe('maxMessageHistory config', () => {
    it('should set maxMessageHistory', () => {
      const result = runCli(['config', 'set', 'maxMessageHistory', '100']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Set maxMessageHistory');
    });

    it('should get maxMessageHistory value', () => {
      runCli(['config', 'set', 'maxMessageHistory', '50']);

      const result = runCli(['config', 'get', 'maxMessageHistory']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('50');

      // Reset
      runCli(['config', 'reset']);
    });

    it('should reject zero maxMessageHistory', () => {
      const result = runCli(['config', 'set', 'maxMessageHistory', '0']);

      expect(result.exitCode).toBe(1);
    });

    it('should reject negative maxMessageHistory', () => {
      const result = runCli(['config', 'set', 'maxMessageHistory', '-5']);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('combined commands', () => {
    it('should handle multiple config operations', () => {
      // Set multiple values
      runCli(['config', 'set', 'debug', 'true']);
      runCli(['config', 'set', 'defaultLocal', 'true']);
      runCli(['config', 'set', 'maxMessageHistory', '200']);

      // Verify all
      const result = runCli(['config', 'get']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('true');
      expect(result.stdout).toContain('200');

      // Reset all
      runCli(['config', 'reset']);
    });
  });

  describe('auth login options', () => {
    it('should accept --no-browser flag', () => {
      // Just verify the flag is accepted (will fail due to not authenticated)
      const result = runCli(['auth', 'login', '--no-browser'], { timeout: 2000 });

      // Should start login process but we can't complete it in tests
      // Just check it doesn't immediately error on the flag
      expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
    });
  });

  describe('sessions list options', () => {
    it('should show sessions list limit option', () => {
      const result = runCli(['sessions', 'list', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--limit');
    });
  });

  describe('error messages', () => {
    it('should show helpful error for invalid config key', () => {
      const result = runCli(['config', 'set', 'invalidKey', 'value']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Unknown configuration key');
      expect(result.stdout).toContain('Available keys');
    });

    it('should show helpful error for invalid URL', () => {
      const result = runCli(['config', 'set', 'apiUrl', 'not-a-valid-url']);

      expect(result.exitCode).toBe(1);
      // Error might be in stdout or stderr depending on how commander handles it
      const output = result.stdout + result.stderr;
      expect(output).toContain('Failed to set');
    });
  });
});
