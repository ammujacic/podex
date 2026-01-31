/**
 * CLI runner helper for E2E tests.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

export interface CliRunnerOptions {
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}

export interface CliRunner extends EventEmitter {
  process: ChildProcess;
  output: string;
  exitCode: number | null;
  write: (input: string) => void;
  pressKey: (key: string) => void;
  waitForOutput: (pattern: string | RegExp, timeout?: number) => Promise<string>;
  waitForExit: (timeout?: number) => Promise<number>;
  kill: () => void;
}

const CLI_PATH = path.join(__dirname, '../../dist/bin/podex.js');

export function runCLI(options: CliRunnerOptions = {}): CliRunner {
  const { args = [], env = {}, cwd = process.cwd(), timeout = 30000 } = options;

  const emitter = new EventEmitter() as CliRunner;
  let output = '';
  let exitCode: number | null = null;

  const proc = spawn('node', [CLI_PATH, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const text = data.toString();
    output += text;
    emitter.emit('output', text);
  });

  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString();
    output += text;
    emitter.emit('error', text);
  });

  proc.on('close', (code) => {
    exitCode = code;
    emitter.emit('exit', code);
  });

  const timeoutId = setTimeout(() => {
    proc.kill('SIGTERM');
  }, timeout);

  proc.on('close', () => clearTimeout(timeoutId));

  emitter.process = proc;

  Object.defineProperty(emitter, 'output', {
    get: () => output,
  });

  Object.defineProperty(emitter, 'exitCode', {
    get: () => exitCode,
  });

  emitter.write = (input: string): void => {
    proc.stdin?.write(input);
  };

  emitter.pressKey = (key: string): void => {
    proc.stdin?.write(key);
  };

  emitter.waitForOutput = (pattern: string | RegExp, waitTimeout = 10000): Promise<string> => {
    return new Promise((resolve, reject) => {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;

      const match = output.match(regex);
      if (match) {
        resolve(match[0]);
        return;
      }

      const timer = setTimeout(() => {
        emitter.off('output', onOutput);
        reject(new Error(`Timeout waiting for output: ${pattern}\nGot: ${output}`));
      }, waitTimeout);

      const onOutput = (): void => {
        const fullMatch = output.match(regex);
        if (fullMatch) {
          clearTimeout(timer);
          emitter.off('output', onOutput);
          resolve(fullMatch[0]);
        }
      };

      emitter.on('output', onOutput);
    });
  };

  emitter.waitForExit = (waitTimeout = 10000): Promise<number> => {
    return new Promise((resolve, reject) => {
      if (exitCode !== null) {
        resolve(exitCode);
        return;
      }

      const timer = setTimeout(() => {
        emitter.off('exit', onExit);
        proc.kill('SIGTERM');
        reject(new Error('Timeout waiting for CLI to exit'));
      }, waitTimeout);

      const onExit = (code: number): void => {
        clearTimeout(timer);
        resolve(code);
      };

      emitter.once('exit', onExit);
    });
  };

  emitter.kill = (): void => {
    proc.kill('SIGTERM');
  };

  return emitter;
}

export const TerminalKeys = {
  ENTER: '\n',
  CTRL_C: '\x03',
  CTRL_D: '\x04',
  UP: '\x1b[A',
  DOWN: '\x1b[B',
  YES: 'y',
  NO: 'n',
};
